// AI crossing-awareness (addendum 2026-06-22 §2/§4). The greedy planner is
// aware of the forced-crossing rule: a move whose intended path is estimated
// to cross a visible enemy's likely path is judged by the exact brawl model —
// it AVOIDS a clearly-losing clash (routes around / holds) and SEEKS a clearly
// winning one. Determinism (same view → identical orders) holds, and the
// planner stays pure.
//
// These use synthetic boards so the geometry is exact. The enemy's estimated
// path is the documented heuristic (planner-greedy §2): the shortest movement-
// cost path toward its nearest visible own-unit target, capped at its movement
// budget, plus the trivial stay-put trail [enemyCell].

import { describe, expect, it } from 'vitest';
import type { Order } from '../../src/core/orders';
import type { GameState, UnitInstance } from '../../src/core/types';
import type { Board } from '../../src/board/types';
import { createRng } from '../../src/core/rng';
import { loadUnits } from '../../src/io/data-loader';
import { buildFactionView } from '../../src/ai/view';
import { createGreedyPlanner } from '../../src/ai/planner-greedy';
import { lineBoard, syntheticBoard, makeUnit } from '../core/synthetic';

const types = loadUnits();

function stateOn(board: Board, units: UnitInstance[], round = 1): GameState {
  const map: Record<string, UnitInstance> = {};
  for (const u of units) map[u.id] = u;
  return { round, phase: 'planning', board, units: map, pendingOrders: { 0: [], 1: [] }, rngSeed: 1, log: [] };
}

const moveOf = (orders: Order[], id: string) =>
  orders.find((o): o is Extract<Order, { kind: 'move' }> => o.kind === 'move' && o.unitId === id);

describe('AI crossing-awareness — AVOID a losing forced crossing', () => {
  it('infantry does NOT advance into a heavytank charge lane it would lose; the crossing-blind planner does', () => {
    // A single plains lane 0—1—2—3—4—5—6 with a safe side-branch 1—7.
    //   our infantry (faction 0) at 1, vision 2 — sees the heavytank at 3.
    //   enemy heavytank (faction 1) at 3: its estimated charge toward the
    //     infantry sweeps cells toward cell 1, so the infantry's forward advance
    //     cells lie on that estimate. A brawl infantry(10) vs heavytank(10)
    //     KILLS the infantry. So the crossing-aware planner must refuse the
    //     forward lunge (the lethal crossing); a planner with the avoid weight
    //     disabled walks forward toward the visible enemy.
    const board = syntheticBoard(
      [
        { center: [0, 0] }, // 0
        { center: [1, 0] }, // 1 infantry
        { center: [2, 0] }, // 2
        { center: [3, 0] }, // 3 heavytank
        { center: [4, 0] }, // 4
        { center: [5, 0] }, // 5
        { center: [6, 0] }, // 6
        { center: [1, 1] }, // 7 safe side-branch off cell 1
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 5],
        [5, 6],
        [1, 7],
      ],
    );
    const inf = makeUnit('inf0', 0, 1, 'infantry', 10);
    const htank = makeUnit('ht1', 1, 3, 'heavytank', 10);
    const view = buildFactionView(board, stateOn(board, [inf, htank]), 0, types);
    // Fog-honest: the heuristic only fires on a VISIBLE enemy.
    expect(view.enemies.map((e) => e.id)).toContain('ht1');

    const aware = createGreedyPlanner(); // default crossingAvoid > 0
    const blind = createGreedyPlanner({ crossingAvoid: 0, crossingSeek: 0 });

    const awareMove = moveOf(aware.planOrders(view, createRng(1)), 'inf0');
    const blindMove = moveOf(blind.planOrders(view, createRng(1)), 'inf0');

    const forwardCells = new Set([2, 3, 4]);
    // Crossing-blind: the infantry advances toward the enemy (a forward cell).
    const blindDest = blindMove ? blindMove.path[blindMove.path.length - 1] : 1;
    expect(forwardCells.has(blindDest!)).toBe(true);
    // Crossing-aware: the infantry does NOT lunge onto a lethal-crossing cell.
    const awareDest = awareMove ? awareMove.path[awareMove.path.length - 1] : 1;
    expect(forwardCells.has(awareDest!)).toBe(false);
  });
});

