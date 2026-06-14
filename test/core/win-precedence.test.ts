// v0.6 — win-condition precedence pin (operator rule: "if Round Limit is set
// BUT another win condition is met, stop immediately"). The resolver's round-
// end checks must evaluate (a) elimination insta-win and (b) base collapse on
// EVERY round end, taking precedence over (c) round-limit adjudication EVEN ON
// THE LIMIT ROUND ITSELF. Audit result: the conquest branch already orders
// conquest → base-collapse → round-limit (the limit check is gated on
// `!outcome`), and skirmish's else-if chain puts annihilation before its
// fixed ROUND_LIMIT. These tests pin that ordering forever.

import { describe, expect, test } from 'vitest';
import { BASELESS_GRACE, ROUND_LIMIT, resolveRound } from '../../src/core/resolver';
import { weewar } from '../../src/core/combat/weewar';
import { loadUnits } from '../../src/io/data-loader';
import type { FactionId, GameState, UnitInstance } from '../../src/core/types';
import type { Board, CellId } from '../../src/board/types';
import { lineBoard, makeUnit } from './synthetic';

const types = loadUnits();

function baseLine(n: number, baseCells: CellId[]): Board {
  const terrains = Array(n).fill('plains');
  for (const c of baseCells) terrains[c] = 'base';
  return lineBoard(terrains);
}

function conquestState(
  board: Board,
  units: UnitInstance[],
  opts: {
    bases: Record<CellId, FactionId | null>;
    baseless?: Record<FactionId, number>;
    roundLimit?: number | null;
    round: number;
  },
): GameState {
  return {
    round: opts.round,
    phase: 'planning',
    board,
    units: Object.fromEntries(units.map((u) => [u.id, u])),
    pendingOrders: { 0: [], 1: [] },
    rngSeed: 7,
    log: [],
    mode: 'conquest',
    bases: opts.bases,
    credits: { 0: 0, 1: 0 },
    baseless: opts.baseless ?? { 0: 0, 1: 0 },
    roundLimit: opts.roundLimit ?? null,
  };
}

describe('win-condition precedence on the limit round (v0.6 pin)', () => {
  test("conquest insta-win ON the limit round → reason 'conquest', not 'round-limit'", () => {
    const LIMIT = 10;
    const board = baseLine(3, [0]);
    // Faction 1: a 1-count sniper and no bases. Faction 0's adjacent tank
    // kills it in Phase B of round 10 — exactly the limit round. Without
    // precedence the limit adjudication would also fire (f0 has more bases);
    // the reason MUST be the decisive one.
    const state = conquestState(
      board,
      [makeUnit('t', 0, 0, 'tank'), makeUnit('weak', 1, 1, 'sniper', 1)],
      { bases: { 0: 0 }, roundLimit: LIMIT, round: LIMIT },
    );
    const { state: s } = resolveRound(board, state, { 0: [], 1: [] }, types, weewar);
    expect(s.outcome).toEqual({ winner: 0, reason: 'conquest' });
  });

  test("base collapse ON the limit round → reason 'base-collapse', not 'round-limit'", () => {
    const LIMIT = 10;
    const board = baseLine(5, [0]);
    // Faction 1 enters round 10 (the limit round) on its final grace tick.
    // Both win conditions trigger this round end; collapse must win.
    const state = conquestState(
      board,
      [makeUnit('a', 0, 4, 'infantry'), makeUnit('b', 1, 2, 'infantry')],
      {
        bases: { 0: 0 },
        baseless: { 0: 0, 1: BASELESS_GRACE - 1 },
        roundLimit: LIMIT,
        round: LIMIT,
      },
    );
    const { state: s } = resolveRound(
      board,
      state,
      // Keep them from killing each other: the precedence is the subject.
      { 0: [{ kind: 'stance', unitId: 'a', stance: 'hold-fire' }], 1: [{ kind: 'stance', unitId: 'b', stance: 'hold-fire' }] },
      types,
      weewar,
    );
    expect(s.outcome).toEqual({ winner: 0, reason: 'base-collapse' });
  });

  test("conquest insta-win outranks base collapse when both land on the same round end", () => {
    const board = baseLine(3, [0]);
    // Faction 1 loses its last unit this round AND holds zero bases on its
    // final grace tick — both (a) and (b) fire; (a) is checked first.
    const state = conquestState(
      board,
      [makeUnit('t', 0, 0, 'tank'), makeUnit('weak', 1, 1, 'sniper', 1)],
      { bases: { 0: 0 }, baseless: { 0: 0, 1: BASELESS_GRACE - 1 }, round: 5 },
    );
    const { state: s } = resolveRound(board, state, { 0: [], 1: [] }, types, weewar);
    expect(s.outcome).toEqual({ winner: 0, reason: 'conquest' });
  });

  test("round-limit adjudication still fires when NO decisive condition is met on the limit round", () => {
    const LIMIT = 10;
    const board = baseLine(6, [0, 5]);
    const state = conquestState(
      board,
      [makeUnit('a', 0, 1, 'infantry'), makeUnit('b', 1, 4, 'infantry')],
      { bases: { 0: 0, 5: 1 }, roundLimit: LIMIT, round: LIMIT },
    );
    const { state: s } = resolveRound(board, state, { 0: [], 1: [] }, types, weewar);
    expect(s.outcome).toEqual({ winner: null, reason: 'round-limit' });
  });

  test("skirmish: annihilation ON round 40 → 'annihilation', not 'round-limit'", () => {
    const board = lineBoard(['plains', 'plains']);
    const state: GameState = {
      round: ROUND_LIMIT,
      phase: 'planning',
      board,
      units: Object.fromEntries(
        [makeUnit('t', 0, 0, 'tank'), makeUnit('weak', 1, 1, 'sniper', 1)].map((u) => [u.id, u]),
      ),
      pendingOrders: { 0: [], 1: [] },
      rngSeed: 7,
      log: [],
    };
    const { state: s } = resolveRound(board, state, { 0: [], 1: [] }, types, weewar);
    expect(s.outcome).toEqual({ winner: 0, reason: 'annihilation' });
  });
});

describe('v0.9 conquest checkmate — unitless enemy whose bases are all occupied', () => {
  test('enemy with 0 units whose owned base is occupied by ANY of our units (even a non-capturer) loses immediately', () => {
    const board = baseLine(6, [0]); // base at cell 0
    // Faction 1 OWNS base 0 but has no units. Our TANK (armored — cannot
    // capture) sits on base 0, so faction 1 can never spawn there. Checkmate.
    const state = conquestState(board, [makeUnit('tank', 0, 0, 'tank')], {
      bases: { 0: 1 },
      round: 3,
    });
    const { state: s } = resolveRound(board, state, { 0: [], 1: [] }, types, weewar);
    expect(s.outcome).toEqual({ winner: 0, reason: 'conquest' });
  });

  test('does NOT fire while the unitless enemy still owns a FREE base (it can still spawn)', () => {
    const board = baseLine(8, [0, 5, 7]); // enemy bases 0 and 5, ours at 7
    // Faction 1 has 0 units and owns base 0 (occupied by our tank) AND base 5
    // (FREE). It can spawn from base 5 next round, so no immediate loss.
    const state = conquestState(board, [makeUnit('tank', 0, 0, 'tank')], {
      bases: { 0: 1, 5: 1, 7: 0 },
      round: 3,
    });
    const { state: s } = resolveRound(board, state, { 0: [], 1: [] }, types, weewar);
    expect(s.outcome ?? null).toBeNull(); // game continues — enemy can recover
  });
});
