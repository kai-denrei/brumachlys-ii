// E2 conquest resolver (conquest addendum §B) — Phase B.5 captures, Phase E
// income + production, win/loss modes, base vision, and determinism. Real
// unit data; synthetic boards. Skirmish bit-identity is guarded by the
// UNTOUCHED pre-E2 suites (resolver/setup/AI acceptance) staying green.

import { describe, expect, test } from 'vitest';
import { BASELESS_GRACE, resolveRound } from '../../src/core/resolver';
import type { BuysByFaction } from '../../src/core/resolver';
import { weewar } from '../../src/core/combat/weewar';
import { loadUnits } from '../../src/io/data-loader';
import type { BuyOrder, Order } from '../../src/core/orders';
import type { FactionId, GameState, ResolutionEvent, UnitInstance } from '../../src/core/types';
import type { Board, CellId } from '../../src/board/types';
import { lineBoard, makeUnit } from './synthetic';

const types = loadUnits();

type ConquestOpts = {
  bases: Record<CellId, FactionId | null>;
  credits?: Record<FactionId, number>;
  baseless?: Record<FactionId, number>;
  roundLimit?: number | null;
  round?: number;
};

function makeConquestState(board: Board, units: UnitInstance[], opts: ConquestOpts): GameState {
  return {
    round: opts.round ?? 1,
    phase: 'planning',
    board,
    units: Object.fromEntries(units.map((u) => [u.id, u])),
    pendingOrders: { 0: [], 1: [] },
    rngSeed: 7,
    log: [],
    mode: 'conquest',
    bases: opts.bases,
    credits: opts.credits ?? { 0: 1000, 1: 1000 },
    baseless: opts.baseless ?? { 0: 0, 1: 0 },
    roundLimit: opts.roundLimit ?? null,
  };
}

function resolve(
  board: Board,
  state: GameState,
  o0: Order[] = [],
  o1: Order[] = [],
  buys?: BuysByFaction,
) {
  return resolveRound(board, state, { 0: o0, 1: o1 }, types, weewar, buys);
}

const ofType = <T extends ResolutionEvent['type']>(events: ResolutionEvent[], type: T) =>
  events.filter((e): e is Extract<ResolutionEvent, { type: T }> => e.type === type);

/** Plains line with `base` terrain at the given cells (terrain is cosmetic to
 * ownership — GameState.bases is authoritative — but keeps boards honest). */
function baseLine(n: number, baseCells: CellId[]): Board {
  const terrains = Array(n).fill('plains');
  for (const c of baseCells) terrains[c] = 'base';
  return lineBoard(terrains);
}

// ── Phase B.5: capture (§B.2) ─────────────────────────────────────────────────

