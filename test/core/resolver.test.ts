// P4 resolver — §13.5 vectors plus the P4 handoff battery: determinism &
// shuffle-invariance, §2.5 movement conflicts, §2.6/§13.4 brawls, §2.7
// combat (fizzle, auto-attack, counter, concentrate fire), gang-up
// accumulation, stance timing, §2.8 win/draw.
//
// Real unit data (data/units.json) so the numeric vectors are the live
// balance numbers; boards are synthetic (geometry helpers only need centers
// and adjacency).

import { describe, expect, test } from 'vitest';
import { resolveRound, ROUND_LIMIT } from '../../src/core/resolver';
import { weewar } from '../../src/core/combat/weewar';
import { loadUnits } from '../../src/io/data-loader';
import type { Order } from '../../src/core/orders';
import type { GameState, ResolutionEvent, UnitInstance } from '../../src/core/types';
import type { Board, Vec2 } from '../../src/board/types';
import { lineBoard, syntheticBoard, makeUnit } from './synthetic';

const types = loadUnits();

function makeState(board: Board, units: UnitInstance[], round = 1): GameState {
  return {
    round,
    phase: 'planning',
    board,
    units: Object.fromEntries(units.map((u) => [u.id, u])),
    pendingOrders: { 0: [], 1: [] },
    rngSeed: 7,
    log: [],
  };
}

function resolve(board: Board, state: GameState, o0: Order[] = [], o1: Order[] = []) {
  return resolveRound(board, state, { 0: o0, 1: o1 }, types, weewar);
}

const ofType = <T extends ResolutionEvent['type']>(events: ResolutionEvent[], type: T) =>
  events.filter((e): e is Extract<ResolutionEvent, { type: T }> => e.type === type);

const plainsLine = (n: number): Board => lineBoard(Array(n).fill('plains'));

// ── determinism (§13.5) ───────────────────────────────────────────────────────

describe('determinism', () => {
  // A busy round: stances, pass-through, same-destination conflict, a charge,
  // explicit + auto attacks.
  function busy() {
    const board = plainsLine(8);
    const units = [
      makeUnit('a-inf', 0, 0, 'infantry'),
      makeUnit('a-rgr', 0, 1, 'ranger'),
      makeUnit('a-snp', 0, 2, 'sniper'),
      makeUnit('b-tnk', 1, 7, 'tank'),
      makeUnit('b-hmv', 1, 6, 'humvee'),
      makeUnit('b-grd', 1, 5, 'grenadier'),
    ];
    const o0: Order[] = [
      { kind: 'stance', unitId: 'a-snp', stance: 'defensive' },
      { kind: 'move', unitId: 'a-inf', path: [1, 2, 3] }, // through friendlies
      { kind: 'move', unitId: 'a-rgr', path: [2, 3] }, // same destination
      { kind: 'attack', unitId: 'a-snp', targetCell: 5 },
    ];
    const o1: Order[] = [
      { kind: 'stance', unitId: 'b-grd', stance: 'hold-fire' },
      { kind: 'move', unitId: 'b-hmv', path: [5, 4, 3] }, // charges whoever claimed 3
      { kind: 'move', unitId: 'b-tnk', path: [6, 5] },
    ];
    return { board, units, o0, o1 };
  }

  test('same state + orders twice → identical JSON event logs', () => {
    const a = busy();
    const b = busy();
    const ra = resolve(a.board, makeState(a.board, a.units), a.o0, a.o1);
    const rb = resolve(b.board, makeState(b.board, b.units), b.o0, b.o1);
    expect(JSON.stringify(ra.events)).toBe(JSON.stringify(rb.events));
    expect(JSON.stringify(ra.state.units)).toBe(JSON.stringify(rb.state.units));
  });

  test('shuffled input order arrays → identical logs', () => {
    const a = busy();
    const b = busy();
    const ra = resolve(a.board, makeState(a.board, a.units), a.o0, a.o1);
    const rb = resolve(
      b.board,
      makeState(b.board, b.units),
      [...b.o0].reverse(),
      [...b.o1].reverse(),
    );
    expect(JSON.stringify(ra.events)).toBe(JSON.stringify(rb.events));
  });

  test('resolveRound does not mutate its input state', () => {
    const { board, units, o0, o1 } = busy();
    const state = makeState(board, units);
    const snapshot = JSON.stringify({ ...state, board: undefined });
    resolve(board, state, o0, o1);
    expect(JSON.stringify({ ...state, board: undefined })).toBe(snapshot);
  });
});

