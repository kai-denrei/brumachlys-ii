// @vitest-environment jsdom
// Board component: N polygons for N cells, fog class application, unit tokens
// with faction colors, highlight treatments (P7 hooks).

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Board as BoardGraph, Cell, CellId } from '../../src/board/types';
import type { UnitInstance } from '../../src/core/types';
import { Board } from '../../src/ui/Board';
import { PALETTE } from '../../src/ui/skin';

afterEach(cleanup);

/** Tiny synthetic 2×2 board (y-up world coords). */
function makeBoard(): BoardGraph {
  const square = (cx: number, cy: number): [number, number][] => [
    [cx - 0.4, cy - 0.4],
    [cx + 0.4, cy - 0.4],
    [cx + 0.4, cy + 0.4],
    [cx - 0.4, cy + 0.4],
  ];
  const mk = (id: CellId, cx: number, cy: number, neighbors: CellId[], terrain: Cell['terrain']): Cell => ({
    id,
    center: [cx, cy],
    polygon: square(cx, cy),
    neighbors,
    terrain,
  });
  const cells = new Map<CellId, Cell>([
    [0, mk(0, 0, 0, [1, 2], 'plains')],
    [1, mk(1, 1, 0, [0, 3], 'woods')],
    [2, mk(2, 0, 1, [0, 3], 'water')],
    [3, mk(3, 1, 1, [1, 2], 'base')],
  ]);
  return { cells, seed: 7, donorMapId: 'test', placementAnchors: [0, 3] };
}

function makeUnit(over: Partial<UnitInstance>): UnitInstance {
  return {
    id: 'u',
    type: 'infantry',
    faction: 0,
    cell: 0,
    count: 10,
    stance: 'aggressive',
    attackedFrom: [],
    ...over,
  };
}

describe('Board', () => {
  it('renders one cell group per board cell', () => {
    const board = makeBoard();
    const { container } = render(<Board board={board} />);
    expect(container.querySelectorAll('[data-cell-id]').length).toBe(board.cells.size);
  });

  it('applies the fog treatment exactly to the fogged set', () => {
    const { container } = render(<Board board={makeBoard()} fog={new Set([1, 2])} />);
    const fogged = [...container.querySelectorAll('.cell-fogged')].map((el) =>
      el.getAttribute('data-cell-id'),
    );
    expect(fogged.sort()).toEqual(['1', '2']);
    expect(container.querySelectorAll('.fog-wash').length).toBe(2);
  });

  it('renders unit tokens with correct faction colors at their cells', () => {
    const units = [
      makeUnit({ id: 'a', faction: 0, cell: 0 }),
      makeUnit({ id: 'b', faction: 1, cell: 3, type: 'tank' }),
    ];
    const { container } = render(<Board board={makeBoard()} units={units} />);
    const tokens = container.querySelectorAll('.unit-token');
    expect(tokens.length).toBe(2);
    const fillOf = (id: string) =>
      container.querySelector(`[data-unit-id="${id}"] .unit-body`)!.getAttribute('fill');
    expect(fillOf('a')).toBe(PALETTE.factionA);
    expect(fillOf('b')).toBe(PALETTE.factionB);
  });

  it('renders highlight treatments: reachable tint + pulsing target ring (P7 hooks)', () => {
    const { container } = render(
      <Board
        board={makeBoard()}
        highlights={{ reachable: new Map([[0, 1]]), targets: new Set([3]) }}
      />,
    );
    expect(container.querySelectorAll('.reach-tint').length).toBe(1);
    expect(container.querySelectorAll('.target-ring').length).toBe(1);
  });

  it('marks the selected unit (token lift hook)', () => {
    const units = [makeUnit({ id: 'a' })];
    const { container } = render(
      <Board board={makeBoard()} units={units} selectedUnitId="a" />,
    );
    expect(container.querySelector('.unit-selected')).not.toBeNull();
  });

  it('renders the grain filter at opacity ≤ 0.05 (§10.1)', () => {
    const { container } = render(<Board board={makeBoard()} />);
    const grain = container.querySelector('.board-grain')!;
    expect(Number(grain.getAttribute('opacity'))).toBeLessThanOrEqual(0.05);
  });
});
