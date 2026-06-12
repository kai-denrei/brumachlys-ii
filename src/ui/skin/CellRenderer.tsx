// CellRenderer — terrain → SVG, spec §10.1 / §10.4. All cell drawing goes
// through here; game components never draw primitives directly.
//
// - Rounded pebble outline: quadratic corner smoothing, radius clamped to
//   shortest-edge/3 (rounded.ts).
// - 1.5px stroke of the fill darkened ~12% (stroke width is in screen units;
//   at base zoom ≈ 1 viewport px on a 390px phone).
// - Terrain textures: woods dot-clusters, mountain ridge stroke, swamp dashes.
//   All decoration geometry is seeded by mulberry32(cell.id) — deterministic,
//   no Math.random in render, stable across re-renders.
// - Fog mist (§10.1): white wash rgba(255,255,255,0.55) + slight desaturation
//   of the fill. Terrain stays legible — the map is known, units hide.

import { memo } from 'react';
import type { Cell } from '../../board/types';
import type { FactionId } from '../../core/types';
import { mulberry32 } from '../../board/rng';
import { PALETTE, darken, desaturate, factionColor, mix, terrainFill } from './palette';
import { ringCentroid, ringRadius, roundedPolygonPath, type Pt } from './rounded';

export type CellRendererProps = {
  cell: Cell;
  /** World (y-up) → screen (y-down) projection, owned by the Board. */
  toScreen: (p: readonly [number, number]) => Pt;
  /** Cell is outside the viewing faction's vision → mist treatment. */
  fogged?: boolean;
  /** Base cells tint toward their owning faction (§10.1). */
  baseTintFaction?: FactionId | null;
  onTap?: (cellId: number) => void;
};

// "Slight" desaturation (§10.1) — the 0.55 white wash does most of the misting;
// keep terrain (especially water) readable under fog. 0.5 measured too pale in
// the P6 visual pass.
const FOG_DESATURATION = 0.25;
/** Cell stroke width, screen units (≈1.5 viewport px at base zoom). */
export const CELL_STROKE_WIDTH = 1.6;

function woodsDots(rng: () => number, c: Pt, r: number): JSX.Element[] {
  // 2–3 clusters of 3 dots each (§10.1), jittered inside the cell.
  const clusters = 2 + Math.floor(rng() * 2);
  const dots: JSX.Element[] = [];
  for (let k = 0; k < clusters; k++) {
    const ang = rng() * Math.PI * 2;
    const dist = rng() * 0.42 * r;
    const cx = c[0] + Math.cos(ang) * dist;
    const cy = c[1] + Math.sin(ang) * dist;
    const dotR = r * (0.075 + rng() * 0.03);
    for (let j = 0; j < 3; j++) {
      const a2 = rng() * Math.PI * 2;
      dots.push(
        <circle
          key={`w${k}-${j}`}
          cx={cx + Math.cos(a2) * dotR * 1.6}
          cy={cy + Math.sin(a2) * dotR * 1.6}
          r={dotR}
          fill={PALETTE.woodsDots}
        />,
      );
    }
  }
  return dots;
}

function mountainRidge(rng: () => number, c: Pt, r: number): JSX.Element {
  // One zigzag ridge stroke across the cell, two peaks, jittered.
  const w = r * 0.95;
  const y0 = c[1] + r * 0.18;
  const peak1 = c[1] - r * (0.28 + rng() * 0.15);
  const peak2 = c[1] - r * (0.18 + rng() * 0.18);
  const xJit = (rng() - 0.5) * 0.1 * r;
  const d =
    `M${c[0] - w * 0.5} ${y0}` +
    `L${c[0] - w * 0.18 + xJit} ${peak1}` +
    `L${c[0] + w * 0.04} ${c[1] - r * 0.02}` +
    `L${c[0] + w * 0.26} ${peak2}` +
    `L${c[0] + w * 0.5} ${y0}`;
  return (
    <path
      d={d}
      fill="none"
      stroke={PALETTE.mountainRidge}
      strokeWidth={r * 0.09}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  );
}

function swampDashes(rng: () => number, c: Pt, r: number): JSX.Element[] {
  // 3 short horizontal dashes, staggered (§10.1).
  const rows = [-0.3, 0.02, 0.34];
  return rows.map((dy, i) => {
    const len = r * (0.42 + rng() * 0.22);
    const x = c[0] + (rng() - 0.5) * 0.4 * r;
    const y = c[1] + dy * r + (rng() - 0.5) * 0.08 * r;
    return (
      <line
        key={`s${i}`}
        x1={x - len / 2}
        y1={y}
        x2={x + len / 2}
        y2={y}
        stroke={PALETTE.swampDash}
        strokeWidth={r * 0.075}
        strokeLinecap="round"
      />
    );
  });
}

export const CellRenderer = memo(function CellRenderer({
  cell,
  toScreen,
  fogged = false,
  baseTintFaction = null,
  onTap,
}: CellRendererProps) {
  const pts = cell.polygon.map(toScreen);
  const d = roundedPolygonPath(pts);
  const c = ringCentroid(pts);
  const r = ringRadius(pts, c);

  let fill = terrainFill(cell.terrain);
  if (cell.terrain === 'base' && baseTintFaction !== null) {
    fill = mix(fill, factionColor(baseTintFaction), 0.28);
  }
  const stroke = darken(fill, 0.12);
  if (fogged) fill = desaturate(fill, FOG_DESATURATION);

  const rng = mulberry32(cell.id + 0x9e3779b9);
  let texture: JSX.Element | JSX.Element[] | null = null;
  if (cell.terrain === 'woods') texture = woodsDots(rng, c, r);
  else if (cell.terrain === 'mountains') texture = mountainRidge(rng, c, r);
  else if (cell.terrain === 'swamp') texture = swampDashes(rng, c, r);

  return (
    <g
      className={`cell cell-${cell.terrain}${fogged ? ' cell-fogged' : ''}`}
      data-cell-id={cell.id}
      onClick={onTap ? () => onTap(cell.id) : undefined}
    >
      <path d={d} fill={fill} stroke={stroke} strokeWidth={CELL_STROKE_WIDTH} strokeLinejoin="round" />
      {texture !== null && (
        <g className="cell-texture" opacity={fogged ? 0.45 : 1} pointerEvents="none">
          {texture}
        </g>
      )}
      {fogged && <path className="fog-wash" d={d} fill={PALETTE.fogWash} pointerEvents="none" />}
    </g>
  );
});