// ── Phase A — movement & §2.5 conflicts ───────────────────────────────────────

describe('Phase A movement', () => {
  test('mid-path hidden enemy → mover stops one cell short (§13.5)', () => {
    const board = plainsLine(5);
    // Ranger vision 3 sees cell 2, but the rule is occupancy-at-execution,
    // not vision — same behaviour either way.
    const state = makeState(board, [makeUnit('a', 0, 0, 'ranger'), makeUnit('b', 1, 2, 'sniper')]);
    const { state: s, events } = resolve(
      board,
      state,
      [
        { kind: 'stance', unitId: 'a', stance: 'hold-fire' },
        { kind: 'move', unitId: 'a', path: [1, 2, 3] },
      ],
      [{ kind: 'stance', unitId: 'b', stance: 'hold-fire' }],
    );
    expect(s.units['a']!.cell).toBe(1);
    expect(ofType(events, 'move')).toEqual([
      { type: 'move', unitId: 'a', from: 0, to: 1, pathTaken: [1] },
    ]);
    expect(ofType(events, 'path-truncated')).toEqual([
      { type: 'path-truncated', unitId: 'a', planned: 3, actual: 1, reason: 'enemy-contact' },
    ]);
    expect(ofType(events, 'brawl-exchange')).toHaveLength(0);
  });

  test('same empty destination: higher initiative claims it, friendly stops one back', () => {
    const board = plainsLine(4);
    // humvee init 12 > ranger init 11 → humvee moves first.
    const state = makeState(board, [makeUnit('h', 0, 3, 'humvee'), makeUnit('r', 0, 0, 'ranger')]);
    const { state: s, events } = resolve(board, state, [
      { kind: 'move', unitId: 'r', path: [1, 2] },
      { kind: 'move', unitId: 'h', path: [2] },
    ]);
    expect(s.units['h']!.cell).toBe(2);
    expect(s.units['r']!.cell).toBe(1);
    const moves = ofType(events, 'move');
    expect(moves.map((m) => m.unitId)).toEqual(['h', 'r']); // initiative order
    expect(ofType(events, 'path-truncated')).toEqual([
      { type: 'path-truncated', unitId: 'r', planned: 2, actual: 1, reason: 'friendly-occupied' },
    ]);
  });

  test('same destination, enemy arrived earlier this Phase A → later mover charges in', () => {
    const board = plainsLine(4);
    const state = makeState(board, [makeUnit('h', 0, 3, 'humvee'), makeUnit('r', 1, 0, 'ranger')]);
    const { events } = resolve(
      board,
      state,
      [{ kind: 'move', unitId: 'h', path: [2] }],
      [{ kind: 'move', unitId: 'r', path: [1, 2] }],
    );
    expect(ofType(events, 'move').map((m) => m.unitId)).toEqual(['h', 'r']);
    expect(ofType(events, 'brawl-exchange').length).toBeGreaterThan(0);
  });

  test('friendly pass-through spends budget; ending past it is fine', () => {
    const board = plainsLine(4);
    const state = makeState(board, [makeUnit('a', 0, 0, 'infantry'), makeUnit('f', 0, 1, 'sniper')]);
    const { state: s } = resolve(board, state, [{ kind: 'move', unitId: 'a', path: [1, 2, 3] }]);
    expect(s.units['a']!.cell).toBe(3); // 3 plains steps = 9 tenths = full budget
    expect(s.units['f']!.cell).toBe(1);
  });

  test('re-validation: non-adjacent path step truncates with invalid-step', () => {
    const board = plainsLine(5);
    const state = makeState(board, [makeUnit('a', 0, 0, 'ranger')]);
    const { state: s, events } = resolve(board, state, [{ kind: 'move', unitId: 'a', path: [2, 3] }]);
    expect(s.units['a']!.cell).toBe(0);
    expect(ofType(events, 'move')).toHaveLength(0);
    expect(ofType(events, 'path-truncated')).toEqual([
      { type: 'path-truncated', unitId: 'a', planned: 3, actual: 0, reason: 'invalid-step' },
    ]);
  });

  test('re-validation: budget exhaustion truncates with reason budget', () => {
    const board = plainsLine(6);
    const state = makeState(board, [makeUnit('a', 0, 0, 'infantry')]); // 9 tenths = 3 plains steps
    const { state: s, events } = resolve(board, state, [
      { kind: 'move', unitId: 'a', path: [1, 2, 3, 4] },
    ]);
    expect(s.units['a']!.cell).toBe(3);
    expect(ofType(events, 'path-truncated')).toEqual([
      { type: 'path-truncated', unitId: 'a', planned: 4, actual: 3, reason: 'budget' },
    ]);
  });
});

