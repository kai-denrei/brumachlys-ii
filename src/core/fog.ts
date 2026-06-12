// Fog-of-war visibility. Pure functions. Ported from v1 core/fog.ts with hex
// range swapped for the board graph's cellsWithin.
//
// Spec §7: visibleCells(state, faction) = union of cellsWithin(unit.cell,
// unit.vision) over the faction's LIVING units. Takes (board, units) rather
// than a full GameState so P4 (resolver replay fog) and P5 (FactionView)
// reuse it.
//
// E1 (conquest addendum §A) — DISCOVERY fog: terrain is no longer public.
// Each faction accumulates a `discovered` set (cells ever inside its vision;
// never shrinks). Three tiers derive from (discovered, visible):
//   dark   — never seen: no terrain knowledge at all
//   memory — seen before, not currently watched: remembered (true) terrain
//   live   — inside the current vision union
// Planning into the dark assumes optimistic PLAINS cost (the reachable
// preview must not leak unscouted terrain); the resolver stays truth-based
// and truncates on surprise ('invalid-step'). The AI keeps full-map terrain
// knowledge (recorded addendum decision) — FactionView is untouched; only
// the player-facing planning/rendering paths consume these helpers.

import type { Board, CellId, TerrainKey } from '../board/types';
import { cellsWithin } from '../board/geometry';
import type { FactionId, UnitInstance, UnitType } from './types';

export function visibleCells(
  board: Board,
  units: Iterable<UnitInstance>,
  faction: FactionId,
  unitTypes: Record<string, UnitType>,
): Set<CellId> {
  const visible = new Set<CellId>();
  for (const unit of units) {
    if (unit.faction !== faction) continue;
    if (unit.count <= 0) continue; // dead units see nothing
    const ut = unitTypes[unit.type];
    if (!ut) continue;
    for (const cell of cellsWithin(board, unit.cell, ut.vision)) {
      visible.add(cell);
    }
  }
  return visible;
}

// ── E1 discovery fog (addendum §A) ──────────────────────────────────────────

export type FogTier = 'dark' | 'memory' | 'live';

/** Terrain assumed for cells never seen: optimistic plains (addendum §A). */
export const DARK_ASSUMED_TERRAIN: TerrainKey = 'plains';

/** Tier of one cell given the faction's accumulated discovery and its
 *  CURRENT vision union. live ⊃ discovered is not required here — a visible
 *  cell is live regardless of the discovered set (callers accumulate). */
export function fogTier(
  cellId: CellId,
  discovered: ReadonlySet<CellId>,
  visible: ReadonlySet<CellId>,
): FogTier {
  if (visible.has(cellId)) return 'live';
  if (discovered.has(cellId)) return 'memory';
  return 'dark';
}

/** prior ∪ visible as a NEW set — discovery accumulates, never shrinks.
 *  `prior` may be absent (legacy GameStates built before E1). */
export function accumulateDiscovery(
  prior: ReadonlySet<CellId> | undefined,
  visible: Iterable<CellId>,
): Set<CellId> {
  const next = new Set<CellId>(prior);
  for (const cell of visible) next.add(cell);
  return next;
}

/** Initial discovery at newGame: each faction's starting vision union.
 *  (Bases contribute vision in Conquest — E2; nothing extra here yet.) */
export function seedDiscovery(
  board: Board,
  units: Iterable<UnitInstance>,
  unitTypes: Record<string, UnitType>,
): Record<FactionId, ReadonlySet<CellId>> {
  const all = [...units];
  return {
    0: visibleCells(board, all, 0, unitTypes),
    1: visibleCells(board, all, 1, unitTypes),
  };
}

/** The faction's BELIEVED terrain for a cell: dark cells are assumed plains;
 *  memory cells use their remembered (true, terrain never changes) terrain;
 *  live cells are truth. Drives the planning-side reachable/cost preview and
 *  validateOrder so valid-looking orders aren't rejected against hidden
 *  truth. The RESOLVER never uses this — it re-paths against truth. */
export function assumedTerrainView(
  board: Board,
  discovered: ReadonlySet<CellId>,
  visible: ReadonlySet<CellId>,
): (cell: CellId) => TerrainKey {
  return (cellId) => {
    const cell = board.cells.get(cellId);
    if (!cell) return DARK_ASSUMED_TERRAIN;
    return fogTier(cellId, discovered, visible) === 'dark' ? DARK_ASSUMED_TERRAIN : cell.terrain;
  };
}