describe('capture (Phase B.5) — opt-in claim consumes the claimant (v0.8)', () => {
  test('personnel ending the round on an ENEMY base flips it + capture event; unit is CONSUMED', () => {
    const board = baseLine(5, [1]);
    const state = makeConquestState(
      board,
      [makeUnit('inf', 0, 0, 'infantry'), makeUnit('far', 1, 4, 'infantry')],
      { bases: { 1: 1 } },
    );
    const { state: s, events } = resolve(board, state, [
      { kind: 'move', unitId: 'inf', path: [1] },
      { kind: 'capture', unitId: 'inf' }, // v0.8: capture is now opt-in
    ]);
    expect(s.bases![1]).toBe(0);
    expect(ofType(events, 'capture')).toEqual([
      { type: 'capture', unitId: 'inf', cell: 1, from: 1, to: 0, unitConsumed: true },
    ]);
    // Consumed, not killed: gone from state, but NO kill event (the UI's
    // dissolve-into-the-flag vs combat death distinction rides on this).
    expect(s.units['inf']).toBeUndefined();
    expect(ofType(events, 'kill')).toHaveLength(0);
  });

  test('personnel on a NEUTRAL base flips it (from: null) and is consumed', () => {
    const board = baseLine(5, [1]);
    const state = makeConquestState(
      board,
      [makeUnit('rgr', 0, 1, 'ranger'), makeUnit('far', 1, 4, 'infantry')],
      { bases: { 1: null } },
    );
    const { state: s, events } = resolve(board, state, [
      { kind: 'capture', unitId: 'rgr' }, // v0.8: capture is now opt-in
    ]);
    expect(s.bases![1]).toBe(0);
    expect(ofType(events, 'capture')).toEqual([
      { type: 'capture', unitId: 'rgr', cell: 1, from: null, to: 0, unitConsumed: true },
    ]);
    expect(s.units['rgr']).toBeUndefined();
    expect(ofType(events, 'kill')).toHaveLength(0);
  });

  test('all four personnel types capture (and are consumed); vehicles never do', () => {
    for (const key of ['infantry', 'ranger', 'sniper', 'grenadier']) {
      const board = baseLine(3, [0]);
      const state = makeConquestState(
        board,
        [makeUnit('u', 0, 0, key), makeUnit('far', 1, 2, 'infantry')],
        { bases: { 0: null } },
      );
      // v0.8: capture is now opt-in; add the order so the claim fires.
      const { state: s } = resolve(board, state, [{ kind: 'capture', unitId: 'u' }]);
      expect(s.bases![0]).toBe(0);
      expect(s.units['u']).toBeUndefined();
    }
    for (const key of ['humvee', 'tank', 'artillery', 'heavytank']) {
      const board = baseLine(3, [0]);
      const state = makeConquestState(
        board,
        [makeUnit('u', 0, 0, key), makeUnit('far', 1, 2, 'infantry')],
        { bases: { 0: null } },
      );
      // Vehicles with a capture order still cannot claim (armorType !== personnel).
      const { state: s, events } = resolve(board, state, [{ kind: 'capture', unitId: 'u' }]);
      expect(s.bases![0]).toBe(null);
      expect(ofType(events, 'capture')).toHaveLength(0);
      expect(s.units['u']).toBeDefined(); // no capture ⇒ no consumption
    }
  });

  test('a unit that DIED this round does not capture', () => {
    const board = baseLine(2, [0]);
    // 1-count infantry sits on the enemy base; adjacent full heavytank kills
    // it in Phase B (auto-attack) before B.5.
    const state = makeConquestState(
      board,
      [makeUnit('weak', 0, 0, 'infantry', 1), makeUnit('ht', 1, 1, 'heavytank')],
      { bases: { 0: 1 } },
    );
    const { state: s, events } = resolve(board, state);
    expect(ofType(events, 'kill').map((k) => k.unitId)).toContain('weak');
    expect(s.bases![0]).toBe(1);
    expect(ofType(events, 'capture')).toHaveLength(0);
  });

  test('own base: no flip, no event, no consumption', () => {
    const board = baseLine(3, [0]);
    const state = makeConquestState(
      board,
      [makeUnit('inf', 0, 0, 'infantry'), makeUnit('far', 1, 2, 'infantry')],
      { bases: { 0: 0 } },
    );
    const { state: s, events } = resolve(board, state);
    expect(s.bases![0]).toBe(0);
    expect(ofType(events, 'capture')).toHaveLength(0);
    expect(s.units['inf']).toBeDefined();
  });

  test('B.5 runs AFTER Phase B combat: the capturer fires its attack first, THEN is consumed', () => {
    const board = baseLine(4, [1]);
    // Sniper moves onto the enemy base at 1 and explicitly attacks the enemy
    // infantry at 2 (range 1 from the base). Phase B: the attack fires.
    // Phase B.5: the sniper flips the base and is consumed.
    const state = makeConquestState(
      board,
      [makeUnit('snp', 0, 0, 'sniper'), makeUnit('inf', 1, 2, 'infantry')],
      { bases: { 1: 1 } },
    );
    const { state: s, events } = resolve(
      board,
      state,
      [
        { kind: 'move', unitId: 'snp', path: [1] },
        { kind: 'attack', unitId: 'snp', targetCell: 2 },
        { kind: 'capture', unitId: 'snp' }, // v0.8: capture is now opt-in
      ],
      [{ kind: 'stance', unitId: 'inf', stance: 'hold-fire' }],
    );
    const attackIdx = events.findIndex((e) => e.type === 'attack');
    const captureIdx = events.findIndex((e) => e.type === 'capture');
    expect(attackIdx).toBeGreaterThanOrEqual(0); // the attack really fired
    expect(captureIdx).toBeGreaterThan(attackIdx); // capture strictly after combat
    expect(ofType(events, 'attack')[0]!.attackerId).toBe('snp');
    expect(s.bases![1]).toBe(0);
    expect(s.units['snp']).toBeUndefined();
  });

  test('a capturer that SURVIVED Phase B fire still flips (then is consumed); accumulator leaves no trace', () => {
    const board = baseLine(3, [0]);
    // Full infantry stands on the enemy base; the adjacent enemy sniper hits
    // it in Phase B (gang-up accumulator gets an entry) but cannot kill a
    // 10-count in one strike. It survives to B.5 → the flip stands, the unit
    // is consumed, and no attackedFrom state lingers (the unit is gone).
    const state = makeConquestState(
      board,
      [makeUnit('inf', 0, 0, 'infantry'), makeUnit('snp', 1, 1, 'sniper')],
      { bases: { 0: 1 } },
    );
    const { state: s, events } = resolve(board, state, [
      { kind: 'stance', unitId: 'inf', stance: 'hold-fire' },
      { kind: 'capture', unitId: 'inf' }, // v0.8: capture is now opt-in
    ]);
    const hits = ofType(events, 'attack').filter((a) => a.defenderId === 'inf');
    expect(hits.length).toBeGreaterThan(0); // it really was shot
    expect(hits[0]!.defenderCountAfter).toBeGreaterThan(0); // ...and survived
    expect(s.bases![0]).toBe(0);
    expect(ofType(events, 'capture')).toEqual([
      { type: 'capture', unitId: 'inf', cell: 0, from: 1, to: 0, unitConsumed: true },
    ]);
    expect(s.units['inf']).toBeUndefined();
    expect(ofType(events, 'kill')).toHaveLength(0);
  });

  test('future-round orders addressed to a consumed unit are dropped silently', () => {
    const board = baseLine(5, [1]);
    const state = makeConquestState(
      board,
      [makeUnit('inf', 0, 1, 'infantry'), makeUnit('far', 1, 4, 'infantry')],
      { bases: { 1: null } },
    );
    const r1 = resolve(board, state, [{ kind: 'capture', unitId: 'inf' }]); // v0.8: opt-in
    expect(r1.state.units['inf']).toBeUndefined(); // consumed in round 1
    // Round 2: orders for the consumed id must be ignored — no move, no
    // attack, no lost-target, nothing referencing it.
    const r2 = resolve(board, r1.state, [
      { kind: 'move', unitId: 'inf', path: [2] },
      { kind: 'attack', unitId: 'inf', targetCell: 4 },
      { kind: 'stance', unitId: 'inf', stance: 'defensive' },
    ]);
    expect(r2.events.some((e) => 'unitId' in e && e.unitId === 'inf')).toBe(false);
    expect(r2.events.some((e) => e.type === 'lost-target' && e.attackerId === 'inf')).toBe(false);
  });

  test('the consumed unit no longer blocks Phase E production on the captured base', () => {
    // Capture vacates the base at B.5, so the OLD owner's queued buy fails
    // 'base-lost' (not 'occupied'), and next round the NEW owner can spawn
    // there — the cell is empty.
    const board = baseLine(4, [1]);
    board.economy = { initialCredits: 0, perBaseCredits: 0 };
    const state = makeConquestState(
      board,
      [makeUnit('rgr', 0, 0, 'ranger'), makeUnit('far', 1, 3, 'infantry')],
      { bases: { 1: 1 }, credits: { 0: 500, 1: 500 } },
    );
    const r1 = resolve(
      board,
      state,
      [
        { kind: 'move', unitId: 'rgr', path: [1] },
        { kind: 'capture', unitId: 'rgr' }, // v0.8: capture is now opt-in
      ],
      [],
      { 0: [], 1: [{ kind: 'buy', baseCell: 1, unitTypeKey: 'infantry' }] },
    );
    expect(r1.state.bases![1]).toBe(0);
    expect(ofType(r1.events, 'spawn-failed')).toEqual([
      { type: 'spawn-failed', cell: 1, faction: 1, unitTypeKey: 'infantry', reason: 'base-lost' },
    ]);
    const r2 = resolve(board, r1.state, [], [], {
      0: [{ kind: 'buy', baseCell: 1, unitTypeKey: 'infantry' }],
      1: [],
    });
    expect(ofType(r2.events, 'spawn')).toHaveLength(1);
    expect(r2.state.units['f0-r2-b1-infantry']).toBeDefined();
  });

  test('skirmish mode emits no conquest events even with units on base terrain', () => {
    const board = baseLine(5, [1]);
    const state: GameState = {
      round: 1,
      phase: 'planning',
      board,
      units: Object.fromEntries(
        [makeUnit('inf', 0, 1, 'infantry'), makeUnit('far', 1, 4, 'infantry')].map((u) => [u.id, u]),
      ),
      pendingOrders: { 0: [], 1: [] },
      rngSeed: 7,
      log: [],
    };
    const { state: s, events } = resolve(board, state, [], [], {
      0: [{ kind: 'buy', baseCell: 1, unitTypeKey: 'infantry' }],
      1: [],
    });
    expect(events.filter((e) => ['capture', 'income', 'spawn', 'spawn-failed'].includes(e.type))).toEqual([]);
    expect(s.bases).toBeUndefined();
    expect(s.credits).toBeUndefined();
    expect(s.mode).toBeUndefined();
  });
});

