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
//
// P9 camera:
// - Pan fix: pointer deltas arrive in CLIENT px but the transform group lives
//   in viewBox units — all gesture math converts via the 'meet' mapping so
//   pan is 1:1 with the finger at any element size (the P6 bug scaled pan
//   speed by the viewBox/client ratio).
// - `follow` prop (replay auto-follow): when its token changes, the view
//   eases (~380 ms rAF, easeOutCubic) to keep the given cells framed —
//   pans, zooms OUT to fit only when needed, and stays put when the action
//   is already comfortably on screen (computeFollowView, exported for
//   tests). Any user gesture cancels the in-flight ease and fires
//   `onUserPan` so the replay layer can suspend following.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Board as BoardGraph, CellId, Vec2 } from '../board/types';
import { orderedUnitIds } from '../core/orders';
import type { FactionId, Stance, UnitInstance, UnitType } from '../core/types';
import { PLAYER_FACTION, useAppStore } from '../state/store';
import { buildHpFlips, type HpFlip } from '../state/replay-timing';
import {
  BuildPips,
  BuyGhosts,
  CaptureIntentMarkers,
  CellRenderer,
  EffectRenderer,
  GrainFilterDef,
  GrainOverlay,
  ProposalGhost,
  ReplayFx,
  ReplayTrails,
  SpriteRedFilter,
  StanceIcon,
  UnitRenderer,
  VisionEdge,
  factionColor,
  type BuildPipMark,
  type BuyGhostMark,
  type CaptureIntentMark,
  type GhostOrder,
  type Motion,
  type ProposalGhostMark,
  type Pt,
  type ReplayFxData,
  type TrailMark,
} from './skin';
import {
  clampZoom,
  computeFollowView,
  demoteSlot,
  staggerLayout,
  type DemoteSlot,
  type StaggerSlot,
  type View,
} from './board-geometry';

