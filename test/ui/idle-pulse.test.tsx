// @vitest-environment jsdom
// v1.4 — idle "awaiting orders" pulse: own units with no queued order get a
// soft breathing halo on the board during planning; it disappears the instant
// any order kind is queued, and never shows for enemy tokens, during replay,
// on silhouettes, or outside the battle screen. (The reduced-motion fallback
// — static dotted outline instead of the animation — is CSS-only:
// @media (prefers-reduced-motion: reduce) in styles.css.)

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

function pulsingIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-unit-id]')]
    .filter((el) => el.querySelector('.idle-pulse'))
    .map((el) => el.getAttribute('data-unit-id')!);
}

describe('idle pulse (v1.4)', () => {
  beforeEach(() => {
    useAppStore.setState({ screen: 'battle', uiPhase: 'planning', orders: {} });
  });

  it('planning: own unordered units pulse; enemy units never do', () => {
    const { container } = render(<Board board={board} units={units} />);
    expect(pulsingIds(container)).toEqual(['own1', 'own2']);
  });

  it('any queued order kind stops the pulse for that unit only', () => {
    useAppStore.setState({
      orders: { own1: { stance: { kind: 'stance', unitId: 'own1', stance: 'defensive' } } },
    });
    const { container } = render(<Board board={board} units={units} />);
    expect(pulsingIds(container)).toEqual(['own2']);
  });

  it('queueing mid-render re-renders the halo away instantly', () => {
    const { container } = render(<Board board={board} units={units} />);
    expect(pulsingIds(container)).toEqual(['own1', 'own2']);
    act(() =>
      useAppStore.setState({
        orders: { own2: { move: { kind: 'move', unitId: 'own2', path: [0] } } },
      }),
    );
    expect(pulsingIds(container)).toEqual(['own1']);
  });

  it('never during replay (the replayFx branch) or outside the planning phase', () => {
    const fx = { key: 0, fx: { arcs: [], floaters: [], bursts: [], kills: [] } };
    const { container } = render(<Board board={board} units={units} replayFx={fx} />);
    expect(pulsingIds(container)).toEqual([]);

    useAppStore.setState({ uiPhase: 'replay' });
    const second = render(<Board board={board} units={units} />);
    expect(pulsingIds(second.container)).toEqual([]);
  });

  it('never on silhouettes, non-interactive previews, or the start screen', () => {
    const silhouette = render(<Board board={board} units={units} silhouette />);
    expect(pulsingIds(silhouette.container)).toEqual([]);

    const still = render(<Board board={board} units={units} interactive={false} />);
    expect(pulsingIds(still.container)).toEqual([]);

    useAppStore.setState({ screen: 'start' });
    const start = render(<Board board={board} units={units} />);
    expect(pulsingIds(start.container)).toEqual([]);
  });

  it('the halo is calm chrome: non-interactive, behind the token body', () => {
    const { container } = render(<Board board={board} units={units} />);
    const token = container.querySelector('[data-unit-id="own1"]')!;
    const halo = token.querySelector('.idle-pulse')!;
    expect(halo.getAttribute('pointer-events')).toBe('none');
    // halo group comes before the body rect in document order (renders under)
    const children = [...token.children];
    expect(children.indexOf(halo as Element)).toBeLessThan(
      children.indexOf(token.querySelector('.unit-body')!),
    );
  });
});
