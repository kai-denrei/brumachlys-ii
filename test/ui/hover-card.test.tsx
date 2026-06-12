// @vitest-environment jsdom
// v1.1 Feature A — unit hover cards: mouse-only (~250 ms delay), compact
// stats card near the token, dismissed on tap/leave; touch behavior unchanged.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { Board, Cell, CellId, TerrainKey, Vec2 } from '../../src/board/types';
import type { FactionId, GameState, UnitInstance } from '../../src/core/types';
import { useAppStore } from '../../src/state/store';
import { App } from '../../src/App';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => vi.useFakeTimers());

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
  return { cells, seed: 0, donorMapId: 'hover-test', placementAnchors: [0, n - 1] };
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

describe('unit hover cards (mouse only)', () => {
  it('shows a compact stats card ~250 ms after a mouse hover on an own token', () => {
    seedBattle([unit('a', 0, 0, 'humvee'), unit('e', 1, 2, 'tank')]);
    const { container, baseElement } = render(<App />);
    fireEvent.pointerOver(container.querySelector('[data-unit-id="a"]')!, {
      pointerType: 'mouse',
    });
    expect(baseElement.querySelector('[data-testid="unit-hover-card"]')).toBeNull();
    act(() => vi.advanceTimersByTime(260));
    const card = baseElement.querySelector('[data-testid="unit-hover-card"]')!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('Humvee');
    expect(card.textContent).toContain('initiative');
    expect(card.textContent).toContain('armor');
    expect(card.textContent).toContain('vision');
    expect(card.textContent).toContain('atk vs pers / arm');
  });

  it("shows VISIBLE enemy units' cards too", () => {
    seedBattle([unit('a', 0, 0), unit('e', 1, 2, 'tank')]); // infantry vision 2 sees cell 2
    const { container, baseElement } = render(<App />);
    fireEvent.pointerOver(container.querySelector('[data-unit-id="e"]')!, {
      pointerType: 'mouse',
    });
    act(() => vi.advanceTimersByTime(260));
    expect(baseElement.querySelector('[data-testid="unit-hover-card"]')!.textContent).toContain(
      'Tank',
    );
  });

  it('does nothing for touch pointers (no behavior change on phones)', () => {
    seedBattle([unit('a', 0, 0), unit('e', 1, 7)]);
    const { container, baseElement } = render(<App />);
    fireEvent.pointerOver(container.querySelector('[data-unit-id="a"]')!, {
      pointerType: 'touch',
    });
    act(() => vi.advanceTimersByTime(400));
    expect(baseElement.querySelector('[data-testid="unit-hover-card"]')).toBeNull();
  });

  it('dismisses on pointer-down (tap) and on leaving the board', () => {
    seedBattle([unit('a', 0, 0), unit('e', 1, 7)]);
    const { container, baseElement } = render(<App />);
    const token = container.querySelector('[data-unit-id="a"]')!;
    fireEvent.pointerOver(token, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(260));
    expect(baseElement.querySelector('[data-testid="unit-hover-card"]')).not.toBeNull();

    fireEvent.pointerDown(token, { pointerType: 'mouse' });
    expect(baseElement.querySelector('[data-testid="unit-hover-card"]')).toBeNull();

    // again, then leave the svg
    fireEvent.pointerUp(token, { pointerType: 'mouse' });
    fireEvent.pointerOver(token, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(260));
    expect(baseElement.querySelector('[data-testid="unit-hover-card"]')).not.toBeNull();
    fireEvent.pointerLeave(container.querySelector('.board-svg')!, { pointerType: 'mouse' });
    expect(baseElement.querySelector('[data-testid="unit-hover-card"]')).toBeNull();
  });

  it('hovering a cell (not a token) shows nothing', () => {
    seedBattle([unit('a', 0, 0), unit('e', 1, 7)]);
    const { container, baseElement } = render(<App />);
    fireEvent.pointerOver(container.querySelector('[data-cell-id="3"]')!, {
      pointerType: 'mouse',
    });
    act(() => vi.advanceTimersByTime(400));
    expect(baseElement.querySelector('[data-testid="unit-hover-card"]')).toBeNull();
  });
});
