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
  /** v0.9 active-unit halo: a PULSING faction-color ring around the currently
   * commanded (selected) unit — a clear "this is the unit I'm moving" cue, far
   * louder than the faint selection ellipse. Gated by the Board on `selected`.
   * When `proposed` is also set (a pending MOVE proposal exists for this unit)
   * the halo intensifies (thicker, brighter) — the player is mid-confirm. Under
   * prefers-reduced-motion the CSS swaps the pulse for a static solid ring. */
  selectedHalo?: boolean;
  /** v0.9: the selected unit has a PENDING move proposal — intensify the halo. */
  proposed?: boolean;
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
  /** v0.6 Ask 7 (impact verb, recoil half): screen-unit lunge-back vector —
   * away from the defender, along the attack line. The animation lives on an
   * INNER group (the outer transform attribute must never carry a CSS
   * transform animation — P9 note) and remounts per `recoilKey` so
   * consecutive volleys restart it. ~220 ms: 120 ms back + 100 ms settle. */
  recoil?: { dx: number; dy: number } | null;
  recoilKey?: number;
  /** v0.8 veterancy: the unit type's credit cost — used to compute XP sliver
   * progress toward the next rank. Absent → sliver is not drawn. */
  unitTypeCost?: number;
  onTap?: (unitId: string) => void;
  /** v0.9 radar: fires when the player taps the bottom-left radar pip.
   * Only rendered when this prop is provided (own units, non-minimal, planning). */
  onRadar?: () => void;
  /** v0.9 radar: when true the radar pip renders as ACTIVE (inverted fill). */
  radarActive?: boolean;
};

