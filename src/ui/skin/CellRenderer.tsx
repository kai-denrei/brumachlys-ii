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
  /** v0.6 Ask 3 (conquest): UNOWNED base — a "camp" for the taking. Renders
   * a tent/palisade motif in neutral sand tones (no flag) over a slightly
   * desaturated fill, so it can't be confused with a productive owned base.
   * On capture the caller flips ownership and the cell re-renders as an
   * owned base (flag pip + faction tint) — the claim animation rides ReplayFx. */
  camp?: boolean;
  onTap?: (cellId: number) => void;
};

/** Cell stroke width, screen units (≈1.5 viewport px at base zoom). */
export const CELL_STROKE_WIDTH = 1.6;

/** v0.6 Ask 3: camp fill desaturation (applied AFTER the memory wash desat,
 * same ordering rule as the ownership tint — pinned by tests). */
export const CAMP_DESATURATION = 0.35;

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

/** Tent + stockade motif for neutral camps (sand-tone ink, no flag). An
 * inviting-but-unclaimed fortification: a ridge-pole tent with a ridge-cap
 * crossbar, set inside a partial-circle stockade arc. Reads distinctly from
 * the keep motif on owned bases — same vocabulary, different status. */
function CampMotif({ c, r, ink }: { c: Pt; r: number; ink: string }) {
  const tw = r * 0.46; // tent half-width
  const th = r * 0.44; // tent height
  const baseY = r * 0.28; // tent baseline (y-down, so positive = lower on screen)
  const topY = baseY - th; // tent peak
  const sw = r * 0.085; // standard stroke weight
  // stockade: an arc from ~220° to ~320° (lower-rear) so it frames the tent
  // without obscuring it — 5 stub posts on the curve.
  const stockR = r * 0.82;
  const postCount = 5;
  const arcStart = (220 * Math.PI) / 180;
  const arcEnd = (320 * Math.PI) / 180;
  return (
    <g className="camp-pip" pointerEvents="none" transform={`translate(${c[0]} ${c[1]})`}>
      {/* stockade arc posts */}
      {Array.from({ length: postCount }, (_, i) => {
        const t = arcStart + (i / (postCount - 1)) * (arcEnd - arcStart);
        const px = Math.cos(t) * stockR;
        const py = Math.sin(t) * stockR;
        // post points toward center — draw it inward
        const inR = stockR * 0.72;
        return (
          <line
            key={`p${i}`}
            x1={px}
            y1={py}
            x2={Math.cos(t) * inR}
            y2={Math.sin(t) * inR}
            stroke={ink}
            strokeWidth={sw * 0.8}
            strokeLinecap="round"
          />
        );
      })}
      {/* tent body: filled lightly so it reads as a solid form, not just wire */}
      <path
        d={`M${-tw} ${baseY} L0 ${topY} L${tw} ${baseY} Z`}
        fill={ink}
        fillOpacity={0.13}
        stroke={ink}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
      {/* ridge-pole crossbar at the peak — marks the center post */}
      <line
        x1={-tw * 0.28}
        y1={topY + th * 0.06}
        x2={tw * 0.28}
        y2={topY + th * 0.06}
        stroke={ink}
        strokeWidth={sw * 0.75}
        strokeLinecap="round"
      />
      {/* center seam */}
      <line
        x1={0}
        y1={topY}
        x2={0}
        y2={baseY}
        stroke={ink}
        strokeWidth={sw * 0.65}
        strokeLinecap="round"
        strokeOpacity={0.55}
      />
    </g>
  );
}

/** Keep/standard motif for owned bases — a crenellated tower silhouette
 * with the faction flag on a mast. Far more legible than the former small
 * pennant at phone zoom; the tower outline reads the same in memory tier. */
