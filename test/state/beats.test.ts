// Sequencing pass (§3/§5) — the PURE beat model. A beat = one shown exchange
// (leading strike + immediate counter grouped; brawl = one beat) laid out
// SEQUENTIALLY within a combat frame, scaled by dilationDepth, capped at
// MAX_SPOTLIT_BEATS with a collapsed remainder tail. layoutBeats / beatAt /
// activeCellsAt are deterministic functions of (rawBeats, depth) / (beats, t) —
// no Math.random, so scrub/replay are identical. (Spec §9.)

import { describe, expect, it } from 'vitest';
import {
  layoutBeats,
  beatAt,
  activeCellsAt,
  beatBaseFor,
  clampDilationDepth,
  BEAT_BASE_RANGED,
  BEAT_BASE_ARTILLERY,
  BEAT_BASE_MELEE,
  INTER_BEAT_GAP,
  MAX_SPOTLIT_BEATS,
  REMAINDER_BEAT_SCALE,
  DILATION_DEPTH_DEFAULT,
  DILATION_DEPTH_MIN,
  DILATION_DEPTH_MAX,
  type RawBeat,
} from '../../src/state/replay-timing';

const raw = (cells: number[], band: RawBeat['band'] = 'ranged', remainder = false): RawBeat => ({
  activeCells: cells,
  projectiles: [],
  band,
  ...(remainder ? { remainder: true } : {}),
});

describe('layoutBeats — N exchanges → N sequential, non-overlapping windows', () => {
  it('lays beats end-to-end with an inter-beat gap, no overlap', () => {
    const depth = 1; // 1× so the math is the bare base
    const { beats, duration } = layoutBeats(
      [raw([0, 1]), raw([2, 3]), raw([4, 5])],
      depth,
    );
    expect(beats.length).toBe(3);
    // beat 0 starts at 0
    expect(beats[0]!.start).toBe(0);
    expect(beats[0]!.dur).toBe(BEAT_BASE_RANGED);
    // each subsequent beat starts after the previous window + the gap
    for (let k = 1; k < beats.length; k++) {
      expect(beats[k]!.start).toBe(beats[k - 1]!.start + beats[k - 1]!.dur + INTER_BEAT_GAP);
      // non-overlap: this beat begins at/after the previous beat's end
      expect(beats[k]!.start).toBeGreaterThanOrEqual(beats[k - 1]!.start + beats[k - 1]!.dur);
    }
    // total = Σ durations + (N-1) gaps
    expect(duration).toBe(3 * BEAT_BASE_RANGED + 2 * INTER_BEAT_GAP);
    expect(beats[beats.length - 1]!.start + beats[beats.length - 1]!.dur).toBe(duration);
  });

  it('an empty input yields no beats and zero duration', () => {
    expect(layoutBeats([], 2)).toEqual({ beats: [], duration: 0 });
  });

  it('a single beat starts at 0 with no leading/trailing gap', () => {
    const { beats, duration } = layoutBeats([raw([7, 8], 'melee')], 1);
    expect(beats[0]!.start).toBe(0);
    expect(beats[0]!.dur).toBe(BEAT_BASE_MELEE);
    expect(duration).toBe(BEAT_BASE_MELEE);
  });
});

describe('beatBaseFor — per-band leading-strike windows', () => {
  it('artillery > ranged > melee', () => {
    expect(beatBaseFor('artillery')).toBe(BEAT_BASE_ARTILLERY);
    expect(beatBaseFor('ranged')).toBe(BEAT_BASE_RANGED);
    expect(beatBaseFor('melee')).toBe(BEAT_BASE_MELEE);
    expect(BEAT_BASE_ARTILLERY).toBeGreaterThan(BEAT_BASE_RANGED);
    expect(BEAT_BASE_RANGED).toBeGreaterThan(BEAT_BASE_MELEE);
  });
});

