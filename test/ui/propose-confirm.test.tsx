// @vitest-environment jsdom
// v0.9 propose-then-confirm MOVE entry + active-unit halo.
//
// The operator's ask: tapping a reachable destination no longer queues the move
// immediately. The FIRST tap sets a transient PENDING proposal; a SECOND tap on
// the same dest commits it, Enter commits it, and selecting another unit commits
// the previous unit's proposal. Re-tapping a DIFFERENT reachable cell retargets
// the proposal (still one move per unit). Escape / own-cell cancels it.
//
// Driven end-to-end through <App /> (the same seam passthrough.test.tsx uses):
// real cell/unit taps via fireEvent, store assertions on pendingMove + orders.
// Attacks / aim cells keep their one-step behavior — covered here too so the
// move flow doesn't swallow them.

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
  return { cells, seed: 0, donorMapId: 'propose-confirm', placementAnchors: [0, n - 1] };
}

function unit(id: string, faction: FactionId, cell: CellId, type = 'infantry'): UnitInstance {
  return { id, type, faction, cell, count: 10, stance: 'aggressive', attackedFrom: [] };
}

function seedBattle(units: UnitInstance[], board = lineBoard(12)) {
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
    pendingMove: null,
    orders: {},
    buys: {},
    focus: null,
    notice: null,
    battleLog: [],
  });
}

const s = () => useAppStore.getState();
const tapCell = (c: HTMLElement, id: CellId) =>
  fireEvent.click(c.querySelector(`[data-cell-id="${id}"]`)!);
const tapUnit = (c: HTMLElement, id: string) =>
  fireEvent.click(c.querySelector(`[data-unit-id="${id}"]`)!);
// Clicks the DOCK CHIP button for a unit (distinct from the board token).
const tapDockChip = (c: HTMLElement, unitId: string) => {
  // Each dock chip button contains exactly one data-unit-id SVG element.
  for (const btn of c.querySelectorAll('button.dock-chip')) {
    if (btn.querySelector(`[data-unit-id="${unitId}"]`)) {
      fireEvent.click(btn);
      return;
    }
  }
  throw new Error(`dock chip not found for unit ${unitId}`);
};
const pressEnter = () => fireEvent.keyDown(window, { key: 'Enter' });
const pressEscape = () => fireEvent.keyDown(window, { key: 'Escape' });