// ── Phase E: income (§B.3) ────────────────────────────────────────────────────

describe('income (Phase E)', () => {
  test('perBase × bases owned at round end, both factions, creditsAfter carried', () => {
    const board = baseLine(6, [0, 2, 5]);
    board.economy = { initialCredits: 100, perBaseCredits: 75 };
    const state = makeConquestState(
      board,
      [makeUnit('a', 0, 1, 'infantry'), makeUnit('b', 1, 4, 'infantry')],
      { bases: { 0: 0, 2: 0, 5: 1 }, credits: { 0: 10, 1: 20 } },
    );
    const { state: s, events } = resolve(board, state);
    expect(ofType(events, 'income')).toEqual([
      { type: 'income', faction: 0, bases: 2, amount: 150, creditsAfter: 160 },
      { type: 'income', faction: 1, bases: 1, amount: 75, creditsAfter: 95 },
    ]);
    expect(s.credits).toEqual({ 0: 160, 1: 95 });
  });

  test('a base captured THIS round earns income for the new owner', () => {
    const board = baseLine(4, [1]);
    board.economy = { initialCredits: 100, perBaseCredits: 100 };
    const state = makeConquestState(
      board,
      [makeUnit('inf', 0, 1, 'infantry'), makeUnit('far', 1, 3, 'infantry')],
      { bases: { 1: 1 }, credits: { 0: 0, 1: 0 } },
    );
    // v0.8: capture is now opt-in; add the order so the claim fires.
    const { state: s } = resolve(board, state, [{ kind: 'capture', unitId: 'inf' }]);
    expect(s.credits).toEqual({ 0: 100, 1: 0 });
  });

  test('boards without economy data fall back to 100 per base', () => {
    const board = baseLine(4, [0]); // no board.economy
    const state = makeConquestState(
      board,
      [makeUnit('a', 0, 1, 'infantry'), makeUnit('b', 1, 3, 'infantry')],
      { bases: { 0: 0 }, credits: { 0: 0, 1: 0 } },
    );
    expect(resolve(board, state).state.credits![0]).toBe(100);
  });
});

