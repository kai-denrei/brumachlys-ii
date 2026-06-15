// @vitest-environment jsdom
// v1.1 Feature C — pass-through friendlies, end-to-end regression.
//
// Spec §2.5: friendly-occupied cells are traversable mid-path. The core chain
// (pathing → validateOrder → resolver) always honored this; the ACTUAL
// blockers found in play were interaction-level:
//   1. Ghost tokens (a queued friendly move's translucent destination token)
//      render above cells and swallowed taps — opening the friend's order
//      sheet instead of queueing the selected unit's move.
//   2. Tapping a friendly-occupied cell silently DESELECTED the active unit.
// Both fixed in App.tsx; the full required regression is pinned here:
// unit with budget 9, friendly directly between it and an empty cell at
// distance 2 → that far cell is reachable, tinted, orderable, and resolves
// through.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { Board, Cell, CellId, TerrainKey, Vec2 } from '../../src/board/types';
import type { FactionId, GameState, UnitInstance } from '../../src/core/types';
import { useAppStore } from '../../src/state/store';
import { App } from '../../src/App';

afterEach(cleanup);

function lineBoard(n: number, terrains: Partial<Record<number, TerrainKey>> = {}): Board {
  const cells = new Map<CellId, Cell>();
  for (let i = 0; i < n; i++) {
    cells.set(i, {
      id: i,
      center: [i, 0] as Vec2,
      polygon: [
        [i - 0.4, -0.4] as Vec2,
        [i + 0.4, -0.4] as Vec2,
        [i + 0.4, 0.4] as Vec2,
        [i - 0.4, 0.4] as Vec2,
      ],
      neighbors: [i - 1, i + 1].filter((j) => j >= 0 && j < n),
      terrain: terrains[i] ?? 'plains',
    });
  }
  return { cells, seed: 0, donorMapId: 'c-regression', placementAnchors: [0, n - 1] };
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
    pendingMove: null, // v0.9: reset the propose-then-confirm proposal too
    orders: {},
    focus: null,
    notice: null,
    battleLog: [],
  });
}

const s = () => useAppStore.getState();

