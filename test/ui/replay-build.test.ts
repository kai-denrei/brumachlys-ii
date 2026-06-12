// P8 replay-script builder: event grouping (attack+counter = ONE visual
// tick), and the §7 replay-fog rules — AI moves wholly in the mist are
// skipped silently, damage from an unseen attacker withholds the source
// ("fire from the mist"), kills of unseen units are not shown. The timeline
// slots must obey the same filter (a hidden tick must not even appear).

import { describe, expect, it } from 'vitest';
import type {
  AttackBreakdown,
  ResolutionEvent,
  UnitInstance,
} from '../../src/core/types';
import { buildReplay } from '../../src/state/replay';
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
  p: 0.45,
  damage: 5,
  gangUp: { total: 0, contributions: [] },
  ...over,
});

function build(units: UnitInstance[], events: ResolutionEvent[], cells = 12) {
  return buildReplay(plains(cells), units, events, types, 0);
}

describe('replay builder — grouping', () => {
  it('always emits an establishing frame with the pre-round fog picture', () => {
    const script = build([makeUnit('pi', 0, 2)], []);
    expect(script.frames.length).toBe(1);
    expect(script.frames[0]!.slot).toBe(-1);
    // infantry vision 2 from cell 2 → cells 0..4 visible, 5+ fogged
    expect(script.frames[0]!.fog.has(5)).toBe(true);
    expect(script.frames[0]!.fog.has(4)).toBe(false);
    expect(script.slots.length).toBe(0);
  });

  it('attack + counter + kill resolve as ONE visual tick (damages were simultaneous)', () => {
    const units = [makeUnit('pi', 0, 2), makeUnit('re', 1, 3, 'ranger')];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'pi',
        defenderId: 're',
        attackerCell: 2,
        defenderCell: 3,
        damage: 5,
        bonusB: 0,
        defenderCountAfter: 0,
        counterFired: true,
        breakdown: bd(),
      },
      {
        type: 'counter',
        attackerId: 're',
        defenderId: 'pi',
        attackerCell: 3,
        defenderCell: 2,
        damage: 4,
        defenderCountAfter: 6,
        breakdown: bd({ damage: 4 }),
      },
      { type: 'kill', unitId: 're', cell: 3, faction: 1 },
    ];
    const script = build(units, events);
    expect(script.slots.length).toBe(1); // one timeline slot for the whole exchange
    expect(script.frames.length).toBe(2); // establish + ONE volley frame
    const frame = script.frames[1]!;
    expect(frame.arcs.length).toBe(2); // both halves flash together
    expect(frame.floaters.map((f) => f.text).sort()).toEqual(['−4', '−5']);
    expect(frame.kills.map((u) => u.id)).toEqual(['re']);
    expect(frame.units.some((u) => u.id === 're')).toBe(false); // dead
    expect(script.slots[0]!.strikes.map((s) => s.kind)).toEqual(['attack', 'counter']);
    expect(script.summary.kills).toEqual([{ id: 're', type: 'ranger', faction: 1 }]);
    expect(script.summary.damageDealt).toEqual([5, 4]);
  });

  it('brawl exchange: both halves in one tick with a clash burst', () => {
    const units = [makeUnit('pt', 0, 2, 'tank'), makeUnit('ei', 1, 2, 'infantry')];
    const events: ResolutionEvent[] = [
      {
        type: 'brawl-exchange',
        cell: 2,
        higherInitId: 'ei',
        lowerInitId: 'pt',
        higherInitDamageDealt: 4,
        lowerInitDamageDealt: 5,
        higherInitCountAfter: 5,
        lowerInitCountAfter: 6,
        higherInitBreakdown: bd({ damage: 4 }),
        lowerInitBreakdown: bd(),
      },
    ];
    const script = build(units, events);
    expect(script.slots.length).toBe(1);
    expect(script.slots[0]!.kind).toBe('brawl');
    expect(script.slots[0]!.strikes.map((s) => s.kind)).toEqual(['brawl', 'brawl-return']);
    const frame = script.frames[1]!;
    expect(frame.bursts).toEqual([2]);
    expect(frame.floaters.length).toBe(2);
    // counts applied
    expect(frame.units.find((u) => u.id === 'ei')!.count).toBe(5);
    expect(frame.units.find((u) => u.id === 'pt')!.count).toBe(6);
  });

  it('stance events animate nothing but restyle the unit', () => {
    const script = build(
      [makeUnit('pi', 0, 2)],
      [{ type: 'stance', unitId: 'pi', stance: 'defensive' }],
    );
    expect(script.frames.length).toBe(1);
    expect(script.slots.length).toBe(0);
  });

  it('player fizzle shows a no-target floater and counts in the summary', () => {
    const script = build(
      [makeUnit('pi', 0, 2)],
      [{ type: 'lost-target', attackerId: 'pi', targetCell: 5 }],
    );
    expect(script.slots.length).toBe(1);
    expect(script.slots[0]!.kind).toBe('fizzle');
    expect(script.frames[1]!.floaters[0]!.text).toBe('no target');
    expect(script.summary.fizzles).toBe(1);
  });
});

