// dilation-clock.ts — Phase 2 (BULLET-TIME DILATION CLOCK): the PURE, closed-
// form hand-angle + tick model and the act-boundary mapping that drive the
// Swiss-railway clock across the WHOLE resolution. Ported from the vendored
// canvas source (docs/.../2026-06-22-dilation-clock-SOURCE.html) — the
// handAngle(t)/tick model — but the timeline is DERIVED FROM THE REPLAY SCRIPT
// (frames + phases) rather than the demo's own knobs.
//
// PURE / deterministic (spec §1, §3.5, decision D): no Math.random, no DOM, no
// ambient time. handAngle(t) is a closed form of (t, acts); the act boundaries
// are a closed read of the script's frame durations. The clock VISUALIZES the
// existing dilation (the WAVE_A window is already temporally longer from R1) —
// it changes NO resolver outcome and NO frame duration.
//
// The three acts (spec §3.1), mapped onto the replay timeline:
//   • GLIDE     — t in [0, glideEnd): the red second hand sweeps SMOOTHLY at
//                 W_GLIDE (continuous), during the movement frames (1×).
//   • SHIFT     — a brief bloom window at the move→combat handover (the first
//                 WAVE_A frame boundary, glideEnd); the clock grows/brightens
//                 IN PLACE (top-right, never flies to center).
//   • DILATION  — t in [glideEnd, dilEnd]: the hand advances in DISCRETE,
//                 DECELERATING ticks (STEP_DEG each, easeOutBack settle,
//                 spacing fast→slow) over the WAVE_A window — time grinding to
//                 a crawl.
//   • RELEASE   — t > dilEnd (INTERLUDE / WAVE_B / SETTLE): ticks end, the hand
//                 holds at its last tick, the clock recedes/fades.

import { frameStartTime, totalDuration } from './replay-timing';
import type { Beat, Wave } from './replay-timing';

/** A frame-like value carrying just the fields the act mapping reads. PURE.
 *  Sequencing §5: a combat frame may carry its SEQUENCED `beats` — when present
 *  the clock maps ONE decelerating tick per BEAT (one tick = one exchange), so
 *  the ticks finally MEAN something. A frame without beats (or a synthetic test
 *  frame) falls back to the closed-form decelerating cadence. */
type WaveFrame = { duration: number; wave?: Wave; beats?: readonly Beat[] };

/** PURE: the replay's elapsed time (ms at 1×) driving the clock, from the
 *  cursor + a wall-clock delta. This is the SAME read the spec mandates
 *  (decision C): `frameStartTime(cursor) + (now − frameEnteredAt)·speed`,
 *  clamped to `totalDuration`, respecting:
 *   • PAUSE  — t freezes at the cursor's frame start (no advance),
 *   • SPEED  — the wall-clock delta is scaled by the multiplier,
 *   • SKIP   — t jumps to the end (totalDuration),
 *   • SCRUB / SEEK — the cursor jumps, so the base + the re-based `enteredAt`
 *     make t land at the new frame (the caller resets `enteredAt` on a cursor
 *     change).
 *  The in-frame offset is CLAMPED to the current frame's own duration so t never
 *  overshoots the next frame's base before the cursor advances (no seam
 *  stutter). PURE — `now`/`enteredAt` are passed IN (no ambient time here). */
export function elapsedReplayTime(
  frames: readonly WaveFrame[],
  frameIdx: number,
  speed: number | 'skip',
  paused: boolean,
  now: number,
  enteredAt: number,
): number {
  const total = totalDuration(frames);
  if (speed === 'skip') return total;
  const base = frameStartTime(frames, frameIdx);
  if (paused) return Math.min(total, base);
  const spd = typeof speed === 'number' && speed > 0 ? speed : 1;
  const lastIdx = Math.max(0, frames.length - 1);
  const frameDur = frames[Math.min(Math.max(0, frameIdx), lastIdx)]?.duration ?? 0;
  const off = Math.max(0, Math.min(frameDur, (now - enteredAt) * spd));
  return Math.max(0, Math.min(total, base + off));
}