describe('pass-through friendlies — required regression', () => {
  it('budget 9, friendly at distance 1, empty cell at distance 2: reachable, tinted, orderable, resolves through', () => {
    // a (infantry, budget 9 = 3 plains steps) at 0; friendly f directly
    // between it and the empty cell 2; enemy far away at 7.
    seedBattle([unit('a', 0, 0), unit('f', 0, 1), unit('e', 1, 7)]);
    const { container } = render(<App />);

    // select a
    fireEvent.click(container.querySelector('[data-unit-id="a"]')!);
    expect(s().selectedUnitId).toBe('a');

    // TINTED: the far cell (2) carries a reach tint; the friendly's cell (1)
    // does not (not a legal destination), but cells beyond it do (2, 3).
    const tinted = [...container.querySelectorAll('[data-tint-cell]')].map((el) =>
      Number(el.getAttribute('data-tint-cell')),
    );
    expect(tinted).toContain(2);
    expect(tinted).toContain(3);
    expect(tinted).not.toContain(1);

    // ORDERABLE: v0.9 propose-then-confirm — the FIRST tap proposes (path
    // computed THROUGH the friendly, not yet queued), the SECOND tap on the
    // same dest commits it as a real order. The committed path is unchanged
    // from the pre-v0.9 single-tap behavior; only the confirm step is new.
    fireEvent.click(container.querySelector('[data-cell-id="2"]')!);
    expect(s().pendingMove).toEqual({ unitId: 'a', dest: 2, path: [1, 2] });
    expect(s().orders['a']?.move).toBeUndefined(); // proposed, not queued yet
    fireEvent.click(container.querySelector('[data-cell-id="2"]')!); // confirm
    expect(s().orders['a']?.move?.path).toEqual([1, 2]);
    expect(s().pendingMove).toBeNull();

    // RESOLVES THROUGH: commit; the unit ends on the far cell, no truncation.
    s().commit();
    const game = s().game!;
    expect(game.units['a']!.cell).toBe(2);
    expect(game.units['f']!.cell).toBe(1);
    expect(game.log.some((e) => e.type === 'path-truncated' && e.unitId === 'a')).toBe(false);
  });

  it('ghost-token fix: tapping a friendly ghost with a unit selected proposes (then confirms) the move underneath', () => {
    // f has a queued move ending on cell 2; its ghost token covers that cell.
    // With a selected, a tap landing on the ghost must route to a's move to 2 —
    // NOT open f's order sheet (the pre-v1.1 behavior). v0.9: the ghost tap
    // falls through to onCellTap(2), which now PROPOSES; a second tap confirms.
    seedBattle([unit('a', 0, 0), unit('f', 0, 4), unit('e', 1, 7)]);
    expect(s().tryQueueOrder({ kind: 'move', unitId: 'f', path: [3, 2] }).ok).toBe(true);
    const { container } = render(<App />);
    fireEvent.click(container.querySelector('[data-unit-id="a"]')!);

    const ghost = container.querySelector('[data-ghost-unit-id="f"] .ghost-token')!;
    const ghostTarget = () =>
      container.querySelector('[data-ghost-unit-id="f"] .ghost-token [data-unit-id]') ?? ghost;
    fireEvent.click(ghostTarget()); // first tap → propose a:[1,2]
    expect(s().pendingMove).toEqual({ unitId: 'a', dest: 2, path: [1, 2] });
    expect(s().orders['a']?.move).toBeUndefined();
    // No order sheet opened for f at any point.
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    fireEvent.click(container.querySelector('[data-cell-id="2"]')!); // confirm
    expect(s().orders['a']?.move?.path).toEqual([1, 2]);
    expect(s().selectedUnitId).toBe('a');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('ghost tap with NOTHING selected still opens the order sheet (edit affordance kept)', () => {
    seedBattle([unit('f', 0, 4), unit('e', 1, 7)]);
    expect(s().tryQueueOrder({ kind: 'move', unitId: 'f', path: [3, 2] }).ok).toBe(true);
    const { container } = render(<App />);
    const ghost = container.querySelector('[data-ghost-unit-id="f"] .ghost-token')!;
    fireEvent.click(ghost.querySelector('[data-unit-id]') ?? ghost);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('v1.1 vacancy affordance: a vacating friendly tile tints and is orderable by tap', () => {
    seedBattle([unit('a', 0, 0), unit('f', 0, 1), unit('e', 1, 7)]);
    // f queues away → its tile becomes a legal destination for a.
    expect(s().tryQueueOrder({ kind: 'move', unitId: 'f', path: [2] }).ok).toBe(true);
    const { container } = render(<App />);
    fireEvent.click(container.querySelector('[data-unit-id="a"]')!);
    const tinted = [...container.querySelectorAll('[data-tint-cell]')].map((el) =>
      Number(el.getAttribute('data-tint-cell')),
    );
    expect(tinted).toContain(1); // the vacating tile is tinted now
    // v0.9 propose-then-confirm: tap proposes the move onto the vacating tile
    // (still a move, not a selection-switch — the key point of this regression),
    // a second tap on the same tile commits it.
    fireEvent.click(container.querySelector('[data-cell-id="1"]')!);
    expect(s().pendingMove).toEqual({ unitId: 'a', dest: 1, path: [1] });
    fireEvent.click(container.querySelector('[data-cell-id="1"]')!); // confirm
    expect(s().orders['a']?.move?.path).toEqual([1]); // queued, not selection-switch
  });

  it('tapping a friendly-occupied cell switches selection instead of deselecting', () => {
    seedBattle([unit('a', 0, 0), unit('f', 0, 1), unit('e', 1, 7)]);
    const { container } = render(<App />);
    fireEvent.click(container.querySelector('[data-unit-id="a"]')!);
    expect(s().selectedUnitId).toBe('a');
    // Tap the friendly's CELL polygon (not its token).
    fireEvent.click(container.querySelector('[data-cell-id="1"]')!);
    expect(s().selectedUnitId).toBe('f');
  });
});
