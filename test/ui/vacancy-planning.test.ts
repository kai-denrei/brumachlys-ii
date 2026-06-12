// @vitest-environment jsdom
// v1.1 Feature B, planning side: queueing a move onto a tile being vacated,
// and dependent re-validation when the occupant's move is removed/edited
// (decision: dependents are AUTO-REMOVED with a toast-level notice — see
// settleDependentOrders in state/store.ts).

import { beforeEach, describe, expect, it } from 'vitest';
import type { Board, Cell, CellId, TerrainKey, Vec2 } from '../../src/board/types';
import type { FactionId, GameState, UnitInstance } from '../../src/core/types';
import { useAppStore } from '../../src/state/store';

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
  return { cells, seed: 0, donorMapId: 'b-planning', placementAnchors: [0, n - 1] };
}

function unit(id: string, faction: FactionId, cell: CellId, type = 'infantry'): UnitInstance {
  return { id, type, faction, cell, count: 10, stance: 'aggressive', attackedFrom: [] };
}

function seedBattle(units: UnitInstance[], board = lineBoard(8)) {
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
    notice: null,
    battleLog: [],
  });
}

const s = () => useAppStore.getState();

describe('vacancy moves through the store (v1.1 Feature B)', () => {
  beforeEach(() => seedBattle([unit('a', 0, 0), unit('f', 0, 1), unit('e', 1, 7)]));

  it('rejects ending on a friendly with no queued move; accepts once it vacates', () => {
    expect(s().tryQueueOrder({ kind: 'move', unitId: 'a', path: [1] })).toEqual({
      ok: false,
      reason: 'ends-on-friendly',
    });
    expect(s().tryQueueOrder({ kind: 'move', unitId: 'f', path: [2] }).ok).toBe(true);
    expect(s().tryQueueOrder({ kind: 'move', unitId: 'a', path: [1] }).ok).toBe(true);
    expect(s().orders['a']!.move!.path).toEqual([1]);
  });

  it("removing the occupant's move auto-removes the dependent move and raises a notice", () => {
    s().tryQueueOrder({ kind: 'move', unitId: 'f', path: [2] });
    s().tryQueueOrder({ kind: 'move', unitId: 'a', path: [1] });
    expect(s().notice).toBeNull();

    s().removeUnitOrder('f', 'move');
    expect(s().orders['f']).toBeUndefined();
    expect(s().orders['a']?.move).toBeUndefined(); // dependent dropped
    expect(s().notice?.text).toContain('Infantry move order removed');
  });

  it("REPLACING the occupant's move so it no longer vacates also drops the dependent", () => {
    s().tryQueueOrder({ kind: 'move', unitId: 'f', path: [2] });
    s().tryQueueOrder({ kind: 'move', unitId: 'a', path: [1] });
    // f's move re-targeted to a loop ending back home: no vacancy any more.
    expect(s().tryQueueOrder({ kind: 'move', unitId: 'f', path: [2, 1] }).ok).toBe(true);
    expect(s().orders['a']?.move).toBeUndefined();
    expect(s().notice?.text).toContain('move order removed');
  });

  it('dependent removal cascades down a chain', () => {
    // c→f's cell, a→c's cell: removing f's move strands c, which strands a.
    seedBattle([unit('a', 0, 0), unit('c', 0, 1), unit('f', 0, 2), unit('e', 1, 7)]);
    s().tryQueueOrder({ kind: 'move', unitId: 'f', path: [3] });
    s().tryQueueOrder({ kind: 'move', unitId: 'c', path: [2] });
    s().tryQueueOrder({ kind: 'move', unitId: 'a', path: [1] });
    s().removeUnitOrder('f', 'move');
    expect(s().orders['c']?.move).toBeUndefined();
    expect(s().orders['a']?.move).toBeUndefined();
  });

  it('a swap can be planned via re-edit (queue away, queue the counterpart, re-target)', () => {
    // a at 0, f at 1. Step 1: a → 2... not adjacent; line: a can only step to 1.
    // Plan: f → 2 (away), a → 1 (vacancy), then EDIT f's move to 0 (a's cell,
    // which a is vacating) — the swap closes.
    s().tryQueueOrder({ kind: 'move', unitId: 'f', path: [2] });
    expect(s().tryQueueOrder({ kind: 'move', unitId: 'a', path: [1] }).ok).toBe(true);
    expect(s().tryQueueOrder({ kind: 'move', unitId: 'f', path: [0] }).ok).toBe(true);
    expect(s().orders['a']!.move!.path).toEqual([1]);
    expect(s().orders['f']!.move!.path).toEqual([0]);

    // And it resolves as a clean swap.
    s().commit();
    const game = s().game!;
    expect(game.units['a']!.cell).toBe(1);
    expect(game.units['f']!.cell).toBe(0);
  });
});