// --- tuning (ported from the SOURCE; visual conceit only — changes no timing) -
/** Each dilation tick advances ONE second-mark — the authentic SBB crawl. */
export const STEP_DEG = 6;
/** Continuous glide rate (rad/ms) — ~0.8 rev over a 1.5 s baseline, as the
 *  source's W_NORMAL. The smooth move-phase sweep. */
export const W_GLIDE = (0.8 * 2 * Math.PI) / 1500;
/** SHIFT bloom duration (ms) — the white-bloom + red-ripple window straddling
 *  the move→combat boundary while the clock swells in place. Clamped to the
 *  dilation window so a tiny WAVE_A never blooms past its own end. */
export const SHIFT_MS = 600;
/** Slow-end tick spacing (ms) the deceleration settles toward; the fast end is
 *  a fraction of it. Source: TS=440, fast=TS*0.42. */
export const TICK_SPACING_SLOW = 440;
const TICK_SPACING_FAST_FRAC = 0.42;
/** 12-o'clock origin for the hand (straight up). */
const A0 = -Math.PI / 2;

const easeOutCubic = (x: number): number => 1 - Math.pow(1 - x, 3);
/** easeOutBack — the tick's overshoot-and-settle (source). */
const easeOutBack = (x: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const clamp01 = (a: number, b: number, t: number): number =>
  Math.max(0, Math.min(1, (t - a) / (b - a)));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** The clock's act at an elapsed time. */
export type ClockAct = 'glide' | 'shift' | 'dilation' | 'release';

/** The act timeline derived from a replay script — all times in ms at 1×
 *  speed, in the SAME frame (elapsed-time) coordinates the transport uses. */
export type DilationActs = {
  /** Move→combat boundary: the start time of the first WAVE_A frame. Equals
   *  `total` when the round has no WAVE_A window (pure glide, no dilation). */
  glideEnd: number;
  /** End of the SHIFT bloom window (glideEnd + SHIFT, clamped to dilEnd). */
  shiftEnd: number;
  /** End of the WAVE_A (dilation) window: glideEnd + Σ(WAVE_A frame durations).
   *  Equals glideEnd when there is no WAVE_A window. */
  dilEnd: number;
  /** Total resolution length (ms at 1×) — Σ all frame durations. */
  total: number;
  /** Decelerating tick BOUNDARIES (ms, relative to glideEnd) within the
   *  dilation window — fast→slow spacing, closed form. Empty with no window. */
  ticks: number[];
  /** True when the round actually has a WAVE_A window (dilation to show). */
  hasDilation: boolean;
};

/** PURE: derive the dilation-clock act timeline from a replay script's frames.
 *  The WAVE_A window is exactly the `wave === 'A'` frames (R1 regrouped a round
 *  so they are contiguous); GLIDE is everything before the first of them and
 *  RELEASE everything after the last. Closed read of frame durations — no
 *  resolved value, no DOM, no ambient time. */
export function dilationActs(frames: readonly WaveFrame[]): DilationActs {
  const total = totalDuration(frames);
  const firstA = frames.findIndex((f) => f.wave === 'A');
  if (firstA < 0) {
    // No WAVE_A window: pure glide the whole way (no dilation, no ticks).
    return { glideEnd: total, shiftEnd: total, dilEnd: total, total, ticks: [], hasDilation: false };
  }
  const glideEnd = frameStartTime(frames, firstA);
  let dilSpan = 0;
  for (const f of frames) if (f.wave === 'A') dilSpan += f.duration;
  const dilEnd = glideEnd + dilSpan;
  const shiftEnd = glideEnd + Math.min(SHIFT_MS, dilSpan);

  // Sequencing §5: ONE tick per BEAT — the clock's decelerating ticks now map to
  // EXCHANGES (one tick = one shown strike/exchange), so a deeper dilation depth
  // (longer beats) spreads the ticks wider automatically. Collect each WAVE_A
  // frame's beat-start boundaries in absolute (elapsed) time, then express them
  // RELATIVE to glideEnd (the dilation window origin). Beat starts are already
  // ascending within a frame and frames are contiguous, so the boundaries are
  // monotonic non-decreasing by construction. PURE — a closed read of the
  // already-laid-out beats; no Math.random, scrub/replay identical.
  const beatTicks: number[] = [];
  for (let i = 0; i < frames.length; i++) {
    const fr = frames[i]!;
    if (fr.wave !== 'A' || !fr.beats || fr.beats.length === 0) continue;
    const frameAbsStart = frameStartTime(frames, i);
    for (const b of fr.beats) {
      const rel = frameAbsStart + b.start - glideEnd;
      if (rel >= 0 && rel < dilSpan) beatTicks.push(rel);
    }
  }
  if (beatTicks.length > 0) {
    beatTicks.sort((a, b) => a - b);
    return { glideEnd, shiftEnd, dilEnd, total, ticks: beatTicks, hasDilation: true };
  }

  // Fallback (frames carry no beats — synthetic test frames / legacy scripts):
  // the closed-form decelerating cadence over [0, dilSpan] (relative to
  // glideEnd); each interval grows fast→slow via easeOutCubic, as in the source.
  const ticks: number[] = [];
  const slow = TICK_SPACING_SLOW;
  const fast = TICK_SPACING_SLOW * TICK_SPACING_FAST_FRAC;
  let tt = 0;
  let k = 0;
  while (tt < dilSpan) {
    ticks.push(tt);
    const iv = lerp(fast, slow, easeOutCubic(Math.min(k / 8, 1)));
    tt += iv;
    k++;
  }
  return { glideEnd, shiftEnd, dilEnd, total, ticks, hasDilation: true };
}

/** PURE: the CURRENT clock-tick index at an elapsed time `t` — the index of the
 *  last decelerating tick BOUNDARY at or before `t` within the dilation window.
 *
 *  This is the audio-side companion to `handAngle`'s internal tick walk: the
 *  dilation audio fires ONE `dilationTick(i, total)` per NEW index this returns
 *  as forward playback crosses each boundary (the same boundaries the hand steps
 *  on), so the click is synced to the visible tick.
 *
 *   • −1 before the dilation window (GLIDE / SHIFT, or no WAVE_A window at all):
 *     no tick has fired yet.
 *   •  k once `t` has crossed the (k)th boundary (0-based); held through RELEASE
 *     at the final index (ticks have ended — the hand holds, so does the index).
 *
 *  Deterministic closed read of (t, acts) — the SAME basis as the hand model, so
 *  a scrub/replay to the same `t` reports the same index. */
export function tickIndexAt(t: number, acts: DilationActs): number {
  if (!acts.hasDilation) return -1;
  const ticks = acts.ticks;
  if (ticks.length === 0) return -1;
  if (t < acts.glideEnd) return -1;
  // clamp into the window (RELEASE holds at the final index, like handAngle).
  const d = Math.min(t, acts.dilEnd) - acts.glideEnd;
  let k = -1;
  for (let i = 0; i < ticks.length; i++) {
    if (d >= ticks[i]!) k = i;
    else break;
  }
  return k;
}

/** PURE: how many dilation ticks the round has (the denominator the audio uses
 *  to pitch each tick DOWN as i/total rises). 0 with no dilation window. */
export function tickCount(acts: DilationActs): number {
  return acts.ticks.length;
}

/** PURE: which act an elapsed time falls in. SHIFT is the brief bloom window
 *  [glideEnd, shiftEnd) at the handover; DILATION runs to dilEnd; after that is
 *  RELEASE. With no WAVE_A window the whole run is GLIDE. */
export function clockActAt(t: number, acts: DilationActs): ClockAct {
  if (!acts.hasDilation) return 'glide';
  if (t < acts.glideEnd) return 'glide';
  if (t < acts.shiftEnd) return 'shift';
  if (t <= acts.dilEnd) return 'dilation';
  return 'release';
}

/** PURE: the SWELL of the clock (0 = corner/small/normal, 1 = grown/bright in
 *  place) at an elapsed time. Ramps up over the SHIFT bloom window, holds at 1
 *  through the dilation window, recedes back to 0 over the run after dilEnd.
 *  Never flies to center — the renderer scales/brightens IN PLACE. */
export function clockSwell(t: number, acts: DilationActs): number {
  if (!acts.hasDilation) return 0;
  if (t < acts.glideEnd) return 0;
  const up = acts.shiftEnd > acts.glideEnd ? clamp01(acts.glideEnd, acts.shiftEnd, t) : 1;
  if (t <= acts.dilEnd) return up;
  // RELEASE: recede over a tail back to 0 (gone by the end of the resolution).
  const tail = Math.min(acts.total, acts.dilEnd + SHIFT_MS);
  return tail > acts.dilEnd ? 1 - clamp01(acts.dilEnd, tail, t) : 0;
}

/** PURE: the SHIFT bloom intensity (0..1) at an elapsed time — a brief rise-and-
 *  fall pulse over the bloom window for the white bloom + red ripple. 0 outside
 *  the window. Closed form (no random, no DOM). */
export function shiftBloom(t: number, acts: DilationActs): number {
  if (!acts.hasDilation || acts.shiftEnd <= acts.glideEnd) return 0;
  const p = clamp01(acts.glideEnd, acts.shiftEnd, t);
  if (p <= 0 || p >= 1) return 0;
  // a quick attack then decay (the source's (1-p) envelope on an easeOut radius)
  return 1 - p;
}

/** PURE / closed-form: the angle (rad) of the red second hand at elapsed time
 *  `t`, in the SAME coordinates as the source (0 = pointing up, clockwise +).
 *
 *   • GLIDE   (t < glideEnd)         — a0 + W_GLIDE·t, a smooth continuous sweep.
 *   • DILATION(glideEnd ≤ t ≤ dilEnd)— discrete, DECELERATING ticks: from the
 *     glide-end angle, advance STEP_DEG per tick boundary with an easeOutBack
 *     settle within each interval (spacing fast→slow). Stepped, not continuous.
 *   • RELEASE (t > dilEnd)           — holds at the final dilation angle (ticks
 *     have ended; the clock recedes/fades but the hand does not jump).
 *
 *  With no WAVE_A window the whole run is the smooth glide. Deterministic — the
 *  same (t, acts) always yields the same angle (scrub/replay stability). */
export function handAngle(t: number, acts: DilationActs): number {
  if (!acts.hasDilation || t <= acts.glideEnd) {
    return A0 + W_GLIDE * Math.max(0, t);
  }
  const angAtGlide = A0 + W_GLIDE * acts.glideEnd;
  const step = (STEP_DEG * Math.PI) / 180;
  // clamp into the dilation window for the tick math (RELEASE holds at dilEnd).
  const d = Math.min(t, acts.dilEnd) - acts.glideEnd;
  const ticks = acts.ticks;
  if (ticks.length === 0) return angAtGlide;
  // current tick index: the last boundary at or before d.
  let k = 0;
  while (k + 1 < ticks.length && ticks[k + 1]! <= d) k++;
  const segStart = ticks[k]!;
  const segEnd = k + 1 < ticks.length ? ticks[k + 1]! : segStart + TICK_SPACING_SLOW;
  const sp = clamp01(segStart, segEnd, d);
  const settle = Math.min(sp / 0.4, 1); // overshoot-settle over the first 40%
  const animSteps = k + easeOutBack(settle);
  return angAtGlide + animSteps * step;
}
