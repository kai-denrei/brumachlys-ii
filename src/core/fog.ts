// Fog-of-war visibility. Pure function. Ported from v1 core/fog.ts with hex
// range swapped for the board graph's cellsWithin.
//
// Spec §7: visibleCells(state, faction) = union of cellsWithin(unit.cell,
// unit.vision) over the faction's LIVING units. Terrain is always visible —
// only enemy units hide; the UI/AI use this set to filter which enemy units
// exist in a faction's view. Takes (board, units) rather than a full
// GameState so P4 (resolver replay fog) and P5 (FactionView) reuse it.

import type { Board, CellId } from '../board/types';
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
