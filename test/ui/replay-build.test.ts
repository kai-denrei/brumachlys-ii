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
  vet: 0,
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

  it('P9 brawl pacing: follow-up exchanges of the SAME brawl compress and accumulate totals', () => {
    const units = [makeUnit('pt', 0, 2, 'tank'), makeUnit('ei', 1, 2, 'infantry')];
    const exchange = (hiDmg: number, loDmg: number, hiAfter: number, loAfter: number): ResolutionEvent => ({
      type: 'brawl-exchange',
      cell: 2,
      higherInitId: 'ei',
      lowerInitId: 'pt',
      higherInitDamageDealt: hiDmg,
      lowerInitDamageDealt: loDmg,
      higherInitCountAfter: hiAfter,
      lowerInitCountAfter: loAfter,
      higherInitBreakdown: bd({ damage: hiDmg }),
      lowerInitBreakdown: bd({ damage: loDmg }),
    });
    const script = build(units, [exchange(4, 5, 5, 6), exchange(3, 1, 4, 3)]);
    expect(script.slots.length).toBe(2);
    // First exchange: full volley beat. Second (same cell + pair): compressed.
    expect(script.frames[1]!.duration).toBe(800);
    expect(script.frames[2]!.duration).toBe(350);
    // Floaters show RUNNING totals: −4/−5, then −7/−6 — the sum stays readable.
    expect(script.frames[1]!.floaters.map((f) => f.text)).toEqual(['−4', '−5']);
    expect(script.frames[2]!.floaters.map((f) => f.text)).toEqual(['−7', '−6']);
    // Camera framing: the brawl cell.
    expect(script.frames[1]!.focus).toEqual([2]);
    expect(script.frames[2]!.focus).toEqual([2]);
  });

  it('P9 brawl pacing: an intervening event breaks the chain (next brawl is a fresh beat)', () => {
    const units = [
      makeUnit('pt', 0, 2, 'tank'),
      makeUnit('ei', 1, 2, 'infantry'),
      makeUnit('pi', 0, 4),
    ];
    const exchange: ResolutionEvent = {
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
    };
    const move: ResolutionEvent = { type: 'move', unitId: 'pi', from: 4, to: 5, pathTaken: [5] };
    const script = build(units, [exchange, move, exchange]);
    const brawlFrames = script.frames.filter((f) => f.bursts.length > 0);
    expect(brawlFrames.length).toBe(2);
    expect(brawlFrames[0]!.duration).toBe(800);
    expect(brawlFrames[1]!.duration).toBe(800); // chain broken — full beat again
    expect(brawlFrames[1]!.floaters.map((f) => f.text)).toEqual(['−4', '−5']); // fresh totals
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

describe('replay builder — camera focus (P9 auto-follow)', () => {
  it('the establishing frame leaves the camera alone', () => {
    const script = build([makeUnit('pi', 0, 2)], []);
    expect(script.frames[0]!.focus).toEqual([]);
  });

  it('move frames focus the mover cell-by-cell', () => {
    const script = build(
      [makeUnit('pi', 0, 0)],
      [{ type: 'move', unitId: 'pi', from: 0, to: 2, pathTaken: [1, 2] }],
    );
    expect(script.frames[1]!.focus).toEqual([1]);
    expect(script.frames[2]!.focus).toEqual([2]);
  });

  it('volley frames frame attacker AND defender', () => {
    const units = [makeUnit('pa', 0, 0, 'artillery'), makeUnit('er', 1, 4, 'ranger')];
    const script = build(units, [
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
    ]);
    expect([...script.frames[1]!.focus].sort()).toEqual([0, 4]);
  });

  it('fire from the mist frames ONLY the defender — focus must not leak the source', () => {
    const units = [makeUnit('pi', 0, 0), makeUnit('aa', 1, 4, 'artillery')];
    const script = build(units, [
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
    ]);
    expect(script.frames[1]!.focus).toEqual([0]); // never cell 4
  });
});

describe('replay builder — movement origin trails (v1.3 Tweak B)', () => {
  it("own move: frames carry a growing trail from the origin (id stable per slot)", () => {
    const script = build(
      [makeUnit('pi', 0, 0)],
      [{ type: 'move', unitId: 'pi', from: 0, to: 2, pathTaken: [1, 2] }],
    );
    expect(script.frames[0]!.trails).toEqual([]); // establishing frame
    expect(script.frames[1]!.trails).toEqual([{ id: 't0', faction: 0, path: [0, 1] }]);
    expect(script.frames[2]!.trails).toEqual([{ id: 't0', faction: 0, path: [0, 1, 2] }]);
  });

  it('non-move frames carry no trails', () => {
    const units = [makeUnit('pi', 0, 2), makeUnit('re', 1, 3, 'ranger')];
    const script = build(units, [
      {
        type: 'attack',
        attackerId: 'pi',
        defenderId: 're',
        attackerCell: 2,
        defenderCell: 3,
        damage: 5,
        bonusB: 0,
        defenderCountAfter: 4,
        counterFired: false,
        breakdown: bd(),
      },
    ]);
    expect(script.frames[1]!.trails).toEqual([]);
  });

  it('AI move crossing vision: the trail holds ONLY witnessed cells — never the mist', () => {
    // Player infantry at 0 sees 0..2; ranger walks 4→1 via [3,2,1]. Cells 4
    // (origin) and 3 were never seen — the dotted line must not mark them.
    const units = [makeUnit('pi', 0, 0), makeUnit('ai', 1, 4, 'ranger')];
    const script = build(units, [
      { type: 'move', unitId: 'ai', from: 4, to: 1, pathTaken: [3, 2, 1] },
    ]);
    // step onto 3 (fogged): nothing to draw yet
    expect(script.frames[1]!.trails).toEqual([]);
    // step onto 2 (visible): only one witnessed cell — still no line
    expect(script.frames[2]!.trails).toEqual([]);
    // step onto 1: trail spans the two witnessed cells only
    expect(script.frames[3]!.trails).toEqual([{ id: 't0', faction: 1, path: [2, 1] }]);
    for (const f of script.frames) {
      for (const t of f.trails) {
        expect(t.path).not.toContain(4);
        expect(t.path).not.toContain(3);
      }
    }
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

// --- E1 discovery fog: replay ignition (conquest addendum §A) ------------------

describe('replay builder — discovery ignition (E1)', () => {
  // Player infantry (vision 2) at cell 2: round-start discovery = cells 0..4.
  const startDisc = new Set([0, 1, 2, 3, 4]);

  it('frames carry per-step ignition deltas as own units advance into the dark', () => {
    const units = [makeUnit('pi', 0, 2)];
    const events: ResolutionEvent[] = [
      { type: 'move', unitId: 'pi', from: 2, to: 5, pathTaken: [3, 4, 5] },
    ];
    const script = buildReplay(plains(12), units, events, types, 0, startDisc);
    // establish + 3 move frames; establishing vision was already discovered
    expect(script.frames.length).toBe(4);
    expect(script.frames[0]!.ignite).toEqual([]);
    // pi at 3 → vision 1..5: cell 5 ignites; at 4 → 6; at 5 → 7
    expect(script.frames[1]!.ignite).toEqual([5]);
    expect(script.frames[2]!.ignite).toEqual([6]);
    expect(script.frames[3]!.ignite).toEqual([7]);
  });

  it('discovery accumulates frame-by-frame and NEVER shrinks', () => {
    const units = [makeUnit('pi', 0, 2)];
    const events: ResolutionEvent[] = [
      { type: 'move', unitId: 'pi', from: 2, to: 5, pathTaken: [3, 4, 5] },
    ];
    const script = buildReplay(plains(12), units, events, types, 0, startDisc);
    let prev: ReadonlySet<number> = new Set();
    for (const frame of script.frames) {
      for (const c of prev) expect(frame.discovered.has(c)).toBe(true); // superset
      prev = frame.discovered;
    }
    // final accumulation lands on the script for the store to fold in
    expect([...script.discovered].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('live → memory wake: a cell left behind stays discovered while fogged', () => {
    const units = [makeUnit('pi', 0, 2)];
    const events: ResolutionEvent[] = [
      { type: 'move', unitId: 'pi', from: 2, to: 5, pathTaken: [3, 4, 5] },
    ];
    const script = buildReplay(plains(12), units, events, types, 0, startDisc);
    const last = script.frames[3]!; // pi at 5, vision 3..7
    expect(last.fog.has(0)).toBe(true); // out of vision now…
    expect(last.discovered.has(0)).toBe(true); // …but remembered = memory tier
  });

  it('without a starting set the establishing frame ignites the opening vision', () => {
    const script = buildReplay(plains(12), [makeUnit('pi', 0, 2)], [], types, 0);
    expect(script.frames[0]!.ignite).toEqual([0, 1, 2, 3, 4]);
    expect([...script.discovered].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('REGRESSION: memory-tier cell shows no enemy unit and emits no log line', () => {
    // The player saw cell 7 in an earlier round (it is discovered) but has no
    // eyes on it now. An enemy moves through it — the frames must not render
    // it, the log must stay silent, the timeline must stay empty.
    const units = [makeUnit('pi', 0, 2), makeUnit('ai', 1, 7, 'ranger')];
    const disc = new Set([...startDisc, 7, 8]);
    const events: ResolutionEvent[] = [
      { type: 'move', unitId: 'ai', from: 7, to: 8, pathTaken: [8] },
    ];
    const script = buildReplay(plains(12), units, events, types, 0, disc);
    expect(script.frames.length).toBe(1); // establish only — nothing witnessed
    expect(script.slots.length).toBe(0);
    expect(script.log.length).toBe(0);
    const establish = script.frames[0]!;
    expect(establish.fog.has(7)).toBe(true);
    expect(establish.discovered.has(7)).toBe(true); // memory tier…
    expect(establish.units.some((u) => u.id === 'ai')).toBe(false); // …no token
  });
});