// ── Phase E: production (§B.4) ────────────────────────────────────────────────

describe('production (Phase E)', () => {
  const buy = (baseCell: CellId, unitTypeKey: string): BuyOrder => ({ kind: 'buy', baseCell, unitTypeKey });

  test('spawn on a vacant own base: unit created, credits deducted, event', () => {
    const board = baseLine(5, [0]);
    board.economy = { initialCredits: 100, perBaseCredits: 0 };
    const state = makeConquestState(
      board,
      [makeUnit('a', 0, 1, 'infantry'), makeUnit('b', 1, 4, 'infantry')],
      { bases: { 0: 0 }, credits: { 0: 500, 1: 0 } },
    );
    const { state: s, events } = resolve(board, state, [], [], { 0: [buy(0, 'sniper')], 1: [] });
    const spawned = s.units['f0-r1-b0-sniper'];
    expect(spawned).toMatchObject({
      type: 'sniper',
      faction: 0,
      cell: 0,
      count: 10,
      stance: 'aggressive',
      attackedFrom: [],
    });
    expect(s.credits![0]).toBe(300); // 500 − 200, perBase income 0
    expect(ofType(events, 'spawn')).toEqual([
      { type: 'spawn', unitId: 'f0-r1-b0-sniper', typeKey: 'sniper', cell: 0, faction: 0, creditsAfter: 300 },
    ]);
  });

  test('occupied base (ANY unit, own included) → spawn-failed, credits kept', () => {
    const board = baseLine(5, [0]);
    board.economy = { initialCredits: 100, perBaseCredits: 0 };
    const state = makeConquestState(
      board,
      [makeUnit('squatter', 0, 0, 'infantry'), makeUnit('b', 1, 4, 'infantry')],
      { bases: { 0: 0 }, credits: { 0: 500, 1: 0 } },
    );
    const { state: s, events } = resolve(board, state, [], [], { 0: [buy(0, 'tank')], 1: [] });
    expect(ofType(events, 'spawn-failed')).toEqual([
      { type: 'spawn-failed', cell: 0, faction: 0, unitTypeKey: 'tank', reason: 'occupied' },
    ]);
    expect(s.credits![0]).toBe(500);
    expect(Object.keys(s.units)).toHaveLength(2);
  });

  test('base lost before Phase E → spawn-failed base-lost, credits kept', () => {
    const board = baseLine(4, [1]);
    board.economy = { initialCredits: 100, perBaseCredits: 0 };
    // Faction 1 queues a buy on its base at 1; faction 0's ranger walks in
    // and captures it at B.5 — the buy must fail with no spend.
    const state = makeConquestState(
      board,
      [makeUnit('rgr', 0, 0, 'ranger'), makeUnit('far', 1, 3, 'infantry')],
      { bases: { 1: 1 }, credits: { 0: 0, 1: 400 } },
    );
    const { state: s, events } = resolve(
      board,
      state,
      [
        { kind: 'move', unitId: 'rgr', path: [1] },
        { kind: 'capture', unitId: 'rgr' }, // v0.8: capture is now opt-in
      ],
      [],
      { 0: [], 1: [buy(1, 'tank')] },
    );
    expect(s.bases![1]).toBe(0);
    expect(ofType(events, 'spawn-failed')).toEqual([
      { type: 'spawn-failed', cell: 1, faction: 1, unitTypeKey: 'tank', reason: 'base-lost' },
    ]);
    expect(s.credits![1]).toBe(400);
  });

  test('insufficient credits at Phase E (defensive re-check) → no-credits', () => {
    const board = baseLine(5, [0]);
    board.economy = { initialCredits: 100, perBaseCredits: 0 };
    const state = makeConquestState(
      board,
      [makeUnit('a', 0, 1, 'infantry'), makeUnit('b', 1, 4, 'infantry')],
      { bases: { 0: 0 }, credits: { 0: 50, 1: 0 } }, // below any cost
    );
    const { state: s, events } = resolve(board, state, [], [], { 0: [buy(0, 'heavytank')], 1: [] });
    expect(ofType(events, 'spawn-failed')).toEqual([
      { type: 'spawn-failed', cell: 0, faction: 0, unitTypeKey: 'heavytank', reason: 'no-credits' },
    ]);
    expect(s.credits![0]).toBe(50);
  });

  test('spawns resolve by base cell ascending (determinism rule)', () => {
    const board = baseLine(8, [0, 2, 5, 7]);
    board.economy = { initialCredits: 100, perBaseCredits: 0 };
    const state = makeConquestState(
      board,
      [makeUnit('a', 0, 1, 'infantry'), makeUnit('b', 1, 6, 'infantry')],
      { bases: { 0: 0, 2: 0, 5: 1, 7: 1 }, credits: { 0: 1000, 1: 1000 } },
    );
    const { events } = resolve(board, state, [], [], {
      0: [buy(2, 'infantry'), buy(0, 'ranger')], // deliberately unsorted
      1: [buy(7, 'infantry'), buy(5, 'ranger')],
    });
    expect(ofType(events, 'spawn').map((e) => e.cell)).toEqual([0, 2, 5, 7]);
  });

  test('spawned units act next round (exist at round end, orders resolved before spawn)', () => {
    const board = baseLine(5, [0]);
    board.economy = { initialCredits: 100, perBaseCredits: 0 };
    const state = makeConquestState(
      board,
      [makeUnit('a', 0, 1, 'infantry'), makeUnit('b', 1, 4, 'infantry')],
      { bases: { 0: 0 }, credits: { 0: 100, 1: 0 } },
    );
    const { state: s, events } = resolve(board, state, [], [], { 0: [buy(0, 'infantry')], 1: [] });
    // Spawn event is the last non-game-state event of the round — after every
    // move/attack — and the unit took no action.
    const spawnIdx = events.findIndex((e) => e.type === 'spawn');
    expect(spawnIdx).toBeGreaterThanOrEqual(0);
    expect(events.slice(0, spawnIdx).some((e) => 'unitId' in e && e.unitId === 'f0-r1-b0-infantry')).toBe(false);
    expect(s.units['f0-r1-b0-infantry']).toBeDefined();
    expect(s.phase).toBe('planning'); // game continues; it may act next round
  });
});