describe('v0.9 propose-then-confirm — MOVE entry', () => {
  it('FIRST tap proposes (not queued); SECOND tap on same cell commits', () => {
    seedBattle([unit('a', 0, 0), unit('e', 1, 11)]);
    const { container } = render(<App />);
    tapUnit(container, 'a');
    expect(s().selectedUnitId).toBe('a');

    // first tap on a reachable cell → proposal, NOT a queued order
    tapCell(container, 2);
    expect(s().pendingMove).toEqual({ unitId: 'a', dest: 2, path: [1, 2] });
    expect(s().orders['a']).toBeUndefined();
    // a DISTINCT proposal ghost renders (not the committed queued-order ghost)
    expect(container.querySelector('[data-proposal-unit-id="a"]')).not.toBeNull();
    expect(container.querySelector('[data-ghost-unit-id="a"]')).toBeNull();

    // second tap on the SAME dest → commit
    tapCell(container, 2);
    expect(s().pendingMove).toBeNull();
    expect(s().orders['a']?.move?.path).toEqual([1, 2]);
    // the proposal ghost is gone; the committed queued ghost is now present
    expect(container.querySelector('[data-proposal-unit-id="a"]')).toBeNull();
    expect(container.querySelector('[data-ghost-unit-id="a"]')).not.toBeNull();
  });

  it('re-tapping a DIFFERENT reachable cell RETARGETS the proposal (one move per unit)', () => {
    seedBattle([unit('a', 0, 0), unit('e', 1, 11)]);
    const { container } = render(<App />);
    tapUnit(container, 'a');

    tapCell(container, 1);
    expect(s().pendingMove).toEqual({ unitId: 'a', dest: 1, path: [1] });
    // a tap on a different reachable cell moves the proposal — does NOT queue two
    tapCell(container, 3);
    expect(s().pendingMove).toEqual({ unitId: 'a', dest: 3, path: [1, 2, 3] });
    expect(s().orders['a']).toBeUndefined(); // still nothing queued

    tapCell(container, 3); // confirm the (retargeted) proposal
    expect(s().orders['a']?.move?.path).toEqual([1, 2, 3]);
    expect(s().pendingMove).toBeNull();
  });

  it('ENTER commits a pending proposal FIRST, before any round-commit', () => {
    seedBattle([unit('a', 0, 0), unit('e', 1, 11)]);
    const { container } = render(<App />);
    tapUnit(container, 'a');
    tapCell(container, 2);
    expect(s().pendingMove).not.toBeNull();
    expect(s().uiPhase).toBe('planning');

    // First Enter: commits the proposal, stays in planning (does NOT commit round)
    pressEnter();
    expect(s().pendingMove).toBeNull();
    expect(s().orders['a']?.move?.path).toEqual([1, 2]);
    expect(s().uiPhase).toBe('planning');

    // Second Enter (no pending now, ≥1 order queued): commits the round → replay
    pressEnter();
    expect(s().uiPhase).not.toBe('planning'); // round committed
  });

  it('selecting ANOTHER friendly unit COMMITS the previous unit pending proposal', () => {
    seedBattle([unit('a', 0, 0), unit('b', 0, 6), unit('e', 1, 11)]);
    const { container } = render(<App />);
    tapUnit(container, 'a');
    tapCell(container, 2);
    expect(s().pendingMove).toEqual({ unitId: 'a', dest: 2, path: [1, 2] });

    // tap b's token → a's proposal commits, b becomes selected, no a-proposal left
    tapUnit(container, 'b');
    expect(s().orders['a']?.move?.path).toEqual([1, 2]); // committed
    expect(s().selectedUnitId).toBe('b');
    expect(s().pendingMove).toBeNull();
  });

  it('tapping another unit DOCK CHIP commits the pending proposal (no silent drop)', () => {
    // FIX 1: onChipTap was missing the commitPendingMove() call before selectUnit.
    // Propose a move for unit 'a', then switch to 'b' via dock chip — 'a' move must land.
    seedBattle([unit('a', 0, 0), unit('b', 0, 6), unit('e', 1, 11)]);
    const { container } = render(<App />);
    tapUnit(container, 'a');
    tapCell(container, 2);
    expect(s().pendingMove).toEqual({ unitId: 'a', dest: 2, path: [1, 2] });

    // tap b's DOCK CHIP (not the board token) — must commit a's proposal first
    tapDockChip(container, 'b');
    expect(s().orders['a']?.move?.path).toEqual([1, 2]); // committed, not dropped
    expect(s().selectedUnitId).toBe('b');
    expect(s().pendingMove).toBeNull();
  });

  it('ESCAPE cancels a pending proposal (nothing queued); a second Escape deselects', () => {
    seedBattle([unit('a', 0, 0), unit('e', 1, 11)]);
    const { container } = render(<App />);
    tapUnit(container, 'a');
    tapCell(container, 2);
    expect(s().pendingMove).not.toBeNull();

    pressEscape(); // cancel the proposal — unit still selected, nothing queued
    expect(s().pendingMove).toBeNull();
    expect(s().orders['a']).toBeUndefined();
    expect(s().selectedUnitId).toBe('a');

    pressEscape(); // no proposal now → deselect
    expect(s().selectedUnitId).toBeNull();
  });

  it('tapping the selected unit OWN cell cancels a pending proposal', () => {
    seedBattle([unit('a', 0, 0), unit('e', 1, 11)]);
    const { container } = render(<App />);
    tapUnit(container, 'a');
    tapCell(container, 2);
    expect(s().pendingMove).not.toBeNull();

    // tap a's own cell (cell 0) → cancel the proposal, keep selection
    tapCell(container, 0);
    expect(s().pendingMove).toBeNull();
    expect(s().orders['a']).toBeUndefined();
    expect(s().selectedUnitId).toBe('a');
  });

  it('tapping an EMPTY/unreachable cell COMMITS the proposal, then deselects (no silent loss)', () => {
    // budget 9 infantry reaches 3 plains steps; cell 8 is unreachable from 0.
    seedBattle([unit('a', 0, 0), unit('e', 1, 11)]);
    const { container } = render(<App />);
    tapUnit(container, 'a');
    tapCell(container, 2);
    expect(s().pendingMove).toEqual({ unitId: 'a', dest: 2, path: [1, 2] });

    tapCell(container, 8); // far unreachable cell → commit proposal + deselect
    expect(s().orders['a']?.move?.path).toEqual([1, 2]); // NOT silently dropped
    expect(s().pendingMove).toBeNull();
    expect(s().selectedUnitId).toBeNull();
  });

  it('committing a proposal REPLACES a prior queued move for the same unit', () => {
    seedBattle([unit('a', 0, 0), unit('e', 1, 11)]);
    const { container } = render(<App />);
    tapUnit(container, 'a');
    // queue [1,2] via propose+confirm
    tapCell(container, 2);
    tapCell(container, 2);
    expect(s().orders['a']?.move?.path).toEqual([1, 2]);
    // propose a new dest and confirm → replaces (still one move)
    tapCell(container, 1);
    tapCell(container, 1);
    expect(s().orders['a']?.move?.path).toEqual([1]);
  });
});

describe('v0.9 propose-then-confirm — attack / aim keep one-step behavior', () => {
  it('tapping a visible enemy in range queues an ATTACK immediately (no proposal)', () => {
    // a infantry (range 1) at 0, enemy at cell 1 (adjacent, visible).
    seedBattle([unit('a', 0, 0), unit('e', 1, 1)]);
    const { container } = render(<App />);
    tapUnit(container, 'a');
    tapCell(container, 1); // enemy cell → attack, not a move proposal
    expect(s().pendingMove).toBeNull();
    expect(s().orders['a']?.attack?.targetCell).toBe(1);
  });

  it('attack pivot COMMITS a standing move proposal first (no silent loss)', () => {
    // A RANGED unit (artillery, range 2-4, vision needs a spotter) so a move and
    // an attack can coexist: artillery 'g' at cell 0, a sniper spotter at 0
    // (vision 4) reveals the enemy at cell 4. Propose a move to cell 1, then tap
    // the enemy: the move proposal commits AND the attack queues from the planned
    // end (cell 1 → enemy 4 = distance 3, in range [2,4]). Neither is dropped.
    seedBattle([unit('g', 0, 0, 'artillery'), unit('spotter', 0, 0, 'sniper'), unit('e', 1, 4)]);
    const { container } = render(<App />);
    tapUnit(container, 'g');
    tapCell(container, 1); // reachable empty cell → propose g's move to 1
    expect(s().pendingMove).toEqual({ unitId: 'g', dest: 1, path: [1] });
    tapCell(container, 4); // enemy → attack pivot (commits the move first)
    expect(s().pendingMove).toBeNull();
    expect(s().orders['g']?.move?.path).toEqual([1]); // proposal committed
    expect(s().orders['g']?.attack?.targetCell).toBe(4); // attack queued on top
  });
});
