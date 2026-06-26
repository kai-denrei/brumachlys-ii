// Phase 2 (BULLET-TIME DILATION CLOCK) — the PURE half: the closed-form
// handAngle(t)/tick model + the act-boundary mapping from a replay script.
// Deterministic (no Math.random, no DOM): handAngle(t) is a closed function of
// (t, acts); the acts are a closed read of the frame durations. The GLIDE
// region is continuous; the DILATION region is stepped + decelerating; the
// move span maps to GLIDE and the WAVE_A window maps to DILATION.

import { describe, expect, it } from 'vitest';
import {
  clockActAt,
  clockSwell,
  dilationActs,
  elapsedReplayTime,
  handAngle,
  shiftBloom,
  STEP_DEG,
  tickCount,
  tickIndexAt,
  W_GLIDE,
} from '../../src/state/dilation-clock';
import type { Wave } from '../../src/state/replay-timing';

type F = { duration: number; wave?: Wave };
const f = (duration: number, wave?: Wave): F => (wave ? { duration, wave } : { duration });

/** A move→combat→release script: 3 move frames, 2 WAVE_A frames, 1 WAVE_B,
 *  1 settle. The move span ends at 3×200=600; WAVE_A spans 600..600+2×500. */
function script(): F[] {
  return [f(200), f(200), f(200), f(500, 'A'), f(500, 'A'), f(300, 'B'), f(900)];
}

describe('dilationActs — act boundaries from the script frames', () => {
  it('maps the move span to GLIDE and the WAVE_A window to DILATION', () => {
    const acts = dilationActs(script());
    expect(acts.glideEnd).toBe(600); // first WAVE_A frame begins at 600
    expect(acts.dilEnd).toBe(600 + 1000); // + Σ(WAVE_A durations)
    expect(acts.total).toBe(200 * 3 + 500 * 2 + 300 + 900);
    expect(acts.hasDilation).toBe(true);
  });

  it('the SHIFT bloom window sits at the handover (glideEnd → glideEnd+SHIFT)', () => {
    const acts = dilationActs(script());
    expect(acts.shiftEnd).toBeGreaterThan(acts.glideEnd);
    expect(acts.shiftEnd).toBeLessThanOrEqual(acts.dilEnd);
  });

  it('a combat-less round is pure GLIDE — no dilation, no ticks', () => {
    const acts = dilationActs([f(200), f(200), f(900)]);
    expect(acts.hasDilation).toBe(false);
    expect(acts.ticks).toEqual([]);
    expect(acts.glideEnd).toBe(acts.total);
    expect(acts.dilEnd).toBe(acts.total);
  });

  it('the dilation tick boundaries decelerate (spacing fast → slow)', () => {
    const acts = dilationActs(script());
    expect(acts.ticks.length).toBeGreaterThanOrEqual(2);
    const gaps = acts.ticks.slice(1).map((t, i) => t - acts.ticks[i]!);
    // each successive gap is >= the previous (monotonic deceleration)
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i]!).toBeGreaterThanOrEqual(gaps[i - 1]! - 1e-9);
    }
    // and the spread is real (the last gap is meaningfully larger than the first)
    expect(gaps[gaps.length - 1]!).toBeGreaterThan(gaps[0]!);
  });
});

describe('clockActAt — the three-act arc over the timeline', () => {
  it('classifies glide / shift / dilation / release in order', () => {
    const acts = dilationActs(script());
    expect(clockActAt(0, acts)).toBe('glide');
    expect(clockActAt(acts.glideEnd - 1, acts)).toBe('glide');
    expect(clockActAt(acts.glideEnd + 1, acts)).toBe('shift');
    expect(clockActAt((acts.shiftEnd + acts.dilEnd) / 2, acts)).toBe('dilation');
    expect(clockActAt(acts.dilEnd + 1, acts)).toBe('release');
  });

  it('a combat-less round is GLIDE throughout', () => {
    const acts = dilationActs([f(200), f(900)]);
    expect(clockActAt(0, acts)).toBe('glide');
    expect(clockActAt(acts.total, acts)).toBe('glide');
  });
});

