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
    // (MOVE_STEP_MS=160, VOLLEY_MS=520, BRAWL_FOLLOWUP_MS=240 — Phase 4.2 constants)
    expect(script.frames[1]!.duration).toBe(520);
    expect(script.frames[2]!.duration).toBe(240);
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
    expect(brawlFrames[0]!.duration).toBe(520); // Phase 4.2 constant: VOLLEY_MS=520
    expect(brawlFrames[1]!.duration).toBe(520); // chain broken — full beat again (Phase 4.2)
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
    // Phase 4.1: trail id is now `t${slot}-${unitId}` to support multi-mover grouping.
    expect(script.frames[1]!.trails).toEqual([{ id: 't0-pi', faction: 0, path: [0, 1] }]);
    expect(script.frames[2]!.trails).toEqual([{ id: 't0-pi', faction: 0, path: [0, 1, 2] }]);
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
    // Phase 4.1: trail id is now `t${slot}-${unitId}`.
    expect(script.frames[3]!.trails).toEqual([{ id: 't0-ai', faction: 1, path: [2, 1] }]);
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

// --- v0.8 veterancy: promotion slots -------------------------------------------

describe('replay builder — promotion events (v0.8 veterancy)', () => {
  it('builds a promotion slot from a visible promotion event (own unit)', () => {
    // Player infantry at cell 2 (always visible — own faction).
    const units = [makeUnit('pi', 0, 2)];
    const events: ResolutionEvent[] = [
      { type: 'promotion', unitId: 'pi', cell: 2, faction: 0, rank: 1, healedTo: 10 },
    ];
    const script = build(units, events);
    expect(script.slots.some((s) => s.kind === 'promotion')).toBe(true);
    expect(script.frames.some((f) => (f.promotions?.length ?? 0) > 0)).toBe(true);
    const promFrame = script.frames.find((f) => (f.promotions?.length ?? 0) > 0)!;
    expect(promFrame.promotions![0]).toEqual({ cell: 2, faction: 0, rank: 1 });
  });

  it('rank and count are updated in the sim — subsequent frame snapshots carry them', () => {
    const units = [makeUnit('pi', 0, 2)];
    const events: ResolutionEvent[] = [
      { type: 'promotion', unitId: 'pi', cell: 2, faction: 0, rank: 1, healedTo: 10 },
    ];
    const script = build(units, events);
    const promFrame = script.frames.find((f) => (f.promotions?.length ?? 0) > 0)!;
    const piSnapshot = promFrame.units.find((u) => u.id === 'pi')!;
    expect(piSnapshot.count).toBe(10);
    expect(piSnapshot.rank).toBe(1);
  });

  it('fog discipline: a promotion at a fogged enemy cell produces NO promotion slot', () => {
    // Player infantry at 0 sees cells 0..2 only. Enemy ranger at 8 is outside vision.
    const units = [makeUnit('pi', 0, 0), makeUnit('er', 1, 8, 'ranger')];
    const events: ResolutionEvent[] = [
      { type: 'promotion', unitId: 'er', cell: 8, faction: 1, rank: 1, healedTo: 10 },
    ];
    const script = build(units, events);
    expect(script.slots.some((s) => s.kind === 'promotion')).toBe(false);
    expect(script.frames.every((f) => (f.promotions?.length ?? 0) === 0)).toBe(true);
  });

  it('enemy promotion on a visible cell IS shown (enemy in player vision)', () => {
    // Player infantry at 0 (vision 2, sees 0..2); enemy ranger at 2 is visible.
    const units = [makeUnit('pi', 0, 0), makeUnit('er', 1, 2, 'ranger')];
    const events: ResolutionEvent[] = [
      { type: 'promotion', unitId: 'er', cell: 2, faction: 1, rank: 1, healedTo: 10 },
    ];
    const script = build(units, events);
    expect(script.slots.some((s) => s.kind === 'promotion')).toBe(true);
    const promFrame = script.frames.find((f) => (f.promotions?.length ?? 0) > 0)!;
    expect(promFrame.promotions![0]).toEqual({ cell: 2, faction: 1, rank: 1 });
  });

  it('every frame carries an empty promotions array by default (emptyFx contract)', () => {
    const script = build([makeUnit('pi', 0, 2)], []);
    for (const f of script.frames) {
      expect(Array.isArray(f.promotions)).toBe(true);
    }
  });
});