// ── Win / loss (§B.5) ─────────────────────────────────────────────────────────

describe('conquest win and loss', () => {
  test('(a) enemy zero units AND zero bases → conquest win', () => {
    const board = baseLine(3, [0]);
    const state = makeConquestState(
      board,
      [makeUnit('t', 0, 0, 'tank'), makeUnit('weak', 1, 1, 'sniper', 1)],
      { bases: { 0: 0 } },
    );
    const { state: s, events } = resolve(board, state);
    expect(s.outcome).toEqual({ winner: 0, reason: 'conquest' });
    expect(s.phase).toBe('over');
    expect(events[events.length - 1]!.type).toBe('game-over');
  });

  test('(a-edge) enemy zero units but still holds a base → game continues', () => {
    const board = baseLine(4, [3]);
    const state = makeConquestState(
      board,
      [makeUnit('t', 0, 0, 'tank'), makeUnit('weak', 1, 1, 'sniper', 1)],
      { bases: { 3: 1 } },
    );
    const { state: s } = resolve(board, state);
    expect(Object.values(s.units).filter((u) => u.faction === 1)).toHaveLength(0);
    expect(s.outcome).toBeUndefined();
    expect(s.phase).toBe('planning');
  });

  test('(b) third consecutive baseless round-end → base collapse loss', () => {
    const board = baseLine(5, [0]);
    const state = makeConquestState(
      board,
      [makeUnit('a', 0, 4, 'infantry'), makeUnit('b', 1, 2, 'infantry')],
      { bases: { 0: 0 }, baseless: { 0: 0, 1: BASELESS_GRACE - 1 } },
    );
    const { state: s } = resolve(board, state);
    expect(s.baseless).toEqual({ 0: 0, 1: BASELESS_GRACE });
    expect(s.outcome).toEqual({ winner: 0, reason: 'base-collapse' });
  });

  test('(b) recapture resets the baseless counter', () => {
    const board = baseLine(4, [1]);
    const state = makeConquestState(
      board,
      [makeUnit('a', 0, 3, 'infantry'), makeUnit('rgr', 1, 0, 'ranger')],
      { bases: { 1: 0 }, baseless: { 0: 0, 1: BASELESS_GRACE - 1 } },
    );
    // Faction 1's ranger takes the base on what would otherwise be its
    // final grace round. v0.8: capture is now opt-in.
    const { state: s } = resolve(board, state, [], [
      { kind: 'move', unitId: 'rgr', path: [1] },
      { kind: 'capture', unitId: 'rgr' },
    ]);
    expect(s.bases![1]).toBe(1);
    expect(s.baseless).toEqual({ 0: 1, 1: 0 }); // faction 0 starts ITS count
    expect(s.outcome).toBeUndefined();
  });

  test('(b) simultaneous collapse → draw', () => {
    const board = baseLine(5, []);
    const state = makeConquestState(
      board,
      [makeUnit('a', 0, 0, 'infantry'), makeUnit('b', 1, 4, 'infantry')],
      { bases: {}, baseless: { 0: BASELESS_GRACE - 1, 1: BASELESS_GRACE - 1 } },
    );
    const { state: s } = resolve(board, state);
    expect(s.outcome).toEqual({ winner: null, reason: 'base-collapse' });
  });

  test('(c) round limit: most bases wins', () => {
    const board = baseLine(6, [0, 2, 5]);
    const state = makeConquestState(
      board,
      [makeUnit('a', 0, 1, 'infantry'), makeUnit('b', 1, 4, 'infantry')],
      { bases: { 0: 0, 2: 0, 5: 1 }, roundLimit: 10, round: 10 },
    );
    const { state: s } = resolve(board, state);
    expect(s.outcome).toEqual({ winner: 0, reason: 'round-limit' });
  });

  test('(c) round limit: equal bases → most total unit count', () => {
    const board = baseLine(6, [0, 5]);
    const state = makeConquestState(
      board,
      [
        makeUnit('a', 0, 1, 'infantry', 10),
        makeUnit('a2', 0, 2, 'infantry', 4),
        makeUnit('b', 1, 4, 'infantry', 10),
      ],
      { bases: { 0: 0, 5: 1 }, roundLimit: 10, round: 10 },
    );
    // Keep them apart: hold-fire everyone so the standoff survives the round.
    const { state: s } = resolve(
      board,
      state,
      [
        { kind: 'stance', unitId: 'a', stance: 'hold-fire' },
        { kind: 'stance', unitId: 'a2', stance: 'hold-fire' },
      ],
      [{ kind: 'stance', unitId: 'b', stance: 'hold-fire' }],
    );
    expect(s.outcome).toEqual({ winner: 0, reason: 'round-limit' });
  });

  test('(c) round limit: equal bases and counts → draw', () => {
    const board = baseLine(6, [0, 5]);
    const state = makeConquestState(
      board,
      [makeUnit('a', 0, 1, 'infantry'), makeUnit('b', 1, 4, 'infantry')],
      { bases: { 0: 0, 5: 1 }, roundLimit: 10, round: 10 },
    );
    const { state: s } = resolve(board, state);
    expect(s.outcome).toEqual({ winner: null, reason: 'round-limit' });
  });

  test('no round limit (null): round 40+ continues — skirmish ROUND_LIMIT does not apply', () => {
    const board = baseLine(6, [0, 5]);
    const state = makeConquestState(
      board,
      [makeUnit('a', 0, 1, 'infantry'), makeUnit('b', 1, 4, 'infantry')],
      { bases: { 0: 0, 5: 1 }, roundLimit: null, round: 60 },
    );
    const { state: s } = resolve(board, state);
    expect(s.outcome).toBeUndefined();
    expect(s.round).toBe(61);
  });

  test('insta-win checked AFTER Phase E: a spawn cannot save a baseless faction, but a base can', () => {
    // Faction 1: no units after combat, no bases → loses even with credits.
    const board = baseLine(3, [0]);
    const state = makeConquestState(
      board,
      [makeUnit('t', 0, 0, 'tank'), makeUnit('weak', 1, 1, 'sniper', 1)],
      { bases: { 0: 0 }, credits: { 0: 0, 1: 9999 } },
    );
    const { state: s } = resolve(board, state, [], [], {
      0: [],
      1: [{ kind: 'buy', baseCell: 0, unitTypeKey: 'infantry' }], // not its base
    });
    expect(s.outcome).toEqual({ winner: 0, reason: 'conquest' });
  });
});

