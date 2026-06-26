// UnitWatercolor — static watercolor unit token (gear menu → "Watercolor").
// A single faction-painted webp per unit type, drawn as an SVG <image> sized to
// the token box. UNTINTED: the faction colour is baked into the art (f0 coral /
// f1 blue), so unlike UnitSprite there is no recolour filter here.
//
// Render contract mirrors UnitSprite: a single SVG <g> positioned by the parent
// UnitRenderer at the token center — a transparent tap target the size of the
// old squircle (so selection/long-press still land on the token, not the cell),
// a soft ground shadow, then the artwork centered on the tile.

import type { FactionId } from '../../core/types';
import { watercolorUrl } from './watercolors/watercolor-data';

/** Artwork box as a multiple of token size. The painted figure fills most of its
 *  frame, so a ~1.7× box renders it a touch larger than the squircle, reading as
 *  a unit standing ON the tile (matching the sprite skin's presence). */
const ART_SCALE = 1.7;
/** The figures are roughly center-weighted but bottom-heavy; lift the box so the
 *  body, not the feet, centers on the tile (fraction of the box above center). */
const ART_Y = 0.56;

/** Faction frame colours (untinted art INSIDE the frame — these only paint the
 *  thin border). f0 = the player (source P1) → a muted brick RED; f1 = the
 *  opponent (source P2) → a near-black charcoal. Clear constants so a future
 *  re-tint is one edit. */
export const WATERCOLOR_FRAME_COLORS: Record<FactionId, string> = {
  0: '#c0392b', // brick red — player / faction 0
  1: '#1a1a1a', // charcoal black — opponent / faction 1
};
/** Corner radius of the clipped art box, as a fraction of the box edge — a
 *  tasteful round, proportional to the token so it reads the same at any size. */
const CORNER_FRAC = 0.16;
/** Frame stroke width as a fraction of token size — deliberately "slight". */
const FRAME_STROKE_FRAC = 0.045;

export type UnitWatercolorProps = {
  faction: FactionId;
  /** Unit-type key (e.g. 'infantry', 'tank') — selects the painting. */
  type: string;
  size: number;
};

export function UnitWatercolor({ faction, type, size }: UnitWatercolorProps) {
  const url = watercolorUrl(faction, type);
  // Unknown type: render nothing here — UnitRenderer falls back to the glyph.
  if (!url) return null;
  const box = size * ART_SCALE;
  const h = size / 2;
  const bx = -box / 2;
  const by = -box * ART_Y;
  const radius = box * CORNER_FRAC;
  const frameColor = WATERCOLOR_FRAME_COLORS[faction];
  const frameStroke = size * FRAME_STROKE_FRAC;
  // A clip path id keyed to the HREF (not the unit id) so the clip is stable as
  // long as the image is — see the keyed <g> note below. The id is sanitised to
  // valid characters; identical art shares one clip (harmless, deterministic).
  const clipId = `wc-clip-${faction}-${type}`;
  // Stable per-HREF KEY on the whole token: when the art on a tile changes (a
  // different unit/href), React MOUNTS A FRESH <image> instead of reusing the
  // old element and swapping its href — the latter makes the browser paint the
  // previous (cached) bitmap for a frame as the new one decodes (the watercolor
  // capture FLICKER). Keying by href guarantees no <image> is ever reused across
  // two different paintings.
  return (
    <g className="unit-watercolor" key={url}>
      {/* Transparent tap target the size of the old squircle: the art is
          pointer-transparent, so the token still selects / long-presses exactly
          as before instead of taps falling through to the cell underneath. */}
      <rect
        className="unit-hit"
        x={-h}
        y={-h}
        width={size}
        height={size}
        fill="transparent"
        style={{ pointerEvents: 'all' }}
      />
      {/* soft ground shadow grounds the figure on the tile */}
      <ellipse
        cx={0}
        cy={size * 0.46}
        rx={size * 0.34}
        ry={size * 0.12}
        fill="rgba(40,36,30,0.20)"
        pointerEvents="none"
      />
      {/* Rounded-corner clip for the art box so the painting reads as a framed
          token rather than a raw rectangle. */}
      <clipPath id={clipId}>
        <rect x={bx} y={by} width={box} height={box} rx={radius} ry={radius} />
      </clipPath>
      {/* the painting — UNTINTED (faction colour is baked in), clipped to the
          rounded rect. */}
      <image
        href={url}
        x={bx}
        y={by}
        width={box}
        height={box}
        preserveAspectRatio="xMidYMid meet"
        clipPath={`url(#${clipId})`}
        data-watercolor-type={type}
        data-watercolor-faction={faction}
        pointerEvents="none"
      />
      {/* slight FACTION FRAME around the rounded box — RED for f0 (player),
          BLACK for f1 (opponent). Thin stroke, no fill (art stays untinted). */}
      <rect
        className="unit-watercolor-frame"
        x={bx}
        y={by}
        width={box}
        height={box}
        rx={radius}
        ry={radius}
        fill="none"
        stroke={frameColor}
        strokeWidth={frameStroke}
        data-frame-faction={faction}
        pointerEvents="none"
      />
    </g>
  );
}
