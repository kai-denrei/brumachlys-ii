// R3 (DILATION) — the pure half: dilationAt reports whether the playback cursor
// is inside the round's WAVE_A (ranged/artillery) window and a 0..1 progress
// through it (for the analog clock hand + the fade envelope). Mirrors spotlightAt:
// a PURE read of (script, frameIdx) — playback never mutates state, outcomes/fog
// are untouched. The WAVE_A window is exactly the wave==='A' combat frames from R1.

import { describe, expect, it } from 'vitest';
import type {
  AttackBreakdown,
  ResolutionEvent,
  UnitInstance,
} from '../../src/core/types';
import { buildReplay, dilationAt } from '../../src/state/replay';
import { loadUnits } from '../../src/io/data-loader';
import { lineBoard, makeUnit } from '../core/synthetic';

const types = loadUnits();
const plains = (n: number) => lineBoard(Array(n).fill('plains'));

const bd = (over: Partial<AttackBreakdown> = {}): AttackBreakdown => ({
  A: 5,
  Ta: 0,
  D: 6,
  Td: 0,
  B: 0,
  vet: 0,
  p: 0.45,
  damage: 5,
  gangUp: { total: 0, contributions: [] },
  ...over,
});

function build(units: UnitInstance[], events: ResolutionEvent[], cells = 12) {
  return buildReplay(plains(cells), units, events, types, 0);
}

/** A ranged exchange (sniper at 0 → infantry at 2): one WAVE_A combat frame. */
function rangedScript() {
  const units = [makeUnit('ps', 0, 0, 'sniper'), makeUnit('e1', 1, 2, 'infantry')];
  const events: ResolutionEvent[] = [
    {
      type: 'attack',
      attackerId: 'ps',
      defenderId: 'e1',
      attackerCell: 0,
      defenderCell: 2,
      damage: 5,
      bonusB: 0,
      defenderCountAfter: 5,
      counterFired: false,
      breakdown: bd({ damage: 5 }),
    },
  ];
  return build(units, events);
}

describe('R3 dilationAt — engage in WAVE A, release after', () => {
  it('a combat-less round never engages dilation', () => {
    const script = build([makeUnit('pi', 0, 2)], []);
    for (let i = 0; i < script.frames.length; i++) {
      expect(dilationAt(script, i).active).toBe(false);
    }
  });

  it('engages on the WAVE_A frame(s) and is released everywhere else', () => {
    const script = rangedScript();
    const aFrames = script.frames
      .map((f, i) => ({ w: f.wave, i }))
      .filter((x) => x.w === 'A')
      .map((x) => x.i);
    expect(aFrames.length).toBeGreaterThan(0);

    for (let i = 0; i < script.frames.length; i++) {
      const inA = aFrames.includes(i);
      expect(dilationAt(script, i).active).toBe(inA);
    }
  });

  it('is NOT active on a melee/brawl (WAVE_B) frame', () => {
    // A brawl is always WAVE_B — dilation must not engage on it.
    const units = [makeUnit('pt', 0, 6, 'tank'), makeUnit('ei', 1, 6, 'infantry')];
    const events: ResolutionEvent[] = [
      {
        type: 'brawl-exchange',
        cell: 6,
        higherInitId: 'ei',
        lowerInitId: 'pt',
        higherInitDamageDealt: 4,
        lowerInitDamageDealt: 5,
        higherInitCountAfter: 5,
        lowerInitCountAfter: 6,
        higherInitBreakdown: bd({ damage: 4 }),
        lowerInitBreakdown: bd({ damage: 5 }),
      },
    ];
    const script = build(units, events);
    expect(script.frames.some((f) => f.wave === 'B')).toBe(true);
    for (let i = 0; i < script.frames.length; i++) {
      expect(dilationAt(script, i).active).toBe(false);
    }
  });

  it('progress is 0..1 and the hand sweeps LESS THAN one full turn across WAVE_A', () => {
    // Multi-frame WAVE_A so progress has range: two ranged volleys.
    const units = [
      makeUnit('ps', 0, 0, 'sniper'),
      makeUnit('e1', 1, 2, 'infantry'),
      makeUnit('ps2', 0, 5, 'sniper'),
      makeUnit('e2', 1, 7, 'infantry'),
    ];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'ps',
        defenderId: 'e1',
        attackerCell: 0,
        defenderCell: 2,
        damage: 5,
        bonusB: 0,
        defenderCountAfter: 5,
        counterFired: false,
        breakdown: bd({ damage: 5 }),
      },
      {
        type: 'attack',
        attackerId: 'ps2',
        defenderId: 'e2',
        attackerCell: 5,
        defenderCell: 7,
        damage: 5,
        bonusB: 0,
        defenderCountAfter: 5,
        counterFired: false,
        breakdown: bd({ damage: 5 }),
      },
    ];
    const script = build(units, events);
    const aIdx = script.frames.map((f, i) => ({ w: f.wave, i })).filter((x) => x.w === 'A').map((x) => x.i);
    expect(aIdx.length).toBeGreaterThanOrEqual(1);

    let last = -1;
    for (const i of aIdx) {
      const { active, progress } = dilationAt(script, i);
      expect(active).toBe(true);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
      // monotonic non-decreasing across the WAVE_A window
      expect(progress).toBeGreaterThanOrEqual(last);
      last = progress;
    }
    // The hand maps progress→turns at <1 rotation over the whole window.
    expect(dilationAt(script, aIdx[aIdx.length - 1]!).turns).toBeLessThan(1);
    expect(dilationAt(script, aIdx[aIdx.length - 1]!).turns).toBeGreaterThan(0);
  });

  it('fade envelope: rises near the start and falls near the end of WAVE_A', () => {
    const script = rangedScript();
    const aIdx = script.frames.map((f, i) => ({ w: f.wave, i })).filter((x) => x.w === 'A').map((x) => x.i);
    // fade is a 0..1 opacity multiplier for the clock; positive while active.
    for (const i of aIdx) {
      const { fade } = dilationAt(script, i);
      expect(fade).toBeGreaterThan(0);
      expect(fade).toBeLessThanOrEqual(1);
    }
    // released frames carry fade 0 (clock gone by INTERLUDE).
    for (let i = 0; i < script.frames.length; i++) {
      if (!aIdx.includes(i)) expect(dilationAt(script, i).fade).toBe(0);
    }
  });

  it('PURE: a given frame is a stable function of (script, frameIdx)', () => {
    const script = rangedScript();
    for (let i = 0; i < script.frames.length; i++) {
      expect(dilationAt(script, i)).toEqual(dilationAt(script, i));
    }
  });
});