describe('AI crossing-awareness — SEEK vs AVOID flips on the matchup', () => {
  // Identical geometry and identical advance pull (the enemy sits at the same
  // cell in both variants); ONLY the enemy TYPE differs. The crossing-aware
  // planner SEEKS the crossing arm when the forced brawl is winnable and
  // AVOIDS it when the brawl is lethal — isolating the crossing logic from the
  // advance/attack terms, which are constant across the two variants.
  //
  // Board: our unit at 0; objective hub at 5. Two equal arms to it —
  //   arm A: 0—1—2—5 (cell 1 is the crossing cell)
  //   arm B: 0—3—4—5 (clear).
  // Enemy at 6 behind a bend 6—7—1, so its estimated charge toward our unit
  // sweeps onto arm A's cell 1. A friendly sniper spotter at cell 2 keeps the
  // distant enemy inside the fog-honest vision union.
  const mkBoard = (): Board =>
    syntheticBoard(
      [
        { center: [0, 0] }, // 0 our unit
        { center: [1, 1] }, // 1 arm A (crossing cell)
        { center: [2, 1] }, // 2 arm A (spotter sits here)
        { center: [1, -1] }, // 3 arm B
        { center: [2, -1] }, // 4 arm B
        { center: [3, 0] }, // 5 objective hub
        { center: [3, 2] }, // 6 enemy
        { center: [2, 2] }, // 7 enemy bend (adjacent to cell 1)
      ],
      [
        [0, 1],
        [1, 2],
        [2, 5],
        [0, 3],
        [3, 4],
        [4, 5],
        [6, 7],
        [7, 1],
      ],
    );

  it('SEEKS the crossing arm against a weak enemy it would annihilate', () => {
    // Our infantry(10) vs the enemy infantry(3): the forced brawl on the
    // crossing cell is a clean win → take arm A (the crossing arm), not arm B.
    const board = mkBoard();
    const me = makeUnit('me0', 0, 0, 'infantry', 10);
    const spotter = makeUnit('sp0', 0, 2, 'sniper', 1);
    const enemy = makeUnit('en1', 1, 6, 'infantry', 3);
    const view = buildFactionView(board, stateOn(board, [me, spotter, enemy]), 0, types);
    expect(view.enemies.map((e) => e.id)).toContain('en1');

    const move = moveOf(createGreedyPlanner().planOrders(view, createRng(1)), 'me0');
    expect(move).toBeDefined();
    // Heads up the crossing arm (cell 1), never the clear arm (cell 3).
    expect(move!.path).toContain(1);
    expect(move!.path).not.toContain(3);
  });

  it('AVOIDS the same arm against a strong enemy it would lose to', () => {
    // Same board, same enemy cell — only the type changes to heavytank(10).
    // Our infantry(10) vs heavytank(10) DIES in the forced brawl, so the
    // crossing-aware planner must NOT commit up the crossing arm: it holds (no
    // forward move) or routes onto the clear arm. Either way it does not march
    // onto the lethal crossing cell 1.
    const board = mkBoard();
    const me = makeUnit('me0', 0, 0, 'infantry', 10);
    const spotter = makeUnit('sp0', 0, 2, 'sniper', 1);
    const enemy = makeUnit('en1', 1, 6, 'heavytank', 10);
    const view = buildFactionView(board, stateOn(board, [me, spotter, enemy]), 0, types);
    expect(view.enemies.map((e) => e.id)).toContain('en1');

    const move = moveOf(createGreedyPlanner().planOrders(view, createRng(1)), 'me0');
    const dest = move ? move.path[move.path.length - 1] : 0;
    // The infantry does not end its move on the lethal crossing cell 1.
    expect(dest).not.toBe(1);
  });
});

describe('AI crossing-awareness — determinism', () => {
  it('same view → identical orders with crossing-awareness active', () => {
    const board = lineBoard(Array(7).fill('plains'));
    const inf = makeUnit('inf0', 0, 1, 'infantry', 10);
    const htank = makeUnit('ht1', 1, 3, 'heavytank', 10);
    const view = buildFactionView(board, stateOn(board, [inf, htank]), 0, types);
    const planner = createGreedyPlanner();
    const a = planner.planOrders(view, createRng(99));
    const b = planner.planOrders(view, createRng(99));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
