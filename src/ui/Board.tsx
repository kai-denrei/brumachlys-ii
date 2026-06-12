// Board.tsx — full-viewport SVG board (spec §9.1): viewBox fitted to the board
// bbox, pinch-zoom + pan via pointer events (zoom clamped 0.5–4×), tap → cell
// via native SVG events per polygon. All drawing delegated to src/ui/skin
// (§10.4 contract).
//
// Coordinate contract (P1 handoff): cell polygons are math-convention CCW,
// y-UP. SVG is y-down — the projection flips y per point (not via a mirroring
// group transform), so text/glyphs never render mirrored.
//
// P7 hooks shipped now (visual treatments implemented, logic wired later):
// `highlights.reachable` (tint, alpha scaled by remaining-budget fraction when
// a Map is given), `highlights.targets` (pulsing ring), `selectedUnitId`
// (token lift + ground shadow).

import { useMemo, useRef, useState } from 'react';
import type { Board as BoardGraph, CellId, Vec2 } from '../board/types';
import type { FactionId, UnitInstance } from '../core/types';
import {
  CellRenderer,
  GrainFilterDef,
  GrainOverlay,
  UnitRenderer,
  factionColor,
  type Pt,
} from './skin';

export type BoardHighlights = {
  /** Reachable-cell tint (§9.2). Map values = remaining-budget fraction 0..1
   * (stronger tint = more budget left); a Set tints uniformly. */
  reachable?: ReadonlySet<CellId> | ReadonlyMap<CellId, number>;
  /** Attackable targets: pulsing ring (§9.2). */
  targets?: ReadonlySet<CellId>;
};

export type BoardProps = {
  board: BoardGraph;
  units?: readonly UnitInstance[];
  /** Cells under the mist (NOT visible to the viewing faction). Terrain stays
   * legible; callers also omit hidden enemy units from `units`. */
  fog?: ReadonlySet<CellId>;
  highlights?: BoardHighlights;
  selectedUnitId?: string | null;
  onCellTap?: (cellId: CellId) => void;
  onUnitTap?: (unitId: string) => void;
  /** Disable pan/zoom (start-screen previews). */
  interactive?: boolean;
  className?: string;
};

const WORLD_SCALE = 1000; // screen units across the board's longer side
const PAD = 14;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const TAP_SLOP_PX = 8;

type View = { k: number; tx: number; ty: number };

function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

export function Board({
  board,
  units = [],
  fog,
  highlights,
  selectedUnitId = null,
  onCellTap,
  onUnitTap,
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

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (!interactive) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      gestureMoved.current = 0;
      wasPinch.current = false;
    } else {
      wasPinch.current = true;
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!interactive) return;
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    gestureMoved.current += Math.hypot(cur.x - prev.x, cur.y - prev.y);

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
  }

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

  /** A click counts as a tap only if the gesture didn't pan/pinch. */
  function tapGuard<T>(handler: ((arg: T) => void) | undefined): ((arg: T) => void) | undefined {
    if (!handler) return undefined;
    return (arg: T) => {
      if (gestureMoved.current > TAP_SLOP_PX || wasPinch.current) return;
      handler(arg);
    };
  }

  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const reachable = highlights?.reachable;
  const reachAlpha = (id: CellId): number | null => {
    if (!reachable) return null;
    if (reachable instanceof Map) {
      const f = reachable.get(id);
      return f === undefined ? null : 0.14 + 0.22 * Math.min(1, Math.max(0, f));
    }
    return (reachable as ReadonlySet<CellId>).has(id) ? 0.24 : null;
  };

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
        {(reachable || highlights?.targets) && (
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
      </g>
    </svg>
  );
}