// --- Phase 4: simultaneous pacing -----------------------------------------------

describe('replay builder — concurrent movement (Phase 4.1)', () => {
  it('animates a run of visible moves concurrently (fewer frames than sequential)', () => {
    // Two player units each move 3 steps. Sequential = 6 move frames; concurrent = 3.
    // Board: 0-1-2-3-4-5-6-7-8-9 (10 cells). Unit A at 0 moves to 3; unit B at 9 moves to 6.
    const units = [makeUnit('pa', 0, 0), makeUnit('pb', 0, 9)];
    const events: ResolutionEvent[] = [
      { type: 'move', unitId: 'pa', from: 0, to: 3, pathTaken: [1, 2, 3] },
      { type: 'move', unitId: 'pb', from: 9, to: 6, pathTaken: [8, 7, 6] },
    ];
    const script = build(units, events, 10);
    const moveSlotIndices = script.slots
      .map((s, i) => (s.kind === 'move' ? i : -1))
      .filter((i) => i >= 0);
    // Both movers share ONE move slot for the group.
    expect(moveSlotIndices.length).toBe(1);
    const moveFrames = script.frames.filter((f) => moveSlotIndices.includes(f.slot));
    // Concurrent: max(3, 3) = 3 frames, NOT 3+3 = 6.
    expect(moveFrames.length).toBeLessThanOrEqual(3);
    // Both units should appear in the final move frame (both at their destination).
    const lastMoveFrame = moveFrames[moveFrames.length - 1]!;
    expect(lastMoveFrame.units.some((u) => u.id === 'pa' && u.cell === 3)).toBe(true);
    expect(lastMoveFrame.units.some((u) => u.id === 'pb' && u.cell === 6)).toBe(true);
  });

  it('unequal-length concurrent moves: shorter mover holds at its final cell', () => {
    // Unit A moves 1 step, unit B moves 3 steps. maxSteps = 3.
    const units = [makeUnit('pa', 0, 0), makeUnit('pb', 0, 5)];
    const events: ResolutionEvent[] = [
      { type: 'move', unitId: 'pa', from: 0, to: 1, pathTaken: [1] },
      { type: 'move', unitId: 'pb', from: 5, to: 8, pathTaken: [6, 7, 8] },
    ];
    const script = build(units, events, 12);
    const moveSlotIndices = script.slots
      .map((s, i) => (s.kind === 'move' ? i : -1))
      .filter((i) => i >= 0);
    expect(moveSlotIndices.length).toBe(1);
    const moveFrames = script.frames.filter((f) => moveSlotIndices.includes(f.slot));
    expect(moveFrames.length).toBeLessThanOrEqual(3);
    // After step 1, pa is at cell 1 (its final) and holds there.
    expect(moveFrames[0]!.units.some((u) => u.id === 'pa' && u.cell === 1)).toBe(true);
    // In the last frame, pa is still at 1, pb is at 8.
    const last = moveFrames[moveFrames.length - 1]!;
    expect(last.units.some((u) => u.id === 'pa' && u.cell === 1)).toBe(true);
    expect(last.units.some((u) => u.id === 'pb' && u.cell === 8)).toBe(true);
  });

  it('fog still holds: wholly-fogged enemy move in a concurrent run contributes no slot', () => {
    // Player infantry at 0 (vision 2, sees 0..2). Two AI units move:
    //   - one wholly beyond vision (cells 6→8) — must be silent
    //   - one crossing into vision (cells 4→1) — must generate a move beat
    // The silent mover must NOT get its own slot.
    const units = [makeUnit('pi', 0, 0), makeUnit('a1', 1, 6, 'ranger'), makeUnit('a2', 1, 4, 'ranger')];
    const events: ResolutionEvent[] = [
      { type: 'move', unitId: 'a1', from: 6, to: 8, pathTaken: [7, 8] },
      { type: 'move', unitId: 'a2', from: 4, to: 1, pathTaken: [3, 2, 1] },
    ];
    const script = build(units, events, 12);
    // Only one slot: for the partially-visible mover; the wholly-fogged one is silent.
    expect(script.slots.filter((s) => s.kind === 'move').length).toBe(1);
    // a1 ends at 8 (applied silently), never appears in frames.
    for (const f of script.frames) {
      expect(f.units.some((u) => u.id === 'a1')).toBe(false);
    }
  });

  it('a single mover still works correctly after the refactor', () => {
    // Regression: single-mover case should still emit sequential step frames.
    const units = [makeUnit('pi', 0, 0)];
    const events: ResolutionEvent[] = [
      { type: 'move', unitId: 'pi', from: 0, to: 2, pathTaken: [1, 2] },
    ];
    const script = build(units, events, 12);
    expect(script.slots.filter((s) => s.kind === 'move').length).toBe(1);
    const moveFrames = script.frames.filter((f) => script.slots[f.slot]?.kind === 'move');
    // 2 steps = 2 move frames.
    expect(moveFrames.length).toBe(2);
    // Camera follows the mover cell-by-cell.
    expect(moveFrames[0]!.focus).toContain(1);
    expect(moveFrames[1]!.focus).toContain(2);
  });
});

