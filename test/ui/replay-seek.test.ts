// R7 (SEEK / SCRUB transport) — the PURE time↔frame mapping (source spec §3:
// playback is a pure function of (resolvedTurn, t); seek(t) yields a correct,
// stable frame for any t ∈ [0, total]). These helpers read only frame durations;
// they compute nothing about damage/fog and mutate no state.

import { describe, expect, it } from 'vitest';
import {
  clampFrame,
  frameAtTime,
  frameStartTime,
  totalDuration,
} from '../../src/state/replay-timing';

// A representative frame list: uneven durations so cumulative-sum boundaries
// land at non-trivial times (running sum: 0, 100, 350, 410, 1410).
const frames = [
  { duration: 100 }, // [0, 100)
  { duration: 250 }, // [100, 350)
  { duration: 60 }, //  [350, 410)
  { duration: 1000 }, // [410, 1410)
];
const TOTAL = 1410;

describe('R7 totalDuration', () => {
  it('sums every frame duration', () => {
    expect(totalDuration(frames)).toBe(TOTAL);
  });
  it('is 0 for an empty list', () => {
    expect(totalDuration([])).toBe(0);
  });
});

describe('R7 clampFrame (the cursor bounds authority)', () => {
  it('passes through an in-range index', () => {
    expect(clampFrame(2, 4)).toBe(2);
  });
  it('clamps below 0 to the first frame', () => {
    expect(clampFrame(-5, 4)).toBe(0);
  });
  it('clamps past the end to the last frame', () => {
    expect(clampFrame(99, 4)).toBe(3);
  });
  it('clamps an empty list to 0', () => {
    expect(clampFrame(3, 0)).toBe(0);
  });
  it('truncates a fractional index', () => {
    expect(clampFrame(2.9, 4)).toBe(2);
  });
});

describe('R7 frameStartTime (running sum at a boundary)', () => {
  it('frame 0 starts at t=0', () => {
    expect(frameStartTime(frames, 0)).toBe(0);
  });
  it('accumulates earlier durations', () => {
    expect(frameStartTime(frames, 1)).toBe(100);
    expect(frameStartTime(frames, 2)).toBe(350);
    expect(frameStartTime(frames, 3)).toBe(410);
  });
  it('clamps an out-of-range index before summing', () => {
    expect(frameStartTime(frames, 99)).toBe(410); // last frame's start
    expect(frameStartTime(frames, -3)).toBe(0);
  });
  it('round-trips: frameAtTime(start of frame i) === i', () => {
    for (let i = 0; i < frames.length; i++) {
      expect(frameAtTime(frames, frameStartTime(frames, i))).toBe(i);
    }
  });
});

describe('R7 frameAtTime (the seek-by-time mapping)', () => {
  it('maps t=0 (and below) to the first frame', () => {
    expect(frameAtTime(frames, 0)).toBe(0);
    expect(frameAtTime(frames, -50)).toBe(0);
  });

  it('maps a mid-frame time to the owning frame', () => {
    expect(frameAtTime(frames, 50)).toBe(0); // inside [0,100)
    expect(frameAtTime(frames, 200)).toBe(1); // inside [100,350)
    expect(frameAtTime(frames, 380)).toBe(2); // inside [350,410)
    expect(frameAtTime(frames, 900)).toBe(3); // inside [410,1410)
  });

  it('a time on a frame boundary belongs to the LATER frame', () => {
    expect(frameAtTime(frames, 100)).toBe(1); // start of frame 1
    expect(frameAtTime(frames, 350)).toBe(2); // start of frame 2
    expect(frameAtTime(frames, 410)).toBe(3); // start of frame 3
  });

  it('a time at or past the total pins to the last frame', () => {
    expect(frameAtTime(frames, TOTAL)).toBe(3);
    expect(frameAtTime(frames, TOTAL + 5000)).toBe(3);
  });

  it('NaN pins to the first frame (defensive)', () => {
    expect(frameAtTime(frames, Number.NaN)).toBe(0);
  });

  it('an empty list maps any time to 0', () => {
    expect(frameAtTime([], 0)).toBe(0);
    expect(frameAtTime([], 999)).toBe(0);
  });
});