// ── Phase A.5 — brawls (§2.6, §13.4) ─────────────────────────────────────────

describe('Phase A.5 brawls', () => {
  test('§13.4: tank charges infantry — full exchange sequence and survivor', () => {
    const board = plainsLine(3);
    const state = makeState(board, [makeUnit('t', 0, 0, 'tank'), makeUnit('i', 1, 2, 'infantry')]);
    // The dead infantry's queued attack must DROP (no event), not fizzle.
    const { state: s, events } = resolve(
      board,
      state,
      [{ kind: 'move', unitId: 't', path: [1, 2] }],
      [{ kind: 'attack', unitId: 'i', targetCell: 0 }],
    );

    // Infantry (init 8) outranks tank (init 6) → infantry is higherInit.
    const brawls = ofType(events, 'brawl-exchange');
    expect(
      brawls.map((b) => [
        b.higherInitDamageDealt,
        b.lowerInitDamageDealt,
        b.higherInitCountAfter,
        b.lowerInitCountAfter,
      ]),
    ).toEqual([
      [4, 5, 5, 6], // exchange 1 leaves 6 (tank) vs 5 (infantry)
      [2, 2, 3, 4],
      [1, 1, 2, 3],
      [1, 1, 1, 2],
      [1, 1, 0, 1], // min-damage floor finishes it; both ticks land together
    ]);
    expect(brawls.every((b) => b.higherInitId === 'i' && b.lowerInitId === 't')).toBe(true);
    expect(brawls.every((b) => b.cell === 2)).toBe(true);
    // Brawls ignore stances: no stance terms in the breakdown (Td is terrain-only).
    expect(brawls[0]!.higherInitBreakdown.Td).toBe(0);

    expect(ofType(events, 'kill')).toEqual([{ type: 'kill', unitId: 'i', cell: 2, faction: 1 }]);
    expect(s.units['i']).toBeUndefined();
    expect(s.units['t']).toMatchObject({ cell: 2, count: 1 }); // survivor keeps the cell

    // Dead unit's queued orders dropped: no attack/lost-target from 'i'.
    expect(ofType(events, 'attack')).toHaveLength(0);
    expect(ofType(events, 'lost-target')).toHaveLength(0);
    expect(s.outcome).toEqual({ winner: 0, reason: 'annihilation' });
  });

  test('charge-into-fog: enemy hidden at destination → brawl occurs (§13.5)', () => {
    const board = plainsLine(4);
    // Vision-2 charger; the defender at distance 3 is fog-hidden at planning
    // time. v0.9: the charger must be a TANK (budget 12) rather than infantry
    // (budget 9) — enemy friction (+1 entering cell 2, which borders the
    // defender on cell 3) now costs the charge 10 of its 12 budget, where an
    // infantry's 9 no longer reaches (3+4+3=10 > 9). The charge-into-fog
    // INTENT is preserved (a fog-hidden enemy at the destination still triggers
    // the §2.6 brawl); friction only means a slower mover can't sprint right up.
    const state = makeState(board, [makeUnit('t', 0, 0, 'tank'), makeUnit('d', 1, 3, 'infantry')]);
    const { events } = resolve(board, state, [{ kind: 'move', unitId: 't', path: [1, 2, 3] }]);
    expect(ofType(events, 'move')).toEqual([
      { type: 'move', unitId: 't', from: 0, to: 3, pathTaken: [1, 2, 3] },
    ]);
    expect(ofType(events, 'brawl-exchange').length).toBeGreaterThan(0);
    expect(ofType(events, 'kill')).toHaveLength(1);
  });

  test('both sides reaching 0 in the same exchange is legal → mutual annihilation draw', () => {
    const board = plainsLine(2);
    const state = makeState(board, [
      makeUnit('a', 0, 0, 'infantry', 1),
      makeUnit('b', 1, 1, 'infantry', 1),
    ]);
    const { state: s, events } = resolve(board, state, [{ kind: 'move', unitId: 'a', path: [1] }]);
    // 1v1 infantry: p=0.5, raw round(0.5)=1 both ways → both die.
    const brawls = ofType(events, 'brawl-exchange');
    expect(brawls).toHaveLength(1);
    expect(brawls[0]!.higherInitCountAfter).toBe(0);
    expect(brawls[0]!.lowerInitCountAfter).toBe(0);
    expect(ofType(events, 'kill')).toHaveLength(2);
    expect(s.outcome).toEqual({ winner: null, reason: 'mutual-annihilation' });
    expect(s.phase).toBe('over');
    expect(events[events.length - 1]).toEqual({
      type: 'game-over',
      outcome: { winner: null, reason: 'mutual-annihilation' },
    });
  });
});

