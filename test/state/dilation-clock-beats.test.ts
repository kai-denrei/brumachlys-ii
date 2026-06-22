// Stage 2 (sequencing §5): the dilation CLOCK maps ONE decelerating tick per
// BEAT — so the ticks finally MEAN something (one tick = one exchange). When a
// combat frame carries its sequenced `beats`, dilationActs derives the tick
// BOUNDARIES from the beat starts (absolute, then relative to glideEnd) rather
// than the synthetic closed-form cadence; a frame WITHOUT beats still falls back
// to that cadence (legacy / synthetic test frames). PURE: a closed read of the
// already-laid-out beats — scrub/replay land on the same ticks.

import { describe, expect, it } from 'vitest';
import { dilationActs, tickCount, tickIndexAt } from '../../src/state/dilation-clock';
import { layoutBeats, type Beat, type RawBeat, type Wave } from '../../src/state/replay-timing';
import { buildReplay } from '../../src/state/replay';
import type { AttackBreakdown, ResolutionEvent } from '../../src/core/types';
import { loadUnits } from '../../src/io/data-loader';
import { lineBoard, makeUnit } from '../core/synthetic';

const types = loadUnits();
const plains = (n: number) => lineBoard(Array(n).fill('plains'));

const bd = (over: Partial<AttackBreakdown> = {}): AttackBreakdown => ({
  A: 5, Ta: 0, D: 6, Td: 0, B: 0, vet: 0, p: 0.45, damage: 5,
  gangUp: { total: 0, contributions: [] }, ...over,
});

const attack = (
  attackerId: string, defenderId: string,
  attackerCell: number, defenderCell: number, damage: number,
): Extract<ResolutionEvent, { type: 'attack' }> => ({
  type: 'attack', attackerId, defenderId, attackerCell, defenderCell, damage,
  bonusB: 0, defenderCountAfter: 5, counterFired: false, breakdown: bd({ damage }),
});

// A frame-like value the clock reads (duration + wave + optional beats).
type F = { duration: number; wave?: Wave; beats?: readonly Beat[] };

/** Lay out a row of `n` independent ranged raw beats at a given depth. */
function beatsFor(n: number, depth: number): { beats: Beat[]; duration: number } {
  const raw: RawBeat[] = [];
  for (let k = 0; k < n; k++) {
    raw.push({ activeCells: [k * 2, k * 2 + 1], projectiles: [], band: 'ranged' });
  }
  return layoutBeats(raw, depth);
}

describe('dilationActs — ONE tick per BEAT when frames carry beats', () => {
  it('the tick boundaries are exactly the WAVE_A frame beat-starts (relative to glideEnd)', () => {
    const { beats, duration } = beatsFor(3, 1.6);
    const frames: F[] = [
      { duration: 200 }, // a move frame (glide)
      { duration, wave: 'A', beats }, // ONE combat frame holding 3 beats
      { duration: 900 }, // settle
    ];
    const acts = dilationActs(frames);
    expect(acts.hasDilation).toBe(true);
    // glideEnd = the combat frame start (after the 200 ms move frame)
    expect(acts.glideEnd).toBe(200);
    // ONE tick PER BEAT — three exchanges → three ticks
    expect(acts.ticks.length).toBe(3);
    expect(tickCount(acts)).toBe(3);
    // each tick boundary equals its beat's start (relative to the frame, which
    // begins at glideEnd, so the relative-to-glideEnd value is beat.start).
    expect(acts.ticks).toEqual(beats.map((b) => b.start));
  });

  it('ticks span multiple contiguous WAVE_A frames (one per beat across both)', () => {
    const a = beatsFor(2, 1.6);
    const b = beatsFor(3, 1.6);
    const frames: F[] = [
      { duration: 200 },
      { duration: a.duration, wave: 'A', beats: a.beats },
      { duration: b.duration, wave: 'A', beats: b.beats },
      { duration: 900 },
    ];
    const acts = dilationActs(frames);
    // 2 + 3 beats → 5 ticks total
    expect(acts.ticks.length).toBe(5);
    // the boundaries are monotonic non-decreasing (never re-fire backward)
    for (let i = 1; i < acts.ticks.length; i++) {
      expect(acts.ticks[i]!).toBeGreaterThanOrEqual(acts.ticks[i - 1]!);
    }
    // the second frame's beats are offset by the first frame's duration
    const off = a.duration; // first WAVE_A frame starts at glideEnd
    expect(acts.ticks[2]!).toBeCloseTo(off + b.beats[0]!.start, 6);
  });

  it('a deeper dilation depth SPREADS the ticks wider (deeper = more time per exchange)', () => {
    const shallow = beatsFor(3, 1.0);
    const deep = beatsFor(3, 3.0);
    const mk = (s: { beats: Beat[]; duration: number }): F[] => [
      { duration: 200 },
      { duration: s.duration, wave: 'A', beats: s.beats },
      { duration: 900 },
    ];
    const aS = dilationActs(mk(shallow));
    const aD = dilationActs(mk(deep));
    expect(aS.ticks.length).toBe(aD.ticks.length); // same EXCHANGE count
    // but each successive tick is further apart at depth (the window stretched)
    expect(aD.ticks[2]!).toBeGreaterThan(aS.ticks[2]!);
  });

  it('tickIndexAt advances one index per crossed beat boundary; held in RELEASE', () => {
    const { beats, duration } = beatsFor(3, 1.6);
    const frames: F[] = [
      { duration: 200 },
      { duration, wave: 'A', beats },
      { duration: 900 },
    ];
    const acts = dilationActs(frames);
    // before the window: −1
    expect(tickIndexAt(acts.glideEnd - 1, acts)).toBe(-1);
    // crossing each beat boundary bumps the index
    for (let k = 0; k < acts.ticks.length; k++) {
      const at = acts.glideEnd + acts.ticks[k]!;
      expect(tickIndexAt(at + 0.5, acts)).toBe(k);
    }
    // RELEASE holds at the final index
    const last = acts.ticks.length - 1;
    expect(tickIndexAt(acts.dilEnd + 50, acts)).toBe(last);
    expect(tickIndexAt(acts.total, acts)).toBe(last);
  });
});

