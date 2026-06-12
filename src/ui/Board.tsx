// Board.tsx — full-viewport SVG board (spec §9.1): viewBox fitted to the board
// bbox, pinch-zoom + pan via pointer events (zoom clamped 0.5–4×), tap → cell
// via native SVG events per polygon. All drawing delegated to src/ui/skin
// (§10.4 contract).
//
// Coordinate contract (P1 handoff): cell polygons are math-convention CCW,
// y-UP. SVG is y-down — the projection flips y per point (not via a mirroring
// group transform), so text/glyphs never render mirrored.
//
// P7 feedback layers:
// - Layer 1 (§9.2): `highlights.reachable` (budget-graded tint),
//   `highlights.targets` (ring pulse), `highlights.visionEdge` (faint contour
//   via skin/VisionEdge), `selectedUnitId` (token lift), and the stance
//   popover (`stancePopover` prop) anchored to the selected token.
// - Layer 2 (§9.3): `ghosts` rendered by skin/EffectRenderer in a dedicated
//   layer ABOVE grain/highlights and BELOW units; `onGhostTap` opens the
//   order sheet.
// - §9.5: long-press (500 ms, same 8 px slop as the tap guard) on any cell or
//   unit token → `onCellLongPress(cellId)`.
// - Overlay UI decision: the stance popover renders INSIDE the SVG (in the
//   pan/zoom group), so it tracks the token under pan/pinch for free — no
//   toClient transform sync needed. Bottom sheets are ordinary DOM outside
//   the SVG (they don't anchor to board geometry).
// - `focus` prop: when its token changes, the view pans (keeping zoom) so the
//   given cell sits at the viewBox center — dock-chip "select + center".

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Board as BoardGraph, CellId, Vec2 } from '../board/types';
import type { FactionId, Stance, UnitInstance } from '../core/types';
import {
  CellRenderer,
  EffectRenderer,
  GrainFilterDef,
  GrainOverlay,
  ReplayFx,
  StanceIcon,
  UnitRenderer,
  VisionEdge,
  factionColor,
  type GhostOrder,
  type Pt,
  type ReplayFxData,
} from './skin';

export type BoardHighlights = {
  /** Reachable-cell tint (§9.2). Map values = remaining-budget fraction 0..1
   * (stronger tint = more budget left); a Set tints uniformly. */
  reachable?: ReadonlySet<CellId> | ReadonlyMap<CellId, number>;
  /** Attackable targets: pulsing ring (§9.2). */
  targets?: ReadonlySet<CellId>;
  /** Selected unit's vision set — its edge renders as a faint contour (§9.2). */
  visionEdge?: ReadonlySet<CellId>;
};

export type StancePopoverState = {
  /** Stance shown as active: the queued one if any, else the unit's current. */
  active: Stance;
  /** §2.4: hold-fire is blocked while an explicit attack is queued. */
  holdFireDisabled: boolean;
  onPick: (stance: Stance) => void;
};

export type BoardProps = {
  board: BoardGraph;
  units?: readonly UnitInstance[];
  /** Cells under the mist (NOT visible to the viewing faction). Terrain stays
   * legible; callers also omit hidden enemy units from `units`. */
  fog?: ReadonlySet<CellId>;
  highlights?: BoardHighlights;
  selectedUnitId?: string | null;
  /** Layer-2 queued-order ghosts (§9.3), drawn by skin/EffectRenderer. */
  ghosts?: readonly GhostOrder[];
  /** Layer-3 replay effects (§9.4), drawn by skin/ReplayFx. `key` remounts
   * the fx group per replay frame so CSS animations restart. */
  replayFx?: { key: number; fx: ReplayFxData } | null;
  /** Tap a floating damage number → breakdown modal for its slot (§9.4). */
  onFloaterTap?: (slot: number) => void;
  /** Pan so this cell is centered whenever `token` changes. */
  focus?: { cell: CellId; token: number } | null;
  /** Stance popover on the selected unit (§9.2); rendered inside the SVG. */
  stancePopover?: StancePopoverState | null;
  onCellTap?: (cellId: CellId) => void;
  onUnitTap?: (unitId: string) => void;
  onGhostTap?: (unitId: string) => void;
  onCellLongPress?: (cellId: CellId) => void;
  /** Disable pan/zoom (start-screen previews). */
  interactive?: boolean;
  className?: string;
};