// ── Phase B — combat (§2.7) ───────────────────────────────────────────────────

describe('Phase B combat', () => {
  test('fizzle: target moved out of range → lost-target, no damage (§13.5)', () => {
    const board = plainsLine(7);
    const state = makeState(board, [makeUnit('s', 0, 0, 'sniper'), makeUnit('h', 1, 2, 'humvee')]);
    const { state: s, events } = resolve(
      board,
      state,
      [{ kind: 'attack', unitId: 's', targetCell: 2 }],
      [{ kind: 'move', unitId: 'h', path: [3, 4, 5, 6] }],
    );
    expect(ofType(events, 'lost-target')).toEqual([
      { type: 'lost-target', attackerId: 's', targetCell: 2 },
    ]);
    expect(ofType(events, 'attack')).toHaveLength(0);
    expect(s.units['h']!.count).toBe(10);
  });

  test('gang-up accumulates across Phase B with immediate damage (§5.4 concentrate fire)', () => {
    // Defender tank at the origin; two infantry at bearings 0° and 170°
    // (θ = 170° → opposite, +3). Same init → FNV decides who fires first,
    // but the geometry and damage sequence are symmetric.
    const at = (deg: number): Vec2 => [
      Math.cos((deg * Math.PI) / 180),
      Math.sin((deg * Math.PI) / 180),
    ];
    const board = syntheticBoard(
      [{ center: [0, 0] }, { center: at(0) }, { center: at(170) }],
      [
        [0, 1],
        [0, 2],
      ],
    );
    const state = makeState(board, [
      makeUnit('t', 1, 0, 'tank'),
      makeUnit('i1', 0, 1, 'infantry'),
      makeUnit('i2', 0, 2, 'infantry'),
    ]);
    const { state: s, events } = resolve(
      board,
      state,
      [
        { kind: 'attack', unitId: 'i1', targetCell: 0 },
        { kind: 'attack', unitId: 'i2', targetCell: 0 },
      ],
      [{ kind: 'stance', unitId: 't', stance: 'hold-fire' }], // isolate the B math
    );
    const attacks = ofType(events, 'attack');
    expect(attacks).toHaveLength(2);
    // First attacker: B=0, p=0.40, damage 4 (tank 10 → 6).
    expect(attacks[0]).toMatchObject({ bonusB: 0, damage: 4, defenderCountAfter: 6 });
    expect(attacks[0]!.breakdown).toMatchObject({ A: 3, Ta: 0, D: 5, Td: 0, B: 0, p: 0.4 });
    // Second attacker: prior at θ=170° → opposite +3 → B=3, p=0.55,
    // damage round(min(10, 6) × 0.55) = 3 — the §5.4 vector, fired at the
    // SOFTENED defender (immediate damage).
    expect(attacks[1]).toMatchObject({ bonusB: 3, damage: 3, defenderCountAfter: 3 });
    expect(attacks[1]!.breakdown.p).toBeCloseTo(0.55, 10);
    expect(attacks[1]!.breakdown.gangUp.total).toBe(3);
    expect(attacks[1]!.breakdown.gangUp.contributions.map((c) => [c.cls, c.weight])).toEqual([
      ['opposite', 3],
    ]);
    expect(s.units['t']!.count).toBe(3);
    // attackedFrom accumulators cleared at round end.
    for (const u of Object.values(s.units)) expect(u.attackedFrom).toEqual([]);
  });

  test('counter fires inside the attacker slot and does NOT accumulate gang-up', () => {
    const board = plainsLine(2);
    // Sniper (init 13) fires first; tank counters it. The tank's own slot
    // (init 6) then auto-attacks the sniper — with B = 0, because counters
    // never enter the accumulator.
    const state = makeState(board, [makeUnit('s', 0, 1, 'sniper'), makeUnit('t', 1, 0, 'tank')]);
    const { events } = resolve(board, state, [{ kind: 'attack', unitId: 's', targetCell: 0 }]);
    const attacks = ofType(events, 'attack');
    const counters = ofType(events, 'counter');
    expect(attacks.map((a) => a.attackerId)).toEqual(['s', 't']);
    // sniper → tank: A2 vs D5, p=0.35, damage round(10×0.35)=4; counter 6.
    expect(attacks[0]).toMatchObject({ damage: 4, counterFired: true, defenderCountAfter: 6 });
    expect(counters[0]).toMatchObject({ attackerId: 't', defenderId: 's', damage: 6 });
    expect(counters[0]!.breakdown.B).toBe(0);
    // tank's real attack on the sniper: B must still be 0.
    expect(attacks[1]).toMatchObject({ attackerId: 't', bonusB: 0 });
    // ...and the sniper (aggressive, in range) counters back.
    expect(counters[1]).toMatchObject({ attackerId: 's', defenderId: 't' });
  });

  test('stance orders apply before anything else in the round', () => {
    const board = plainsLine(2);
    const state = makeState(board, [makeUnit('r', 0, 1, 'ranger'), makeUnit('g', 1, 0, 'grenadier')]);
    const { events } = resolve(
      board,
      state,
      [
        { kind: 'attack', unitId: 'r', targetCell: 0 },
        { kind: 'stance', unitId: 'r', stance: 'defensive' },
      ],
      [{ kind: 'stance', unitId: 'g', stance: 'hold-fire' }],
    );
    // Stance events lead the log (init order: ranger 11 before grenadier 7).
    expect(events[0]).toEqual({ type: 'stance', unitId: 'r', stance: 'defensive' });
    expect(events[1]).toEqual({ type: 'stance', unitId: 'g', stance: 'hold-fire' });
    // hold-fire applied THIS round: the grenadier neither counters...
    expect(ofType(events, 'counter')).toHaveLength(0);
    expect(ofType(events, 'attack')[0]).toMatchObject({ attackerId: 'r', counterFired: false });
    // ...nor auto-attacks in its own slot.
    expect(ofType(events, 'attack')).toHaveLength(1);
  });

  test('defensive stance ordered this round adds +1 Td immediately', () => {
    const board = plainsLine(2);
    const state = makeState(board, [makeUnit('i', 0, 1, 'infantry'), makeUnit('t', 1, 0, 'tank')]);
    const { events } = resolve(
      board,
      state,
      [{ kind: 'attack', unitId: 'i', targetCell: 0 }],
      [{ kind: 'stance', unitId: 't', stance: 'defensive' }],
    );
    // infantry vs defensive tank: A3 − (D5 + Td1) → p = 0.40 − 0.05 = 0.35.
    const atk = ofType(events, 'attack').find((a) => a.attackerId === 'i')!;
    expect(atk.breakdown).toMatchObject({ A: 3, D: 5, Td: 1 });
    expect(atk.breakdown.p).toBeCloseTo(0.35, 10);
  });

  test('defensive units do not auto-attack; aggressive units do', () => {
    const board = plainsLine(2);
    const state = makeState(board, [makeUnit('i', 0, 0, 'infantry'), makeUnit('t', 1, 1, 'tank')]);
    const { events } = resolve(board, state, [
      { kind: 'stance', unitId: 'i', stance: 'defensive' },
    ]);
    // Only the tank (aggressive) fires; the infantry counters (defensive counters).
    const attacks = ofType(events, 'attack');
    expect(attacks.map((a) => a.attackerId)).toEqual(['t']);
    expect(ofType(events, 'counter').map((c) => c.attackerId)).toEqual(['i']);
  });

  test('auto-attack picks nearest visible enemy; fog hides farther ones', () => {
    // Heavy tank: vision 1, range 1. An enemy two cells out is invisible AND
    // out of range; only the adjacent one can be auto-attacked.
    const board = plainsLine(3);
    const state = makeState(board, [
      makeUnit('ht', 0, 0, 'heavytank'),
      makeUnit('e1', 1, 1, 'infantry', 3),
      makeUnit('e2', 1, 2, 'infantry', 1),
    ]);
    const { events } = resolve(board, state, [], [
      { kind: 'stance', unitId: 'e1', stance: 'hold-fire' },
      { kind: 'stance', unitId: 'e2', stance: 'hold-fire' },
    ]);
    const ht = ofType(events, 'attack').filter((a) => a.attackerId === 'ht');
    expect(ht).toHaveLength(1);
    expect(ht[0]!.defenderId).toBe('e1');
  });

  test('auto-attack tie-break: lowest count first at equal distance', () => {
    // Defender-side counts differ; both enemies adjacent to the attacker.
    const board = syntheticBoard(
      [{ center: [0, 0] }, { center: [1, 0] }, { center: [-1, 0] }],
      [
        [0, 1],
        [0, 2],
      ],
    );
    const state = makeState(board, [
      makeUnit('r', 0, 0, 'ranger'),
      makeUnit('big', 1, 1, 'infantry', 9),
      makeUnit('small', 1, 2, 'infantry', 4),
    ]);
    const { events } = resolve(board, state, [], [
      { kind: 'stance', unitId: 'big', stance: 'hold-fire' },
      { kind: 'stance', unitId: 'small', stance: 'hold-fire' },
    ]);
    const ranger = ofType(events, 'attack').filter((a) => a.attackerId === 'r');
    expect(ranger[0]!.defenderId).toBe('small');
  });

  test('artillery cannot counter an adjacent attacker (minRange 2)', () => {
    const board = plainsLine(2);
    const state = makeState(board, [makeUnit('r', 0, 0, 'ranger'), makeUnit('art', 1, 1, 'artillery')]);
    const { events } = resolve(board, state, [{ kind: 'attack', unitId: 'r', targetCell: 1 }]);
    const atk = ofType(events, 'attack').find((a) => a.attackerId === 'r')!;
    expect(atk.counterFired).toBe(false);
    expect(ofType(events, 'counter').filter((c) => c.attackerId === 'art')).toHaveLength(0);
  });
});

