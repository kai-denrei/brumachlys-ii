// ReplayFx — Layer-3 "what happened" drawing (spec §9.4 / §10.4): attack
// flash arcs, floating damage numbers, fire-from-the-mist impact markers,
// brawl clash bursts, kill fades. All IN-SVG so effects track pan/zoom (P6
// decision). Animations are CSS (styles.css `fx-*` classes); the Board
// remounts this group per frame (key=frame index) so they restart cleanly.
//
// Fog honesty (§7): this module draws exactly what it is given. The replay
// builder (state/replay.ts) already withheld mist sources — a mist floater
// arrives with `mist: true` and there is simply no arc to draw.

import type { Board, CellId } from '../../board/types';
import type { FactionId, UnitInstance } from '../../core/types';
import { factionColor } from './palette';
import { UnitRenderer } from './UnitRenderer';
import type { Pt } from './rounded';

export type ReplayFxData = {
  arcs: { from: CellId; to: CellId; faction: FactionId }[];
  floaters: { id: string; cell: CellId; text: string; mist: boolean; slot: number }[];
  bursts: CellId[];
  kills: UnitInstance[];
};

export type ReplayFxProps = {
  board: Board;
  toScreen: (p: readonly [number, number]) => Pt;
  tokenSize: number;
  fx: ReplayFxData;
  /** Tap a floating damage number → breakdown modal for its slot (§9.4). */
  onFloaterTap?: (slot: number) => void;
};

const center = (board: Board, id: CellId, toScreen: ReplayFxProps['toScreen']): Pt | null => {
  const cell = board.cells.get(id);
  return cell ? toScreen(cell.center) : null;
};

function FlashArc({
  board,
  toScreen,
  tokenSize,
  from,
  to,
  faction,
}: {
  board: Board;
  toScreen: ReplayFxProps['toScreen'];
  tokenSize: number;
  from: CellId;
  to: CellId;
  faction: FactionId;
}) {
  const a = center(board, from, toScreen);
  const b = center(board, to, toScreen);
  if (!a || !b) return null;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const bulge = Math.min(len * 0.22, tokenSize * 1.1);
  const cx = mx - (dy / len) * bulge;
  const cy = my + (dx / len) * bulge;
  return (
    <path
      className="fx-arc"
      d={`M${a[0]} ${a[1]} Q${cx} ${cy} ${b[0]} ${b[1]}`}
      fill="none"
      stroke={factionColor(faction)}
      strokeWidth={tokenSize * 0.1}
      strokeLinecap="round"
      pointerEvents="none"
    />
  );
}

function ClashBurst({ at, tokenSize }: { at: Pt; tokenSize: number }) {
  const r0 = tokenSize * 0.34;
  const r1 = tokenSize * 0.78;
  const spikes = [...Array(8).keys()].map((k) => {
    const t = (k / 8) * Math.PI * 2 + Math.PI / 8;
    return [Math.cos(t), Math.sin(t)] as const;
  });
  return (
    <g className="fx-burst" transform={`translate(${at[0]} ${at[1]})`} pointerEvents="none">
      {spikes.map(([ux, uy], k) => (
        <line
          key={k}
          x1={ux * r0}
          y1={uy * r0}
          x2={ux * r1}
          y2={uy * r1}
          stroke="#fff"
          strokeWidth={tokenSize * 0.09}
          strokeLinecap="round"
        />
      ))}
      <circle r={r0 * 0.8} fill="#fff" opacity={0.85} />
    </g>
  );
}

/** Expanding double ring — damage arriving from an unseen source ("fire
 *  from the mist", spec §7): the impact is shown, the shooter is not. */
function MistImpact({ at, tokenSize }: { at: Pt; tokenSize: number }) {
  return (
    <g className="fx-impact" transform={`translate(${at[0]} ${at[1]})`} pointerEvents="none">
      <circle className="fx-impact-ring" r={tokenSize * 0.55} fill="none" stroke="#fff" strokeWidth={tokenSize * 0.08} />
      <circle className="fx-impact-ring fx-impact-ring-2" r={tokenSize * 0.55} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={tokenSize * 0.05} />
    </g>
  );
}

export function ReplayFx({ board, toScreen, tokenSize, fx, onFloaterTap }: ReplayFxProps) {
  // Stack same-cell floaters (brawl halves) side by side.
  const seenCells = new Map<CellId, number>();
  return (
    <g className="board-replay-fx">
      {fx.arcs.map((arc, k) => (
        <FlashArc
          key={`a${k}`}
          board={board}
          toScreen={toScreen}
          tokenSize={tokenSize}
          from={arc.from}
          to={arc.to}
          faction={arc.faction}
        />
      ))}
      {fx.bursts.map((cell, k) => {
        const at = center(board, cell, toScreen);
        return at ? <ClashBurst key={`b${k}`} at={at} tokenSize={tokenSize} /> : null;
      })}
      {fx.floaters.map((fl) => {
        const at = center(board, fl.cell, toScreen);
        if (!at) return null;
        const stack = seenCells.get(fl.cell) ?? 0;
        seenCells.set(fl.cell, stack + 1);
        const w = Math.max(fl.text.length, 2) * tokenSize * 0.26 + tokenSize * 0.3;
        const h = tokenSize * 0.52;
        const x = at[0] + (stack === 0 ? 0 : (stack % 2 === 1 ? 1 : -1) * w * 0.7);
        const y = at[1] - tokenSize * 0.95 - stack * h * 0.25;
        const fill = fl.mist ? '#5d5648' : '#fff';
        const text = fl.mist ? '#f2eee3' : '#9c2f1d';
        return (
          <g key={fl.id} className={`fx-floater${fl.mist ? ' fx-floater-mist' : ''}`} transform={`translate(${x} ${y})`}>
            {fl.mist && <MistImpact at={[at[0] - x, at[1] - y]} tokenSize={tokenSize} />}
            <g
              className="fx-floater-pill"
              onClick={onFloaterTap ? () => onFloaterTap(fl.slot) : undefined}
            >
              <rect
                x={-w / 2}
                y={-h / 2}
                width={w}
                height={h}
                rx={h / 2}
                fill={fill}
                stroke={fl.mist ? 'rgba(255,255,255,0.55)' : 'rgba(74,68,58,0.35)'}
                strokeWidth={tokenSize * 0.03}
              />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={h * 0.62}
                fontWeight={700}
                fill={text}
                pointerEvents="none"
              >
                {fl.text}
              </text>
            </g>
          </g>
        );
      })}
      {fx.kills.map((unit) => {
        const at = center(board, unit.cell, toScreen);
        if (!at) return null;
        return (
          <g key={`k${unit.id}`} className="fx-kill" pointerEvents="none">
            <UnitRenderer unit={unit} x={at[0]} y={at[1]} size={tokenSize} />
          </g>
        );
      })}
    </g>
  );
}
