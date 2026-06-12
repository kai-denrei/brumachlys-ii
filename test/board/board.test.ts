// board.test.ts — generateBoard contract (spec §3.2, §3.3, §13.2 vectors).

import { describe, expect, it } from 'vitest';
import { generateBoard } from '../../src/board/generate';
import type { Board } from '../../src/board/types';

// Serialize a Board's deterministic surface for deep-equality.
function snapshot(board: Board) {
  return {
    seed: board.seed,
    donorMapId: board.donorMapId,
    cells: [...board.cells.entries()].map(([id, c]) => ({
      id,
      cellId: c.id,
      center: c.center,
      polygon: c.polygon,
      neighbors: c.neighbors,
      terrain: c.terrain,
    })),
  };
}

describe('generateBoard determinism (§13.2)', () => {
  it('generateBoard(7, 150) twice -> deep-equal (ids, centers, polygons, neighbors)', () => {
    const a = generateBoard(7, 150);
    const b = generateBoard(7, 150);
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it('different seed -> different board', () => {
    const a = generateBoard(7, 150);
    const c = generateBoard(8, 150);
    expect(JSON.stringify(snapshot(a))).not.toBe(JSON.stringify(snapshot(c)));
  });
});

describe('board structure', () => {
  const board = generateBoard(7, 150);

  it('cell ids are stable generation-order indices, map key === cell.id', () => {
    const ids = [...board.cells.keys()];
    ids.forEach((id, i) => expect(id).toBe(i)); // P1: nothing deleted -> dense 0..n-1
    for (const [id, cell] of board.cells) expect(cell.id).toBe(id);
  });

  it('adjacency is symmetric and has no self-neighbors', () => {
    for (const [id, cell] of board.cells) {
      expect(cell.neighbors).not.toContain(id);
      for (const n of cell.neighbors) {
        const other = board.cells.get(n);
        expect(other, `neighbor ${n} of ${id} exists`).toBeDefined();
        expect(other!.neighbors, `back-link ${n} -> ${id}`).toContain(id);
      }
    }
  });

  it('neighbor lists are sorted ascending and duplicate-free', () => {
    for (const cell of board.cells.values()) {
      const sorted = [...new Set(cell.neighbors)].sort((a, b) => a - b);
      expect(cell.neighbors).toEqual(sorted);
    }
  });

  it('every cell has >= 2 neighbors (disc-edge cells can have exactly 2)', () => {
    for (const cell of board.cells.values()) {
      expect(cell.neighbors.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('every cell polygon has >= 3 CCW corners', () => {
    for (const cell of board.cells.values()) {
      expect(cell.polygon.length).toBeGreaterThanOrEqual(3);
      // CCW: positive shoelace area
      let signed = 0;
      for (let i = 0; i < cell.polygon.length; i++) {
        const p = cell.polygon[i]!;
        const q = cell.polygon[(i + 1) % cell.polygon.length]!;
        signed += p[0] * q[1] - q[0] * p[1];
      }
      expect(signed).toBeGreaterThan(0);
    }
  });

  it('P1 uniform board: all terrain plains, donorMapId "uniform"', () => {
    expect(board.donorMapId).toBe('uniform');
    for (const cell of board.cells.values()) expect(cell.terrain).toBe('plains');
  });

  it('board is fully connected (single component)', () => {
    const start = board.cells.keys().next().value!;
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length > 0) {
      for (const n of board.cells.get(stack.pop()!)!.neighbors) {
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    expect(seen.size).toBe(board.cells.size);
  });
});

describe('targetCells honored within ±40% (§13.2)', () => {
  it.each([
    [7, 60],
    [7, 150],
    [7, 250],
    [42, 150],
    [1337, 150],
  ])('seed %i, targetCells %i', (seed, target) => {
    const board = generateBoard(seed, target);
    expect(board.cells.size).toBeGreaterThanOrEqual(Math.ceil(target * 0.6));
    expect(board.cells.size).toBeLessThanOrEqual(Math.floor(target * 1.4));
  });
});