export type BoardHighlights = {
  /** Reachable-cell tint (§9.2). Map values = remaining-budget fraction 0..1
   * (stronger tint = more budget left); a Set tints uniformly. */
  reachable?: ReadonlySet<CellId> | ReadonlyMap<CellId, number>;
  /** Attackable targets: pulsing ring (§9.2). */
  targets?: ReadonlySet<CellId>;
  /** v0.9 preemptive fire (area denial): EMPTY in-range cells a selected RANGED
   * unit may fire at, anticipating an enemy moving there. Rendered as a faint
   * DASHED aim-ring — distinct from the solid target-ring on actual enemies. */
  aimCells?: ReadonlySet<CellId>;
  /** v0.9 ENEMY FRICTION (movement friction near enemies): reachable cells
   * whose ENTRY pays an enemy-adjacency movement malus (core/pathing). Marked
   * with a small "slow" tick over the reach tint so the player SEES the soft
   * malus at planning — the reach already shrank; this names WHY. */
  frictionCells?: ReadonlySet<CellId>;
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

/** v0.8 Task 2.4: the capture-toggle popover shown for the selected unit when
 * it is eligible to capture (conquest + personnel + planned end is enemy/neutral
 * base). A boolean toggle: armed = capture order queued. */
export type CaptureToggleState = {
  /** Whether the capture order is currently armed. */
  armed: boolean;
  /** v0.9: the base cell being captured (the unit's planned end). The toggle
   *  anchors HERE — over the target base — not over the unit's start cell. */
  targetCell: CellId;
  onToggle: () => void;
};

export type BoardProps = {
  board: BoardGraph;
  units?: readonly UnitInstance[];
  /** Cells NOT visible to the viewing faction right now. Callers also omit
   * hidden enemy units from `units`. Combined with `discovered` this yields
   * the E1 tier: fogged ∧ undiscovered = dark, fogged ∧ discovered = memory,
   * unfogged = live. */
  fog?: ReadonlySet<CellId>;
  /** E1 discovery set (cells ever seen). Absent ⇒ fogged cells render as
   * memory (legacy mist look) — real callers always pass it. */
  discovered?: ReadonlySet<CellId>;
  /** E1 replay ignition: cells soft-fading dark → live right now (~0.4 s). */
  ignite?: ReadonlySet<CellId>;
  /** Start-screen previews: paper-tone mesh silhouette, no terrain colors. */
  silhouette?: boolean;
  /** E3 conquest: live base ownership (GameState.bases / frame.bases). When
   * present it REPLACES the legacy nearest-anchor tint: owned bases tint to
   * their owner, neutral bases stay sand. Absent (skirmish) keeps the legacy
   * proximity tint. Dark-tier cells hide bases either way (CellRenderer). */
  bases?: Readonly<Record<CellId, FactionId | null>>;
  /** E3 conquest: queued-buy ghosts (token + "arrives at round end" pill). */
  buyGhosts?: readonly BuyGhostMark[];
  /** Tap a buy ghost → reopen the build dashboard, focused on that base. */
  onBuyGhostTap?: (baseCell: CellId) => void;
  /** v0.7 Item 1: owned-base build pips — an always-reachable production
   * affordance rendered ABOVE units, so an occupant never swallows the tap. */
  buildPips?: readonly BuildPipMark[];
  /** Tap a build pip → open the build dashboard, focused on that base
   *  (regardless of occupancy). */
  onBuildTap?: (baseCell: CellId) => void;
  highlights?: BoardHighlights;
  selectedUnitId?: string | null;
  /** Layer-2 queued-order ghosts (§9.3), drawn by skin/EffectRenderer. */
  ghosts?: readonly GhostOrder[];
  /** v0.9 propose-then-confirm: the un-queued MOVE proposal awaiting confirm,
   * drawn distinct from a committed ghost (brighter, dashed dest ring, hint).
   * Null = no pending proposal. */
  proposal?: ProposalGhostMark | null;
  /** Tap the proposal ghost → commit it (same as a second tap on the dest). */
  onProposalConfirm?: () => void;
  /** Layer-3 replay effects (§9.4), drawn by skin/ReplayFx. `key` remounts
   * the fx group per replay frame so CSS animations restart. */
  replayFx?: { key: number; fx: ReplayFxData } | null;
  /** v1.3 Tweak B: movement origin trails — persistent layer (fades via CSS,
   * so NOT part of the per-frame-remounted replayFx group). */
  trails?: readonly TrailMark[];
  /** R2 (SPOTLIGHT): the combat spotlight for THIS replay frame. When `active`,
   * non-combatant tiles + idle units desaturate/dim and combatant tiles/units
   * get a highlight ring. `combatants` is the round's witnessed set (computed
   * ONCE per turn, not per wave). Null/absent or `active: false` = no dim
   * (planning, post-SETTLE resaturation, non-combat rounds). The radar badges
   * on tokens are untouched. */
  spotlight?: {
    active: boolean;
    combatants: { cells: ReadonlySet<CellId>; units: ReadonlySet<string> };
  } | null;
  /** Tap a floating damage number → breakdown modal for its slot (§9.4). */
  onFloaterTap?: (slot: number) => void;
  /** Pan so this cell is centered whenever `token` changes. */
  focus?: { cell: CellId; token: number } | null;
  /** P9 replay auto-follow: ease the view so these cells are framed whenever
   * `token` changes (pan; zoom out to fit only if needed). */
  follow?: { cells: readonly CellId[]; token: number } | null;
  /** The user panned/pinched/wheeled — replay suspends auto-follow on this. */
  onUserPan?: () => void;
  /** v1.1 Feature A — a unit token was mouse-hovered (~250 ms, mouse pointers
   * only; touch behavior unchanged). Fires with null on leave/pan/tap. The
   * client coords are the token center at hover time. */
  onUnitHover?: (hover: { unitId: string; clientX: number; clientY: number } | null) => void;
  /** Stance popover on the selected unit (§9.2); rendered inside the SVG. */
  stancePopover?: StancePopoverState | null;
  /** v0.8 Task 2.4: capture toggle anchored to the selected token, shown only
   * when the unit is eligible to capture. Rendered inside the SVG alongside
   * the stance popover so it pans/zooms with the board. */
  captureToggle?: CaptureToggleState | null;
  /** v0.8 Task 2.4: claim-intent markers — one per unit with an armed capture
   * order; shown in the ghost layer (above grain, below units). */
  captureIntentMarks?: readonly CaptureIntentMark[];
  /** v0.9 radar: tap the bottom-left radar pip on an own unit to toggle the
   * distance-measurement overlay on/off. Toggling: if the same unitId is
   * already active it clears; a different id switches to the new unit.
   * Only fired for own-faction units (Board gates it). */
  onUnitRadarTap?: (unitId: string) => void;
  /** v0.9 radar: when set, dims the board and renders shooting-range hop
   * distances on all cells visible to the selected unit. */
  rangeOverlay?: {
    unitId: string;
    /** The radar unit's cell (center of the measurement). */
    cell: CellId;
    /** All cells in the unit's vision → BFS hop-distance from the unit's cell. */
    distances: ReadonlyMap<CellId, number>;
  } | null;
  onCellTap?: (cellId: CellId) => void;
  onUnitTap?: (unitId: string) => void;
  onGhostTap?: (unitId: string) => void;
  onCellLongPress?: (cellId: CellId) => void;
  /** Disable pan/zoom (start-screen previews). */
  interactive?: boolean;
  className?: string;
  /** v0.8 veterancy: unit type registry — used by UnitRenderer to draw the
   * XP progress sliver (needs cost per type). Absent → sliver not drawn. */
  unitTypes?: Readonly<Record<string, UnitType>>;
};

const WORLD_SCALE = 1000; // screen units across the board's longer side
const PAD = 14;
const TAP_SLOP_PX = 8;
const LONG_PRESS_MS = 500;
const HOVER_DELAY_MS = 250; // v1.1: unit hover card (mouse only)

const STANCES: readonly Stance[] = ['aggressive', 'defensive', 'hold-fire'];

export function Board({
  board,
  units = [],
  fog,
  discovered,
  ignite,
  silhouette = false,
  bases,
  buyGhosts,
  onBuyGhostTap,
  buildPips,
  onBuildTap,
  highlights,
  selectedUnitId = null,
  ghosts,
  proposal = null,
  onProposalConfirm,
  replayFx = null,
  trails,
  spotlight = null,
  focus = null,
  follow = null,
  onUserPan,
  onUnitHover,
  stancePopover = null,
  captureToggle = null,
  captureIntentMarks,
  onUnitRadarTap,
  rangeOverlay = null,
  onCellTap,
  onUnitTap,
  onGhostTap,
  onFloaterTap,
  onCellLongPress,
  interactive = true,
  className,
  unitTypes,
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

  // Base cell tint. E3 conquest: ownership is authoritative (owner tint,
  // neutral = sand). Skirmish legacy: toward the nearer anchor (§10.1).
  const baseTint = useMemo(() => {
    const tint = new Map<CellId, FactionId>();
    if (bases) {
      for (const [cellKey, owner] of Object.entries(bases)) {
        if (owner !== null) tint.set(Number(cellKey), owner);
      }
      return tint;
    }
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
  }, [cells, board, bases]);

  // --- pan / pinch-zoom ------------------------------------------------------
  const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gestureMoved = useRef(0); // cumulative px since gesture start
  const wasPinch = useRef(false);
  const panNotified = useRef(false); // onUserPan fired once per gesture

  /** px per viewBox unit under preserveAspectRatio="meet" (P9 pan fix). */
  function pxPerUnit(svg: SVGSVGElement): number {
    const r = svg.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return 1; // jsdom / zero-size: identity
    return Math.min(r.width / bbox.width, r.height / bbox.height);
  }

  /** Client coords → viewBox coords ('meet' letterboxes and centers). */
  function clientToViewBox(svg: SVGSVGElement, cx: number, cy: number): { x: number; y: number } {
    const r = svg.getBoundingClientRect();
    const s = pxPerUnit(svg);
    const ox = r.left + (r.width - bbox.width * s) / 2;
    const oy = r.top + (r.height - bbox.height * s) / 2;
    return { x: bbox.x + (cx - ox) / s, y: bbox.y + (cy - oy) / s };
  }

  // --- eased camera (P9): focus + follow share one rAF animation -------------
  const viewAnim = useRef<number | null>(null);

  function cancelViewAnim() {
    if (viewAnim.current !== null) {
      cancelAnimationFrame(viewAnim.current);
      viewAnim.current = null;
    }
  }

  /** Ease the view to `target` (~380 ms easeOutCubic) — calm, not a teleport.
   * Retargeting mid-flight restarts from the current view, so per-step move
   * follows chain into one continuous glide. */
  function animateViewTo(target: View, duration = 380) {
    cancelViewAnim();
    if (typeof requestAnimationFrame !== 'function' || duration <= 0) {
      setView(target);
      return;
    }
    const from = viewRef.current;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const e = 1 - (1 - t) ** 3;
      setView({
        k: from.k + (target.k - from.k) * e,
        tx: from.tx + (target.tx - from.tx) * e,
        ty: from.ty + (target.ty - from.ty) * e,
      });
      viewAnim.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    viewAnim.current = requestAnimationFrame(step);
  }

  useEffect(() => cancelViewAnim, []); // unmount: drop an in-flight ease

  /** A live gesture turned into a pan/pinch: cancel any camera ease and tell
   * the replay layer once (auto-follow suspension). */
  function userTookCamera() {
    cancelViewAnim();
    dismissHover(); // v1.1: panning dismisses the hover card
    if (!panNotified.current) {
      panNotified.current = true;
      onUserPan?.();
    }
  }

  // --- v1.1 Feature A: unit hover card (mouse only) ---------------------------
  // Event delegation on the svg: pointerover resolves the token under the
  // pointer; a 250 ms timer then fires onUnitHover with the token's CLIENT
  // coords (computed once — pan/tap/leave dismiss, so the card never drifts).
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverShownRef = useRef<string | null>(null);
  const hoverPendingRef = useRef<string | null>(null);

  function dismissHover() {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    hoverPendingRef.current = null;
    if (hoverShownRef.current !== null) {
      hoverShownRef.current = null;
      onUnitHover?.(null);
    }
  }

  useEffect(() => dismissHover, []); // unmount: drop a pending timer

  function onSvgPointerOver(e: React.PointerEvent<SVGSVGElement>) {
    if (!onUnitHover || !interactive || e.pointerType !== 'mouse') return;
    const el = e.target instanceof Element ? e.target.closest('[data-unit-id]') : null;
    const unitId = el?.getAttribute('data-unit-id') ?? null;
    if (unitId === hoverShownRef.current || unitId === hoverPendingRef.current) return;
    dismissHover(); // moved off the previous token (or onto a different one)
    if (unitId === null) return;
    const svg = e.currentTarget;
    hoverPendingRef.current = unitId;
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = null;
      hoverPendingRef.current = null;
      const unit = units.find((u) => u.id === unitId);
      const cell = unit ? board.cells.get(unit.cell) : undefined;
      if (!unit || !cell) return;
      // token center: board screen coords → viewBox (view transform) → client
      const [sx, sy] = toScreen(cell.center);
      const v = viewRef.current;
      const r = svg.getBoundingClientRect();
      const s = pxPerUnit(svg);
      const ox = r.left + (r.width - bbox.width * s) / 2;
      const oy = r.top + (r.height - bbox.height * s) / 2;
      hoverShownRef.current = unitId;
      onUnitHover({
        unitId,
        clientX: ox + (v.tx + v.k * sx - bbox.x) * s,
        clientY: oy + (v.ty + v.k * sy - bbox.y) * s,
      });
    }, HOVER_DELAY_MS);
  }

  function onSvgPointerLeave(e: React.PointerEvent<SVGSVGElement>) {
    if (e.pointerType === 'mouse') dismissHover();
  }

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
    dismissHover(); // v1.1: any tap/press dismisses the hover card
    // NOTE: capture is DEFERRED until the gesture pans/pinches (see
    // onPointerMove). Capturing here retargets the browser's compatibility
    // click to the svg, which silences every cell/unit onClick — found by
    // the P7 Playwright pass; jsdom never reproduced it.
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cancelViewAnim(); // finger down: the camera stops moving on its own
    if (pointers.current.size === 1) {
      gestureMoved.current = 0;
      wasPinch.current = false;
      longPressFired.current = false;
      panNotified.current = false;
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
      userTookCamera();
      // The gesture is a pan/pinch, not a tap: NOW capture, so it keeps
      // tracking outside the svg. The tap guard is already tripped.
      if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
    }

    if (pointers.current.size === 1) {
      // P9 pan fix: client px → viewBox units, so pan is 1:1 at any zoom.
      const s = pxPerUnit(e.currentTarget);
      const dx = (cur.x - prev.x) / s;
      const dy = (cur.y - prev.y) / s;
      setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
    } else if (pointers.current.size === 2) {
      const [idA, idB] = [...pointers.current.keys()] as [number, number];
      const otherId = e.pointerId === idA ? idB : idA;
      const other = pointers.current.get(otherId)!;
      const dPrev = Math.hypot(prev.x - other.x, prev.y - other.y);
      const dCur = Math.hypot(cur.x - other.x, cur.y - other.y);
      if (dPrev > 1) {
        const mid = clientToViewBox(e.currentTarget, (cur.x + other.x) / 2, (cur.y + other.y) / 2);
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
    cancelViewAnim();
    dismissHover(); // v1.1: wheel zoom moves the board under the card
    onUserPan?.(); // wheel zoom = the user took the camera (desktop replay)
    const m = clientToViewBox(e.currentTarget, e.clientX, e.clientY);
    setView((v) => {
      const k2 = clampZoom(v.k * Math.exp(-e.deltaY * 0.0015));
      const f = k2 / v.k;
      return { k: k2, tx: m.x - (m.x - v.tx) * f, ty: m.y - (m.y - v.ty) * f };
    });
  }

  // Dock-chip "select + center": pan (keep zoom) so focus.cell sits at the
  // viewBox center. Runs only when the token changes. Eased since P9.
  const focusToken = focus?.token;
  useEffect(() => {
    if (!focus) return;
    const cell = board.cells.get(focus.cell);
    if (!cell) return;
    const [px, py] = toScreen(cell.center);
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;
    const v = viewRef.current;
    animateViewTo({ k: v.k, tx: cx - v.k * px, ty: cy - v.k * py });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken]);

  // P9 replay auto-follow: ease so the frame's focus cells stay framed.
  // Retargets per token (per replay frame) — movers are chased step by step.
  const followToken = follow?.token;
  useEffect(() => {
    if (!follow || follow.cells.length === 0) return;
    const pts: Pt[] = [];
    for (const id of follow.cells) {
      const cell = board.cells.get(id);
      if (cell) pts.push(toScreen(cell.center));
    }
    const target = computeFollowView(pts, viewRef.current, bbox, tokenSize * 2.2);
    if (target) animateViewTo(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followToken]);

  /** A click counts as a tap only if the gesture didn't pan/pinch/long-press. */
  function tapGuard<T>(handler: ((arg: T) => void) | undefined): ((arg: T) => void) | undefined {
    if (!handler) return undefined;
    return (arg: T) => {
      if (gestureMoved.current > TAP_SLOP_PX || wasPinch.current || longPressFired.current) return;
      handler(arg);
    };
  }

  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);

  // --- v0.6 Ask 7 (impact verb, recoil half): per-unit lunge-back vectors ----
  // For every shown strike with a known attacker this frame, the attacker's
  // token kicks back along the attack line (screen units, ~0.16 token). Mist
  // strikes carry attackerCell null and brawls share a cell — both skip.
  const recoilByUnit = useMemo(() => {
    const out = new Map<string, { dx: number; dy: number }>();
    const impacts = replayFx?.fx.impacts;
    if (!impacts) return out;
    for (const im of impacts) {
      if (!im.attackerId || im.attackerCell === null || im.attackerCell === im.defenderCell) {
        continue;
      }
      const a = board.cells.get(im.attackerCell);
      const d = board.cells.get(im.defenderCell);
      if (!a || !d) continue;
      const pa = toScreen(a.center);
      const pd = toScreen(d.center);
      const dx = pa[0] - pd[0];
      const dy = pa[1] - pd[1];
      const len = Math.hypot(dx, dy) || 1;
      out.set(im.attackerId, {
        dx: (dx / len) * tokenSize * 0.16,
        dy: (dy / len) * tokenSize * 0.16,
      });
    }
    return out;
  }, [replayFx, board, toScreen, tokenSize]);

  // --- Combat readability §2 (HP flip): per HIT defender, hold the pre-hit count
  // then fold DOWN to the post-combat count on the witnessed impact. buildHpFlips
  // is PURE/tested (replay-timing): it sums damage per defender, arms ONLY where a
  // witnessed projectile lands (fog honesty), and times the fold to the spark.
  const flipByUnit = useMemo(() => {
    const impacts = replayFx?.fx.impacts;
    if (!impacts) return new Map<string, HpFlip>();
    return buildHpFlips(impacts, replayFx?.fx.beats ?? [], (id) => unitById.get(id)?.count);
  }, [replayFx, unitById]);

  // --- v1.4: idle "awaiting orders" pulse --------------------------------------
  // Own units with NO queued order get a slow breathing halo during the
  // planning phase — an on-board echo of the hollow dock chips. The Board
  // reads the order queues straight from the store (one narrow, additive
  // subscription; the selector returns null outside battle-planning so the
  // start-screen previews and every non-planning render bail before any
  // per-unit work). Hard gates: never during replay (`replayFx` is the replay
  // branch's marker prop), never on silhouettes/non-interactive previews,
  // never for enemy tokens (faction check below). The halo unmounts the
  // instant ANY order kind (move / attack / stance) is queued for the unit —
  // queue edits re-render through this same subscription.
  const planningOrders = useAppStore((s) =>
    s.screen === 'battle' && s.uiPhase === 'planning' ? s.orders : null,
  );
  // Gear menu: the unit-render skin (icon / anim / watercolor) for board tokens.
  const unitRenderMode = useAppStore((s) => s.unitRenderMode);
  const pulseEligible =
    interactive && !silhouette && replayFx === null && planningOrders !== null;
  const orderedIds = useMemo(
    () => (pulseEligible && planningOrders ? orderedUnitIds(planningOrders) : null),
    [pulseEligible, planningOrders],
  );
  const idlePulse = (unit: UnitInstance): boolean =>
    orderedIds !== null && unit.faction === PLAYER_FACTION && !orderedIds.has(unit.id);

  // v1.3 Tweak A: per-unit stagger slots for cells holding 2+ tokens.
  const staggerByUnit = useMemo(() => {
    const byCell = new Map<CellId, string[]>();
    for (const u of unitById.values()) {
      const ids = byCell.get(u.cell);
      if (ids) ids.push(u.id);
      else byCell.set(u.cell, [u.id]);
    }
    const out = new Map<string, StaggerSlot>();
    for (const ids of byCell.values()) {
      if (ids.length < 2) continue;
      for (const [id, slot] of staggerLayout(ids, tokenSize)) out.set(id, slot);
    }
    return out;
  }, [unitById, tokenSize]);

  // Once a move is DECIDED, demote that unit's start-cell token into the corner
  // facing its first step (see demoteSlot). Own units only, interactive planning
  // only (same gate as the idle pulse). Keyed off a real queued MOVE — a pending
  // proposal isn't in `orders` yet, so it never demotes mid-confirm. The selected
  // unit is handled at render time (kept full-size so it can be re-commanded).
  const demoteByUnit = useMemo(() => {
    const out = new Map<string, DemoteSlot>();
    if (!pulseEligible || !planningOrders) return out;
    for (const unit of unitById.values()) {
      if (unit.faction !== PLAYER_FACTION) continue;
      const path = planningOrders[unit.id]?.move?.path;
      if (!path || path.length === 0) continue;
      const startCell = board.cells.get(unit.cell);
      const nextCell = board.cells.get(path[0]!);
      if (!startCell || !nextCell) continue;
      out.set(
        unit.id,
        demoteSlot(startCell.polygon.map(toScreen), toScreen(nextCell.center), tokenSize),
      );
    }
    return out;
  }, [pulseEligible, planningOrders, unitById, board, toScreen, tokenSize]);

  // PoC sprites: per-(infantry-)unit MOTION + FACING.
  //  motion: 'fire' while a visible attacker this frame (cell is an arc source /
  //  a named impact attacker), 'move' while its cell changes between frames,
  //  else idle (planning idles).
  //  facing: which way the soldier points — toward its fire TARGET, its MOVE
  //  direction, or (at rest) the nearest visible ENEMY, falling back to the
  //  enemy's home anchor. 1 = the sprite's native right, -1 = mirrored to face
  //  left. Screen-x only (toScreen flips y, not x), so this tracks the board.
  const prevCellsRef = useRef<Map<string, CellId>>(new Map());
  const spriteByUnit = useMemo(() => {
    const out = new Map<string, { motion: Motion; facing: 1 | -1 }>();
    const fx = replayFx?.fx;
    const fireTarget = new Map<string, CellId>(); // attacker id → the cell it shoots
    if (fx) {
      const cellUnit = new Map<CellId, string>();
      for (const u of unitById.values()) cellUnit.set(u.cell, u.id);
      for (const a of fx.arcs) {
        const id = cellUnit.get(a.from);
        if (id && !fireTarget.has(id)) fireTarget.set(id, a.to);
      }
      for (const im of fx.impacts ?? []) {
        if (im.attackerId && !fireTarget.has(im.attackerId)) fireTarget.set(im.attackerId, im.defenderCell);
      }
    }
    const prev = prevCellsRef.current;
    const enemyAnchorX = (f: FactionId): number | null => {
      const a = board.placementAnchors;
      if (!a) return null;
      const c = board.cells.get(a[f === 0 ? 1 : 0]);
      return c ? toScreen(c.center)[0] : null;
    };
    for (const u of unitById.values()) {
      if (u.type !== 'infantry') continue; // only the sprite consumes this
      const ucell = board.cells.get(u.cell);
      if (!ucell) continue;
      const [ux, uy] = toScreen(ucell.center);
      let motion: Motion = 'idle';
      let dir = 0; // screen-x toward whatever the soldier should face
      const tgt = fireTarget.get(u.id);
      if (tgt !== undefined) {
        motion = 'fire';
        const tc = board.cells.get(tgt);
        if (tc) dir = toScreen(tc.center)[0] - ux;
      } else if (fx) {
        const pc = prev.get(u.id);
        if (pc !== undefined && pc !== u.cell) {
          motion = 'move';
          const pcc = board.cells.get(pc);
          if (pcc) dir = ux - toScreen(pcc.center)[0];
        }
      }
      if (dir === 0) {
        // at rest / directionless: face the nearest visible enemy, else home
        let best = Infinity;
        let bx: number | null = null;
        for (const e of unitById.values()) {
          if (e.faction === u.faction) continue;
          const ec = board.cells.get(e.cell);
          if (!ec) continue;
          const [ex, ey] = toScreen(ec.center);
          const d = (ex - ux) ** 2 + (ey - uy) ** 2;
          if (d < best) {
            best = d;
            bx = ex;
          }
        }
        dir = (bx ?? enemyAnchorX(u.faction) ?? ux + 1) - ux;
      }
      out.set(u.id, { motion, facing: dir < 0 ? -1 : 1 });
    }
    return out;
  }, [replayFx, unitById, board, toScreen]);

  // Remember this frame's cells so the NEXT frame can detect movement by diff.
  useEffect(() => {
    const next = new Map<string, CellId>();
    for (const u of unitById.values()) next.set(u.id, u.cell);
    prevCellsRef.current = next;
  }, [unitById]);

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

  // R2 (SPOTLIGHT): per-cell / per-unit treatment for the active spotlight.
  // `lit` = a combatant (full colour + ring); `dim` = a non-combatant (recede);
  // null = no spotlight engaged this frame (planning / post-SETTLE / no combat),
  // so nothing is touched. Pure reads of the frame's spotlight payload.
  const spotlightActive = spotlight?.active === true;
  const cellSpotlight = (id: CellId): 'dim' | 'lit' | null => {
    if (!spotlightActive) return null;
    return spotlight!.combatants.cells.has(id) ? 'lit' : 'dim';
  };
  const unitSpotlight = (u: UnitInstance): 'dim' | 'lit' | null => {
    if (!spotlightActive) return null;
    // A combatant unit OR a unit standing on a combatant cell stays lit (an
    // attacker token on its firing tile, a defender on the struck tile).
    return spotlight!.combatants.units.has(u.id) || spotlight!.combatants.cells.has(u.cell)
      ? 'lit'
      : 'dim';
  };

  const selectedUnit = selectedUnitId !== null ? unitById.get(selectedUnitId) : undefined;
  const selectedCell = selectedUnit ? board.cells.get(selectedUnit.cell) : undefined;

  // v0.9 propose-then-confirm: adapt the void→void confirm handler to the
  // (arg)→void shape tapGuard expects (same pattern as CaptureToggle).
  const guardedProposalConfirm = tapGuard<undefined>(
    onProposalConfirm ? () => onProposalConfirm() : undefined,
  );
  const proposalConfirmHandler = guardedProposalConfirm
    ? () => guardedProposalConfirm(undefined)
    : undefined;

  return (
    <svg
      className={`board-svg${className ? ` ${className}` : ''}`}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onPointerOver={onSvgPointerOver}
      onPointerLeave={onSvgPointerLeave}
      onWheel={onWheel}
    >
      <defs>
        <GrainFilterDef />
        <SpriteRedFilter />
        {/* §6C: clip ALL replay FX to the board frame so no shot lasers off
            screen (the aligned/same-level long shot was a beam to the edge). The
            rect is in board screen-space — the same space the FX group lives in
            INSIDE the view transform — so it tracks pan/zoom for free. */}
        <clipPath id="board-fx-clip">
          <rect x={bbox.x} y={bbox.y} width={bbox.width} height={bbox.height} />
        </clipPath>
      </defs>
      <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
        <g className="board-cells">
          {cells.map((cell) => {
            // E1 tier: not fogged = live; fogged + discovered = memory;
            // fogged + never seen = dark. No `discovered` prop ⇒ memory
            // (legacy mist), so bare <Board fog=…> never leaks darkness.
            const fogged = fog?.has(cell.id) ?? false;
            const tier = !fogged
              ? 'live'
              : discovered === undefined || discovered.has(cell.id)
                ? 'memory'
                : 'dark';
            return (
              <CellRenderer
                key={cell.id}
                cell={cell}
                toScreen={toScreen}
                tier={tier}
                igniting={tier === 'live' && (ignite?.has(cell.id) ?? false)}
                silhouette={silhouette}
                baseTintFaction={baseTint.get(cell.id) ?? null}
                // v0.6 Ask 3 (conquest only — `bases` present): an unowned
                // base renders as a neutral camp. Skirmish keeps the legacy
                // proximity-tinted flag pips.
                camp={
                  bases !== undefined &&
                  cell.terrain === 'base' &&
                  (bases[cell.id] ?? null) === null
                }
                spotlight={cellSpotlight(cell.id)}
                onTap={tapGuard(onCellTap)}
              />
            );
          })}
        </g>
        <GrainOverlay {...bbox} />
        {(reachable ||
          highlights?.targets ||
          highlights?.aimCells ||
          highlights?.frictionCells ||
          highlights?.visionEdge) && (
          <g className="board-highlights" pointerEvents="none">
            {cells.map((cell) => {
              const alpha = reachAlpha(cell.id);
              if (alpha === null) return null;
              const [cx, cy] = toScreen(cell.center);
              return (
                <circle
                  key={`r${cell.id}`}
                  className="reach-tint"
                  data-tint-cell={cell.id}
                  cx={cx}
                  cy={cy}
                  r={tokenSize * 0.55}
                  fill={factionColor(0)}
                  opacity={alpha}
                />
              );
            })}
            {/* v0.9 enemy-friction cue: a small amber "slow" tick on reachable
               cells whose entry pays the enemy-adjacency malus. The reach tint
               already shrank near enemies; this marks WHY, legibly at phone
               size, without cluttering open cells. */}
            {highlights?.frictionCells &&
              [...highlights.frictionCells].map((id) => {
                const cell = board.cells.get(id);
                if (!cell) return null;
                const [cx, cy] = toScreen(cell.center);
                return (
                  <circle
                    key={`fr${id}`}
                    className="friction-tick"
                    data-friction-cell={id}
                    cx={cx}
                    cy={cy}
                    r={tokenSize * 0.16}
                    fill="#d98a1f"
                    opacity={0.85}
                  />
                );
              })}
            {highlights?.visionEdge && (
              <VisionEdge board={board} toScreen={toScreen} cellSet={highlights.visionEdge} />
            )}
            {highlights?.aimCells &&
              [...highlights.aimCells].map((id) => {
                const cell = board.cells.get(id);
                if (!cell) return null;
                const [cx, cy] = toScreen(cell.center);
                // Dashed aim-ring on an EMPTY cell a ranged unit can preempt —
                // visibly weaker than the solid enemy target-ring. Player-colored:
                // this is a PLAYER-INTENT affordance ("I'm holding range here"),
                // not an enemy presence, so it must read distinct from the
                // enemy-colored target-ring drawn on actual enemies below.
                return (
                  <circle
                    key={`aim${id}`}
                    className="aim-ring"
                    cx={cx}
                    cy={cy}
                    r={tokenSize * 0.66}
                    fill="none"
                    stroke={factionColor(PLAYER_FACTION)}
                    strokeWidth={tokenSize * 0.07}
                    strokeDasharray={`${tokenSize * 0.18} ${tokenSize * 0.12}`}
                    opacity={0.62}
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
        {ghosts && ghosts.length > 0 && (
          <EffectRenderer
            board={board}
            toScreen={toScreen}
            tokenSize={tokenSize}
            ghosts={ghosts}
            onGhostTap={tapGuard(onGhostTap)}
          />
        )}
        {/* v0.9 propose-then-confirm: the un-queued proposal ghost, above the
            committed ghosts so it reads as "the thing you're about to confirm". */}
        {proposal && (
          <ProposalGhost
            board={board}
            toScreen={toScreen}
            tokenSize={tokenSize}
            mark={proposal}
            onConfirm={proposalConfirmHandler}
          />
        )}
        {/* v0.8 Task 2.4: claim-intent markers in the ghost layer */}
        {captureIntentMarks && captureIntentMarks.length > 0 && (
          <CaptureIntentMarkers
            board={board}
            toScreen={toScreen}
            tokenSize={tokenSize}
            marks={captureIntentMarks}
          />
        )}
        {trails && trails.length > 0 && (
          <ReplayTrails board={board} toScreen={toScreen} tokenSize={tokenSize} trails={trails} />
        )}
        {buyGhosts && buyGhosts.length > 0 && (
          <BuyGhosts
            board={board}
            toScreen={toScreen}
            tokenSize={tokenSize}
            buys={buyGhosts}
            onTap={tapGuard(onBuyGhostTap)}
          />
        )}
        <g className="board-units">
          {[...unitById.values()].map((unit) => {
            const cell = board.cells.get(unit.cell);
            if (!cell) return null;
            const [x, y] = toScreen(cell.center);
            const slot = staggerByUnit.get(unit.id);
            // Move decided → tuck into the corner at 1/4 size. Exempt only the
            // unit being ACTIVELY proposed (mid propose-then-confirm): it stays
            // full/centered while you command it, then demotes the instant the
            // move is confirmed. Selection alone is NOT exempt — it persists past
            // commit (commitPendingMove keeps selectedUnitId), so exempting it
            // would hide the demote until you happened to tap away.
            const demote =
              proposal?.unit.id === unit.id ? undefined : demoteByUnit.get(unit.id);
            // v0.9 radar: only pass onRadar for own player units in interactive
            // planning (not during replay/silhouette/minimal previews). Measuring
            // an enemy's vision would leak hidden information.
            const showRadar =
              onUnitRadarTap !== undefined &&
              pulseEligible &&
              replayFx === null &&
              unit.faction === PLAYER_FACTION;
            return (
              <UnitRenderer
                key={unit.id}
                unit={unit}
                x={demote ? demote.x : x + (slot?.dx ?? 0)}
                y={demote ? demote.y : y + (slot?.dy ?? 0)}
                size={tokenSize}
                scale={demote ? demote.scale : slot?.scale}
                // A demoted token is a glyph-only marker ("moving, that way"):
                // minimal drops the count/rank/XP sub-pips and the radar control,
                // which are illegible — and the radar an un-hittable dead target —
                // at quarter scale. Selecting the unit restores the full token.
                minimal={demote !== undefined}
                selected={unit.id === selectedUnitId}
                // v0.9 active-unit halo: only on the selected own unit, only in
                // interactive planning (never replay/silhouette/preview).
                selectedHalo={
                  unit.id === selectedUnitId && pulseEligible && replayFx === null
                }
                proposed={proposal?.unit.id === unit.id}
                pulse={idlePulse(unit)}
                recoil={recoilByUnit.get(unit.id) ?? null}
                recoilKey={replayFx?.key ?? 0}
                flip={flipByUnit.get(unit.id) ?? null}
                flipKey={replayFx?.key ?? 0}
                unitTypeCost={unitTypes ? unitTypes[unit.type]?.cost : undefined}
                onTap={tapGuard(onUnitTap)}
                onRadar={showRadar ? () => onUnitRadarTap(unit.id) : undefined}
                radarActive={rangeOverlay?.unitId === unit.id}
                renderMode={unitRenderMode}
                motion={spriteByUnit.get(unit.id)?.motion ?? 'idle'}
                facing={spriteByUnit.get(unit.id)?.facing ?? 1}
                spotlight={unitSpotlight(unit)}
              />
            );
          })}
        </g>
        {/* v0.9 radar overlay: dims the entire board and labels visible tiles
            with BFS shooting-range hop distances. Rendered above units so the
            numbers are always legible. The radar unit itself is re-highlighted
            with a bright ring on top of the dim so it reads as the origin.
            Tapping the dim (anywhere outside the active radar pip) exits. */}
        {rangeOverlay && (() => {
          const radarCell = board.cells.get(rangeOverlay.cell);
          if (!radarCell) return null;
          const [rcx, rcy] = toScreen(radarCell.center);
          return (
            <g className="radar-overlay" pointerEvents="auto">
              {/* dim wash — covers the entire viewBox */}
              <rect
                x={bbox.x}
                y={bbox.y}
                width={bbox.width}
                height={bbox.height}
                fill="rgba(0,0,0,0.52)"
                className="radar-dim"
                onClick={() => onUnitRadarTap?.(rangeOverlay.unitId)}
                style={{ cursor: 'pointer' }}
              />
              {/* highlight ring around the radar unit so it stays bright */}
              <circle
                cx={rcx}
                cy={rcy}
                r={tokenSize * 0.88}
                fill="none"
                stroke={factionColor(PLAYER_FACTION)}
                strokeWidth={tokenSize * 0.1}
                opacity={0.95}
                pointerEvents="none"
              />
              {/* distance labels on each visible cell */}
              {[...rangeOverlay.distances.entries()].map(([cellId, dist]) => {
                const c = board.cells.get(cellId);
                if (!c) return null;
                const [cx, cy] = toScreen(c.center);
                // Color-grade by distance: near=green, mid=amber, far=red/dim.
                const distColor =
                  dist === 0
                    ? 'rgba(255,255,255,0.55)'
                    : dist <= 2
                      ? '#6ee080'
                      : dist <= 4
                        ? '#f5d174'
                        : '#f08070';
                return (
                  <text
                    key={cellId}
                    x={cx}
                    y={cy}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={tokenSize * 0.44}
                    fontWeight={700}
                    fill={distColor}
                    stroke="rgba(0,0,0,0.55)"
                    strokeWidth={tokenSize * 0.045}
                    paintOrder="stroke"
                    pointerEvents="none"
                    className="radar-dist-label"
                  >
                    {dist === 0 ? '•' : dist}
                  </text>
                );
              })}
            </g>
          );
        })()}
        {/* v0.7 Item 1: build pips ABOVE units — always tappable over an
            occupant token. Planning only (buildPips is unset during replay). */}
        {buildPips && buildPips.length > 0 && (
          <BuildPips
            board={board}
            toScreen={toScreen}
            tokenSize={tokenSize}
            pips={buildPips}
            onBuild={tapGuard(onBuildTap)}
          />
        )}
        {replayFx && (
          <ReplayFx
            key={replayFx.key}
            board={board}
            toScreen={toScreen}
            tokenSize={tokenSize}
            fx={replayFx.fx}
            player={PLAYER_FACTION}
            renderMode={unitRenderMode}
            onFloaterTap={tapGuard(onFloaterTap)}
            clipId="board-fx-clip"
            frameBounds={bbox}
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
        {/* v0.8 Task 2.4 · v0.9: capture toggle anchored over the TARGET base
            (the unit's planned end), so it reads "capture this base" — not over
            the unit's start cell. Shown only when eligible (conquest + personnel
            + planned end is an unowned base). */}
        {captureToggle && board.cells.get(captureToggle.targetCell) && (
          <CaptureToggle
            anchor={toScreen(board.cells.get(captureToggle.targetCell)!.center)}
            tokenSize={tokenSize}
            state={captureToggle}
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

/** v0.8 Task 2.4: capture toggle — a single pill-shaped button below the
 * token, inside the SVG so it tracks pan/zoom like the stance popover.
 * Shows only when the unit is eligible (conquest + personnel + planned end
 * is an unowned base). Toggling arms/disarms the capture order. */
function CaptureToggle({
  anchor,
  tokenSize,
  state,
  tapGuard,
}: {
  anchor: Pt;
  tokenSize: number;
  state: CaptureToggleState;
  tapGuard: <T>(h: ((arg: T) => void) | undefined) => ((arg: T) => void) | undefined;
}) {
  const r = tokenSize * 0.44;
  // Position ABOVE the base center so the pill reads as sitting on top of the
  // base art and the capturing unit token (which stands on the same cell).
  // The stance popover (when both show) goes further above at 1.55×; this sits
  // at 1.1× which clears the token body without floating too far away.
  const y = anchor[1] - tokenSize * 1.1;
  const x = anchor[0];
  const pillW = r * 3.2;
  const pillH = r * 1.1;
  const active = state.armed;
  // tapGuard wraps a handler of any type; we need a void→void tap guard.
  // Pass the toggle as a handler of `undefined` to satisfy the generic.
  const guardedToggle = tapGuard<undefined>(state.onToggle ? () => { state.onToggle(); } : undefined);
  const label = active ? '⚑ Capture ON' : '⚐ Capture';
  const fillColor = active ? factionColor(0) : '#fff';
  const strokeColor = active ? '#fff' : 'rgba(74,68,58,0.45)';
  const textColor = active ? '#fff' : '#6b6356';

  return (
    <g
      className={`capture-toggle${active ? ' capture-toggle-armed' : ''}`}
      data-capture-toggle
      data-testid="capture-toggle"
      transform={`translate(${x} ${y})`}
      onClick={guardedToggle ? () => guardedToggle(undefined) : undefined}
      style={{ cursor: 'pointer' }}
    >
      <rect
        x={-pillW / 2}
        y={-pillH / 2}
        width={pillW}
        height={pillH}
        rx={pillH / 2}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={r * 0.1}
      />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={r * 0.68}
        fontWeight={600}
        fill={textColor}
        pointerEvents="none"
      >
        {label}
      </text>
    </g>
  );
}
