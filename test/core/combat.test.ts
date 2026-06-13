// Weewar model vectors — ported from v1 test/combat.test.ts (Hex contexts →
// board-agnostic Combatant contexts), plus II stance modifiers (spec §2.4).
// §5.4 reference vectors must hold exactly.

import { describe, expect, test } from 'vitest';
import {
  attackDamage,
  battleExchange,
  explainAttack,
  roundDamage,
  weewar,
} from '../../src/core/combat/weewar';
import type { Combatant } from '../../src/core/combat/model';
import { loadUnits } from '../../src/io/data-loader';
import type { Stance, UnitType } from '../../src/core/types';
import type { TerrainKey } from '../../src/board/types';

const units = loadUnits();
const INF = units.infantry!;
const TNK = units.tank!;
const ART = units.artillery!;

function c(
  type: UnitType,
  count = 10,
  terrain: TerrainKey = 'plains',
  stance?: Stance,
): Combatant {
  return stance === undefined ? { count, type, terrain } : { count, type, terrain, stance };
}

describe('roundDamage (v1 §B.1 — half-up)', () => {
  test('Math.round half-up for non-negatives', () => {
    expect(roundDamage(4.5)).toBe(5);
    expect(roundDamage(4.4)).toBe(4);
    expect(roundDamage(0)).toBe(0);
    expect(roundDamage(2.5)).toBe(3); // half-up, NOT banker's
  });
});

describe('attackDamage — spec §5.4 reference vectors', () => {
  test('infantry(10) → tank(10), both plains, B=0: A=3, D=5 → p=0.40 → damage 4', () => {
    expect(attackDamage({ attacker: c(INF), defender: c(TNK), bonusB: 0 })).toBe(4);
  });

  test('tank(10) → infantry(10), plains, B=0: A=5, D=6 → p=0.45 → damage 5 (half-up)', () => {
    expect(attackDamage({ attacker: c(TNK), defender: c(INF), bonusB: 0 })).toBe(5);
  });

  test('opposite gang-up: B=3 → p=0.55, tank count now 6 → round(6 × 0.55) = 3', () => {
    expect(attackDamage({ attacker: c(INF), defender: c(TNK, 6), bonusB: 3 })).toBe(3);
  });
});

describe('attackDamage — clamp + zero-attack edges', () => {
  test('p clamps to 1 when bonus is huge', () => {
    expect(attackDamage({ attacker: c(INF), defender: c(TNK), bonusB: 100 })).toBe(10);
  });

  test('p clamps to 0 when penalty is huge', () => {
    expect(attackDamage({ attacker: c(INF), defender: c(TNK), bonusB: -100 })).toBe(0);
  });

  test('attackStrength 0 vs armor type → damage 0 regardless of count', () => {
    const frigate: UnitType = { ...TNK, armorType: 'naval', key: 'frigate' };
    expect(attackDamage({ attacker: c(INF), defender: c(frigate), bonusB: 0 })).toBe(0);
  });

  test('attacker count of 0 produces 0 damage', () => {
    expect(attackDamage({ attacker: c(INF, 0), defender: c(TNK), bonusB: 0 })).toBe(0);
  });
});

describe('attackDamage — minimum-damage floor (spec §5.2 / v1 §B.16)', () => {
  test('tank-10 vs infantry-1 floors raw 0 to 1 (no immortal stragglers)', () => {
    // p=0.45, min(10,1)=1, round(0.45)=0 → floor 1.
    expect(attackDamage({ attacker: c(TNK), defender: c(INF, 1), bonusB: 0 })).toBe(1);
  });

  test('infantry-10 vs tank-1 also floors to 1', () => {
    // p=0.40, round(0.40)=0 → floor 1.
    expect(attackDamage({ attacker: c(INF), defender: c(TNK, 1), bonusB: 0 })).toBe(1);
  });

  test('floor does NOT fire when attacker cannot engage the armor type', () => {
    const frigate: UnitType = { ...TNK, armorType: 'naval', key: 'frigate' };
    expect(attackDamage({ attacker: c(INF), defender: c(frigate, 1), bonusB: 0 })).toBe(0);
  });

  test('floor does NOT fire when p clamps to 0', () => {
    expect(attackDamage({ attacker: c(INF), defender: c(TNK, 1), bonusB: -100 })).toBe(0);
  });

  test('positive raw values pass through unchanged', () => {
    expect(attackDamage({ attacker: c(INF), defender: c(TNK, 6), bonusB: 3 })).toBe(3);
  });
});

describe('attackDamage — terrain and stance modifiers', () => {
  test('defensive stance adds +1 Td: tank → defensive infantry, plains → p=0.40 → 4', () => {
    expect(
      attackDamage({ attacker: c(TNK), defender: c(INF, 10, 'plains', 'defensive'), bonusB: 0 }),
    ).toBe(4); // vs 5 without the stance
  });

  test('no stance on the context → no stance modifier (brawls ignore stances)', () => {
    expect(attackDamage({ attacker: c(TNK), defender: c(INF), bonusB: 0 })).toBe(5);
  });

  test('defender woods cover (+2 Td personnel): tank → infantry in woods → p=0.35 → 4', () => {
    // A=5, D=6, Td=+2 → p = 0.5 + 0.05*(5-8) = 0.35 → round(3.5) = 4.
    expect(
      attackDamage({ attacker: c(TNK), defender: c(INF, 10, 'woods'), bonusB: 0 }),
    ).toBe(4);
  });

  test('attacker mountain bonus (+2 Ta personnel): infantry on mountains → tank → p=0.50 → 5', () => {
    // A=3, Ta=+2, D=5 → p = 0.5 → 5.
    expect(
      attackDamage({ attacker: c(INF, 10, 'mountains'), defender: c(TNK), bonusB: 0 }),
    ).toBe(5);
  });
});

