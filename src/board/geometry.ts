// geometry.ts — graph/angle helpers over the game-facing Board (spec §3.2). PURE.
// All game logic measures range, vision and gang-up geometry through these —
// never through the mesh.

import type { Board, CellId } from './types';

function cellOrThrow(board: Board, id: CellId) {
  const cell = board.cells.get(id);
  if (!cell) throw new Error(`geometry: unknown cell id ${id}`);
  return cell;
}

/**
 * BFS hop count between two cells (range, vision). 0 to self, 1 to a neighbor.
 * Returns Infinity if unreachable (disconnected boards can exist after P2
 * deletion; callers compare against ranges, so Infinity composes correctly).
 */
export function graphDistance(board: Board, a: CellId, b: CellId): number {
  cellOrThrow(board, a);
  cellOrThrow(board, b);
  if (a === b) return 0;

  const dist = new Map<CellId, number>([[a, 0]]);
  let frontier: CellId[] = [a];
  while (frontier.length > 0) {
    const next: CellId[] = [];
    for (const id of frontier) {
      const d = dist.get(id)!;
      for (const n of cellOrThrow(board, id).neighbors) {
        if (dist.has(n)) continue;
        if (n === b) return d + 1;
        dist.set(n, d + 1);
        next.push(n);
      }
    }
    frontier = next;
  }
  return Infinity;
}

/**
 * Angle in degrees [0, 180] between the vectors center(pivot)→center(a) and
 * center(pivot)→center(b). Drives the angle-based gang-up classification
 * (spec §5.3). Degenerate input (a or b sharing pivot's center) → 0.
 */
export function angleAt(board: Board, pivot: CellId, a: CellId, b: CellId): number {
  const p = cellOrThrow(board, pivot).center;
  const ca = cellOrThrow(board, a).center;
  const cb = cellOrThrow(board, b).center;

  const ux = ca[0] - p[0];
  const uy = ca[1] - p[1];
  const vx = cb[0] - p[0];
  const vy = cb[1] - p[1];
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (lu < 1e-12 || lv < 1e-12) return 0;

  let c = (ux * vx + uy * vy) / (lu * lv);
  c = Math.max(-1, Math.min(1, c));
  return (Math.acos(c) * 180) / Math.PI;
}

/**
 * All cells within `hops` BFS steps of `from`, INCLUDING `from` itself
 * (hops = 0 → [from]). Sorted ascending for determinism.
 */
export function cellsWithin(board: Board, from: CellId, hops: number): CellId[] {
  cellOrThrow(board, from);
  const dist = new Map<CellId, number>([[from, 0]]);
  let frontier: CellId[] = [from];
  for (let d = 1; d <= hops && frontier.length > 0; d++) {
    const next: CellId[] = [];
    for (const id of frontier) {
      for (const n of cellOrThrow(board, id).neighbors) {
        if (dist.has(n)) continue;
        dist.set(n, d);
        next.push(n);
      }
    }
    frontier = next;
  }
  return [...dist.keys()].sort((x, y) => x - y);
}
