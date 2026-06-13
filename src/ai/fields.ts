// Shared distance-field helpers for the AI planners (greedy + directives).
// PURE — graph/Dijkstra utilities over the board, no state, no randomness.
// Extracted verbatim from planner-greedy.ts (v0.6) so src/ai/directives.ts
// can reuse the same advance machinery; behaviour is bit-identical.

import type { Board, CellId } from '../board/types';
import { IMPASSABLE } from '../core/pathing';
import type { MovementCosts } from '../core/pathing';

/** Full-board BFS hop distances from `from` (optionally depth-capped).
 *  Hop metric matches graphDistance — range and vision are hop-based. */
export function bfsHops(board: Board, from: CellId, maxHops = Infinity): Map<CellId, number> {
  const dist = new Map<CellId, number>([[from, 0]]);
  let frontier: CellId[] = [from];
  for (let d = 1; d <= maxHops && frontier.length > 0; d++) {
    const next: CellId[] = [];
    for (const id of frontier) {
      for (const n of board.cells.get(id)!.neighbors) {
        if (dist.has(n)) continue;
        dist.set(n, d);
        next.push(n);
      }
    }
    frontier = next;
  }
  return dist;
}

/** Multi-source BFS hop distances (terrain-blind). */
export function multiSourceHops(board: Board, sources: readonly CellId[]): Map<CellId, number> {
  const dist = new Map<CellId, number>();
  let frontier: CellId[] = [];
  for (const s of sources) {
    if (!board.cells.has(s) || dist.has(s)) continue;
    dist.set(s, 0);
    frontier.push(s);
  }
  for (let d = 1; frontier.length > 0; d++) {
    const next: CellId[] = [];
    for (const id of frontier) {
      for (const n of board.cells.get(id)!.neighbors) {
        if (dist.has(n)) continue;
        dist.set(n, d);
        next.push(n);
      }
    }
    frontier = next;
  }
  return dist;
}

/** Multi-source Dijkstra: cheapest walking cost (tenths, in this unit's
 *  terrain costs) from the nearest source. Sources seed at 0 even when the
 *  unit could not stand there (enemy on a mountain, fog cell in the hills);
 *  expansion only ever enters cells the unit can pass. */
export function multiSourceCost(
  board: Board,
  costs: MovementCosts,
  sources: readonly CellId[],
): Map<CellId, number> {
  const dist = new Map<CellId, number>();
  const queue: { cell: CellId; cost: number }[] = [];
  for (const s of sources) {
    if (!board.cells.has(s)) continue;
    dist.set(s, 0);
    queue.push({ cell: s, cost: 0 });
  }
  while (queue.length > 0) {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i]!.cost < queue[bi]!.cost) bi = i;
    }
    const cur = queue.splice(bi, 1)[0]!;
    if (cur.cost > (dist.get(cur.cell) ?? Infinity)) continue;
    for (const n of board.cells.get(cur.cell)!.neighbors) {
      const cell = board.cells.get(n);
      if (!cell) continue;
      const step = costs[cell.terrain] ?? IMPASSABLE;
      if (step >= IMPASSABLE) continue;
      const nd = cur.cost + step;
      if (nd < (dist.get(n) ?? Infinity)) {
        dist.set(n, nd);
        queue.push({ cell: n, cost: nd });
      }
    }
  }
  return dist;
}