// ── Base vision in combat (§B.1) ──────────────────────────────────────────────

describe('base vision feeds auto-targeting (conquest only)', () => {
  test('artillery (vision 1) auto-attacks an enemy revealed only by an owned base', () => {
    const board = baseLine(5, [3]);
    // artillery at 0, enemy at 2 (distance 2, in range 2–4, outside vision 1).
    // Owned base at 3 sees cell 2 (vision 2) — conquest reveals the target.
    const units = [makeUnit('art', 0, 0, 'artillery'), makeUnit('inf', 1, 2, 'infantry')];
    const conquest = makeConquestState(board, units.map((u) => ({ ...u })), { bases: { 3: 0 } });
    const { events } = resolve(board, conquest, [], [
      { kind: 'stance', unitId: 'inf', stance: 'hold-fire' },
    ]);
    expect(ofType(events, 'attack').map((a) => a.attackerId)).toContain('art');

    // Same situation in skirmish (no bases): the artillery stays blind.
    const skirmish: GameState = {
      round: 1,
      phase: 'planning',
      board,
      units: Object.fromEntries(units.map((u) => [u.id, { ...u, attackedFrom: [] }])),
      pendingOrders: { 0: [], 1: [] },
      rngSeed: 7,
      log: [],
    };
    const { events: skirmishEvents } = resolve(board, skirmish, [], [
      { kind: 'stance', unitId: 'inf', stance: 'hold-fire' },
    ]);
    expect(ofType(skirmishEvents, 'attack').map((a) => a.attackerId)).not.toContain('art');
  });
});