export const UnitRenderer = memo(function UnitRenderer({
  unit,
  x,
  y,
  size,
  selected = false,
  selectedHalo = false,
  proposed = false,
  scale = 1,
  minimal = false,
  pulse = false,
  recoil = null,
  recoilKey = 0,
  unitTypeCost,
  onTap,
  onRadar,
  radarActive = false,
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

  const body = (
    <>
      {selected && <ellipse cx={0} cy={size * 0.5} rx={h * 0.9} ry={h * 0.3} fill="rgba(74,68,58,0.18)" />}
      {/* v0.9 active-unit halo: a pulsing faction-color ring around the unit the
          player is commanding. `proposed` intensifies it (thicker/brighter)
          while a move proposal is pending. Behind the token body, never taps. */}
      {selectedHalo && (
        <g
          className={`active-halo${proposed ? ' active-halo-proposed' : ''}`}
          pointerEvents="none"
          aria-hidden="true"
        >
          <circle
            className="active-halo-ring"
            r={size * 0.82}
            pathLength={100}
            fill="none"
            stroke={color}
            strokeWidth={size * (proposed ? 0.12 : 0.09)}
          />
        </g>
      )}
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
            // v0.9: count doubles as a health readout — high black, mid amber,
            // low red (8–10 black · 5–7 orange · 1–4 red).
            fill={unit.count >= 8 ? '#1a1a1a' : unit.count >= 5 ? '#d97706' : '#dc2626'}
          >
            {unit.count}
          </text>
        </g>
      )}
      {/* v0.9 radar: bottom-left pip — mirrors the count pip (bottom-right).
          Only rendered for own units in planning (onRadar provided by Board).
          The radar icon: a filled circle with 2 concentric arcs + a sweep line.
          Active state inverts fill to faction color. Tap stops propagation so
          it does NOT trigger the unit's own select/propose tap. */}
      {!minimal && onRadar && (
        <g
          className={`unit-radar${radarActive ? ' unit-radar-active' : ''}`}
          transform={`translate(${-h * 0.78} ${h * 0.78})`}
          pointerEvents="auto"
          onClick={(e) => { e.stopPropagation(); onRadar(); }}
          style={{ cursor: 'pointer' }}
          aria-label={radarActive ? 'radar on — tap to exit' : 'radar — measure distances'}
          role="button"
        >
          {/* pip background circle */}
          <circle
            r={pipR}
            fill={radarActive ? color : '#fff'}
            stroke={darken(color, 0.18)}
            strokeWidth={pipR * 0.14}
          />
          {/* radar rings (2 concentric arcs, top-right quadrant) */}
          <circle
            r={pipR * 0.38}
            fill="none"
            stroke={radarActive ? '#fff' : color}
            strokeWidth={pipR * 0.13}
            strokeDasharray={`${pipR * 0.6} ${pipR * 9}`}
            strokeDashoffset={pipR * 0.0}
            opacity={0.85}
          />
          <circle
            r={pipR * 0.68}
            fill="none"
            stroke={radarActive ? '#fff' : color}
            strokeWidth={pipR * 0.11}
            strokeDasharray={`${pipR * 0.55} ${pipR * 9}`}
            strokeDashoffset={pipR * 0.0}
            opacity={0.65}
          />
          {/* sweep line from center — rotates when active */}
          <g className={radarActive ? 'radar-sweep-spin' : undefined}>
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={-(pipR * 0.72)}
              stroke={radarActive ? '#fff' : color}
              strokeWidth={pipR * 0.13}
              strokeLinecap="round"
              opacity={0.9}
            />
          </g>
        </g>
      )}
      {/* v0.8 veterancy: rank pips — small chevrons along the bottom edge,
          in the faction colour. Only drawn when rank > 0 and not minimal.
          Cap at 3 drawn; rank > 3 shows 3 filled + a tiny "+N" label. */}
      {!minimal && (unit.rank ?? 0) > 0 && (() => {
        const rank = unit.rank ?? 0;
        const drawnPips = Math.min(rank, 3);
        const overflow = rank > 3 ? rank - 3 : 0;
        // Chevron dims: tiny upward V shape. pipW = half-width, pipH = height.
        const pipW = size * 0.085;
        const pipH = size * 0.07;
        // Row of pips, horizontally centered, near the bottom inside edge.
        const spacing = size * 0.22;
        const totalW = (drawnPips - 1) * spacing;
        const baseY = h - size * 0.1; // just inside the bottom edge
        return (
          <g className="unit-rank-pips" pointerEvents="none" aria-label={`rank ${rank}`}>
            {Array.from({ length: drawnPips }, (_, i) => {
              const px = -totalW / 2 + i * spacing;
              return (
                <polyline
                  key={i}
                  points={`${px - pipW},${baseY + pipH} ${px},${baseY} ${px + pipW},${baseY + pipH}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={size * 0.055}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.9}
                />
              );
            })}
            {overflow > 0 && (
              <text
                x={totalW / 2 + spacing * 0.65}
                y={baseY + pipH * 0.4}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={size * 0.13}
                fontWeight={700}
                fill={color}
                opacity={0.85}
              >
                +{overflow}
              </text>
            )}
          </g>
        );
      })()}
      {/* v0.8 veterancy: XP sliver — thin progress bar along the left edge
          showing progress toward the next rank. Low-contrast, ambient only.
          Only drawn when cost is known and there is meaningful xp or rank. */}
      {!minimal && unitTypeCost != null && unitTypeCost > 0 && (() => {
        const xp = unit.xp ?? 0;
        const rank = unit.rank ?? 0;
        if (xp === 0 && rank === 0) return null;
        const fraction = ((2 * xp) % unitTypeCost) / unitTypeCost;
        if (fraction <= 0) return null;
        const barH = size * 0.72; // usable height inside the squircle
        const barX = -h + size * 0.055; // left edge, slightly inset
        const barY = -barH / 2;
        const barW = size * 0.06;
        const fillH = barH * fraction;
        return (
          <g className="unit-xp-sliver" pointerEvents="none" aria-hidden="true">
            {/* track */}
            <rect
              x={barX}
              y={barY}
              width={barW}
              height={barH}
              rx={barW / 2}
              fill="rgba(0,0,0,0.18)"
            />
            {/* fill — anchored to the bottom */}
            <rect
              x={barX}
              y={barY + (barH - fillH)}
              width={barW}
              height={fillH}
              rx={barW / 2}
              fill="#fff"
              opacity={0.55}
            />
          </g>
        );
      })()}
    </>
  );

  return (
    <g
      className={`unit-token unit-faction-${unit.faction}${selected ? ' unit-selected' : ''}`}
      data-unit-id={unit.id}
      data-unit-type={unit.type}
      transform={`translate(${x} ${y})${scale !== 1 ? ` scale(${scale})` : ''}${selected ? ` translate(0 ${-size * 0.14})` : ''}`}
      onClick={onTap ? () => onTap(unit.id) : undefined}
    >
      {recoil ? (
        // v0.6 recoil: inner group, CSS-var vector, remounted per volley.
        <g
          key={`rc${recoilKey}`}
          className="fx-recoil"
          style={{ '--rdx': `${recoil.dx}px`, '--rdy': `${recoil.dy}px` } as React.CSSProperties}
        >
          {body}
        </g>
      ) : (
        body
      )}
    </g>
  );
});