// ── v0.9 preemptive fire (area denial) ────────────────────────────────────────
// A ranged unit's explicit attack on an EMPTY cell fires at whoever occupies it
// at Phase B (after movement): enemy → hit; empty or friendly → lost-target.
// The resolver needs NO change for this — the explicit-target path already does
// it (enemyAt is enemy-only; a missing/friendly occupant yields lost-target).
// These tests lock that contract in.

describe('preemptive fire: explicit attack on an empty cell', () => {
  test('enemy MOVES onto the targeted empty cell → hit (no lost-target)', () => {
    const board = plainsLine(7);
    // artillery at 0 (range 2-4) preemptively targets empty cell 3; an enemy
    // humvee at 6 moves 6→5→4→3, ending ON cell 3 in Phase A. Distance 0→3 == 3.
    const state = makeState(board, [
      makeUnit('art', 0, 0, 'artillery'),
      makeUnit('h', 1, 6, 'humvee'),
    ]);
    const { state: s, events } = resolve(
      board,
      state,
      [{ kind: 'attack', unitId: 'art', targetCell: 3 }],
      [{ kind: 'move', unitId: 'h', path: [5, 4, 3] }],
    );
    expect(ofType(events, 'lost-target')).toHaveLength(0);
    const attacks = ofType(events, 'attack').filter((a) => a.attackerId === 'art');
    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({ defenderId: 'h' });
    expect(s.units['h']!.count).toBeLessThan(10); // took the hit
  });

  test('cell STAYS empty → fizzle (lost-target), no damage', () => {
    const board = plainsLine(7);
    // No enemy ever reaches cell 3 — the humvee sits at 6.
    const state = makeState(board, [
      makeUnit('art', 0, 0, 'artillery'),
      makeUnit('h', 1, 6, 'humvee'),
    ]);
    const { state: s, events } = resolve(
      board,
      state,
      [{ kind: 'attack', unitId: 'art', targetCell: 3 }],
      [{ kind: 'stance', unitId: 'h', stance: 'hold-fire' }],
    );
    expect(ofType(events, 'lost-target')).toEqual([
      { type: 'lost-target', attackerId: 'art', targetCell: 3 },
    ]);
    expect(ofType(events, 'attack').filter((a) => a.attackerId === 'art')).toHaveLength(0);
    expect(s.units['h']!.count).toBe(10);
  });

  test('FRIENDLY moves onto the targeted cell → fizzle, no friendly fire', () => {
    const board = plainsLine(7);
    // artillery (faction 0) targets empty cell 3; a FRIENDLY ranger (faction 0)
    // moves onto cell 3. enemyAt(3, 0) finds no enemy → lost-target, no hit.
    const state = makeState(board, [
      makeUnit('art', 0, 0, 'artillery'),
      makeUnit('r', 0, 6, 'ranger'),
    ]);
    const { state: s, events } = resolve(
      board,
      state,
      [
        { kind: 'attack', unitId: 'art', targetCell: 3 },
        { kind: 'move', unitId: 'r', path: [5, 4, 3] },
      ],
    );
    expect(ofType(events, 'lost-target')).toEqual([
      { type: 'lost-target', attackerId: 'art', targetCell: 3 },
    ]);
    expect(ofType(events, 'attack').filter((a) => a.attackerId === 'art')).toHaveLength(0);
    expect(s.units['r']!.count).toBe(10); // friendly untouched
  });

  test('UNDAMAGEABLE enemy moves onto the targeted cell → fizzle, NO attack, NO counter', () => {
    // Fix (v0.9): the explicit-target path must gate on attackStrengths at fire
    // time, exactly like pickAutoTarget. Artillery deals 0 to 'air' armor; if an
    // aircraft moves onto the preemptively-targeted cell, the shot can't hurt it,
    // so it must fizzle (lost-target) rather than fire for 0 and eat a counter.
    const board = plainsLine(7);
    // Synthetic 'aircraft' target: armorType 'air' (artillery's attackStrengths
    // ['air'] === 0). Clone artillery's terrainEffects so it's a valid type; it
    // can counter (nonzero attackStrengths) — proving NO counter is eaten.
    const artType = types['artillery']!;
    const aircraft: typeof artType = {
      ...artType,
      key: 'aircraft',
      name: 'Aircraft',
      armorType: 'air',
      minRange: 1,
      maxRange: 1,
      attackStrengths: { personnel: 6, armored: 6, naval: 0, air: 0 },
    };
    const testTypes = { ...types, aircraft };
    const state = makeState(board, [
      makeUnit('art', 0, 0, 'artillery'),
      { ...makeUnit('plane', 1, 6, 'aircraft'), count: 10 },
    ]);
    // art targets empty cell 3; the aircraft moves 6→5→4→3, ending ON cell 3.
    const { state: s, events } = resolveRound(
      board,
      state,
      { 0: [{ kind: 'attack', unitId: 'art', targetCell: 3 }], 1: [{ kind: 'move', unitId: 'plane', path: [5, 4, 3] }] },
      testTypes,
      weewar,
    );
    // Fizzle: a lost-target on cell 3, NO attack from art, and (critically) NO
    // counter — neither side took damage.
    expect(ofType(events, 'lost-target')).toEqual([
      { type: 'lost-target', attackerId: 'art', targetCell: 3 },
    ]);
    expect(ofType(events, 'attack').filter((a) => a.attackerId === 'art')).toHaveLength(0);
    expect(ofType(events, 'counter')).toHaveLength(0);
    expect(s.units['art']!.count).toBe(10); // attacker ate no counter
    expect(s.units['plane']!.count).toBe(10); // undamageable target untouched
  });
});