describe('replay builder — concurrent combat (Phase 4.2)', () => {
  it('two independent visible attacks produce at least one frame with ≥2 arcs', () => {
    // Two independent attacks in sequence — should be grouped into a combined frame.
    // Player infantry at 0 attacks enemy at 3; player ranger at 5 attacks enemy at 7.
    const units = [
      makeUnit('pa', 0, 0),
      makeUnit('pb', 0, 5, 'ranger'),
      makeUnit('e1', 1, 3),
      makeUnit('e2', 1, 7),
    ];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'pa',
        defenderId: 'e1',
        attackerCell: 0,
        defenderCell: 3,
        damage: 5,
        bonusB: 0,
        defenderCountAfter: 5,
        counterFired: false,
        breakdown: bd({ damage: 5 }),
      },
      {
        type: 'attack',
        attackerId: 'pb',
        defenderId: 'e2',
        attackerCell: 5,
        defenderCell: 7,
        damage: 4,
        bonusB: 0,
        defenderCountAfter: 6,
        counterFired: false,
        breakdown: bd({ damage: 4 }),
      },
    ];
    const script = build(units, events, 12);
    const volleyFrames = script.frames.filter((f) => script.slots[f.slot]?.kind === 'volley');
    // At least one frame carries ≥2 arcs (concurrent).
    expect(volleyFrames.some((f) => f.arcs.length >= 2)).toBe(true);
    // Far fewer volley frames than sequential (sequential = 2 frames, concurrent ≤ 1 or 2).
    expect(volleyFrames.length).toBeLessThan(3);
    // Both damages should appear in the summary.
    expect(script.summary.damageDealt[0]).toBe(9);
  });

  it('mist strike in a concurrent run: no arc, impact floater with mist=true, attacker withheld', () => {
    // Player infantry at 0 (vision 2, sees 0..2). Enemy artillery at 6 (art has vision 1)
    // fires at player infantry at 0. A second player attack happens simultaneously.
    // Cell layout: 0-1-2-3-4-5-6-7-8-9-10-11
    // Player infantry at 0 sees 0..2; artillery at 6 is completely fogged.
    // Player ranger at 0 also (same cell as pi, so vision union still only 0..2 for infantry
    // — actually ranger at 0 has vision 3: sees 0..3). Still, cell 6 is beyond vision 3
    // from cell 0 on a line board (0+3=3), so cell 6 is fogged.
    // We use a player sniper at 0 (vision 4 → sees 0..4) to attack enemy at 3,
    // keeping the artillery at 6 beyond vision.
    const units = [
      makeUnit('pi', 0, 0),          // infantry at 0, vision 2 → sees 0..2
      makeUnit('ps', 0, 0, 'sniper'), // sniper at 0, vision 4 → sees 0..4
      makeUnit('aa', 1, 6, 'artillery'), // AI artillery at 6, beyond vision (6 > 4)
      makeUnit('e2', 1, 3),           // AI infantry at 3 (visible to sniper)
    ];
    const events: ResolutionEvent[] = [
      // Mist strike: artillery at 6 fires at infantry at 0 (defender visible, attacker fogged)
      {
        type: 'attack',
        attackerId: 'aa',
        defenderId: 'pi',
        attackerCell: 6,
        defenderCell: 0,
        damage: 3,
        bonusB: 0,
        defenderCountAfter: 7,
        counterFired: false,
        breakdown: bd({ damage: 3 }),
      },
      // Concurrent player strike: sniper at 0 attacks enemy at 3
      {
        type: 'attack',
        attackerId: 'ps',
        defenderId: 'e2',
        attackerCell: 0,
        defenderCell: 3,
        damage: 5,
        bonusB: 0,
        defenderCountAfter: 5,
        counterFired: false,
        breakdown: bd({ damage: 5 }),
      },
    ];
    const script = build(units, events, 12);
    const volleyFrames = script.frames.filter((f) => script.slots[f.slot]?.kind === 'volley');
    // Mist strike must produce a floater with mist=true and no arc from cell 6.
    const mistFloater = volleyFrames
      .flatMap((f) => f.floaters)
      .find((fl) => fl.mist);
    expect(mistFloater).toBeDefined();
    const arcFromMistCell = volleyFrames.flatMap((f) => f.arcs).find((a) => a.from === 6);
    expect(arcFromMistCell).toBeUndefined();
    // Artillery unit itself must not appear in rendered units.
    for (const f of volleyFrames) {
      expect(f.units.some((u) => u.id === 'aa')).toBe(false);
    }
    // §7 regression: the FIRST shown strike is the mist one — it owns the slot
    // glyph, so the chip must stay anonymous even though a later visible sniper
    // strike shares the combined volley. (Guards the firstAttSet sentinel: a
    // null firstAttType from a mist strike must NOT let the sniper hijack it.)
    const volleySlot = script.slots.find((s) => s.kind === 'volley');
    expect(volleySlot?.actorType).toBeNull();
    expect(volleySlot?.actorFaction).toBeNull();
  });

  it('concurrent group preserves all strike data for breakdown modal', () => {
    // Both strikes must be present on slots so the breakdown modal can open them.
    const units = [
      makeUnit('pa', 0, 0),
      makeUnit('pb', 0, 5, 'ranger'),
      makeUnit('e1', 1, 3),
      makeUnit('e2', 1, 7),
    ];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'pa',
        defenderId: 'e1',
        attackerCell: 0,
        defenderCell: 3,
        damage: 5,
        bonusB: 0,
        defenderCountAfter: 5,
        counterFired: false,
        breakdown: bd({ damage: 5 }),
      },
      {
        type: 'attack',
        attackerId: 'pb',
        defenderId: 'e2',
        attackerCell: 5,
        defenderCell: 7,
        damage: 4,
        bonusB: 0,
        defenderCountAfter: 6,
        counterFired: false,
        breakdown: bd({ damage: 4 }),
      },
    ];
    const script = build(units, events, 12);
    // All strikes across all volley slots should be present for the breakdown modal.
    const allStrikes = script.slots.filter((s) => s.kind === 'volley').flatMap((s) => s.strikes);
    expect(allStrikes.length).toBe(2);
    expect(allStrikes.map((s) => s.attackerId).sort()).toEqual(['pa', 'pb']);
    expect(allStrikes.every((s) => s.breakdown !== undefined)).toBe(true);
  });

  it('kills in a concurrent combat group apply correctly, dead units excluded from later frames', () => {
    // Two attacks, one kills. The killed unit should not appear after the combat.
    const units = [makeUnit('pa', 0, 0), makeUnit('pb', 0, 5, 'ranger'), makeUnit('e1', 1, 3), makeUnit('e2', 1, 7)];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'pa',
        defenderId: 'e1',
        attackerCell: 0,
        defenderCell: 3,
        damage: 10,
        bonusB: 0,
        defenderCountAfter: 0,
        counterFired: false,
        breakdown: bd({ damage: 10 }),
      },
      { type: 'kill', unitId: 'e1', cell: 3, faction: 1 },
      {
        type: 'attack',
        attackerId: 'pb',
        defenderId: 'e2',
        attackerCell: 5,
        defenderCell: 7,
        damage: 3,
        bonusB: 0,
        defenderCountAfter: 7,
        counterFired: false,
        breakdown: bd({ damage: 3 }),
      },
    ];
    const script = build(units, events, 12);
    // e1 should be killed and appear in summary.kills.
    expect(script.summary.kills.map((k) => k.id)).toContain('e1');
    // No frame after the kill should include e1.
    const lastFrame = script.frames[script.frames.length - 1]!;
    expect(lastFrame.units.some((u) => u.id === 'e1')).toBe(false);
  });
});
