// @vitest-environment jsdom
// P7 planning slice: selection, queue/replace/remove via tryQueueOrder
// (validated against the player's fog-filtered view), ordered count (commit
// gate), centering, convergence detection over the queued orders.
//
// Uses a synthetic board injected via setState — full control over geometry
// and occupancy, no donor generation in the loop.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Board, Cell, CellId, TerrainKey, Vec2 } from '../../src/board/types';
import type { FactionId, GameState, UnitInstance } from '../../src/core/types';
import { findConvergences, orderedUnitIds } from '../../src/core/orders';
import { PLAYER_FACTION, useAppStore } from '../../src/state/store';

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
  return { cells, seed: 0, donorMapId: 'p7-test', placementAnchors: [0, n - 1] };
}

function unit(id: string, faction: FactionId, cell: CellId, type = 'infantry'): UnitInstance {
  return { id, type, faction, cell, count: 10, stance: 'aggressive', attackedFrom: [] };
}

// Infantry vision is 2 — on a 12-cell line, an enemy at cell 10 is hidden
// from a player unit at cell 0, one at cell 2 is visible.
const N = 12;

function seedBattle(units: UnitInstance[]) {
  const board = lineBoard(N);
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
    focus: null,
  });
}

describe('planning slice', () => {
  beforeEach(() => {
    seedBattle([unit('a', 0, 0), unit('b', 0, 4), unit('e-near', 1, 2), unit('e-far', 1, 10)]);
  });

  it('selectUnit / centerOn drive selection and focus token', () => {
    const s = () => useAppStore.getState();
    s().selectUnit('a');
    expect(s().selectedUnitId).toBe('a');
    s().centerOn(4);
    expect(s().focus).toEqual({ cell: 4, token: 1 });
    s().centerOn(4);
    expect(s().focus!.token).toBe(2); // token bumps on every center request
    s().selectUnit(null);
    expect(s().selectedUnitId).toBeNull();
  });

  it('tryQueueOrder validates, queues, and REPLACES same-kind orders', () => {
    const s = () => useAppStore.getState();
    expect(s().tryQueueOrder({ kind: 'move', unitId: 'a', path: [1] }).ok).toBe(true);
    expect(s().orders['a']!.move!.path).toEqual([1]);
    // a new move replaces the queued one (edit semantics, max one per kind)
    expect(s().tryQueueOrder({ kind: 'move', unitId: 'a', path: [1, 2] }).ok).toBe(true);
    expect(s().orders['a']!.move!.path).toEqual([1, 2]);
    expect(s().orders['a']!.attack).toBeUndefined();
    expect(s().orders['a']!.stance).toBeUndefined();
  });

  it('move onto a visible enemy queues as a charge; through it is rejected', () => {
    const s = () => useAppStore.getState();
    const charge = s().tryQueueOrder({ kind: 'move', unitId: 'a', path: [1, 2] });
    expect(charge.ok).toBe(true);
    const through = s().tryQueueOrder({ kind: 'move', unitId: 'a', path: [1, 2, 3] });
    expect(through).toEqual({ ok: false, reason: 'through-enemy' });
    expect(s().orders['a']!.move!.path).toEqual([1, 2]); // rejected order did not replace
  });

  it('hidden enemies are excluded from validation (fog ignores only units)', () => {
    const s = () => useAppStore.getState();
    // e-far at cell 10 is outside every player unit's vision: attacking it is
    // 'target-not-visible', and unit b can path through its cell area freely.
    expect(s().tryQueueOrder({ kind: 'attack', unitId: 'b', targetCell: 10 })).toEqual({
      ok: false,
      reason: 'target-not-visible',
    });
    expect(s().tryQueueOrder({ kind: 'move', unitId: 'b', path: [5, 6, 7] }).ok).toBe(true);
  });

  it('attack validation runs against the player view: visible enemy in range', () => {
    const s = () => useAppStore.getState();
    // b at 4, e-near at 2: distance 2, infantry range 1 → out of range
    expect(s().tryQueueOrder({ kind: 'attack', unitId: 'b', targetCell: 2 })).toEqual({
      ok: false,
      reason: 'out-of-range',
    });
    // queue a move to cell 3 first → planned end distance 1 → valid
    expect(s().tryQueueOrder({ kind: 'move', unitId: 'b', path: [3] }).ok).toBe(true);
    expect(s().tryQueueOrder({ kind: 'attack', unitId: 'b', targetCell: 2 }).ok).toBe(true);
  });

  it('hold-fire / attack mutual exclusion flows through the store', () => {
    const s = () => useAppStore.getState();
    expect(s().tryQueueOrder({ kind: 'move', unitId: 'a', path: [1] }).ok).toBe(true);
    expect(s().tryQueueOrder({ kind: 'attack', unitId: 'a', targetCell: 2 }).ok).toBe(true);
    expect(s().tryQueueOrder({ kind: 'stance', unitId: 'a', stance: 'hold-fire' })).toEqual({
      ok: false,
      reason: 'hold-fire-blocks-attack',
    });
    s().removeUnitOrder('a', 'attack');
    expect(s().tryQueueOrder({ kind: 'stance', unitId: 'a', stance: 'hold-fire' }).ok).toBe(true);
  });

  it('ordered count: commit gate enables at ≥1, players may leave units unordered', () => {
    const s = () => useAppStore.getState();
    expect(orderedUnitIds(s().orders).size).toBe(0);
    s().tryQueueOrder({ kind: 'stance', unitId: 'a', stance: 'defensive' });
    expect(orderedUnitIds(s().orders).size).toBe(1);
    s().tryQueueOrder({ kind: 'move', unitId: 'b', path: [5] });
    expect(orderedUnitIds(s().orders).size).toBe(2);
    s().removeUnitOrder('a', 'stance');
    expect(orderedUnitIds(s().orders).size).toBe(1);
    s().clearOrders();
    expect(orderedUnitIds(s().orders).size).toBe(0);
  });

  it('convergence detection over the queued orders (§9.3 amber flash)', () => {
    const s = () => useAppStore.getState();
    s().tryQueueOrder({ kind: 'move', unitId: 'a', path: [1] });
    s().tryQueueOrder({ kind: 'move', unitId: 'b', path: [3] });
    let conv = findConvergences(s().orders, Object.values(s().game!.units), PLAYER_FACTION);
    expect(conv.size).toBe(0);
    // redirect b onto a's destination
    s().tryQueueOrder({ kind: 'move', unitId: 'b', path: [3, 2, 1] }); // through e-near at 2 → rejected
    s().tryQueueOrder({ kind: 'move', unitId: 'a', path: [1, 2] }); // a charges cell 2
    s().tryQueueOrder({ kind: 'move', unitId: 'b', path: [3, 2] }); // b also ends on cell 2
    conv = findConvergences(s().orders, Object.values(s().game!.units), PLAYER_FACTION);
    expect(conv.get(2)).toEqual(['a', 'b']);
  });

  it('exitBattle clears the planning slice', () => {
    const s = () => useAppStore.getState();
    s().selectUnit('a');
    s().tryQueueOrder({ kind: 'stance', unitId: 'a', stance: 'defensive' });
    s().exitBattle();
    expect(s().selectedUnitId).toBeNull();
    expect(s().orders).toEqual({});
    expect(s().focus).toBeNull();
  });
});
