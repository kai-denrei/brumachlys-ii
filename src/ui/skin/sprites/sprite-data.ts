// sprite-data.ts — animated infantry sprite (Mr. Blue "05-Shooter", Craftpix
// CC0/free). Replaces the flat infantry glyph with a frame-animated sprite.
// Strips are horizontal, 128px tall, frames 128×128 (frame count = width÷128).
//
// PURE except the asset-URL imports (Vite resolves these to bundled, base-path-
// aware URLs). Animation is MOTION-driven, not a free-running show:
//   • idle  → an ambient loop, mostly idle with the occasional sit / reload
//   • move  → the unit's run OR roll (rng per unit), only while it ACTUALLY moves
//   • fire  → the unit's shoot stance (standing / sitting / lying, rng), only
//             while it ACTUALLY attacks
// The move/fire CLIP is the unit's stable id-hash pick (no flicker); the idle
// ambient is a weighted per-beat pick. Every function is pure in (unitId, t) /
// (unitId, motion, t), so the timeline is unit-testable and the ticker/DOM layer
// stays a thin imperative shell.

import idleUrl from './05-shooter/idle.png';
import sittingUrl from './05-shooter/sitting.png';
import sittingRechargeUrl from './05-shooter/sitting-recharge.png';
import runUrl from './05-shooter/run.png';
import rollUrl from './05-shooter/roll.png';
import standShootUrl from './05-shooter/stand-shoot.png';
import sitShootUrl from './05-shooter/sit-shoot.png';
import lieShootUrl from './05-shooter/lie-shoot.png';

/** Every strip frame is a 128×128 cell, laid out left-to-right. */
export const FRAME = 128;

/** What a unit is doing right now — drives which clip family plays. */
export type Motion = 'idle' | 'move' | 'fire';

export type ClipKey =
  | 'idle'
  | 'sitting'
  | 'sittingRecharge'
  | 'run'
  | 'roll'
  | 'standShoot'
  | 'sitShoot'
  | 'lieShoot';

export type SpriteClip = { url: string; frames: number; fps: number };

/** Frame counts are the real strip widths ÷ 128; fps tuned for pleasant playback
 * (run/roll brisk, idle calm, sitting a held pose). */
export const CLIPS: Record<ClipKey, SpriteClip> = {
  idle: { url: idleUrl, frames: 6, fps: 7 },
  sitting: { url: sittingUrl, frames: 1, fps: 1 }, // single held pose
  sittingRecharge: { url: sittingRechargeUrl, frames: 12, fps: 9 },
  run: { url: runUrl, frames: 12, fps: 16 },
  roll: { url: rollUrl, frames: 8, fps: 14 },
  standShoot: { url: standShootUrl, frames: 4, fps: 12 },
  sitShoot: { url: sitShootUrl, frames: 4, fps: 12 },
  lieShoot: { url: lieShootUrl, frames: 4, fps: 12 },
};

/** Move = run or roll (no walk). Fire = standing / sitting / lying shoot. */
const MOVE_CLIPS: ClipKey[] = ['run', 'roll'];
const FIRE_CLIPS: ClipKey[] = ['standShoot', 'sitShoot', 'lieShoot'];

/** FNV-1a hash of a string → uint32 (deterministic per unit id). */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Integer hash mix (idHash, beat) → uint32, for the per-beat ambient choice. */
function mix(a: number, b: number): number {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 2654435761)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return h >>> 0;
}

export type SpritePlan = { move: ClipKey; fire: ClipKey; phase: number };

/** Stable per-unit choice: ONE move style + ONE fire stance + a phase offset so
 * units don't animate in lockstep. The "rng" is a hash of the unit id, so it
 * never flickers between renders. */
export function unitSpritePlan(unitId: string): SpritePlan {
  const h = hashStr(unitId);
  return {
    move: MOVE_CLIPS[h % MOVE_CLIPS.length]!,
    fire: FIRE_CLIPS[(h >>> 4) % FIRE_CLIPS.length]!,
    phase: (h >>> 8) % 2000,
  };
}

export type SpriteFrame = { clip: ClipKey; frame: number };

/** Loop frame index for a clip at time `t` (ms), id-phased so units desync. */
function clipFrame(unitId: string, clip: ClipKey, t: number): number {
  const def = CLIPS[clip];
  const tt = Math.max(0, t) + unitSpritePlan(unitId).phase;
  return Math.floor((tt / 1000) * def.fps) % def.frames;
}

/** ms per ambient "beat"; calm, idle-dominant. */
const AMBIENT_BEAT_MS = 2200;

/** Pure: the resting loop — idle ≈80%, with the occasional held sit (~10%) or a
 * sitting reload (~10%). Each unit's sequence differs by its id hash. */
export function spriteAmbientAt(unitId: string, t: number): SpriteFrame {
  const tt = Math.max(0, t) + unitSpritePlan(unitId).phase;
  const beat = Math.floor(tt / AMBIENT_BEAT_MS);
  const r = (mix(hashStr(unitId), beat) % 1000) / 1000;
  const clip: ClipKey = r < 0.8 ? 'idle' : r < 0.9 ? 'sitting' : 'sittingRecharge';
  const def = CLIPS[clip];
  const local = tt - beat * AMBIENT_BEAT_MS;
  const frame = Math.floor((local / 1000) * def.fps) % def.frames;
  return { clip, frame };
}

/** Pure: the (clip, frame) a unit shows given what it is DOING right now. idle →
 * the ambient loop; move → its run/roll; fire → its shoot stance. */
export function spriteFrameFor(unitId: string, motion: Motion, t: number): SpriteFrame {
  if (motion === 'idle') return spriteAmbientAt(unitId, t);
  const plan = unitSpritePlan(unitId);
  const clip = motion === 'move' ? plan.move : plan.fire;
  return { clip, frame: clipFrame(unitId, clip, t) };
}