describe('battleExchange (spec §2.7 counter semantics)', () => {
  test('mutual loss applied against pre-exchange counts (one tick)', () => {
    // Infantry attacks tank, both plains, 10 each, B=0, distance 1.
    // attacker deals 4; counter deals 5 → 5 vs 6.
    const r = battleExchange({ attacker: c(INF), defender: c(TNK), distance: 1, bonusB: 0 });
    expect(r.attackerCount).toBe(5);
    expect(r.defenderCount).toBe(6);
    expect(r.attackerDamageDealt).toBe(4);
    expect(r.defenderCounterDealt).toBe(5);
    expect(r.counterFired).toBe(true);
  });

  test('§13.4 first brawl exchange: tank(10) vs infantry(10) → 6 vs 5', () => {
    // Tank deals 5 (p=0.45), infantry counters 4 (p=0.40).
    const r = battleExchange({ attacker: c(TNK), defender: c(INF), distance: 1, bonusB: 0 });
    expect(r.attackerCount).toBe(6);
    expect(r.defenderCount).toBe(5);
  });

  test('artillery (minRange 2) cannot counter an adjacent attacker — glass cannon', () => {
    const r = battleExchange({ attacker: c(INF), defender: c(ART), distance: 1, bonusB: 0 });
    expect(r.counterFired).toBe(false);
    expect(r.defenderCounterDealt).toBe(0);
    expect(r.attackerCount).toBe(10); // attacker untouched
  });

  test('counter does not fire beyond the defender maxRange', () => {
    // Sniper attacks tank from distance 2; tank maxRange 1 → no counter.
    const SNI = units.sniper!;
    const r = battleExchange({ attacker: c(SNI), defender: c(TNK), distance: 2, bonusB: 0 });
    expect(r.counterFired).toBe(false);
    expect(r.attackerCount).toBe(10);
  });

  test('counter does not fire if defender cannot attack attacker armor type', () => {
    const pacifist: UnitType = {
      ...TNK,
      attackStrengths: { personnel: 0, armored: 0, naval: 0, air: 0 },
    };
    const r = battleExchange({ attacker: c(INF), defender: c(pacifist), distance: 1, bonusB: 0 });
    expect(r.counterFired).toBe(false);
    expect(r.attackerCount).toBe(10);
  });

  test('hold-fire defender never counters (spec §2.4)', () => {
    const r = battleExchange({
      attacker: c(INF),
      defender: c(TNK, 10, 'plains', 'hold-fire'),
      distance: 1,
      bonusB: 0,
    });
    expect(r.counterFired).toBe(false);
    expect(r.attackerCount).toBe(10);
    expect(r.defenderCount).toBe(6);
  });

  test('counts cannot go below zero', () => {
    const r = battleExchange({ attacker: c(INF, 1), defender: c(TNK, 1), distance: 1, bonusB: 100 });
    expect(r.attackerCount).toBeGreaterThanOrEqual(0);
    expect(r.defenderCount).toBeGreaterThanOrEqual(0);
  });

  test('does not mutate the input combatants (counter cannot touch accumulators)', () => {
    const attacker = c(INF);
    const defender = c(TNK);
    battleExchange({ attacker, defender, distance: 1, bonusB: 0 });
    expect(attacker).toEqual(c(INF));
    expect(defender).toEqual(c(TNK));
  });
});

describe('weewar as a ResolutionModel (spec §5.1)', () => {
  test('exposes key + pure methods', () => {
    expect(weewar.key).toBe('weewar');
    expect(weewar.attackDamage({ attacker: c(INF), defender: c(TNK), bonusB: 0 })).toBe(4);
    expect(
      weewar.battleExchange({ attacker: c(INF), defender: c(TNK), distance: 1, bonusB: 0 })
        .defenderCount,
    ).toBe(6);
  });
});

describe('veterancy damageBonus (v0.8 §rank)', () => {
  // Test A: base A > 0 (infantry vs tank, armored, A=3) — bonus IS applied.
  // Without bonus: A=3, D=5, p=0.40, damage=4.
  // With damageBonus=2: A should be 5, vet=2, p=0.50, damage=5.
  test('Test A: damageBonus adds to A and vet when base attack strength > 0', () => {
    const baseTerms = explainAttack({ attacker: c(INF), defender: c(TNK), bonusB: 0 });
    const vetTerms = explainAttack({
      attacker: { ...c(INF), damageBonus: 2 },
      defender: c(TNK),
      bonusB: 0,
    });
    expect(vetTerms.A).toBe(baseTerms.A + 2);
    expect(vetTerms.vet).toBe(2);
    expect(vetTerms.p).toBeGreaterThanOrEqual(baseTerms.p);
  });

  // Test B: base A === 0 (infantry vs naval) — bonus is NOT applied.
  // INF.attackStrengths.naval === 0; adding damageBonus=5 must have no effect.
  test('Test B: damageBonus is suppressed when base attack strength is 0 (cannot engage armor type)', () => {
    const frigate: UnitType = { ...TNK, armorType: 'naval', key: 'frigate' };
    const vetTerms = explainAttack({
      attacker: { ...c(INF), damageBonus: 5 },
      defender: c(frigate),
      bonusB: 0,
    });
    expect(vetTerms.A).toBe(0);
    expect(vetTerms.vet).toBe(0);
    expect(vetTerms.damage).toBe(0);
  });
});
