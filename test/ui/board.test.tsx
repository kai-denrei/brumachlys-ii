// @vitest-environment jsdom
// Board component: N polygons for N cells, fog class application, unit tokens
// with faction colors, highlight treatments (P7 hooks).

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Board as BoardGraph, Cell, CellId } from '../../src/board/types';
import type { UnitInstance } from '../../src/core/types';
import { Board, computeFollowView } from '../../src/ui/Board';
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

// --- P9 auto-follow camera math (pure) ---------------------------------------

describe('computeFollowView', () => {
  const bbox = { x: 0, y: 0, width: 100, height: 100 };
  const ident = { k: 1, tx: 0, ty: 0 };

  it('returns null for no points', () => {
    expect(computeFollowView([], ident, bbox, 10)).toBeNull();
  });

  it('calm rule: stays put when the action is already comfortably in view', () => {
    expect(computeFollowView([[50, 50]], ident, bbox, 10)).toBeNull();
    // near the edge but margin still inside
    expect(computeFollowView([[85, 85]], ident, bbox, 10)).toBeNull();
  });

  it('pans (keeping zoom) when the target is off-screen and fits at current zoom', () => {
    const v = computeFollowView([[200, 50]], ident, bbox, 10)!;
    expect(v).not.toBeNull();
    expect(v.k).toBe(1); // zoom untouched
    // the point lands at the viewBox center: k*px + tx = 50
    expect(v.k * 200 + v.tx).toBeCloseTo(50);
    expect(v.k * 50 + v.ty).toBeCloseTo(50);
  });

  it('zooms OUT to fit when the framed points exceed the viewport', () => {
    const v = computeFollowView([[0, 0], [150, 0]], ident, bbox, 10)!;
    expect(v.k).toBeCloseTo(100 / 170); // fit 170-wide box into 100
    // box center (75, 0) lands at the viewBox center
    expect(v.k * 75 + v.tx).toBeCloseTo(50);
    expect(v.k * 0 + v.ty).toBeCloseTo(50);
  });

  it('never zooms IN to chase a tight cluster', () => {
    const zoomedOut = { k: 0.6, tx: 0, ty: 0 };
    const v = computeFollowView([[400, 400]], zoomedOut, bbox, 10)!;
    expect(v.k).toBe(0.6);
  });
});