// ── §2.8 win / draw ───────────────────────────────────────────────────────────

describe('win and draw detection', () => {
  test('annihilation: last enemy unit killed → winner, phase over', () => {
    const board = plainsLine(2);
    const state = makeState(board, [makeUnit('t', 0, 0, 'tank'), makeUnit('s', 1, 1, 'sniper', 1)]);
    const { state: s, events } = resolve(board, state);
    expect(s.outcome).toEqual({ winner: 0, reason: 'annihilation' });
    expect(s.phase).toBe('over');
    expect(ofType(events, 'kill').map((k) => k.unitId)).toContain('s');
    expect(events[events.length - 1]!.type).toBe('game-over');
  });

  test(`round ${ROUND_LIMIT} reached with both alive → draw (the mist settles)`, () => {
    const board = plainsLine(5);
    const state = makeState(
      board,
      [makeUnit('a', 0, 0, 'infantry'), makeUnit('b', 1, 4, 'infantry')],
      ROUND_LIMIT,
    );
    const { state: s, events } = resolve(board, state);
    expect(s.outcome).toEqual({ winner: null, reason: 'round-limit' });
    expect(s.phase).toBe('over');
    expect(events[events.length - 1]).toEqual({
      type: 'game-over',
      outcome: { winner: null, reason: 'round-limit' },
    });
  });

  test(`round ${ROUND_LIMIT - 1} with both alive → game continues`, () => {
    const board = plainsLine(5);
    const state = makeState(
      board,
      [makeUnit('a', 0, 0, 'infantry'), makeUnit('b', 1, 4, 'infantry')],
      ROUND_LIMIT - 1,
    );
    const { state: s } = resolve(board, state);
    expect(s.outcome).toBeUndefined();
    expect(s.phase).toBe('planning');
    expect(s.round).toBe(ROUND_LIMIT);
  });
});

