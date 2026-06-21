import { describe, it, expect } from 'vitest';
import { unitUpkeep, factionUpkeep, upkeepRateOf, DEFAULT_UPKEEP_RATE } from '../../src/core/economy';
import { loadUnits } from '../../src/io/data-loader';
import type { UnitInstance } from '../../src/core/types';
import type { Board } from '../../src/board/types';

const types = loadUnits();
const u = (type: string, count: number, faction: 0 | 1 = 0): UnitInstance => ({
  id: `${type}-${count}-${faction}`, type, faction, cell: 0, count,
  stance: 'aggressive', attackedFrom: [],
});

describe('unitUpkeep', () => {
  it('is 1% of cost per count-point, rounded (full infantry 75 → 8)', () => {
    expect(unitUpkeep(types.infantry, 10, 0.01)).toBe(8); // round(7.5)
  });
  it('caps at 10% of cost at full strength (heavytank 600 → 60)', () => {
    expect(unitUpkeep(types.heavytank, 10, 0.01)).toBe(60);
  });
  it('scales down with count (infantry at count 4 → round(3.0)=3)', () => {
    expect(unitUpkeep(types.infantry, 4, 0.01)).toBe(3);
  });
  it('a 1-count cheap unit still rounds to ~1 (round(0.75)=1)', () => {
    expect(unitUpkeep(types.infantry, 1, 0.01)).toBe(1);
  });
  it('rate 0 disables (0 for any unit)', () => {
    expect(unitUpkeep(types.heavytank, 10, 0)).toBe(0);
  });
});

describe('factionUpkeep', () => {
  it('sums only the named faction’s living units', () => {
    const units = [u('infantry', 10, 0), u('tank', 10, 0), u('infantry', 10, 1)];
    // f0: round(0.75*10)=8 + round(3*10)=30 = 38 ; tank cost 300 → 0.01*10*300=30
    expect(factionUpkeep(units, 0, types, 0.01)).toBe(8 + 30);
    expect(factionUpkeep(units, 1, types, 0.01)).toBe(8);
  });
  it('ignores count-0 (dead) units', () => {
    const units = [u('infantry', 0, 0), u('tank', 10, 0)];
    expect(factionUpkeep(units, 0, types, 0.01)).toBe(30);
  });
});

describe('upkeepRateOf', () => {
  const board = (economy?: Board['economy']): Board =>
    ({ economy } as unknown as Board);
  it('defaults to 0.01 when absent', () => {
    expect(upkeepRateOf(board(undefined))).toBe(DEFAULT_UPKEEP_RATE);
    expect(upkeepRateOf(board({ initialCredits: 100, perBaseCredits: 100 }))).toBe(0.01);
  });
  it('honors an explicit rate including 0', () => {
    expect(upkeepRateOf(board({ initialCredits: 100, perBaseCredits: 100, upkeepRate: 0 }))).toBe(0);
    expect(upkeepRateOf(board({ initialCredits: 100, perBaseCredits: 100, upkeepRate: 0.05 }))).toBe(0.05);
  });
});
