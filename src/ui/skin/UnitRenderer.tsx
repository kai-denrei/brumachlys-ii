// UnitRenderer — unit token, spec §10.2 / §10.4. Rounded squircle in faction
// color, white unit icon (v1.2: real Noun Project art via skin/icons, tinted
// through currentColor), count numeral in a corner pip, stance as the token's
// stroke style (aggressive solid, defensive double, hold-fire dashed).
//
// Skin-swap contract: the token is a single <g class="unit-token"> positioned
// by transform — a sprite/animated skin later replaces the innards, and P8's
// replay can animate movement by transitioning the transform. No game logic.
// Every glyph site (board tokens, dock chips, timeline strip, ghosts, cards,
// rules modal) renders through here, so the icon swap was one file.

import { memo } from 'react';
import type { UnitInstance } from '../../core/types';
import { UnitGlyph } from './icons';
import { darken, factionColor } from './palette';

export type UnitRendererProps = {
  unit: UnitInstance;
  /** Token center, screen coords. */
  x: number;
  y: number;
  /** Token edge length (squircle width/height), screen units. */
  size: number;
  /** Layer-1 selection: the token lifts slightly (§9.2). */
  selected?: boolean;
  /** v1.3 Tweak A (co-located stagger): shrink the whole token. Rides the
   * positioning transform so the 0.25s CSS transition animates it. */
  scale?: number;
  /** Glyph-only token (timeline strip chips): no count pip, no stance
   * stroke styling — squircle + glyph at tiny sizes. */
  minimal?: boolean;
  /** v1.4: idle "awaiting orders" cue (planning phase, own unordered units
   * only — the Board decides). A soft faction-color halo breathing on a ~2 s
   * period behind the token: a nudge, not an alarm — deliberately unlike the
   * red threat-ring vocabulary (faster ring-pulse on target cells). Under
   * prefers-reduced-motion the CSS swaps it for a static dotted outline. */
  pulse?: boolean;
  onTap?: (unitId: string) => void;
};

export const UnitRenderer = memo(function UnitRenderer({
  unit,
  x,
  y,
  size,
  selected = false,
  scale = 1,
  minimal = false,
  pulse = false,
  onTap,
}: UnitRendererProps) {
  const color = factionColor(unit.faction);
  const h = size / 2;
  const rx = size * 0.3; // squircle corner
  const strokeW = size * 0.06;
  const stroke = '#fff';

  // Stance → stroke style (§10.2).
  const stance = minimal ? 'aggressive' : unit.stance;
  const dash = stance === 'hold-fire' ? `${size * 0.12} ${size * 0.09}` : undefined;

  const pipR = size * 0.21;

  return (
    <g
      className={`unit-token unit-faction-${unit.faction}${selected ? ' unit-selected' : ''}`}
      data-unit-id={unit.id}
      data-unit-type={unit.type}
      transform={`translate(${x} ${y})${scale !== 1 ? ` scale(${scale})` : ''}${selected ? ` translate(0 ${-size * 0.14})` : ''}`}
      onClick={onTap ? () => onTap(unit.id) : undefined}
    >
      {selected && <ellipse cx={0} cy={size * 0.5} rx={h * 0.9} ry={h * 0.3} fill="rgba(74,68,58,0.18)" />}
      {pulse && (
        <g className="idle-pulse" pointerEvents="none" aria-hidden="true">
          {/* pathLength normalizes the circumference so the reduced-motion
              dotted outline (CSS stroke-dasharray) is size-independent. */}
          <circle
            className="idle-pulse-halo"
            r={size * 0.74}
            pathLength={100}
            fill="none"
            stroke={color}
            strokeWidth={size * 0.07}
          />
        </g>
      )}
      <rect
        className="unit-body"
        x={-h}
        y={-h}
        width={size}
        height={size}
        rx={rx}
        fill={color}
        stroke={stroke}
        strokeWidth={strokeW}
        strokeDasharray={dash}
      />
      {stance === 'defensive' && (
        <rect
          className="unit-stroke-inner"
          x={-h + strokeW * 1.9}
          y={-h + strokeW * 1.9}
          width={size - strokeW * 3.8}
          height={size - strokeW * 3.8}
          rx={rx * 0.72}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeW * 0.75}
        />
      )}
      <g transform={`translate(${-h} ${-h}) scale(${size / 100})`} pointerEvents="none">
        <UnitGlyph type={unit.type} />
      </g>
      {!minimal && (
        <g className="unit-count" transform={`translate(${h * 0.78} ${h * 0.78})`} pointerEvents="none">
          <circle r={pipR} fill="#fff" stroke={darken(color, 0.18)} strokeWidth={pipR * 0.14} />
          <text
            y={pipR * 0.06}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={pipR * 1.35}
            fontWeight={700}
            fill={darken(color, 0.3)}
          >
            {unit.count}
          </text>
        </g>
      )}
    </g>
  );
});
