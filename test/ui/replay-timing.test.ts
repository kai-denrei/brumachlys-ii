// R1 (TEMPO BACKBONE) — the presentation timing config + combat band
// classification (combat-readability adaptation §2/§4). PURE: durations are
// constants; classifyBand derives the wave band from existing event/unit data
// without changing any resolved value. The 2:1 tempo ratio (WAVE_A ≈ 2×WAVE_B)
// is the load-bearing contrast and is asserted here.

import { describe, expect, it } from 'vitest';
import {
  REPLAY_PHASE_DURATIONS,
  layoutPhases,
  classifyBand,
  bandWave,
  type CombatBand,
} from '../../src/state/replay-timing';
import { loadUnits } from '../../src/io/data-loader';
import { lineBoard, makeUnit } from '../core/synthetic';

const types = loadUnits();
const plains = (n: number) => lineBoard(Array(n).fill('plains'));

describe('R1 phase-window durations (config)', () => {
  it('exposes the source-spec §4 defaults', () => {
    expect(REPLAY_PHASE_DURATIONS).toEqual({
      SPOTLIGHT: 350,
      HOLD: 200,
      WAVE_A: 2800,
      INTERLUDE: 250,
      WAVE_B: 1400,
      SETTLE: 900,
    });
  });

  it('preserves the load-bearing A ≈ 2×B tempo contrast', () => {
    expect(REPLAY_PHASE_DURATIONS.WAVE_A).toBe(2 * REPLAY_PHASE_DURATIONS.WAVE_B);
  });

  it('layoutPhases lays the windows end-to-end with start/end/duration', () => {
    const p = layoutPhases();
    expect(p.SPOTLIGHT).toEqual({ start: 0, end: 350, duration: 350 });
    expect(p.HOLD).toEqual({ start: 350, end: 550, duration: 200 });
    expect(p.WAVE_A).toEqual({ start: 550, end: 3350, duration: 2800 });
    expect(p.INTERLUDE).toEqual({ start: 3350, end: 3600, duration: 250 });
    expect(p.WAVE_B).toEqual({ start: 3600, end: 5000, duration: 1400 });
    expect(p.SETTLE).toEqual({ start: 5000, end: 5900, duration: 900 });
  });

  it('layoutPhases accepts a config override (keep the ratio if you change it)', () => {
    const p = layoutPhases({ WAVE_A: 1400, WAVE_B: 700 });
    expect(p.WAVE_A.duration).toBe(1400);
    expect(p.WAVE_B.duration).toBe(700);
    // windows still chain end-to-end
    expect(p.WAVE_A.start).toBe(p.HOLD.end);
    expect(p.WAVE_B.start).toBe(p.INTERLUDE.end);
  });
});

describe('R1 combat band classification (§2)', () => {
  const board = plains(12);

  it('artillery: attacker unitType.minRange >= 2', () => {
    const art = makeUnit('a', 0, 0, 'artillery');
    // even firing adjacent, an artillery piece is the artillery band
    expect(classifyBand('attack', art, 0, 1, board, types)).toBe<CombatBand>('artillery');
    expect(classifyBand('attack', art, 0, 4, board, types)).toBe<CombatBand>('artillery');
  });

  it('ranged: non-artillery fired at graphDistance > 1', () => {
    const sniper = makeUnit('s', 0, 0, 'sniper'); // minRange 1, maxRange 2
    expect(classifyBand('attack', sniper, 0, 2, board, types)).toBe<CombatBand>('ranged');
  });

  it('melee: non-artillery fired at distance 1', () => {
    const sniper = makeUnit('s', 0, 0, 'sniper');
    expect(classifyBand('attack', sniper, 0, 1, board, types)).toBe<CombatBand>('melee');
    const inf = makeUnit('i', 0, 0, 'infantry');
    expect(classifyBand('attack', inf, 0, 1, board, types)).toBe<CombatBand>('melee');
  });

  it('melee: a brawl-exchange is always melee (same cell)', () => {
    const tank = makeUnit('t', 0, 2, 'tank');
    expect(classifyBand('brawl', tank, 2, 2, board, types)).toBe<CombatBand>('melee');
  });

  it('counters classify by the COUNTERING unit + the geometry of the return', () => {
    // a counter from an artillery piece is still artillery-banded; an adjacent
    // counter from infantry is melee.
    const art = makeUnit('a', 0, 0, 'artillery');
    expect(classifyBand('counter', art, 0, 2, board, types)).toBe<CombatBand>('artillery');
    const inf = makeUnit('i', 0, 0, 'infantry');
    expect(classifyBand('counter', inf, 1, 0, board, types)).toBe<CombatBand>('melee');
  });
});

describe('R1 band → wave mapping', () => {
  it('artillery and ranged play in WAVE_A; melee in WAVE_B', () => {
    expect(bandWave('artillery')).toBe('A');
    expect(bandWave('ranged')).toBe('A');
    expect(bandWave('melee')).toBe('B');
  });
});
