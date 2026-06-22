// DilationClock.tsx — Phase 2 (BULLET-TIME DILATION CLOCK): the Swiss-railway
// clock, ported from the vendored canvas source and driven by the REPLAY's
// elapsed time across the WHOLE resolution. Replaces the R3 SVG clock.
//
// A fixed TOP-RIGHT canvas overlay (where the SkirmishLog sits), present through
// the replay. The three-act arc (spec §3.1) is driven by `t`, the replay's
// elapsed time (ms at 1×):
//   • GLIDE     — the red second hand sweeps SMOOTHLY during the movement frames.
//   • SHIFT     — at the move→combat boundary: a white bloom + red ripple, the
//                 clock GROWS/BRIGHTENS IN PLACE (never flies to center), the
//                 board cools (the kept R3 cooling/vignette layers behind).
//   • DILATION  — over the WAVE_A window the hand advances in DISCRETE
//                 DECELERATING ticks (STEP_DEG, easeOutBack settle).
//   • RELEASE   — after WAVE_A: ticks end, the clock recedes/fades.
//
// `t` is computed by a rAF as frameStartTime(cursor) + (now − frameEnteredAt)·
// speed, clamped to totalDuration (R7 helpers). It respects PAUSE (t frozen),
// SPEED, SKIP (t→end), and SCRUB/SEEK (the cursor jump re-bases t). The
// handAngle(t)/tick model is the PURE closed form in state/dilation-clock.ts.
//
// Reduced-motion (decision D): a STATIC end-state — the clock is present and the
// hand sits at the cursor frame's time, but no rAF interpolation, no bloom/tick
// glide animation.
//
// src/ui is the impure layer — DOM, canvas, RAF, matchMedia are all fair game.

import { useEffect, useMemo, useRef } from 'react';
import {
  clockSwell,
  dilationActs,
  elapsedReplayTime,
  handAngle,
  shiftBloom,
  type DilationActs,
} from '../../state/dilation-clock';
import type { ReplayFrame } from '../../state/replay';

/** Swiss-railway (SBB) palette — white face, black batons, red second hand. */
const SBB_FACE = '#ffffff';
const SBB_BLACK = '#161616';
const SBB_RED = '#e8362a';

/** Base clock radius (CSS px) in the corner; grows to ×GROWTH during dilation
 *  (in place — the wrapper never moves). The canvas box is sized for the grown
 *  state so the swell has room. */
const BASE_R = 26;
const GROWTH = 1.9;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** PURE-ISH (ctx side-effects only): draw the Swiss-railway clock face + hands
 *  at center (cx,cy), radius R, for the red second hand at angle `ang` (rad).
 *  60 ticks (5 hour batons), aesthetic ~10:09 hour/minute pose, red second hand
 *  with the signal disc, hubs + a thin bezel. Ported from the SOURCE. */
function drawSwissClock(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  ang: number,
  bright: number,
): void {
  // face
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.20)';
  ctx.shadowBlur = R * 0.18;
  ctx.shadowOffsetY = R * 0.05;
  ctx.fillStyle = SBB_FACE;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, 7);
  ctx.fill();
  ctx.restore();

  ctx.save();
  // 60 ticks (every 5th is a fat hour baton)
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * 2 * Math.PI;
    const hour = i % 5 === 0;
    const len = hour ? R * 0.2 : R * 0.075;
    const w = hour ? R * 0.052 : R * 0.018;
    const r1 = R * 0.93;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.fillStyle = SBB_BLACK;
    ctx.fillRect(-w / 2, -r1, w, len);
    ctx.restore();
  }
  // hour & minute hands — static aesthetic pose, black batons
  const baton = (a: number, len: number, w: number, back: number) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.fillStyle = SBB_BLACK;
    ctx.fillRect(-w / 2, -len, w, len + back);
    ctx.restore();
  };
  baton(-Math.PI / 2 - 2.6, R * 0.5, R * 0.072, R * 0.13); // hour ~10
  baton(-Math.PI / 2 + 0.78, R * 0.78, R * 0.05, R * 0.13); // minute ~09

  // red second hand with the signal disc
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.fillStyle = SBB_RED;
  ctx.strokeStyle = SBB_RED;
  ctx.lineWidth = R * 0.026;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(0, R * 0.18);
  ctx.lineTo(0, -(R * 0.82));
  ctx.stroke(); // shaft + tail
  ctx.beginPath();
  ctx.arc(0, -(R * 0.66), R * 0.082, 0, 7);
  ctx.fill(); // disc
  ctx.restore();

  // hubs
  ctx.fillStyle = SBB_BLACK;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.045, 0, 7);
  ctx.fill();
  ctx.fillStyle = SBB_RED;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.022, 0, 7);
  ctx.fill();

  // thin bezel — brightens with the swell (the "brightens in place" read)
  ctx.strokeStyle = `rgba(232,54,42,${0.1 + 0.5 * bright})`;
  ctx.lineWidth = R * (0.03 + 0.02 * bright);
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.985, 0, 7);
  ctx.stroke();
  ctx.restore();
}