describe('handAngle — GLIDE continuous; DILATION stepped + decelerating', () => {
  it('is a smooth continuous sweep during GLIDE (small step ⇒ small Δangle)', () => {
    const acts = dilationActs(script());
    // sample densely across the glide region; the per-ms slope is exactly W_GLIDE
    const a1 = handAngle(100, acts);
    const a2 = handAngle(101, acts);
    expect(a2 - a1).toBeCloseTo(W_GLIDE, 9);
    // continuity: no jumps anywhere in the glide region
    let prev = handAngle(0, acts);
    for (let t = 1; t < acts.glideEnd; t += 5) {
      const cur = handAngle(t, acts);
      expect(cur - prev).toBeLessThan(W_GLIDE * 6); // bounded by the glide slope
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-9); // monotone increasing
      prev = cur;
    }
  });

  it('advances in DISCRETE steps during DILATION (a tick ⇒ ~STEP_DEG jump)', () => {
    const acts = dilationActs(script());
    const stepRad = (STEP_DEG * Math.PI) / 180;
    // just before vs just after a tick boundary deep in the window: the hand has
    // advanced by close to one full STEP_DEG (the discrete crawl).
    const k = Math.min(2, acts.ticks.length - 1);
    const boundary = acts.glideEnd + acts.ticks[k]!;
    const before = handAngle(boundary - 0.001, acts);
    // sample far enough past the boundary that the easeOutBack has settled
    const next = k + 1 < acts.ticks.length ? acts.glideEnd + acts.ticks[k + 1]! : acts.dilEnd;
    const settled = handAngle(next - 0.001, acts);
    expect(settled - before).toBeGreaterThan(stepRad * 0.5);
    expect(settled - before).toBeLessThan(stepRad * 1.6); // ~one step (with overshoot)
  });

  it('the DILATION hand never sweeps as fast as the continuous glide would', () => {
    const acts = dilationActs(script());
    // total angle gained over the WHOLE dilation window is the discrete-tick sum,
    // far less than W_GLIDE × the window length (time has "slowed").
    const gained = handAngle(acts.dilEnd, acts) - handAngle(acts.glideEnd, acts);
    const ifContinuous = W_GLIDE * (acts.dilEnd - acts.glideEnd);
    expect(gained).toBeLessThan(ifContinuous);
    expect(gained).toBeGreaterThan(0);
  });

  it('RELEASE holds the hand at its final dilation angle (no jump)', () => {
    const acts = dilationActs(script());
    const atEnd = handAngle(acts.dilEnd, acts);
    expect(handAngle(acts.dilEnd + 50, acts)).toBeCloseTo(atEnd, 6);
    expect(handAngle(acts.total, acts)).toBeCloseTo(atEnd, 6);
  });

  it('a combat-less round glides smoothly the whole way (closed form)', () => {
    const acts = dilationActs([f(300), f(900)]);
    expect(handAngle(600, acts)).toBeCloseTo(-Math.PI / 2 + W_GLIDE * 600, 9);
  });

  it('PURE: the same (t, acts) always yields the same angle', () => {
    const acts = dilationActs(script());
    for (const t of [0, 250, 600, 800, 1200, 1600, 2200]) {
      expect(handAngle(t, acts)).toBe(handAngle(t, acts));
    }
  });
});

describe('elapsedReplayTime — drive t from the replay (pause/speed/skip/scrub)', () => {
  // frames: durations 200,200,200,500,500,300,900 → starts 0,200,400,600,1100,
  // 1600,2500; total 2800.
  const fr = script();
  const TOTAL = 2800;

  it('advances within a frame as (now − entered)·speed from the frame start', () => {
    // cursor on frame 3 (WAVE_A, starts at 600), 100 ms of wall-clock elapsed.
    const t = elapsedReplayTime(fr, 3, 1, false, /*now*/ 1100, /*entered*/ 1000);
    expect(t).toBe(600 + 100);
  });

  it('SPEED scales the wall-clock delta', () => {
    const t = elapsedReplayTime(fr, 3, 2, false, 1100, 1000);
    expect(t).toBe(600 + 200); // 100 ms × 2
  });

  it('PAUSE freezes t at the cursor frame start (no advance)', () => {
    const moving = elapsedReplayTime(fr, 3, 1, false, 5000, 1000);
    const frozen = elapsedReplayTime(fr, 3, 1, true, 5000, 1000);
    expect(frozen).toBe(600); // frame 3 begins at 600
    expect(moving).toBeGreaterThan(frozen);
  });

  it('SKIP jumps t to the end (totalDuration)', () => {
    expect(elapsedReplayTime(fr, 0, 'skip', false, 0, 0)).toBe(TOTAL);
    expect(elapsedReplayTime(fr, 3, 'skip', true, 9999, 0)).toBe(TOTAL);
  });

  it('SCRUB / SEEK: a cursor jump re-bases t to the new frame', () => {
    // seek to frame 4 (starts at 1100) with a fresh enteredAt (now===entered).
    const t = elapsedReplayTime(fr, 4, 1, false, 2000, 2000);
    expect(t).toBe(1100);
  });

  it('the in-frame offset is clamped to the frame duration (no seam overshoot)', () => {
    // frame 3 (start 600, duration 500): a huge wall-clock delta can not push t
    // past the frame's own end (1100) before the cursor advances.
    const t = elapsedReplayTime(fr, 3, 1, false, 99_999, 0);
    expect(t).toBe(600 + 500);
  });

  it('clamps to [0, total]', () => {
    expect(elapsedReplayTime(fr, 0, 1, false, -50, 0)).toBeGreaterThanOrEqual(0);
    expect(elapsedReplayTime(fr, fr.length - 1, 1, false, 1e9, 0)).toBeLessThanOrEqual(TOTAL);
  });
});

