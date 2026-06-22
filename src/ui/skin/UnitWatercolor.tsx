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
  return (
    <g className="unit-watercolor">
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
      {/* the painting — UNTINTED (faction colour is baked in) */}
      <image
        href={url}
        x={-box / 2}
        y={-box * ART_Y}
        width={box}
        height={box}
        preserveAspectRatio="xMidYMid meet"
        data-watercolor-type={type}
        data-watercolor-faction={faction}
        pointerEvents="none"
      />
    </g>
  );
}