/** Draw the SHIFT bloom (white bloom + red ripple) at the clock center — the
 *  brief handover pulse. `b` is the bloom intensity (0..1). */
function drawShiftBloom(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  b: number,
): void {
  if (b <= 0) return;
  const p = 1 - b; // b decays as the bloom expands (b = 1−p in the model)
  ctx.save();
  // white bloom
  ctx.globalAlpha = b * 0.85;
  const r = R * (0.8 + 3.2 * p);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, 'rgba(255,255,255,.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 7);
  ctx.fill();
  // red ripple ring
  ctx.globalAlpha = b * 0.7;
  ctx.strokeStyle = 'rgba(232,54,42,.85)';
  ctx.lineWidth = R * (0.06 * b + 0.012);
  ctx.beginPath();
  ctx.arc(cx, cy, R * (0.4 + 3 * p), 0, 7);
  ctx.stroke();
  ctx.restore();
}

export type DilationClockProps = {
  /** The replay frames (drive the act timeline + the elapsed-time base). */
  frames: readonly ReplayFrame[];
  /** The playback cursor (frame index). */
  frameIdx: number;
  /** Replay speed — a number multiplier or 'skip' (jumps t to the end). */
  speed: number | 'skip';
  /** Paused → t freezes (no advance). */
  paused: boolean;
  /** Force the static reduced-motion end-state (defaults to matchMedia). */
  reducedMotion?: boolean;
};

/** Phase 2: the Swiss-railway BULLET-TIME clock — a fixed top-right canvas
 *  overlay driven by the replay's elapsed time across the whole resolution.
 *  Glides during movement, blooms + grows in place at the combat handover,
 *  ticks in decelerating steps through WAVE_A, then recedes. */
export function DilationClock({
  frames,
  frameIdx,
  speed,
  paused,
  reducedMotion,
}: DilationClockProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  // performance.now() captured each time the cursor lands on a (new) frame, so
  // (now − frameEnteredAt)·speed is the offset INTO the current frame — a SCRUB
  // / SEEK / SKIP re-bases t cleanly (the cursor jumps, this resets).
  const enteredAtRef = useRef<number>(0);
  const drawRef = useRef<(() => void) | null>(null);
  // The long-lived rAF reads the CURRENT cursor/speed/pause via refs (the paint
  // closure outlives a single render), so a seek/speed/pause is picked up live.
  const frameIdxRef = useRef(frameIdx);
  const speedRef = useRef(speed);
  const pausedRef = useRef(paused);
  frameIdxRef.current = frameIdx;
  speedRef.current = speed;
  pausedRef.current = paused;

  // The act timeline is a pure read of the frame durations + waves — memoized so
  // a scrub/pause doesn't recompute it (only a new script does).
  const acts: DilationActs = useMemo(() => dilationActs(frames), [frames]);

  const reduce = reducedMotion ?? prefersReducedMotion();

  // Re-base the elapsed-time offset whenever the cursor (or pause/speed) changes.
  // Also repaints immediately so a seek/resume (and the reduced-motion static
  // path) lands on the new frame's time without waiting for the next rAF.
  useEffect(() => {
    enteredAtRef.current = typeof performance !== 'undefined' ? performance.now() : 0;
    drawRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameIdx, paused, speed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    // jsdom (test env) returns null — the visually-hidden marker is what tests
    // assert against, so this degrades cleanly with no canvas paint.
    if (!ctx) return;

    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2.5);
    // size the canvas box for the GROWN clock (so the swell has room in place).
    const box = Math.ceil(BASE_R * GROWTH * 2 + 24);
    canvas.width = Math.round(box * dpr);
    canvas.height = Math.round(box * dpr);
    canvas.style.width = `${box}px`;
    canvas.style.height = `${box}px`;

    const elapsed = (): number => {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      return elapsedReplayTime(
        frames,
        frameIdxRef.current,
        speedRef.current,
        pausedRef.current,
        now,
        enteredAtRef.current,
      );
    };

    const paint = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, box, box);
      const cx = box / 2;
      const cy = box / 2;
      const t = elapsed();
      const swell = clockSwell(t, acts);
      const R = BASE_R * (1 + (GROWTH - 1) * swell);
      const ang = handAngle(t, acts);
      drawSwissClock(ctx, cx, cy, R, ang, swell);
      if (!reduce) drawShiftBloom(ctx, cx, cy, R, shiftBloom(t, acts));
    };
    drawRef.current = paint;

    if (reduce) {
      // Static end-state: paint once at the cursor's frame time, no rAF loop.
      paint();
      return () => {
        drawRef.current = null;
      };
    }

    const loop = () => {
      paint();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      drawRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, acts, reduce]);

  return (
    <div className="dilation-clock" data-testid="dilation-clock" aria-hidden="true">
      <canvas ref={canvasRef} className="dilation-clock-canvas" />
    </div>
  );
}