describe('tickIndexAt / tickCount — the current clock-tick index at t (Phase 3 audio sync)', () => {
  it('is −1 before the dilation window (GLIDE / SHIFT) and 0 at the first boundary', () => {
    const acts = dilationActs(script());
    expect(tickIndexAt(0, acts)).toBe(-1);
    expect(tickIndexAt(acts.glideEnd - 1, acts)).toBe(-1);
    // exactly at glideEnd the first boundary (ticks[0] === 0 relative) is crossed.
    expect(tickIndexAt(acts.glideEnd, acts)).toBe(0);
  });

  it('advances ONE index per crossed tick boundary, in step with handAngle', () => {
    const acts = dilationActs(script());
    expect(acts.ticks.length).toBeGreaterThanOrEqual(3);
    // just before the k-th boundary the index is k−1; just past it the index is
    // k (sampled off the exact float boundary, as the rAF never lands on it).
    for (let k = 1; k < acts.ticks.length; k++) {
      const at = acts.glideEnd + acts.ticks[k]!;
      expect(tickIndexAt(at - 0.5, acts)).toBe(k - 1);
      expect(tickIndexAt(at + 0.5, acts)).toBe(k);
    }
  });

  it('is MONOTONIC NON-DECREASING across the whole window (never re-fires backward)', () => {
    const acts = dilationActs(script());
    let prev = -1;
    for (let t = 0; t <= acts.total; t += 7) {
      const k = tickIndexAt(t, acts);
      expect(k).toBeGreaterThanOrEqual(prev);
      prev = k;
    }
  });

  it('RELEASE holds at the final index (ticks have ended, like the hand)', () => {
    const acts = dilationActs(script());
    const last = acts.ticks.length - 1;
    expect(tickIndexAt(acts.dilEnd, acts)).toBe(last);
    expect(tickIndexAt(acts.dilEnd + 50, acts)).toBe(last);
    expect(tickIndexAt(acts.total, acts)).toBe(last);
  });

  it('a combat-less round has no ticks: index stays −1, count 0', () => {
    const acts = dilationActs([f(200), f(200), f(900)]);
    expect(tickCount(acts)).toBe(0);
    expect(tickIndexAt(0, acts)).toBe(-1);
    expect(tickIndexAt(acts.total, acts)).toBe(-1);
  });

  it('tickCount equals the number of boundaries (the audio denominator)', () => {
    const acts = dilationActs(script());
    expect(tickCount(acts)).toBe(acts.ticks.length);
  });

  it('PURE: the same (t, acts) always yields the same index (scrub/replay stable)', () => {
    const acts = dilationActs(script());
    for (const t of [0, 600, 800, 1200, 1600, 2200]) {
      expect(tickIndexAt(t, acts)).toBe(tickIndexAt(t, acts));
    }
  });
});

describe('clockSwell + shiftBloom — grows/brightens in place, bloom pulse', () => {
  it('swell is 0 during glide, ramps over SHIFT, holds through dilation', () => {
    const acts = dilationActs(script());
    expect(clockSwell(0, acts)).toBe(0);
    expect(clockSwell(acts.glideEnd - 1, acts)).toBe(0);
    expect(clockSwell(acts.shiftEnd, acts)).toBeCloseTo(1, 5);
    expect(clockSwell((acts.shiftEnd + acts.dilEnd) / 2, acts)).toBeCloseTo(1, 5);
  });

  it('swell recedes after the dilation window (clock recedes/fades)', () => {
    const acts = dilationActs(script());
    expect(clockSwell(acts.dilEnd, acts)).toBeCloseTo(1, 5);
    expect(clockSwell(acts.total, acts)).toBeLessThan(0.5);
  });

  it('the shift bloom is a brief pulse confined to the bloom window', () => {
    const acts = dilationActs(script());
    expect(shiftBloom(0, acts)).toBe(0);
    expect(shiftBloom(acts.glideEnd + 1, acts)).toBeGreaterThan(0);
    expect(shiftBloom(acts.dilEnd, acts)).toBe(0);
  });
});
