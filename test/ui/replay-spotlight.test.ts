// R2 (SPOTLIGHT) — the pure half: buildReplay exposes the round's witnessed
// COMBATANT SET (attacked/attacking/brawling cells + units), fog-respecting,
// and spotlightAt engages the spotlight through the combat portion and releases
// it in SETTLE / at replay end. PURE — derived from the same fog-filtered shown
// strikes that drive the frames; outcomes/damage/fog are unchanged from R1.

import { describe, expect, it } from 'vitest';
import { bd } from '../fixtures';
import type {
  ResolutionEvent,
  UnitInstance,
} from '../../src/core/types';
import { buildReplay, spotlightAt } from '../../src/state/replay';
import { loadUnits } from '../../src/io/data-loader';
import { lineBoard, makeUnit } from '../core/synthetic';

const types = loadUnits();
const plains = (n: number) => lineBoard(Array(n).fill('plains'));

function build(units: UnitInstance[], events: ResolutionEvent[], cells = 12) {
  return buildReplay(plains(cells), units, events, types, 0);
}

describe('R2 buildReplay — combatant set', () => {
  it('always exposes a combatants set (empty for a combat-less round)', () => {
    const script = build([makeUnit('pi', 0, 2)], []);
    expect(script.combatants).toBeDefined();
    expect([...script.combatants.cells]).toEqual([]);
    expect([...script.combatants.units]).toEqual([]);
  });

  it('a mixed round: attacked/attacking/brawling cells+units IN, idle ones OUT', () => {
    // ps (sniper, cell 0) → e1 (cell 2): a ranged exchange.
    // pt (tank, cell 6) ⨯ ei (infantry, cell 6): a brawl.
    // pidle (cell 4) and eidle (cell 9) never fight → must NOT be combatants.
    const units = [
      makeUnit('ps', 0, 0, 'sniper'),
      makeUnit('e1', 1, 2, 'infantry'),
      makeUnit('pt', 0, 6, 'tank'),
      makeUnit('ei', 1, 6, 'infantry'),
      makeUnit('pidle', 0, 4, 'infantry'),
      makeUnit('eidle', 1, 9, 'infantry'),
    ];
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
    const script = build(units, events);
    const { cells, units: cu } = script.combatants;

    // attacker, defender, and both brawlers are combatants
    expect(cu.has('ps')).toBe(true);
    expect(cu.has('e1')).toBe(true);
    expect(cu.has('pt')).toBe(true);
    expect(cu.has('ei')).toBe(true);
    // their cells too
    expect(cells.has(0)).toBe(true); // sniper's firing cell
    expect(cells.has(2)).toBe(true); // struck cell
    expect(cells.has(6)).toBe(true); // brawl cell

    // the idle pair is OUT — neither cell nor unit
    expect(cu.has('pidle')).toBe(false);
    expect(cu.has('eidle')).toBe(false);
    expect(cells.has(4)).toBe(false);
    expect(cells.has(9)).toBe(false);

    // outcomes unchanged from R1 (presentation-only set)
    expect(script.summary.damageDealt).toEqual([5 + 5, 4]);
  });

  it('counters join the combatant set (the answering unit + its cell)', () => {
    // pi (infantry, cell 0) attacks ei (cell 1); ei counters back.
    const units = [makeUnit('pi', 0, 0, 'infantry'), makeUnit('ei', 1, 1, 'infantry')];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'pi',
        defenderId: 'ei',
        attackerCell: 0,
        defenderCell: 1,
        damage: 4,
        bonusB: 0,
        defenderCountAfter: 6,
        counterFired: true,
        breakdown: bd({ damage: 4 }),
      },
      {
        type: 'counter',
        attackerId: 'ei',
        defenderId: 'pi',
        attackerCell: 1,
        defenderCell: 0,
        damage: 3,
        defenderCountAfter: 7,
        breakdown: bd({ damage: 3 }),
      },
    ];
    const script = build(units, events);
    expect(script.combatants.units.has('pi')).toBe(true);
    expect(script.combatants.units.has('ei')).toBe(true);
    expect(script.combatants.cells.has(0)).toBe(true);
    expect(script.combatants.cells.has(1)).toBe(true);
  });

  it('FOG-RESPECTING: a fire-from-the-mist attacker leaks NEITHER its cell nor id', () => {
    // Player infantry at 0 (vision 2, sees 0..2); AI artillery at 4 fires at 0.
    // The strike is shown (the defender is visible) but the source is withheld —
    // the combatant set must carry ONLY the witnessed defender, never the
    // unseen attacker's firing cell or id.
    const units = [makeUnit('pi', 0, 0), makeUnit('aa', 1, 4, 'artillery')];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'aa',
        defenderId: 'pi',
        attackerCell: 4,
        defenderCell: 0,
        damage: 3,
        bonusB: 0,
        defenderCountAfter: 7,
        counterFired: false,
        breakdown: bd({ damage: 3 }),
      },
    ];
    const script = build(units, events);
    // defender shown
    expect(script.combatants.units.has('pi')).toBe(true);
    expect(script.combatants.cells.has(0)).toBe(true);
    // attacker WITHHELD — no leak of the mist firing position
    expect(script.combatants.units.has('aa')).toBe(false);
    expect(script.combatants.cells.has(4)).toBe(false);
  });

  it('FOG-RESPECTING: an unwitnessed combat (wholly in the mist) adds no combatants', () => {
    // AI-on-AI off in the dark — the player sees nothing, so no frame, no slot,
    // and nothing joins the combatant set. (Synthetic stream; the builder must
    // stay fog-honest regardless.)
    const units = [
      makeUnit('pi', 0, 0), // vision 2 → sees 0..2 only
      makeUnit('a1', 1, 9, 'infantry'),
      makeUnit('a2', 1, 10, 'infantry'),
    ];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'a1',
        defenderId: 'a2',
        attackerCell: 9,
        defenderCell: 10,
        damage: 4,
        bonusB: 0,
        defenderCountAfter: 6,
        counterFired: false,
        breakdown: bd({ damage: 4 }),
      },
    ];
    const script = build(units, events);
    expect([...script.combatants.cells]).toEqual([]);
    expect([...script.combatants.units]).toEqual([]);
  });
});

describe('R2 spotlightAt — engage through combat, release in SETTLE', () => {
  it('a combat-less round never engages the spotlight', () => {
    const script = build([makeUnit('pi', 0, 2)], []);
    for (let i = 0; i < script.frames.length; i++) {
      expect(spotlightAt(script, i).active).toBe(false);
    }
  });

  it('engages on the combat frames and RELEASES after the last wave frame', () => {
    // A single ranged volley → one combat (wave) frame, then no further combat.
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
    const script = build(units, events);
    const lastCombat = script.frames.map((f) => f.wave).lastIndexOf('A');
    expect(lastCombat).toBeGreaterThanOrEqual(0);
    // every frame up to and including the last combat frame: engaged
    for (let i = 0; i <= lastCombat; i++) expect(spotlightAt(script, i).active).toBe(true);
    // any frame AFTER it (SETTLE / end): released
    for (let i = lastCombat + 1; i < script.frames.length; i++) {
      expect(spotlightAt(script, i).active).toBe(false);
    }
  });

  it('returns the round combatant set regardless of the active flag', () => {
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
    const script = build(units, events);
    expect(spotlightAt(script, 0).combatants).toBe(script.combatants);
    expect(spotlightAt(script, script.frames.length - 1).combatants).toBe(script.combatants);
  });
});