// ── Determinism ───────────────────────────────────────────────────────────────

describe('conquest determinism', () => {
  function busy() {
    const board = baseLine(8, [0, 3, 7]);
    board.economy = { initialCredits: 100, perBaseCredits: 50 };
    const units = [
      makeUnit('a-inf', 0, 1, 'infantry'),
      makeUnit('a-rgr', 0, 2, 'ranger'),
      makeUnit('b-tnk', 1, 6, 'tank'),
      makeUnit('b-grd', 1, 5, 'grenadier'),
    ];
    const o0: Order[] = [
      { kind: 'move', unitId: 'a-rgr', path: [3] },
      { kind: 'capture', unitId: 'a-rgr' }, // v0.8 opt-in: claim the neutral base at cell 3
      { kind: 'move', unitId: 'a-inf', path: [2] },
    ];
    const o1: Order[] = [{ kind: 'move', unitId: 'b-grd', path: [4] }];
    const buys: BuysByFaction = {
      0: [{ kind: 'buy', baseCell: 0, unitTypeKey: 'infantry' }],
      1: [{ kind: 'buy', baseCell: 7, unitTypeKey: 'ranger' }],
    };
    return { board, units, o0, o1, buys };
  }

  test('same state + orders + buys twice → byte-identical logs and states', () => {
    const a = busy();
    const b = busy();
    const sa = makeConquestState(a.board, a.units, { bases: { 0: 0, 3: null, 7: 1 } });
    const sb = makeConquestState(b.board, b.units, { bases: { 0: 0, 3: null, 7: 1 } });
    const ra = resolve(a.board, sa, a.o0, a.o1, a.buys);
    const rb = resolve(b.board, sb, b.o0, b.o1, b.buys);
    expect(JSON.stringify(ra.events)).toBe(JSON.stringify(rb.events));
    expect(JSON.stringify(ra.state.units)).toBe(JSON.stringify(rb.state.units));
    expect(JSON.stringify(ra.state.bases)).toBe(JSON.stringify(rb.state.bases));
    expect(JSON.stringify(ra.state.credits)).toBe(JSON.stringify(rb.state.credits));
  });

  test('input mutation check: resolver never mutates the given state', () => {
    const a = busy();
    const state = makeConquestState(a.board, a.units, { bases: { 0: 0, 3: null, 7: 1 } });
    const before = JSON.stringify({ bases: state.bases, credits: state.credits, baseless: state.baseless });
    resolve(a.board, state, a.o0, a.o1, a.buys);
    expect(
      JSON.stringify({ bases: state.bases, credits: state.credits, baseless: state.baseless }),
    ).toBe(before);
  });
});
