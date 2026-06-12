// geometry.test.ts — graphDistance / angleAt / cellsWithin (spec §13.2 vectors).

import { describe, expect, it } from 'vitest';
import { generateUniformBoard } from '../../src/board/generate';
import { angleAt, cellsWithin, graphDistance } from '../../src/board/geometry';
import type { Board, Cell, CellId, Vec2 } from '../../src/board/types';

// Synthetic board: cells from centers + explicit adjacency (polygons unused by
// the geometry helpers; a degenerate triangle ring keeps the type honest).
function syntheticBoard(centers: Vec2[], edges: [CellId, CellId][]): Board {
  const cells = new Map<CellId, Cell>();
  centers.forEach((center, id) => {
    cells.set(id, {
      id,
      center,
      polygon: [center, center, center],
      neighbors: [],
      terrain: 'plains',
    });
  });
  for (const [a, b] of edges) {
    cells.get(a)!.neighbors.push(b);
    cells.get(b)!.neighbors.push(a);
  }
  for (const c of cells.values()) c.neighbors.sort((x, y) => x - y);
  return { cells, seed: 0, donorMapId: 'synthetic' };
}

describe('angleAt (§13.2 vectors)', () => {
  // pivot 0 at (0,0), a = cell 1 at (1,0); b varies.
  const board = syntheticBoard(
    [
      [0, 0], // 0: pivot
      [1, 0], // 1: a
      [-1, 0.01], // 2: ≈179°
      [0, 1], // 3: 90°
      [0.94, 0.34], // 4: ≈20°
    ],
    [],
  );

  it('b at (-1, 0.01) -> ≈179°', () => {
    expect(angleAt(board, 0, 1, 2)).toBeCloseTo(179.427, 1);
  });

  it('b at (0, 1) -> 90°', () => {
    expect(angleAt(board, 0, 1, 3)).toBeCloseTo(90, 6);
  });

  it('b at (0.94, 0.34) -> ≈20°', () => {
    expect(angleAt(board, 0, 1, 4)).toBeCloseTo(19.89, 1);
  });

  it('is symmetric in a and b, and 0 for a == b', () => {
    expect(angleAt(board, 0, 1, 3)).toBeCloseTo(angleAt(board, 0, 3, 1), 9);
    expect(angleAt(board, 0, 1, 1)).toBe(0);
  });
});

describe('graphDistance (§13.2)', () => {
  const board = generateUniformBoard(7, 150);
  const ids = [...board.cells.keys()];
  const first = ids[0]!;

  it('0 to self', () => {
    for (const id of ids.slice(0, 10)) expect(graphDistance(board, id, id)).toBe(0);
  });

  it('1 to any neighbor', () => {
    for (const id of ids.slice(0, 25)) {
      for (const n of board.cells.get(id)!.neighbors) {
        expect(graphDistance(board, id, n)).toBe(1);
      }
    }
  });

  it('symmetric', () => {
    for (const b of ids.filter((id) => id % 17 === 0)) {
      expect(graphDistance(board, first, b)).toBe(graphDistance(board, b, first));
    }
  });

  it('Infinity across disconnected components', () => {
    const board2 = syntheticBoard(
      [
        [0, 0],
        [1, 0],
        [5, 5],
      ],
      [[0, 1]],
    );
    expect(graphDistance(board2, 0, 2)).toBe(Infinity);
  });
});

describe('cellsWithin (§3.2)', () => {
  const board = generateUniformBoard(7, 150);
  const from = [...board.cells.keys()][0]!;

  it('hops 0 -> just the cell itself', () => {
    expect(cellsWithin(board, from, 0)).toEqual([from]);
  });

  it('hops 1 -> self + neighbors, sorted ascending', () => {
    const expected = [from, ...board.cells.get(from)!.neighbors].sort((a, b) => a - b);
    expect(cellsWithin(board, from, 1)).toEqual(expected);
  });

  it('hops n -> exactly the cells with graphDistance <= n', () => {
    const hops = 3;
    const got = cellsWithin(board, from, hops);
    const expected = [...board.cells.keys()]
      .filter((id) => graphDistance(board, from, id) <= hops)
      .sort((a, b) => a - b);
    expect(got).toEqual(expected);
  });

  it('grows monotonically with hops', () => {
    let prev = 0;
    for (let h = 0; h <= 5; h++) {
      const n = cellsWithin(board, from, h).length;
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });
});