describe('dilationActs — built script: tick count equals the shown exchanges', () => {
  it('three independent ranged strikes → three clock ticks (ticks = exchanges)', () => {
    const units = [
      makeUnit('s0', 0, 0, 'sniper'), makeUnit('e0', 1, 2, 'infantry'),
      makeUnit('s1', 0, 4, 'sniper'), makeUnit('e1', 1, 6, 'infantry'),
      makeUnit('s2', 0, 8, 'sniper'), makeUnit('e2', 1, 10, 'infantry'),
    ];
    const script = buildReplay(
      plains(24),
      units,
      [attack('s0', 'e0', 0, 2, 5), attack('s1', 'e1', 4, 6, 5), attack('s2', 'e2', 8, 10, 5)],
      types,
      0,
      undefined,
      undefined,
      undefined,
      1.6,
    );
    const acts = dilationActs(script.frames);
    const waveA = script.frames.find((f) => f.wave === 'A')!;
    // one tick per beat — the WAVE_A frame carries exactly the shown exchanges
    expect(acts.ticks.length).toBe(waveA.beats!.length);
    expect(acts.ticks.length).toBe(3);
  });

  it('deterministic — same script yields identical tick boundaries (scrub/replay stable)', () => {
    const units = [makeUnit('s0', 0, 0, 'sniper'), makeUnit('e0', 1, 2, 'infantry')];
    const ev = [attack('s0', 'e0', 0, 2, 5)];
    const mk = () => buildReplay(plains(12), units, ev, types, 0, undefined, undefined, undefined, 1.6);
    expect(dilationActs(mk().frames).ticks).toEqual(dilationActs(mk().frames).ticks);
  });
});

describe('dilationActs — fallback cadence preserved for beat-less frames', () => {
  it('synthetic WAVE_A frames without beats still get the closed-form decelerating ticks', () => {
    const frames: F[] = [
      { duration: 200 }, { duration: 200 }, { duration: 200 },
      { duration: 500, wave: 'A' }, { duration: 500, wave: 'A' },
      { duration: 300, wave: 'B' }, { duration: 900 },
    ];
    const acts = dilationActs(frames);
    expect(acts.hasDilation).toBe(true);
    expect(acts.ticks.length).toBeGreaterThanOrEqual(2);
    // the fallback decelerates (spacing fast → slow)
    const gaps = acts.ticks.slice(1).map((t, i) => t - acts.ticks[i]!);
    expect(gaps[gaps.length - 1]!).toBeGreaterThan(gaps[0]!);
  });
});
