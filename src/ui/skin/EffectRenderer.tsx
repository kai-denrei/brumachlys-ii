// EffectRenderer — Layer-2 "about to happen" drawing (spec §9.3 / §10.4):
// queued moves as dotted faction-color trails ending in a translucent ghost
// token; queued attacks as a thin arc with a small sword marker; convergence
// (two friendly moves → one cell) flashes both ghosts amber via CSS.
// Also: the §9.2 vision-edge contour (boundary segments of a cell set) and
// the stance icon glyphs (sword / shield / crossed) the popover uses.
//
// Skin-swap contract: all "about to happen" primitives live here; Board
// passes pure data + the toScreen projection. A future animated skin replaces
// this module, zero game code touched.

import { memo } from 'react';
import type { Board, Cell, CellId } from '../../board/types';
import type { Stance, UnitInstance } from '../../core/types';
import { factionColor } from './palette';
import { UnitRenderer } from './UnitRenderer';
import type { Pt } from './rounded';

/** One unit's queued plan, ready to draw. `movePath` excludes the start cell
 * (order shape, spec §2.3); `attackFrom` is the planned end position the
 * attack will fire from (move destination if a move is queued). */
export type GhostOrder = {
  unit: UnitInstance;
  movePath?: readonly CellId[];
  attackTarget?: CellId;
  attackFrom?: CellId;
  /** §9.3 convergence warning — flash this ghost amber. */
  converging?: boolean;
  /** Destination holds a (visible) unit — a charge, or a convergence with a
   * friend still standing there. The ghost token offsets up-left so it stays
   * visible AND tappable beside the real token (P7 visual pass: a centered
   * charge ghost is fully covered by the enemy token and can never be
   * tapped). */
  destOccupied?: boolean;
};

export type EffectRendererProps = {
  board: Board;
  toScreen: (p: readonly [number, number]) => Pt;
  /** Unit token edge length (screen units) — ghosts match real tokens. */
  tokenSize: number;
  ghosts: readonly GhostOrder[];
  /** Tap a ghost token or sword marker → order sheet (§9.3). */
  onGhostTap?: (unitId: string) => void;
};

const center = (board: Board, id: CellId): Pt | null => {
  const cell = board.cells.get(id);
  return cell ? cell.center : null;
};