function OwnedBaseMotif({ c, r, color }: { c: Pt; r: number; color: string }) {
  // Tower geometry (centered, y-down)
  const tw = r * 0.46; // tower half-width
  const tH = r * 0.66; // tower total height
  const topY = -r * 0.34; // top of battlements
  const botY = topY + tH; // tower base
  const merlonW = tw * 0.28; // merlon (raised) width
  const merlonH = r * 0.14; // merlon protrusion
  const gateW = tw * 0.38; // gate arch half-width
  const gateH = r * 0.22; // gate arch height
  const sw = r * 0.07; // stroke weight
  // Tower body (filled with faction color at low opacity)
  const towerFill = color;
  // Battlement: 3 merlons centered on the tower top
  const merX = [-merlonW, 0, merlonW];
  return (
    <g className="base-keep" pointerEvents="none" transform={`translate(${c[0]} ${c[1]})`}>
      {/* tower body */}
      <rect
        x={-tw}
        y={topY}
        width={tw * 2}
        height={tH}
        fill={towerFill}
        fillOpacity={0.22}
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
      {/* battlements — 3 merlons across the top */}
      {merX.map((mx, i) => (
        <rect
          key={`m${i}`}
          x={mx - merlonW * 0.45}
          y={topY - merlonH}
          width={merlonW * 0.9}
          height={merlonH}
          fill={towerFill}
          fillOpacity={0.28}
          stroke={color}
          strokeWidth={sw * 0.8}
          strokeLinejoin="round"
        />
      ))}
      {/* arched gate — filled dark so it reads as an opening */}
      <path
        d={`M${-gateW} ${botY} L${-gateW} ${botY - gateH * 0.6} A${gateW} ${gateH * 0.6} 0 0 1 ${gateW} ${botY - gateH * 0.6} L${gateW} ${botY} Z`}
        fill={color}
        fillOpacity={0.55}
        stroke={color}
        strokeWidth={sw * 0.7}
        strokeLinejoin="round"
      />
      {/* flag mast rising from center merlon */}
      <line
        x1={0}
        y1={topY - merlonH}
        x2={0}
        y2={topY - merlonH - r * 0.48}
        stroke={color}
        strokeWidth={sw * 0.85}
        strokeLinecap="round"
      />
      {/* flag banner — a proper rect so it reads clearly at small size */}
      <path
        d={`M0 ${topY - merlonH - r * 0.46} L${r * 0.44} ${topY - merlonH - r * 0.3} L0 ${topY - merlonH - r * 0.14} Z`}
        fill={color}
        stroke="none"
      />
    </g>
  );
}

export const CellRenderer = memo(function CellRenderer({
  cell,
  toScreen,
  tier = 'live',
  igniting = false,
  silhouette = false,
  baseTintFaction = null,
  camp = false,
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
  const isCamp = camp && cell.terrain === 'base' && baseTintFaction === null;
  let fill = terrainFill(cell.terrain);
  // E3 (E1 handoff): ownership tint applies AFTER the memory desaturation so
  // it survives the wash — a remembered base still reads as owned ground.
  if (memory) fill = desaturate(fill, MEMORY_DESATURATION);
  if (cell.terrain === 'base' && baseTintFaction !== null) {
    fill = mix(fill, factionColor(baseTintFaction), 0.28);
  }
  // v0.6 Ask 3: camps desaturate slightly (after the memory desat, same
  // ordering rule as the tint) — unowned ground reads quieter than owned.
  if (isCamp) fill = desaturate(fill, CAMP_DESATURATION);
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
      className={`cell cell-${cell.terrain}${memory ? ' cell-memory' : ''}${isCamp ? ' cell-camp' : ''}`}
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
      {cell.terrain === 'base' &&
        (isCamp ? (
          // v0.6 Ask 3: a camp flies NO flag — tent + stockade, sand ink,
          // slightly faded so it reads "for the taking", not "productive".
          <g opacity={memory ? 0.6 : 0.82}>
            <CampMotif c={c} r={r} ink={darken(PALETTE.base, 0.42)} />
          </g>
        ) : (
          // Owned base: keep/standard motif — tower + battlements + faction flag.
          // The base-pip class is retained so test selectors keep working.
          <g className="base-pip" pointerEvents="none" opacity={memory ? 0.72 : 1}>
            <OwnedBaseMotif c={c} r={r} color={pipColor} />
          </g>
        ))}
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
