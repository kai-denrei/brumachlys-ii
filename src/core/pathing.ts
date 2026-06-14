// Movement-cost-weighted Dijkstra over the board graph. Pure functions.
// Ported from v1 core/pathing.ts with hex neighbors swapped for the board's
// adjacency lists, and unit-occupancy rules abstracted behind callbacks so
// the P4 resolver supplies them (friendly pass-through / no-land-on-friendly /
// enemy-blocks-traversal are POLICY, not pathing):
//
//   canStopAt(cell)      — false → cell is not a valid destination (e.g.
//                          friendly-occupied). Still traversable.
//   canPassThrough(cell) — false → cell may be ENTERED (valid destination,
//                          e.g. enemy-occupied → charge) but never expanded
//                          past.
//
// Conventions (unchanged from v1):
//   • Path returned lists the cells traversed AFTER `from` (start excluded),
//     matching the move-order shape (spec §2.3).
//   • Step cost is the movementCost of each ENTERED cell, in tenths.
//   • Costs >= IMPASSABLE (99) mean the unit can never enter that terrain.
//   • Determinism: neighbors are sorted ascending (board invariant) and the
//     queue pops the strictly-lowest cost (first-found on ties), so equal-cost
//     paths resolve identically for identical inputs.

import type { Board, CellId, TerrainKey } from '../board/types';
import type { UnitType } from './types';

/** Per-unit terrain step costs in tenths. >= IMPASSABLE → cannot enter. */
export type MovementCosts = Readonly<Record<TerrainKey, number>>;

export const IMPASSABLE = 99;

/** Derive the cost table pathing wants from a UnitType's terrainEffects. */
export function movementCostsFor(unitType: UnitType): MovementCosts {
  const costs = {} as Record<TerrainKey, number>;
  for (const key of Object.keys(unitType.terrainEffects) as TerrainKey[]) {
    costs[key] = unitType.terrainEffects[key].movementCost;
  }
  return costs;
}

export type PathOpts = {
  /** Movement budget in tenths. Default Infinity (cost-only search). */
  budget?: number;
  /** false → not a valid final destination (still traversable). */
  canStopAt?: (cell: CellId) => boolean;
  /** false → may be entered as a destination, but never expanded past. */
  canPassThrough?: (cell: CellId) => boolean;
  /** E1 discovery fog (addendum §A): the searching faction's BELIEVED
   * terrain per cell (dark ⇒ plains; see core/fog assumedTerrainView).
   * Default: truth. Planning-preview only — the resolver never sets this. */
  assumedTerrain?: (cell: CellId) => TerrainKey;
  /** v0.9 ENEMY-FRICTION (movement friction near enemies): extra movement cost
   * (tenths) to ENTER `cell`, on top of its terrain `movementCost`. The caller
   * injects the friction field — typically `enemyFrictionAt(board, cell, …)` —
   * so every movement-cost seam (validation, the reachable overlay, the
   * resolver, the AI planner) agrees on one formula while each chooses its own
   * enemy set (visible vs actual). Default: no extra cost (legacy behaviour). */
  extraCostAt?: (cell: CellId) => number;
};

/** Tenths of extra movement cost per ENEMY unit on a cell adjacent to the one
 * being ENTERED (v0.9). One adjacent enemy turns a plains step (3) into 5 — a
 * noticeable but passable malus; three (3 + 6 = 9) costs ≈ a full infantry move,
 * so being surrounded or forced through a line is near-prohibitive but never
 * hard-blocked — friction is a SOFT field, you push through with enough budget. */
export const FRICTION_PER_ENEMY = 2;

/** Extra movement cost (tenths) to ENTER `cell`, from enemy units occupying
 * cells ADJACENT to it. `enemyCells` is the set of cells the caller treats as
 * enemy-held — VISIBLE enemies at planning seams, ACTUAL living enemies at the
 * resolver. The starting cell's own adjacency never costs: only ENTERED cells
 * pay (the pathfinder applies this per step). Pure. */
export function enemyFrictionAt(
  board: Board,
  cell: CellId,
  enemyCells: ReadonlySet<CellId>,
): number {
  if (enemyCells.size === 0) return 0;
  let n = 0;
  for (const nb of board.cells.get(cell)?.neighbors ?? []) {
    if (enemyCells.has(nb)) n++;
  }
  return n * FRICTION_PER_ENEMY;
}

export type PathResult = {
  path: CellId[];
  totalCost: number; // tenths
};

type QueueItem = { cell: CellId; cost: number };

// Simple sorted-on-pop priority queue — adequate for ≤250-cell boards.
function popMin(queue: QueueItem[]): QueueItem {
  let bestIdx = 0;
  for (let i = 1; i < queue.length; i++) {
    if (queue[i]!.cost < queue[bestIdx]!.cost) bestIdx = i;
  }
  return queue.splice(bestIdx, 1)[0]!;
}

