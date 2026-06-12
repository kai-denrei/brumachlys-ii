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
// - E1 discovery fog (conquest addendum §A) — three tiers per cell:
//     dark   — never seen: paper underfill + near-black cover (#2A2622 at
//              ~0.92); NO terrain detail, texture, or base tint leaks.
//     memory — seen before, not watched: remembered terrain, desaturated
//              ~0.55 + white wash 0.35; units are withheld by the callers.
//     live   — inside current vision: normal rendering (unchanged).
//   `igniting` replays the dark cover once and fades it (~0.4 s CSS) — the
//   dark → live soft ignite during replay playback.
// - `silhouette` (start-screen previews): paper-tone mesh, terrain withheld —
//   full-terrain previews would defeat discovery.

import { memo } from 'react';
import type { Cell } from '../../board/types';
import type { FactionId } from '../../core/types';
import type { FogTier } from '../../core/fog';
import { mulberry32 } from '../../board/rng';
import {
  DARK_COVER_OPACITY,
  MEMORY_DESATURATION,
  PALETTE,
  darken,
  desaturate,
  factionColor,
  mix,
  terrainFill,
} from './palette';
import { ringCentroid, ringRadius, roundedPolygonPath, type Pt } from './rounded';

export type CellRendererProps = {
  cell: Cell;
  /** World (y-up) → screen (y-down) projection, owned by the Board. */
  toScreen: (p: readonly [number, number]) => Pt;
  /** E1 discovery tier (default 'live' — normal rendering). */
  tier?: FogTier;
  /** Dark → live transition this replay frame: fade the cover out (~0.4 s). */
  igniting?: boolean;
  /** Paper-tone silhouette (start previews): mesh only, no terrain colors. */
  silhouette?: boolean;
  /** Base cells tint toward their owning faction (§10.1). */
  baseTintFaction?: FactionId | null;
  onTap?: (cellId: number) => void;
};

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
  tier = 'live',
  igniting = false,
  silhouette = false,
  baseTintFaction = null,
  onTap,
}: CellRendererProps) {
  const pts = cell.polygon.map(toScreen);
  const d = roundedPolygonPath(pts);
  const c = ringCentroid(pts);
  const r = ringRadius(pts, c);

  // Silhouette (start previews): the mesh in paper tones — nothing else.
  // Stroke darkened 0.28 — the E1 visual pass found 0.1 invisible on the
  // white donor cards at phone size; the mesh IS the preview, it must read.
  if (silhouette) {
    return (
      <g className={`cell cell-silhouette`} data-cell-id={cell.id}>
        <path
          d={d}
          fill={PALETTE.paper}
          stroke={darken(PALETTE.paper, 0.28)}
          strokeWidth={CELL_STROKE_WIDTH}
          strokeLinejoin="round"
        />
      </g>
    );
  }

  // Dark tier: never seen — paper underfill, near-black cover, zero detail.
  if (tier === 'dark') {
    return (
      <g
        className="cell cell-dark"
        data-cell-id={cell.id}
        onClick={onTap ? () => onTap(cell.id) : undefined}
      >
        <path
          d={d}
          fill={PALETTE.paper}
          stroke={darken(PALETTE.paper, 0.12)}
          strokeWidth={CELL_STROKE_WIDTH}
          strokeLinejoin="round"
        />
        <path
          className="dark-cover"
          d={d}
          fill={PALETTE.darkCover}
          opacity={DARK_COVER_OPACITY}
          pointerEvents="none"
        />
      </g>
    );
  }

  const memory = tier === 'memory';
  let fill = terrainFill(cell.terrain);
  // E3 (E1 handoff): ownership tint applies AFTER the memory desaturation so
  // it survives the wash — a remembered base still reads as owned ground.
  if (memory) fill = desaturate(fill, MEMORY_DESATURATION);
  if (cell.terrain === 'base' && baseTintFaction !== null) {
    fill = mix(fill, factionColor(baseTintFaction), 0.28);
  }
  const stroke = darken(fill, 0.12);
  // E3: keep/flag pip so base cells are findable among cells (live + memory;
  // the dark branch above already hides bases entirely). Neutral = sand ink.
  const pipColor =
    baseTintFaction !== null ? factionColor(baseTintFaction) : darken(PALETTE.base, 0.4);

  const rng = mulberry32(cell.id + 0x9e3779b9);
  let texture: JSX.Element | JSX.Element[] | null = null;
  if (cell.terrain === 'woods') texture = woodsDots(rng, c, r);
  else if (cell.terrain === 'mountains') texture = mountainRidge(rng, c, r);
  else if (cell.terrain === 'swamp') texture = swampDashes(rng, c, r);

  return (
    <g
      className={`cell cell-${cell.terrain}${memory ? ' cell-memory' : ''}`}
      data-cell-id={cell.id}
      onClick={onTap ? () => onTap(cell.id) : undefined}
    >
      <path d={d} fill={fill} stroke={stroke} strokeWidth={CELL_STROKE_WIDTH} strokeLinejoin="round" />
      {texture !== null && (
        <g className="cell-texture" opacity={memory ? 0.45 : 1} pointerEvents="none">
          {texture}
        </g>
      )}
      {memory && (
        <path className="memory-wash" d={d} fill={PALETTE.memoryWash} pointerEvents="none" />
      )}
      {cell.terrain === 'base' && (
        <g
          className="base-pip"
          pointerEvents="none"
          transform={`translate(${c[0]} ${c[1] - r * 0.5})`}
          opacity={memory ? 0.75 : 1}
        >
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={r * 0.62}
            stroke={pipColor}
            strokeWidth={r * 0.08}
            strokeLinecap="round"
          />
          <path d={`M0 0 L${r * 0.42} ${r * 0.14} L0 ${r * 0.28} Z`} fill={pipColor} />
        </g>
      )}
      {igniting && (
        <path
          className="dark-cover dark-cover-ignite"
          d={d}
          fill={PALETTE.darkCover}
          pointerEvents="none"
        />
      )}
    </g>
  );
});
