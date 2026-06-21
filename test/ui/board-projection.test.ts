// Phase 3 Task 3.1 — projectBoard: the generalized SVG projection extracted
// from RulesModal. Every cell gets a polygon; every projected vertex lands
// inside the padded 240×200 viewBox.

import { describe, it, expect } from 'vitest';
import { projectBoard } from '../../src/ui/skin/board-projection';
import { generateUniformBoard } from '../../src/board';

describe('projectBoard', () => {
  it('projects every cell into the default 240×200 viewBox', () => {
    const board = generateUniformBoard(42, 40);
    const { pts } = projectBoard(board);

    // every cell id has a polygon entry
    for (const cell of board.cells.values()) {
      expect(pts.has(cell.id)).toBe(true);
      expect(pts.get(cell.id)!.length).toBe(cell.polygon.length);
    }

    // every projected point lies within the 0..240 × 0..200 viewBox
    for (const poly of pts.values()) {
      for (const [x, y] of poly) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(240);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(200);
      }
    }
  });
});
