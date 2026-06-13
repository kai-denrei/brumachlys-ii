// @vitest-environment jsdom
// v0.6 Ask 2 — group directives in the store: applyDirective bulk-fills ALL
// units' queues from the ai layer's planDirective (replacing existing
// orders), the chip tracks kind + modified, clear-all/commit reset it, and
// the whole feature degrades to a no-op while the planDirective export is
// missing. The ai module is mocked here: the contract under test is the
// STORE's wiring, not the planner's tactics (those are core-agent tests).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board, Cell, CellId, TerrainKey, Vec2 } from '../../src/board/types';
import type { FactionId, GameState, UnitInstance } from '../../src/core/types';
import type { Order } from '../../src/core/orders';

// planDirective lands per-kind distinguishable plans so the replace semantics
// are observable. Hoisted above the store import by vi.mock.
vi.mock('../../src/ai', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/ai')>();
  return {
    ...mod,
    planDirective: (kind: string): Order[] =>
      kind === 'fortify'
        ? [
            { kind: 'stance', unitId: 'a', stance: 'defensive' },
            { kind: 'stance', unitId: 'b', stance: 'defensive' },
          ]
        : [
            { kind: 'move', unitId: 'a', path: [1] },
            { kind: 'move', unitId: 'b', path: [5] },
          ],
  };
});

import { resolvePlanDirective, useAppStore } from '../../src/state/store';

function lineBoard(n: number, terrains: Partial<Record<number, TerrainKey>> = {}): Board {
  const cells = new Map<CellId, Cell>();
  for (let i = 0; i < n; i++) {
    cells.set(i, {
      id: i,
      center: [i, 0] as Vec2,
      polygon: [[i, 0] as Vec2, [i, 0] as Vec2, [i, 0] as Vec2],
      neighbors: [i - 1, i + 1].filter((j) => j >= 0 && j < n),
      terrain: terrains[i] ?? 'plains',
    });
  }
  return { cells, seed: 0, donorMapId: 'directive-test', placementAnchors: [0, n - 1] };
}

function unit(id: string, faction: FactionId, cell: CellId, type = 'infantry'): UnitInstance {
  return { id, type, faction, cell, count: 10, stance: 'aggressive', attackedFrom: [] };
}

function seedBattle(units: UnitInstance[]) {
  const board = lineBoard(12);
  const game: GameState = {
    round: 1,
    phase: 'planning',
    board,
    units: Object.fromEntries(units.map((u) => [u.id, u])),
    pendingOrders: { 0: [], 1: [] },
    rngSeed: 7,
    log: [],
  };
  useAppStore.setState({
    screen: 'battle',
    board,
    game,
    uiPhase: 'planning',
    replay: null,
    selectedUnitId: null,
    orders: {},
    buys: {},
    directive: null,
    focus: null,
    notice: null,
  });
}

const s = () => useAppStore.getState();

describe('group directives (store)', () => {
  beforeEach(() => seedBattle([unit('a', 0, 0), unit('b', 0, 4), unit('e', 1, 10)]));

  it('resolvePlanDirective finds the (mocked) ai export', () => {
    expect(resolvePlanDirective()).not.toBeNull();
  });

  it('applyDirective bulk-fills ALL units, replacing existing queues', () => {
    s().tryQueueOrder({ kind: 'stance', unitId: 'a', stance: 'hold-fire' });
    s().applyDirective('forward-deploy');
    expect(s().orders.a?.move?.path).toEqual([1]);
    expect(s().orders.b?.move?.path).toEqual([5]);
    expect(s().orders.a?.stance).toBeUndefined(); // REPLACED, not merged
    expect(s().directive).toEqual({ kind: 'forward-deploy', modified: false });
  });

  it('an individual re-order flips the chip to modified (orders stay)', () => {
    s().applyDirective('forward-deploy');
    s().tryQueueOrder({ kind: 'move', unitId: 'a', path: [1, 2] });
    expect(s().directive).toEqual({ kind: 'forward-deploy', modified: true });
    expect(s().orders.a?.move?.path).toEqual([1, 2]);
    expect(s().orders.b?.move?.path).toEqual([5]); // the rest of the fill holds
  });

  it('removing an order also marks modified', () => {
    s().applyDirective('forward-deploy');
    s().removeUnitOrder('b', 'move');
    expect(s().directive?.modified).toBe(true);
  });

  it('undo = re-tap another directive (full replace, chip resets) or clear-all', () => {
    s().applyDirective('forward-deploy');
    s().tryQueueOrder({ kind: 'move', unitId: 'a', path: [1, 2] }); // → modified
    s().applyDirective('fortify');
    expect(s().directive).toEqual({ kind: 'fortify', modified: false });
    expect(s().orders.a?.move).toBeUndefined();
    expect(s().orders.a?.stance?.stance).toBe('defensive');

    s().clearOrders();
    expect(s().orders).toEqual({});
    expect(s().directive).toBeNull();
  });

  it('commit consumes the round and clears the directive chip', () => {
    s().applyDirective('forward-deploy');
    s().commit();
    expect(s().uiPhase).toBe('replay');
    expect(s().directive).toBeNull();
    expect(s().orders).toEqual({});
  });

  it('outside planning applyDirective is a no-op', () => {
    s().applyDirective('forward-deploy');
    s().commit();
    const after = s().orders;
    s().applyDirective('fortify'); // uiPhase is replay — ignored
    expect(s().orders).toBe(after);
    expect(s().directive).toBeNull();
  });
});