const WORLD_SCALE = 1000; // screen units across the board's longer side
const PAD = 14;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const TAP_SLOP_PX = 8;
const LONG_PRESS_MS = 500;

type View = { k: number; tx: number; ty: number };

function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

const STANCES: readonly Stance[] = ['aggressive', 'defensive', 'hold-fire'];

export function Board({
  board,
  units = [],
  fog,
  highlights,
  selectedUnitId = null,
  ghosts,
  replayFx = null,
  focus = null,
  stancePopover = null,
  onCellTap,
  onUnitTap,
  onGhostTap,
  onFloaterTap,
  onCellLongPress,
  interactive = true,
  className,
}: BoardProps) {
  const cells = useMemo(() => [...board.cells.values()], [board]);

  // World bbox (y-up) → projection → screen bbox (y-down).
  const { toScreen, viewBox, bbox } = useMemo(() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const cell of cells) {
      for (const [x, y] of cell.polygon) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const span = Math.max(maxX - minX, maxY - minY, 1e-9);
    const s = WORLD_SCALE / span;
    const toScreen = (p: readonly [number, number]): Pt => [
      (p[0] - minX) * s,
      (maxY - p[1]) * s, // y flip: world y-up → SVG y-down
    ];
    const w = (maxX - minX) * s;
    const h = (maxY - minY) * s;
    const bbox = { x: -PAD, y: -PAD, width: w + 2 * PAD, height: h + 2 * PAD };
    return { toScreen, viewBox: `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`, bbox };
  }, [cells]);

  // Token size: 0.62 × median neighbor-center spacing (screen units).
  const tokenSize = useMemo(() => {
    const gaps: number[] = [];
    for (const cell of cells) {
      const c = toScreen(cell.center);
      let nearest = Infinity;
      for (const nId of cell.neighbors) {
        const n = board.cells.get(nId);
        if (!n) continue;
        const p = toScreen(n.center);
        const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
        if (d < nearest) nearest = d;
      }
      if (isFinite(nearest)) gaps.push(nearest);
    }
    gaps.sort((a, b) => a - b);
    const median = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)]! : WORLD_SCALE / 16;
    return median * 0.62;
  }, [cells, board, toScreen]);

  // Base cells tint toward the faction whose anchor is nearer (§10.1).
  const baseTint = useMemo(() => {
    const tint = new Map<CellId, FactionId>();
    const anchors = board.placementAnchors;
    if (!anchors) return tint;
    const a0 = board.cells.get(anchors[0])?.center;
    const a1 = board.cells.get(anchors[1])?.center;
    if (!a0 || !a1) return tint;
    const d2 = (a: Vec2, b: Vec2) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
    for (const cell of cells) {
      if (cell.terrain !== 'base') continue;
      tint.set(cell.id, d2(cell.center, a0) <= d2(cell.center, a1) ? 0 : 1);
    }
    return tint;
  }, [cells, board]);

  // --- pan / pinch-zoom ------------------------------------------------------
  const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gestureMoved = useRef(0); // cumulative px since gesture start
  const wasPinch = useRef(false);

  // --- long-press (§9.5) -----------------------------------------------------
  // Shares the pointer tap-guard state: same 8 px slop cancels; firing
  // suppresses the synthetic click that follows pointer release.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  function cancelLongPress() {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  /** Cell under a pointer-down target: a cell polygon's group, or a unit
   * token's group mapped to the unit's cell. */
  function cellAtTarget(target: EventTarget | null): CellId | null {
    if (!(target instanceof Element)) return null;
    const cellEl = target.closest('[data-cell-id]');
    if (cellEl) return Number(cellEl.getAttribute('data-cell-id'));
    const unitEl = target.closest('[data-unit-id]');
    if (unitEl) {
      const unit = units.find((u) => u.id === unitEl.getAttribute('data-unit-id'));
      if (unit) return unit.cell;
    }
    return null;
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (!interactive) return;
    // NOTE: capture is DEFERRED until the gesture pans/pinches (see
    // onPointerMove). Capturing here retargets the browser's compatibility
    // click to the svg, which silences every cell/unit onClick — found by
    // the P7 Playwright pass; jsdom never reproduced it.
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      gestureMoved.current = 0;
      wasPinch.current = false;
      longPressFired.current = false;
      if (onCellLongPress) {
        const cellId = cellAtTarget(e.target);
        if (cellId !== null) {
          cancelLongPress();
          longPressTimer.current = setTimeout(() => {
            longPressTimer.current = null;
            longPressFired.current = true;
            onCellLongPress(cellId);
          }, LONG_PRESS_MS);
        }
      }
    } else {
      wasPinch.current = true;
      cancelLongPress();
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!interactive) return;
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    gestureMoved.current += Math.hypot(cur.x - prev.x, cur.y - prev.y);
    if (gestureMoved.current > TAP_SLOP_PX || pointers.current.size > 1) {
      cancelLongPress();
      // The gesture is a pan/pinch, not a tap: NOW capture, so it keeps
      // tracking outside the svg. The tap guard is already tripped.
      if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
    }

    if (pointers.current.size === 1) {
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
    } else if (pointers.current.size === 2) {
      const [idA, idB] = [...pointers.current.keys()] as [number, number];
      const otherId = e.pointerId === idA ? idB : idA;
      const other = pointers.current.get(otherId)!;
      const dPrev = Math.hypot(prev.x - other.x, prev.y - other.y);
      const dCur = Math.hypot(cur.x - other.x, cur.y - other.y);
      if (dPrev > 1) {
        const mid = { x: (cur.x + other.x) / 2, y: (cur.y + other.y) / 2 };
        setView((v) => {
          const k2 = clampZoom(v.k * (dCur / dPrev));
          const f = k2 / v.k;
          return { k: k2, tx: mid.x - (mid.x - v.tx) * f, ty: mid.y - (mid.y - v.ty) * f };
        });
      }
    }
    pointers.current.set(e.pointerId, cur);
  }

  function onPointerEnd(e: React.PointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId);
    cancelLongPress();
  }

  useEffect(() => cancelLongPress, []); // unmount: drop a pending timer

  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    if (!interactive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setView((v) => {
      const k2 = clampZoom(v.k * Math.exp(-e.deltaY * 0.0015));
      const f = k2 / v.k;
      return { k: k2, tx: mx - (mx - v.tx) * f, ty: my - (my - v.ty) * f };
    });
  }

  // Dock-chip "select + center": pan (keep zoom) so focus.cell sits at the
  // viewBox center. Runs only when the token changes.
  const focusToken = focus?.token;
  useEffect(() => {
    if (!focus) return;
    const cell = board.cells.get(focus.cell);
    if (!cell) return;
    const [px, py] = toScreen(cell.center);
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;
    setView((v) => ({ ...v, tx: cx - v.k * px, ty: cy - v.k * py }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken]);

  /** A click counts as a tap only if the gesture didn't pan/pinch/long-press. */
  function tapGuard<T>(handler: ((arg: T) => void) | undefined): ((arg: T) => void) | undefined {
    if (!handler) return undefined;
    return (arg: T) => {
      if (gestureMoved.current > TAP_SLOP_PX || wasPinch.current || longPressFired.current) return;
      handler(arg);
    };
  }

  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const reachable = highlights?.reachable;
  const reachAlpha = (id: CellId): number | null => {
    if (!reachable) return null;
    if (reachable instanceof Map) {
      const f = reachable.get(id);
      // 0.22..0.52: the P7 visual pass measured 0.14-base tint as nearly
      // invisible on pale-green plains at phone size.
      return f === undefined ? null : 0.22 + 0.3 * Math.min(1, Math.max(0, f));
    }
    return (reachable as ReadonlySet<CellId>).has(id) ? 0.32 : null;
  };

  const selectedUnit = selectedUnitId !== null ? unitById.get(selectedUnitId) : undefined;
  const selectedCell = selectedUnit ? board.cells.get(selectedUnit.cell) : undefined;

  return (
    <svg
      className={`board-svg${className ? ` ${className}` : ''}`}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onWheel={onWheel}
    >
      <defs>
        <GrainFilterDef />
      </defs>
      <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
        <g className="board-cells">
          {cells.map((cell) => (
            <CellRenderer
              key={cell.id}
              cell={cell}
              toScreen={toScreen}
              fogged={fog?.has(cell.id) ?? false}
              baseTintFaction={baseTint.get(cell.id) ?? null}
              onTap={tapGuard(onCellTap)}
            />
          ))}
        </g>
        <GrainOverlay {...bbox} />
        {(reachable || highlights?.targets || highlights?.visionEdge) && (
          <g className="board-highlights" pointerEvents="none">
            {cells.map((cell) => {
              const alpha = reachAlpha(cell.id);
              if (alpha === null) return null;
              const [cx, cy] = toScreen(cell.center);
              return (
                <circle
                  key={`r${cell.id}`}
                  className="reach-tint"
                  cx={cx}
                  cy={cy}
                  r={tokenSize * 0.55}
                  fill={factionColor(0)}
                  opacity={alpha}
                />
              );
            })}
            {highlights?.visionEdge && (
              <VisionEdge board={board} toScreen={toScreen} cellSet={highlights.visionEdge} />
            )}
            {highlights?.targets &&
              [...highlights.targets].map((id) => {
                const cell = board.cells.get(id);
                if (!cell) return null;
                const [cx, cy] = toScreen(cell.center);
                return (
                  <circle
                    key={`t${id}`}
                    className="target-ring"
                    cx={cx}
                    cy={cy}
                    r={tokenSize * 0.72}
                    fill="none"
                    stroke={factionColor(1)}
                    strokeWidth={tokenSize * 0.09}
                  />
                );
              })}
          </g>
        )}
        {ghosts && ghosts.length > 0 && (
          <EffectRenderer
            board={board}
            toScreen={toScreen}
            tokenSize={tokenSize}
            ghosts={ghosts}
            onGhostTap={tapGuard(onGhostTap)}
          />
        )}
        <g className="board-units">
          {[...unitById.values()].map((unit) => {
            const cell = board.cells.get(unit.cell);
            if (!cell) return null;
            const [x, y] = toScreen(cell.center);
            return (
              <UnitRenderer
                key={unit.id}
                unit={unit}
                x={x}
                y={y}
                size={tokenSize}
                selected={unit.id === selectedUnitId}
                onTap={tapGuard(onUnitTap)}
              />
            );
          })}
        </g>
        {replayFx && (
          <ReplayFx
            key={replayFx.key}
            board={board}
            toScreen={toScreen}
            tokenSize={tokenSize}
            fx={replayFx.fx}
            onFloaterTap={tapGuard(onFloaterTap)}
          />
        )}
        {stancePopover && selectedUnit && selectedCell && (
          <StancePopover
            anchor={toScreen(selectedCell.center)}
            tokenSize={tokenSize}
            state={stancePopover}
            tapGuard={tapGuard}
          />
        )}
      </g>
    </svg>
  );
}

/** §9.2 stance popover: 3 icon buttons (sword / shield / crossed) floating
 * above the selected token, inside the SVG so it pans/zooms with the board. */
function StancePopover({
  anchor,
  tokenSize,
  state,
  tapGuard,
}: {
  anchor: Pt;
  tokenSize: number;
  state: StancePopoverState;
  tapGuard: <T>(h: ((arg: T) => void) | undefined) => ((arg: T) => void) | undefined;
}) {
  const r = tokenSize * 0.44;
  const gap = r * 2.5;
  const y = anchor[1] - tokenSize * 1.55;
  const pick = tapGuard(state.onPick);
  return (
    <g className="stance-popover">
      {STANCES.map((stance, i) => {
        const x = anchor[0] + (i - 1) * gap;
        const active = stance === state.active;
        const disabled = stance === 'hold-fire' && state.holdFireDisabled;
        return (
          <g
            key={stance}
            className={`stance-option stance-${stance}${active ? ' stance-active' : ''}${disabled ? ' stance-disabled' : ''}`}
            data-stance={stance}
            transform={`translate(${x} ${y})`}
            opacity={disabled ? 0.35 : 1}
            onClick={disabled || !pick ? undefined : () => pick(stance)}
          >
            <circle
              r={r}
              fill={active ? factionColor(0) : '#fff'}
              stroke={active ? '#fff' : 'rgba(74,68,58,0.45)'}
              strokeWidth={r * 0.1}
            />
            <g pointerEvents="none">
              <StanceIcon stance={stance} size={r * 1.35} stroke={active ? '#fff' : '#6b6356'} />
            </g>
          </g>
        );
      })}
    </g>
  );
}