// ── v0.9 ENEMY FRICTION (movement friction near enemies) ──────────────────────
//
// A move PLANNED against no/visible enemies truncates at resolution when the
// ACTUAL (incl. hidden) enemies add friction over budget; an open-field move is
// unchanged; the truncation emits the distinct 'enemy-friction' reason.
describe('movement friction near enemies (resolver Phase A)', () => {
  /** Lane 0—1—2—3—4 with a side cell 5 attached to lane cell `besideCell`. An
   *  enemy parked on cell 5 borders that lane cell. */
  function laneWithSide(besideCell: number): Board {
    const specs: { center: Vec2; terrain: 'plains' }[] = [
      { center: [0, 0], terrain: 'plains' }, // 0
      { center: [1, 0], terrain: 'plains' }, // 1
      { center: [2, 0], terrain: 'plains' }, // 2
      { center: [3, 0], terrain: 'plains' }, // 3
      { center: [4, 0], terrain: 'plains' }, // 4
      { center: [besideCell, 1], terrain: 'plains' }, // 5 (beside `besideCell`)
    ];
    const edges: [number, number][] = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [5, besideCell],
    ];
    return syntheticBoard(specs, edges);
  }

  test('open-field walk is unchanged: infantry completes 0→3 (cost 9)', () => {
    const board = laneWithSide(3); // side cell exists but is EMPTY
    const state = makeState(board, [makeUnit('a', 0, 0, 'infantry')]);
    const { state: s, events } = resolve(board, state, [
      { kind: 'move', unitId: 'a', path: [1, 2, 3] },
    ]);
    expect(s.units['a']!.cell).toBe(3);
    expect(ofType(events, 'path-truncated')).toHaveLength(0);
  });

  test('a hidden enemy bordering the destination truncates with enemy-friction', () => {
    // Enemy on cell 5, adjacent to lane cell 3. Infantry budget 9. Entering
    // 1 (3) → 2 (3) → leaves budget 3; entering 3 = terrain 3 (fits) + friction
    // 1 = 4 > 3 → truncate AT cell 2, reason 'enemy-friction'.
    const board = laneWithSide(3);
    const state = makeState(board, [
      makeUnit('a', 0, 0, 'infantry'),
      makeUnit('e', 1, 5, 'infantry'),
    ]);
    const { state: s, events } = resolve(board, state, [
      { kind: 'move', unitId: 'a', path: [1, 2, 3] },
    ]);
    expect(s.units['a']!.cell).toBe(2); // stopped one short of the friction cell
    const tr = ofType(events, 'path-truncated');
    expect(tr).toHaveLength(1);
    expect(tr[0]!.reason).toBe('enemy-friction');
    expect(tr[0]!.planned).toBe(3);
    expect(tr[0]!.actual).toBe(2);
  });

  test("a pure terrain-budget halt still reports 'budget', not 'enemy-friction'", () => {
    // Long plains lane, no enemy: infantry runs out of budget on terrain alone.
    const board = plainsLine(6);
    const state = makeState(board, [makeUnit('a', 0, 0, 'infantry')]);
    const { events } = resolve(board, state, [
      { kind: 'move', unitId: 'a', path: [1, 2, 3, 4] }, // cost 12 > 9
    ]);
    const tr = ofType(events, 'path-truncated');
    expect(tr).toHaveLength(1);
    expect(tr[0]!.reason).toBe('budget');
  });

  test('friction is deterministic: identical inputs → identical logs', () => {
    const board = laneWithSide(3);
    const mk = () =>
      resolve(
        board,
        makeState(board, [makeUnit('a', 0, 0, 'infantry'), makeUnit('e', 1, 5, 'infantry')]),
        [{ kind: 'move', unitId: 'a', path: [1, 2, 3] }],
      );
    expect(JSON.stringify(mk().events)).toBe(JSON.stringify(mk().events));
  });
});

// ── hygiene ───────────────────────────────────────────────────────────────────

describe('order hygiene', () => {
  test("orders addressing the other faction's units are ignored", () => {
    const board = plainsLine(3);
    const state = makeState(board, [makeUnit('a', 0, 0, 'infantry'), makeUnit('b', 1, 2, 'infantry')]);
    // Faction 0 tries to move faction 1's unit.
    const { state: s, events } = resolve(board, state, [{ kind: 'move', unitId: 'b', path: [1] }]);
    expect(s.units['b']!.cell).toBe(2);
    expect(ofType(events, 'move')).toHaveLength(0);
  });

  test('orders for unknown units are ignored', () => {
    const board = plainsLine(2);
    const state = makeState(board, [makeUnit('a', 0, 0, 'infantry', 10)]);
    expect(() =>
      resolve(board, state, [
        { kind: 'move', unitId: 'ghost', path: [1] },
        { kind: 'attack', unitId: 'ghost', targetCell: 1 },
        { kind: 'stance', unitId: 'ghost', stance: 'defensive' },
      ]),
    ).not.toThrow();
  });
});
