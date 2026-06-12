// UnitRenderer — unit token, spec §10.2 / §10.4. Rounded squircle in faction
// color, white minimalist glyph (8 glyphs, readable at 24px), count numeral in
// a corner pip, stance as the token's stroke style (aggressive solid,
// defensive double, hold-fire dashed).
//
// Skin-swap contract: the token is a single <g class="unit-token"> positioned
// by transform — a sprite/animated skin later replaces the innards, and P8's
// replay can animate movement by transitioning the transform. No game logic.

import { memo } from 'react';
import type { UnitInstance } from '../../core/types';
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
  onTap?: (unitId: string) => void;
};

const GLYPH_STROKE = 11; // in the 100×100 glyph box

/** White minimalist glyphs in a 100×100 box centered on (50,50) (§10.2). */
function glyph(type: string): JSX.Element {
  switch (type) {
    case 'sniper': // crosshair
      return (
        <g fill="none" stroke="#fff" strokeWidth={GLYPH_STROKE} strokeLinecap="round">
          <circle cx={50} cy={50} r={20} />
          <line x1={50} y1={14} x2={50} y2={28} />
          <line x1={50} y1={72} x2={50} y2={86} />
          <line x1={14} y1={50} x2={28} y2={50} />
          <line x1={72} y1={50} x2={86} y2={50} />
        </g>
      );
    case 'humvee': // wedge
      return <path d="M24 70 L50 28 L76 70 L50 58 Z" fill="#fff" />;
    case 'ranger': // chevron
      return (
        <path
          d="M26 62 L50 36 L74 62"
          fill="none"
          stroke="#fff"
          strokeWidth={GLYPH_STROKE + 3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'infantry': // dot-pair
      return (
        <g fill="#fff">
          <circle cx={36} cy={50} r={12} />
          <circle cx={64} cy={50} r={12} />
        </g>
      );
    case 'grenadier': // triangle
      return <path d="M50 26 L78 70 L22 70 Z" fill="#fff" />;
    case 'tank': // rectangle
      return <rect x={26} y={36} width={48} height={28} rx={5} fill="#fff" />;
    case 'artillery': // arc
      return (
        <path
          d="M24 66 A 30 30 0 0 1 76 66"
          fill="none"
          stroke="#fff"
          strokeWidth={GLYPH_STROKE + 2}
          strokeLinecap="round"
        />
      );
    case 'heavytank': // double-rectangle
      return (
        <g fill="#fff">
          <rect x={24} y={30} width={52} height={17} rx={4} />
          <rect x={24} y={53} width={52} height={17} rx={4} />
        </g>
      );
    default:
      return <circle cx={50} cy={50} r={16} fill="#fff" />;
  }
}

export const UnitRenderer = memo(function UnitRenderer({
  unit,
  x,
  y,
  size,
  selected = false,
  onTap,
}: UnitRendererProps) {
  const color = factionColor(unit.faction);
  const h = size / 2;
  const rx = size * 0.3; // squircle corner
  const strokeW = size * 0.06;
  const stroke = '#fff';

  // Stance → stroke style (§10.2).
  const stance = unit.stance;
  const dash = stance === 'hold-fire' ? `${size * 0.12} ${size * 0.09}` : undefined;

  const pipR = size * 0.21;

  return (
    <g
      className={`unit-token unit-faction-${unit.faction}${selected ? ' unit-selected' : ''}`}
      data-unit-id={unit.id}
      data-unit-type={unit.type}
      transform={`translate(${x} ${y})${selected ? ` translate(0 ${-size * 0.14})` : ''}`}
      onClick={onTap ? () => onTap(unit.id) : undefined}
    >
      {selected && <ellipse cx={0} cy={size * 0.5} rx={h * 0.9} ry={h * 0.3} fill="rgba(74,68,58,0.18)" />}
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
        {glyph(unit.type)}
      </g>
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
    </g>
  );
});
