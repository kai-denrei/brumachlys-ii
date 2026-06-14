// @vitest-environment jsdom
// v0.9 PART A — active-unit halo: a pulsing faction-color ring around the unit
// the player is currently commanding (selected). It's louder than the v1.4 idle
// "awaiting orders" breath, and intensifies (.active-halo-proposed) while a MOVE
// proposal is pending. Gated by the Board: only the selected own unit, only in
// interactive planning (never replay / silhouette / preview). The pulse → static
// ring under prefers-reduced-motion is CSS-only (asserted by inspection of
// styles.css, not here). The proposal ghost rendering is covered alongside.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { Board as BoardGraph, Cell, CellId } from '../../src/board/types';
import type { UnitInstance } from '../../src/core/types';
import { useAppStore } from '../../src/state/store';
import { Board } from '../../src/ui/Board';

afterEach(cleanup);

function makeBoard(): BoardGraph {
  const square = (cx: number, cy: number): [number, number][] => [
    [cx - 0.4, cy - 0.4],
    [cx + 0.4, cy - 0.4],
    [cx + 0.4, cy + 0.4],
    [cx - 0.4, cy + 0.4],
  ];
  const mk = (id: CellId, cx: number, cy: number, neighbors: CellId[]): Cell => ({
    id,
    center: [cx, cy],
    polygon: square(cx, cy),
    neighbors,
    terrain: 'plains',
  });
  const cells = new Map<CellId, Cell>([
    [0, mk(0, 0, 0, [1])],
    [1, mk(1, 1, 0, [0, 2])],
    [2, mk(2, 2, 0, [1])],
  ]);
  return { cells, seed: 7, donorMapId: 'test', placementAnchors: [0, 2] };
}

function unit(id: string, faction: 0 | 1, cell: CellId): UnitInstance {
  return { id, type: 'infantry', faction, cell, count: 10, stance: 'aggressive', attackedFrom: [] };
}

const board = makeBoard();
const units = [unit('own1', 0, 0), unit('own2', 0, 1), unit('foe', 1, 2)];

const haloOn = (container: HTMLElement, unitId: string) =>
  container.querySelector(`[data-unit-id="${unitId}"] .active-halo`) !== null;

describe('active-unit halo (v0.9 PART A)', () => {
  beforeEach(() => {
    useAppStore.setState({
      screen: 'battle',
      uiPhase: 'planning',
      orders: {},
      pendingMove: null,
      selectedUnitId: null,
    });
  });

  it('the selected own unit gets a halo; unselected own units and enemies do not', () => {
    const { container } = render(<Board board={board} units={units} selectedUnitId="own1" />);
    expect(haloOn(container, 'own1')).toBe(true);
    expect(haloOn(container, 'own2')).toBe(false);
    expect(haloOn(container, 'foe')).toBe(false);
  });

  it('no halo without a selection', () => {
    const { container } = render(<Board board={board} units={units} selectedUnitId={null} />);
    expect(haloOn(container, 'own1')).toBe(false);
  });

  it('a pending MOVE proposal INTENSIFIES the selected unit halo (.active-halo-proposed)', () => {
    const { container } = render(<Board board={board} units={units} selectedUnitId="own1" />);
    const halo = () => container.querySelector('[data-unit-id="own1"] .active-halo')!;
    expect(halo().classList.contains('active-halo-proposed')).toBe(false);
    act(() =>
      useAppStore.setState({ pendingMove: { unitId: 'own1', dest: 2, path: [1, 2] } }),
    );
    expect(halo().classList.contains('active-halo-proposed')).toBe(true);
  });

  it('never during replay (the replayFx branch), on silhouettes, or non-interactive previews', () => {
    const fx = { key: 0, fx: { arcs: [], floaters: [], bursts: [], kills: [] } };
    const replay = render(
      <Board board={board} units={units} selectedUnitId="own1" replayFx={fx} />,
    );
    expect(haloOn(replay.container, 'own1')).toBe(false);

    const sil = render(<Board board={board} units={units} selectedUnitId="own1" silhouette />);
    expect(haloOn(sil.container, 'own1')).toBe(false);

    const still = render(
      <Board board={board} units={units} selectedUnitId="own1" interactive={false} />,
    );
    expect(haloOn(still.container, 'own1')).toBe(false);
  });

  it('the halo is calm chrome: non-interactive, behind the token body', () => {
    const { container } = render(<Board board={board} units={units} selectedUnitId="own1" />);
    const token = container.querySelector('[data-unit-id="own1"]')!;
    const halo = token.querySelector('.active-halo')!;
    expect(halo.getAttribute('pointer-events')).toBe('none');
    const children = [...token.children];
    expect(children.indexOf(halo as Element)).toBeLessThan(
      children.indexOf(token.querySelector('.unit-body')!),
    );
  });
});