describe('dilationDepth scales beat durations (combat only)', () => {
  it('beat dur = beatBaseFor(band) × depth; gaps scale too', () => {
    const a = layoutBeats([raw([0, 1]), raw([2, 3])], 1.0);
    const b = layoutBeats([raw([0, 1]), raw([2, 3])], 2.0);
    // each beat doubles
    expect(b.beats[0]!.dur).toBe(a.beats[0]!.dur * 2);
    // the whole laid-out duration (windows + gap) doubles
    expect(b.duration).toBe(a.duration * 2);
    // explicit: 2 ranged beats at 2× = 2×(900×2) + 1×(120×2)
    expect(b.duration).toBe(2 * (BEAT_BASE_RANGED * 2) + INTER_BEAT_GAP * 2);
  });

  it('a deeper depth makes a strictly longer combat frame (monotonic)', () => {
    const shallow = layoutBeats([raw([0, 1], 'artillery')], 1.0).duration;
    const deep = layoutBeats([raw([0, 1], 'artillery')], 4.0).duration;
    expect(deep).toBeGreaterThan(shallow);
    expect(deep).toBe(BEAT_BASE_ARTILLERY * 4.0);
  });

  it('clampDilationDepth bounds [1.0, 4.0]; NaN/garbage → default', () => {
    expect(clampDilationDepth(0.2)).toBe(DILATION_DEPTH_MIN);
    expect(clampDilationDepth(9)).toBe(DILATION_DEPTH_MAX);
    expect(clampDilationDepth(2.3)).toBe(2.3);
    expect(clampDilationDepth(Number.NaN)).toBe(DILATION_DEPTH_DEFAULT);
    // a depth out of range passed to layoutBeats clamps (not crashes)
    expect(layoutBeats([raw([0, 1])], 99).beats[0]!.dur).toBe(BEAT_BASE_RANGED * DILATION_DEPTH_MAX);
  });
});

describe('cap — the tail past MAX_SPOTLIT_BEATS collapses into one faster remainder', () => {
  it('a remainder beat is laid out at REMAINDER_BEAT_SCALE of a normal window', () => {
    const { beats } = layoutBeats(
      [raw([0, 1]), raw([2, 3], 'ranged', true)],
      1.0,
    );
    expect(beats[0]!.dur).toBe(BEAT_BASE_RANGED);
    // the remainder is faster
    expect(beats[1]!.dur).toBe(BEAT_BASE_RANGED * REMAINDER_BEAT_SCALE);
    expect(beats[1]!.dur).toBeLessThan(beats[0]!.dur);
  });
});

describe('beatAt / activeCellsAt — deterministic, scrub-safe reads', () => {
  const { beats } = layoutBeats([raw([0, 1]), raw([2, 3]), raw([4, 5])], 1.0);

  it('beatAt returns the beat whose window contains t', () => {
    expect(beatAt(beats, 0)).toBe(beats[0]); // exactly on a start belongs to that beat
    expect(beatAt(beats, beats[0]!.dur - 1)).toBe(beats[0]);
    expect(beatAt(beats, beats[1]!.start)).toBe(beats[1]);
    expect(beatAt(beats, beats[2]!.start + 1)).toBe(beats[2]);
  });

  it('beatAt returns null in an inter-beat gap, before, and after', () => {
    // gap between beat 0 and beat 1
    const gapT = beats[0]!.start + beats[0]!.dur + 1;
    expect(gapT).toBeLessThan(beats[1]!.start);
    expect(beatAt(beats, gapT)).toBeNull();
    // before the first beat / negative / NaN
    expect(beatAt(beats, -5)).toBeNull();
    expect(beatAt(beats, Number.NaN)).toBeNull();
    // past the last beat's end
    const end = beats[2]!.start + beats[2]!.dur;
    expect(beatAt(beats, end)).toBeNull();
    expect(beatAt(beats, end + 1000)).toBeNull();
  });

  it('activeCellsAt returns the containing beat cells, [] in gaps/outside', () => {
    expect(activeCellsAt(beats, beats[1]!.start)).toEqual([2, 3]);
    const gapT = beats[1]!.start + beats[1]!.dur + 1;
    expect(activeCellsAt(beats, gapT)).toEqual([]);
    expect(activeCellsAt(beats, -1)).toEqual([]);
  });

  it('deterministic: same inputs → identical layout (no Math.random)', () => {
    const x = layoutBeats([raw([0, 1], 'ranged'), raw([2, 3], 'melee')], 1.7);
    const y = layoutBeats([raw([0, 1], 'ranged'), raw([2, 3], 'melee')], 1.7);
    expect(x).toEqual(y);
  });

  it('MAX_SPOTLIT_BEATS is the documented cap (8)', () => {
    expect(MAX_SPOTLIT_BEATS).toBe(8);
  });
});
