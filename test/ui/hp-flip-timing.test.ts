import { describe, expect, it } from 'vitest';
import {
  impactTimeByCell,
  buildHpFlips,
  type Beat,
  type Projectile,
} from '../../src/state/replay-timing';

// --- fixtures ---------------------------------------------------------------

const proj = (over: Partial<Projectile>): Projectile => ({
  kind: 'shell',
  from: 0,
  to: 1,
  faction: 0,
  impact: 0.88,
  delay: 0,
  ...over,
});

const beat = (over: Partial<Beat>): Beat => ({
  start: 0,
  dur: 1000,
  activeCells: [],
  projectiles: [],
  ...over,
});

describe('impactTimeByCell', () => {
  it('lands a projectile at start + delay + impact*dur on its target cell', () => {
    const beats = [beat({ start: 200, dur: 1000, projectiles: [proj({ to: 4, delay: 50, impact: 0.8 })] })];
    // 200 + 50 + 0.8*1000 = 1050
    expect(impactTimeByCell(beats).get(4)).toBe(1050);
  });

  it('keeps the LATEST impact when a cell is hit by multiple projectiles', () => {
    const beats = [
      beat({ start: 0, dur: 1000, projectiles: [proj({ to: 7, delay: 0, impact: 0.5 })] }), // 500
      beat({ start: 1200, dur: 1000, projectiles: [proj({ to: 7, delay: 0, impact: 0.8 })] }), // 2000
    ];
    expect(impactTimeByCell(beats).get(7)).toBe(2000);
  });

  it('returns an empty map for no beats', () => {
    expect(impactTimeByCell([]).size).toBe(0);
  });
});

describe('buildHpFlips', () => {
  const counts = new Map<string, number>([['def', 5]]);
  const countOf = (id: string) => counts.get(id);

  it('arms a flip from old(=new+damage) down to new at the impact time', () => {
    const beats = [beat({ start: 0, dur: 1000, projectiles: [proj({ to: 2, impact: 0.88, delay: 0 })] })];
    const impacts = [{ defenderId: 'def', defenderCell: 2, damage: 3 }];
    const flips = buildHpFlips(impacts, beats, countOf);
    expect(flips.get('def')).toEqual({ fromCount: 8, toCount: 5, flipAtMs: 880 });
  });

  it('sums damage across multiple strikes on one defender and flips once after the last impact', () => {
    const beats = [
      beat({ start: 0, dur: 1000, projectiles: [proj({ to: 2, impact: 0.5, delay: 0 })] }), // 500
      beat({ start: 1000, dur: 1000, projectiles: [proj({ to: 2, impact: 0.8, delay: 0 })] }), // 1800
    ];
    const impacts = [
      { defenderId: 'def', defenderCell: 2, damage: 2 },
      { defenderId: 'def', defenderCell: 2, damage: 1 },
    ];
    const flips = buildHpFlips(impacts, beats, countOf);
    // fromCount = newCount(5) + total damage(3) = 8; flips after the last impact (1800)
    expect(flips.get('def')).toEqual({ fromCount: 8, toCount: 5, flipAtMs: 1800 });
  });

  it('times the flip off the LAST recorded impact cell for a defender (defensive)', () => {
    // A unit occupies one cell per frame, but if a defender is ever recorded on
    // more than one cell the flip must time off the decisive (last) landing.
    const beats = [
      beat({ start: 0, dur: 1000, projectiles: [proj({ to: 2, impact: 0.5, delay: 0 })] }), // 500
      beat({ start: 1000, dur: 1000, projectiles: [proj({ to: 5, impact: 0.8, delay: 0 })] }), // 1800
    ];
    const impacts = [
      { defenderId: 'def', defenderCell: 2, damage: 1 },
      { defenderId: 'def', defenderCell: 5, damage: 2 },
    ];
    expect(buildHpFlips(impacts, beats, countOf).get('def')).toEqual({
      fromCount: 8,
      toCount: 5,
      flipAtMs: 1800,
    });
  });

  it('does NOT arm a flip when no witnessed projectile lands on the defender cell (mist honesty)', () => {
    const beats = [beat({ start: 0, dur: 1000, projectiles: [proj({ to: 99, impact: 0.88 })] })];
    const impacts = [{ defenderId: 'def', defenderCell: 2, damage: 3 }];
    expect(buildHpFlips(impacts, beats, countOf).has('def')).toBe(false);
  });

  it('skips a defender whose post-combat count is unknown', () => {
    const beats = [beat({ projectiles: [proj({ to: 2, impact: 0.5 })] })];
    const impacts = [{ defenderId: 'ghost', defenderCell: 2, damage: 3 }];
    expect(buildHpFlips(impacts, beats, countOf).has('ghost')).toBe(false);
  });

  it('ignores zero-damage impacts', () => {
    const beats = [beat({ projectiles: [proj({ to: 2, impact: 0.5 })] })];
    const impacts = [{ defenderId: 'def', defenderCell: 2, damage: 0 }];
    expect(buildHpFlips(impacts, beats, countOf).has('def')).toBe(false);
  });
});