export function findPath(
  board: Board,
  costs: MovementCosts,
  from: CellId,
  to: CellId,
  opts: PathOpts = {},
): PathResult | null {
  const budget = opts.budget ?? Infinity;
  const canStopAt = opts.canStopAt ?? (() => true);
  const canPassThrough = opts.canPassThrough ?? (() => true);
  const terrainOf = (cell: { id: CellId; terrain: TerrainKey }): TerrainKey =>
    opts.assumedTerrain ? opts.assumedTerrain(cell.id) : cell.terrain;

  if (!board.cells.has(from) || !board.cells.has(to)) return null;
  if (from === to) return { path: [], totalCost: 0 };
  if (!canStopAt(to)) return null;

  const distances = new Map<CellId, number>([[from, 0]]);
  const previous = new Map<CellId, CellId>();
  const queue: QueueItem[] = [{ cell: from, cost: 0 }];

  while (queue.length > 0) {
    const current = popMin(queue);

    if (current.cell === to) {
      const path: CellId[] = [];
      let cur: CellId | undefined = to;
      while (cur !== undefined && cur !== from) {
        path.unshift(cur);
        cur = previous.get(cur);
      }
      return { path, totalCost: current.cost };
    }

    if (current.cost > (distances.get(current.cell) ?? Infinity)) continue; // stale
    // Blocked cells (e.g. enemy-occupied) terminate further pathing.
    if (current.cell !== from && !canPassThrough(current.cell)) continue;

    for (const n of board.cells.get(current.cell)!.neighbors) {
      const cell = board.cells.get(n);
      if (!cell) continue; // dangling neighbor id — defensive, P1 guards this
      const baseCost = costs[terrainOf(cell)] ?? IMPASSABLE;
      if (baseCost >= IMPASSABLE) continue;
      // Enemy friction (v0.9): extra cost to ENTER this cell, added before the
      // budget check so reach/path costs include it. Impassable terrain is
      // gated above — friction never makes a passable cell impassable, just
      // pricier. Omitted ⇒ 0 (unchanged behaviour).
      const stepCost = baseCost + (opts.extraCostAt ? opts.extraCostAt(n) : 0);

      const newCost = current.cost + stepCost;
      if (newCost > budget) continue;

      // Cells we cannot stop at are traversable but not the destination.
      if (n === to && !canStopAt(n)) continue;

      if (newCost < (distances.get(n) ?? Infinity)) {
        distances.set(n, newCost);
        previous.set(n, current.cell);
        queue.push({ cell: n, cost: newCost });
      }
    }
  }

  return null;
}

// All cells a unit could MOVE TO from `from` within `budget` (tenths), with
// their cheapest total cost. Excludes `from` itself and any cell rejected by
// canStopAt (e.g. friendly-occupied). Cells rejected by canPassThrough (e.g.
// enemy-occupied) ARE included as destinations — entering one is a charge —
// but are never expanded past.
export function reachableCells(
  board: Board,
  costs: MovementCosts,
  from: CellId,
  budget: number,
  opts: Omit<PathOpts, 'budget'> = {},
): Map<CellId, number> {
  const canStopAt = opts.canStopAt ?? (() => true);
  const canPassThrough = opts.canPassThrough ?? (() => true);
  const terrainOf = (cell: { id: CellId; terrain: TerrainKey }): TerrainKey =>
    opts.assumedTerrain ? opts.assumedTerrain(cell.id) : cell.terrain;

  if (!board.cells.has(from)) return new Map();

  const distances = new Map<CellId, number>([[from, 0]]);
  const queue: QueueItem[] = [{ cell: from, cost: 0 }];

  while (queue.length > 0) {
    const current = popMin(queue);
    if (current.cost > (distances.get(current.cell) ?? Infinity)) continue;
    if (current.cell !== from && !canPassThrough(current.cell)) continue;

    for (const n of board.cells.get(current.cell)!.neighbors) {
      const cell = board.cells.get(n);
      if (!cell) continue;
      const baseCost = costs[terrainOf(cell)] ?? IMPASSABLE;
      if (baseCost >= IMPASSABLE) continue;
      // Enemy friction (v0.9) — see findPath. Shrinks reach near enemies.
      const stepCost = baseCost + (opts.extraCostAt ? opts.extraCostAt(n) : 0);
      const newCost = current.cost + stepCost;
      if (newCost > budget) continue;
      if (newCost < (distances.get(n) ?? Infinity)) {
        distances.set(n, newCost);
        queue.push({ cell: n, cost: newCost });
      }
    }
  }

  distances.delete(from);
  for (const cell of [...distances.keys()]) {
    if (!canStopAt(cell)) distances.delete(cell);
  }
  return distances;
}