describe('replay builder — player-fog filtering (§7)', () => {
  // Player infantry at 0: vision 2 → sees cells 0..2 only.

  it('an AI move wholly outside player vision is skipped silently (no frame, no slot)', () => {
    const units = [makeUnit('pi', 0, 0), makeUnit('ai', 1, 8, 'ranger')];
    const events: ResolutionEvent[] = [
      { type: 'move', unitId: 'ai', from: 8, to: 6, pathTaken: [7, 6] },
    ];
    const script = build(units, events);
    expect(script.frames.length).toBe(1); // establishing only
    expect(script.slots.length).toBe(0); // timeline leaks nothing
  });

  it('an AI move that crosses player vision is shown, token hidden while in the mist', () => {
    const units = [makeUnit('pi', 0, 0), makeUnit('ai', 1, 4, 'ranger')];
    const events: ResolutionEvent[] = [
      { type: 'move', unitId: 'ai', from: 4, to: 1, pathTaken: [3, 2, 1] },
    ];
    const script = build(units, events);
    expect(script.slots.length).toBe(1);
    expect(script.slots[0]!.kind).toBe('move');
    expect(script.frames.length).toBe(4); // establish + 3 path steps
    // step onto cell 3 (fogged): the mover is not rendered yet
    expect(script.frames[1]!.units.some((u) => u.id === 'ai')).toBe(false);
    // steps onto cells 2 and 1 (visible): rendered
    expect(script.frames[2]!.units.some((u) => u.id === 'ai')).toBe(true);
    expect(script.frames[3]!.units.some((u) => u.id === 'ai')).toBe(true);
  });

  it('FIRE FROM THE MIST: unseen artillery hits a visible unit — impact shown, source withheld', () => {
    // Player infantry at 0 (sees 0..2); AI artillery at 4 fires (range 2–4).
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
    expect(script.slots.length).toBe(1);
    const slot = script.slots[0]!;
    // The UI event feed withholds the attacker entirely:
    expect(slot.actorType).toBeNull(); // timeline shows a mist glyph
    expect(slot.actorFaction).toBeNull();
    const strike = slot.strikes[0]!;
    expect(strike.fromMist).toBe(true);
    expect(strike.attackerCell).toBeNull();
    expect(strike.attackerId).toBeNull();
    expect(strike.attackerType).toBeNull();
    // The defender's pain is fully shown:
    expect(strike.defenderCell).toBe(0);
    expect(strike.damage).toBe(3);
    const frame = script.frames[1]!;
    expect(frame.arcs.length).toBe(0); // no arc — no source to draw from
    expect(frame.floaters.length).toBe(1);
    expect(frame.floaters[0]!.mist).toBe(true);
    expect(frame.floaters[0]!.cell).toBe(0);
    // The artillery is still not rendered anywhere:
    expect(frame.units.some((u) => u.id === 'aa')).toBe(false);
  });

  it("the player's own attacks are always fully shown, even beyond own vision", () => {
    // Player artillery at 0 (vision 1, sees 0..1) fires at cell 4.
    const units = [makeUnit('pa', 0, 0, 'artillery'), makeUnit('er', 1, 4, 'ranger')];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'pa',
        defenderId: 'er',
        attackerCell: 0,
        defenderCell: 4,
        damage: 6,
        bonusB: 0,
        defenderCountAfter: 4,
        counterFired: false,
        breakdown: bd({ damage: 6 }),
      },
    ];
    const script = build(units, events);
    const strike = script.slots[0]!.strikes[0]!;
    expect(strike.fromMist).toBe(false);
    expect(strike.attackerCell).toBe(0);
    expect(script.frames[1]!.arcs.length).toBe(1);
  });

  it('kills of unseen units are not shown (synthetic AI-on-AI stream)', () => {
    // Not producible by the real 2-faction resolver, but the builder must
    // withhold it: an attack between two units the player cannot see.
    const units = [makeUnit('pi', 0, 0), makeUnit('a1', 1, 6, 'ranger'), makeUnit('a2', 1, 7, 'tank')];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'a1',
        defenderId: 'a2',
        attackerCell: 6,
        defenderCell: 7,
        damage: 9,
        bonusB: 0,
        defenderCountAfter: 0,
        counterFired: false,
        breakdown: bd({ damage: 9 }),
      },
      { type: 'kill', unitId: 'a2', cell: 7, faction: 1 },
    ];
    const script = build(units, events);
    expect(script.frames.length).toBe(1); // nothing shown
    expect(script.slots.length).toBe(0);
    expect(script.summary.kills.length).toBe(0); // the player learns nothing
    expect(script.summary.damageDealt).toEqual([0, 0]);
  });

  it("player vision moves with the player's own replayed moves", () => {
    // Player infantry walks 0→2; AI unit at 4 becomes visible mid-replay.
    const units = [makeUnit('pi', 0, 0), makeUnit('ai', 1, 4, 'ranger')];
    const events: ResolutionEvent[] = [
      { type: 'move', unitId: 'pi', from: 0, to: 2, pathTaken: [1, 2] },
    ];
    const script = build(units, events);
    expect(script.frames.length).toBe(3);
    expect(script.frames[0]!.units.some((u) => u.id === 'ai')).toBe(false); // hidden at start
    expect(script.frames[1]!.units.some((u) => u.id === 'ai')).toBe(false); // pi at 1, vision to 3
    expect(script.frames[2]!.units.some((u) => u.id === 'ai')).toBe(true); // pi at 2, vision to 4
    expect(script.frames[2]!.fog.has(4)).toBe(false);
  });
});
