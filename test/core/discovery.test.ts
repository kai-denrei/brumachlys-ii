// E1 discovery fog (conquest addendum §A) — the PREVIEW-OPTIMISM contract,
// end to end through the pure core:
//
//   planning side  — reachable/cost previews and validateOrder derive paths
//                    against the faction's BELIEVED terrain: dark cells are
//                    assumed optimistic plains (cost 3), memory cells use
//                    their remembered (true) terrain. The overlay never leaks
//                    unscouted terrain — a hidden mountain looks reachable.
//   resolver side  — execution re-paths against TRUTH and truncates with the
//                    existing 'invalid-step' machinery when the optimism was
//                    wrong. Resolver semantics are UNCHANGED (it never takes
//                    an assumedTerrain).
//
// Real unit data; synthetic line boards.

import { describe, expect, test } from 'vitest';
import { assumedTerrainView } from '../../src/core/fog';
import { validateOrder } from '../../src/core/orders';
import type { OrderContext } from '../../src/core/orders';
import { findPath, movementCostsFor, reachableCells } from '../../src/core/pathing';
import { resolveRound } from '../../src/core/resolver';
import { weewar } from '../../src/core/combat/weewar';
import { loadUnits } from '../../src/io/data-loader';
import type { Board } from '../../src/board/types';
import type { GameState, ResolutionEvent, UnitInstance } from '../../src/core/types';
import { lineBoard, makeUnit } from './synthetic';

const types = loadUnits();
const tank = types.tank!; // mountains/water impassable (99), plains 3, move 12

// 0:plains 1:plains 2:mountains 3:plains — the mountain at 2 is the surprise.
const hiddenMountain = (): Board => lineBoard(['plains', 'plains', 'mountains', 'plains']);

function makeState(board: Board, units: UnitInstance[]): GameState {
  return {
    round: 1,
    phase: 'planning',
    board,
    units: Object.fromEntries(units.map((u) => [u.id, u])),
    pendingOrders: { 0: [], 1: [] },
    rngSeed: 7,
    log: [],
  };
}

const ofType = <T extends ResolutionEvent['type']>(events: ResolutionEvent[], type: T) =>
  events.filter((e): e is Extract<ResolutionEvent, { type: T }> => e.type === type);

describe('preview optimism: pathing through the dark', () => {
  const board = hiddenMountain();
  const costs = movementCostsFor(tank);
  // The tank has seen nothing beyond cell 1 — cells 2 and 3 are dark.
  const believed = assumedTerrainView(board, new Set([0, 1]), new Set([0, 1]));

  test('truth-based reach STOPS at the mountain wall (control)', () => {
    const reach = reachableCells(board, costs, 0, tank.movement);
    expect(reach.has(1)).toBe(true);
    expect(reach.has(2)).toBe(false); // impassable in truth
    expect(reach.has(3)).toBe(false); // unreachable behind it
  });

  test('believed-terrain reach extends THROUGH the dark mountain (assumed plains)', () => {
    const reach = reachableCells(board, costs, 0, tank.movement, { assumedTerrain: believed });
    expect(reach.get(2)).toBe(6); // 3 + 3 — optimistic plains cost
    expect(reach.get(3)).toBe(9);
  });

  test('findPath agrees: a path into the dark exists under belief, not under truth', () => {
    expect(findPath(board, costs, 0, 3, { budget: tank.movement })).toBeNull();
    const optimistic = findPath(board, costs, 0, 3, {
      budget: tank.movement,
      assumedTerrain: believed,
    });
    expect(optimistic?.path).toEqual([1, 2, 3]);
    expect(optimistic?.totalCost).toBe(9);
  });

  test('memory beats optimism: a REMEMBERED mountain blocks the preview again', () => {
    const remembered = assumedTerrainView(board, new Set([0, 1, 2]), new Set([0, 1]));
    const reach = reachableCells(board, costs, 0, tank.movement, { assumedTerrain: remembered });
    expect(reach.has(2)).toBe(false); // memory holds the truth
    expect(reach.has(3)).toBe(false);
  });
});

describe('preview optimism: validateOrder admits the plan, the resolver truncates it', () => {
  const board = hiddenMountain();
  const unit = makeUnit('t', 0, 0, 'tank');

  function ctx(over: Partial<OrderContext> = {}): OrderContext {
    return {
      board,
      units: [unit],
      unitTypes: types,
      visible: new Set([0, 1]),
      ...over,
    };
  }

  const order = { kind: 'move' as const, unitId: 't', path: [1, 2, 3] };

  test('without belief (full knowledge) the order is rejected: impassable', () => {
    expect(validateOrder(ctx(), order)).toEqual({ ok: false, reason: 'impassable' });
  });

  test('with the believed-terrain lens the same order queues cleanly', () => {
    const believed = assumedTerrainView(board, new Set([0, 1]), new Set([0, 1]));
    expect(validateOrder(ctx({ assumedTerrain: believed }), order)).toEqual({ ok: true });
  });

  test('the RESOLVER stays truth-based: the move truncates with invalid-step', () => {
    const state = makeState(board, [{ ...unit, attackedFrom: [] }]);
    const { state: after, events } = resolveRound(
      board,
      state,
      { 0: [{ ...order, path: [...order.path] }], 1: [] },
      types,
      weewar,
    );
    // walked the plains step, stopped dead at the mountain
    expect(after.units.t!.cell).toBe(1);
    const trunc = ofType(events, 'path-truncated');
    expect(trunc).toHaveLength(1);
    expect(trunc[0]!.reason).toBe('invalid-step');
    const moves = ofType(events, 'move');
    expect(moves[0]!.pathTaken).toEqual([1]);
  });
});