function GhostMove({
  board,
  toScreen,
  tokenSize,
  ghost,
  onGhostTap,
}: {
  board: Board;
  toScreen: (p: readonly [number, number]) => Pt;
  tokenSize: number;
  ghost: GhostOrder;
  onGhostTap?: (unitId: string) => void;
}) {
  const { unit, movePath } = ghost;
  if (!movePath || movePath.length === 0) return null;
  const worldPts = [unit.cell, ...movePath].map((id) => center(board, id));
  if (worldPts.some((p) => p === null)) return null;
  const pts = (worldPts as Pt[]).map(toScreen);
  const rawDest = pts[pts.length - 1]!;
  const dest: Pt = ghost.destOccupied
    ? [rawDest[0] - tokenSize * 0.5, rawDest[1] - tokenSize * 0.5]
    : rawDest;
  const color = factionColor(unit.faction);
  const cls = `ghost ghost-move${ghost.converging ? ' ghost-converging' : ''}`;

  return (
    <g className={cls} data-ghost-unit-id={unit.id}>
      <polyline
        className="ghost-trail"
        points={pts.map((p) => `${p[0]},${p[1]}`).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={tokenSize * 0.09}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={`${tokenSize * 0.02} ${tokenSize * 0.22}`}
        pointerEvents="none"
      />
      <g
        className="ghost-token"
        opacity={0.45}
        onClick={onGhostTap ? () => onGhostTap(unit.id) : undefined}
      >
        <UnitRenderer unit={unit} x={dest[0]} y={dest[1]} size={tokenSize} />
      </g>
    </g>
  );
}

// --- E3 conquest: queued-buy ghosts (addendum §B.4 mandatory messaging) -----
// A buy queued on an owned base renders a translucent dashed-ring token on
// the base cell plus a pill naming the purchase and when it lands. Tap →
// the build sheet for that base (edit/remove).

export type BuyGhostMark = {
  baseCell: CellId;
  /** Throwaway instance for the token art (player faction, the bought type). */
  unit: UnitInstance;
  /** Pill copy, e.g. "Sniper purchased — arrives at round end". */
  pill: string;
};

export function BuyGhosts({
  board,
  toScreen,
  tokenSize,
  buys,
  onTap,
}: {
  board: Board;
  toScreen: (p: readonly [number, number]) => Pt;
  tokenSize: number;
  buys: readonly BuyGhostMark[];
  onTap?: (baseCell: CellId) => void;
}) {
  return (
    <g className="buy-ghosts">
      {buys.map((b) => {
        const cell = board.cells.get(b.baseCell);
        if (!cell) return null;
        const [x, y] = toScreen(cell.center);
        const fs = tokenSize * 0.26;
        const w = b.pill.length * fs * 0.52 + fs * 1.6;
        const h = fs * 1.7;
        const py = y - tokenSize * 1.05;
        return (
          <g
            key={b.baseCell}
            className="ghost ghost-buy"
            data-buy-cell={b.baseCell}
            onClick={onTap ? () => onTap(b.baseCell) : undefined}
          >
            <circle
              cx={x}
              cy={y}
              r={tokenSize * 0.68}
              fill="none"
              stroke={factionColor(b.unit.faction)}
              strokeWidth={tokenSize * 0.05}
              strokeDasharray={`${tokenSize * 0.08} ${tokenSize * 0.12}`}
            />
            <g className="ghost-token" opacity={0.45}>
              <UnitRenderer unit={b.unit} x={x} y={y} size={tokenSize} minimal />
            </g>
            <g className="buy-pill" transform={`translate(${x} ${py})`}>
              <rect
                x={-w / 2}
                y={-h / 2}
                width={w}
                height={h}
                rx={h / 2}
                fill="#fff"
                stroke="rgba(74,68,58,0.35)"
                strokeWidth={tokenSize * 0.03}
              />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={fs}
                fontWeight={600}
                fill="#4a443a"
                pointerEvents="none"
              >
                {b.pill}
              </text>
            </g>
          </g>
        );
      })}
    </g>
  );
}

// --- v0.7 Item 1: owned-base build pips --------------------------------------
// A persistent, always-reachable production affordance on every base the
// viewing player owns. Rendered as a Board overlay ABOVE the unit layer, so a
// unit token standing on the base (e.g. one ordered to move but not yet moved)
// can NEVER swallow the tap — the operator's "can't buy from an occupied base"
// complaint. Tap → open that base's build sheet regardless of selection or
// occupancy. The deselect-then-tap-cell path stays as a fallback.

export type BuildPipMark = {
  baseCell: CellId;
  /** Already has a queued buy this round — pip reads "queued", not "＋". */
  queued?: boolean;
};

export function BuildPips({
  board,
  toScreen,
  tokenSize,
  pips,
  onBuild,
}: {
  board: Board;
  toScreen: (p: readonly [number, number]) => Pt;
  tokenSize: number;
  pips: readonly BuildPipMark[];
  onBuild?: (baseCell: CellId) => void;
}) {
  const r = tokenSize * 0.34;
  return (
    <g className="build-pips">
      {pips.map((p) => {
        const cell = board.cells.get(p.baseCell);
        if (!cell) return null;
        const [cx, cy] = toScreen(cell.center);
        // Lower-right of the token so it clears the base flag pip (upper) and
        // the count pip; still over the cell so it's obviously "this base".
        const px = cx + tokenSize * 0.5;
        const py = cy + tokenSize * 0.5;
        const stroke = '#fff';
        return (
          <g
            key={p.baseCell}
            className={`build-pip${p.queued ? ' build-pip-queued' : ''}`}
            data-build-pip={p.baseCell}
            transform={`translate(${px} ${py})`}
            onClick={onBuild ? () => onBuild(p.baseCell) : undefined}
            role="button"
            aria-label={`build at base ${p.baseCell}`}
          >
            <circle
              r={r}
              fill={factionColor(0)}
              stroke="#fff"
              strokeWidth={r * 0.16}
            />
            <g pointerEvents="none">
              {p.queued ? (
                // check mark — a buy is already queued here
                <path
                  d={`M${-r * 0.42} 0 L${-r * 0.08} ${r * 0.36} L${r * 0.46} ${-r * 0.4}`}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={r * 0.22}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : (
                // plus — open production
                <g
                  stroke={stroke}
                  strokeWidth={r * 0.22}
                  strokeLinecap="round"
                >
                  <line x1={-r * 0.46} y1={0} x2={r * 0.46} y2={0} />
                  <line x1={0} y1={-r * 0.46} x2={0} y2={r * 0.46} />
                </g>
              )}
            </g>
          </g>
        );
      })}
    </g>
  );
}

/** Small white-on-color sword marker (also the aggressive stance icon). */
export function SwordIcon({ size, stroke = '#fff' }: { size: number; stroke?: string }) {
  const s = size / 100;
  return (
    <g
      className="icon-sword"
      fill="none"
      stroke={stroke}
      strokeWidth={12 * s}
      strokeLinecap="round"
      transform={`scale(1)`}
    >
      {/* blade ↗, guard, pommel — drawn in a ±50 box centered on 0,0 */}
      <line x1={-26 * s} y1={26 * s} x2={30 * s} y2={-30 * s} />
      <line x1={-2 * s} y1={-22 * s} x2={22 * s} y2={2 * s} />
      <line x1={-30 * s} y1={30 * s} x2={-36 * s} y2={36 * s} />
    </g>
  );
}

export function ShieldIcon({ size, stroke = '#fff' }: { size: number; stroke?: string }) {
  const s = size / 100;
  return (
    <path
      className="icon-shield"
      d={`M0 ${-34 * s} L${28 * s} ${-22 * s} L${28 * s} ${4 * s} Q${28 * s} ${24 * s} 0 ${36 * s} Q${-28 * s} ${24 * s} ${-28 * s} ${4 * s} L${-28 * s} ${-22 * s} Z`}
      fill="none"
      stroke={stroke}
      strokeWidth={11 * s}
      strokeLinejoin="round"
    />
  );
}

/** Crossed-out sword = hold-fire. */
export function HoldFireIcon({ size, stroke = '#fff' }: { size: number; stroke?: string }) {
  const s = size / 100;
  return (
    <g className="icon-holdfire">
      <SwordIcon size={size * 0.82} stroke={stroke} />
      <line
        x1={-36 * s}
        y1={-36 * s}
        x2={36 * s}
        y2={36 * s}
        stroke={stroke}
        strokeWidth={12 * s}
        strokeLinecap="round"
      />
    </g>
  );
}

export function StanceIcon({
  stance,
  size,
  stroke,
}: {
  stance: Stance;
  size: number;
  stroke?: string;
}) {
  if (stance === 'aggressive') return <SwordIcon size={size} stroke={stroke} />;
  if (stance === 'defensive') return <ShieldIcon size={size} stroke={stroke} />;
  return <HoldFireIcon size={size} stroke={stroke} />;
}

function GhostAttack({
  board,
  toScreen,
  tokenSize,
  ghost,
  onGhostTap,
}: {
  board: Board;
  toScreen: (p: readonly [number, number]) => Pt;
  tokenSize: number;
  ghost: GhostOrder;
  onGhostTap?: (unitId: string) => void;
}) {
  const { unit, attackTarget } = ghost;
  if (attackTarget === undefined) return null;
  const fromWorld = center(board, ghost.attackFrom ?? unit.cell);
  const toWorld = center(board, attackTarget);
  if (!fromWorld || !toWorld) return null;
  const a = toScreen(fromWorld);
  const b = toScreen(toWorld);
  const color = factionColor(unit.faction);

  // Thin arc: quadratic bezier bulging perpendicular to the chord (§9.3).
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const bulge = Math.min(len * 0.22, tokenSize * 1.1);
  const cx = mx - (dy / len) * bulge;
  const cy = my + (dx / len) * bulge;
  // Sword marker sits at the curve apex t=0.5.
  const sx = 0.25 * a[0] + 0.5 * cx + 0.25 * b[0];
  const sy = 0.25 * a[1] + 0.5 * cy + 0.25 * b[1];
  const markerR = tokenSize * 0.27;

  return (
    <g className="ghost ghost-attack" data-ghost-attack-unit-id={unit.id}>
      <path
        className="attack-arc"
        d={`M${a[0]} ${a[1]} Q${cx} ${cy} ${b[0]} ${b[1]}`}
        fill="none"
        stroke={color}
        strokeWidth={tokenSize * 0.07}
        opacity={0.85}
        pointerEvents="none"
      />
      <g
        className="attack-marker"
        transform={`translate(${sx} ${sy})`}
        onClick={onGhostTap ? () => onGhostTap(unit.id) : undefined}
      >
        <circle r={markerR} fill={color} stroke="#fff" strokeWidth={markerR * 0.16} />
        <g pointerEvents="none">
          <SwordIcon size={markerR * 1.5} />
        </g>
      </g>
    </g>
  );
}

export const EffectRenderer = memo(function EffectRenderer({
  board,
  toScreen,
  tokenSize,
  ghosts,
  onGhostTap,
}: EffectRendererProps) {
  return (
    <g className="board-effects">
      {ghosts.map((g) => (
        <GhostMove
          key={`m${g.unit.id}`}
          board={board}
          toScreen={toScreen}
          tokenSize={tokenSize}
          ghost={g}
          onGhostTap={onGhostTap}
        />
      ))}
      {ghosts.map((g) => (
        <GhostAttack
          key={`a${g.unit.id}`}
          board={board}
          toScreen={toScreen}
          tokenSize={tokenSize}
          ghost={g}
          onGhostTap={onGhostTap}
        />
      ))}
    </g>
  );
});

// --- vision-edge contour (§9.2) -----------------------------------------------

/**
 * Boundary segments of `cellSet`: for every (in-set cell, out-of-set
 * neighbor) pair, the polygon edge the two cells share. Dual cells share
 * exact vertex coordinates with their neighbors (both vertices are quad
 * centroids of the same mesh edge), so matching is by exact rounded key.
 * Board-boundary cells contribute nothing (no out-of-set neighbor exists
 * there) — the contour marks where vision ENDS inside the board.
 */
export function visionEdgeSegments(board: Board, cellSet: ReadonlySet<CellId>): [Pt, Pt][] {
  const key = (p: readonly [number, number]) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const segments: [Pt, Pt][] = [];
  for (const id of cellSet) {
    const cell = board.cells.get(id);
    if (!cell) continue;
    for (const nId of cell.neighbors) {
      if (cellSet.has(nId)) continue;
      const n: Cell | undefined = board.cells.get(nId);
      if (!n) continue;
      const nKeys = new Set(n.polygon.map(key));
      const shared = cell.polygon.filter((p) => nKeys.has(key(p)));
      if (shared.length === 2) segments.push([shared[0]!, shared[1]!]);
    }
  }
  return segments;
}

export function VisionEdge({
  board,
  toScreen,
  cellSet,
}: {
  board: Board;
  toScreen: (p: readonly [number, number]) => Pt;
  cellSet: ReadonlySet<CellId>;
}) {
  const segments = visionEdgeSegments(board, cellSet);
  if (segments.length === 0) return null;
  const d = segments
    .map(([p, q]) => {
      const a = toScreen(p);
      const b = toScreen(q);
      return `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;
    })
    .join('');
  return (
    <path
      className="vision-edge"
      d={d}
      fill="none"
      stroke="rgba(74,68,58,0.38)"
      strokeWidth={2.2}
      strokeDasharray="7 5"
      strokeLinecap="round"
      pointerEvents="none"
    />
  );
}
