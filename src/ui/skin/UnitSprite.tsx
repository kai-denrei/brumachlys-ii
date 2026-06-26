// UnitSprite — animated infantry sprite token (PoC). Frame-steps a Craftpix
// strip via the shared ticker. Low-frequency CLIP changes go through React
// state (so href/width re-render correctly); the per-frame X offset is set
// imperatively on the <image> element, so a 12–16 fps animation never triggers a
// React re-render. faction 0 (red) gets a blue→red SVG filter; faction 1 keeps
// the sprite's native blue.
//
// Render contract: a single SVG <g> positioned by the parent UnitRenderer at the
// token center. A nested <svg> acts as the 128×128 clip window (overflow hidden);
// the <image> is the full N×128 strip translated left by frame×128.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FactionId } from '../../core/types';
import {
  CLIPS,
  FRAME,
  spriteFrameFor,
  unitSpritePlan,
  type ClipKey,
  type Motion,
} from './sprites/sprite-data';
import { subscribeSprite } from './sprites/ticker';

/** Sprite box as a multiple of token size. The character fills ~half its 128
 * frame, so a ~2× box renders it at roughly icon scale. */
const SPRITE_SCALE = 2.1;
/** The sprite is feet-anchored (pivot y≈0.92); lift the box so the body, not
 * the feet, centers on the tile. Fraction of the box above the token center. */
const SPRITE_Y = 0.6;

export type UnitSpriteProps = {
  unitId: string;
  faction: FactionId;
  size: number;
  /** What the unit is doing right now: idle ambient / moving / firing. */
  motion?: Motion;
  /** Horizontal facing: 1 = the sprite's native right, -1 = mirrored to face
   *  left (toward the enemy). The strips all face right, so left flips. */
  facing?: 1 | -1;
};

export function UnitSprite({ unitId, faction, size, motion = 'idle', facing = 1 }: UnitSpriteProps) {
  const plan = useMemo(() => unitSpritePlan(unitId), [unitId]);
  // move/fire are a single fixed clip per unit → derived straight from `motion`
  // (immediate, no tick needed). Only the IDLE ambient loop cycles clips, so
  // just that rides the ticker. The per-frame x offset (all motions) is set
  // imperatively below, so animation never triggers a React re-render.
  const [ambientClip, setAmbientClip] = useState<ClipKey>('idle');
  const imgRef = useRef<SVGImageElement>(null);
  const motionRef = useRef<Motion>(motion); // ticker reads the LIVE motion
  motionRef.current = motion;

  useEffect(() => {
    let curAmbient: ClipKey = 'idle';
    return subscribeSprite((t) => {
      const m = motionRef.current;
      const next = spriteFrameFor(unitId, m, t);
      if (m === 'idle' && next.clip !== curAmbient) {
        curAmbient = next.clip;
        setAmbientClip(next.clip);
      }
      imgRef.current?.setAttribute('x', String(-next.frame * FRAME));
    });
    // unitId identifies the sprite; motion is read live via motionRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId]);

  const clip: ClipKey = motion === 'move' ? plan.move : motion === 'fire' ? plan.fire : ambientClip;
  const def = CLIPS[clip];
  const box = size * SPRITE_SCALE;
  const h = size / 2;
  return (
    // Mirror the whole sprite (art + shadow + hit rect, all centered/symmetric)
    // around the token center to face left. The flip is instant — no transition.
    <g className="unit-sprite" transform={facing === -1 ? 'scale(-1, 1)' : undefined}>
      {/* Transparent tap target the size of the old squircle: the sprite art is
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
      {/* soft ground shadow grounds the floating sprite on the tile */}
      <ellipse
        cx={0}
        cy={size * 0.46}
        rx={size * 0.34}
        ry={size * 0.12}
        fill="rgba(40,36,30,0.20)"
        pointerEvents="none"
      />
      {/* nested SVG = the 128×128 clip window onto the strip */}
      <svg
        x={-box / 2}
        y={-box * SPRITE_Y}
        width={box}
        height={box}
        viewBox={`0 0 ${FRAME} ${FRAME}`}
        style={{ overflow: 'hidden' }}
        pointerEvents="none"
      >
        <image
          ref={imgRef}
          href={def.url}
          width={FRAME * def.frames}
          height={FRAME}
          preserveAspectRatio="none"
          data-sprite-clip={clip}
          data-sprite-faction={faction}
          style={faction === 0 ? { filter: 'url(#sprite-red)' } : undefined}
        />
      </svg>
    </g>
  );
}

/** SVG filter recoloring the blue sprite to red tones for faction 0. Render once
 * inside the board <defs>. Tuned to sit near the coral factionA without going
 * fully saturated — drops the blue/green, lifts red from the blue+red channels. */
export function SpriteRedFilter() {
  return (
    <filter id="sprite-red" colorInterpolationFilters="sRGB">
      <feColorMatrix
        type="matrix"
        values="1.05 0.30 0.85 0 0
                0.18 0.24 0.10 0 0
                0.16 0.06 0.22 0 0
                0    0    0    1 0"
      />
    </filter>
  );
}
