// Shared synthetic-board builders for core tests. Cells from explicit centers
// + adjacency; polygons are degenerate (unused by game logic — geometry
// helpers only read centers and neighbors).

import type { Board, Cell, CellId, TerrainKey, Vec2 } from '../../src/board/types';
import type { FactionId, UnitInstance } from '../../src/core/types';

export function syntheticBoard(
  specs: { center: Vec2; terrain?: TerrainKey }[],
  edges: [CellId, CellId][],
): Board {
  const cells = new Map<CellId, Cell>();
  specs.forEach((spec, id) => {
    cells.set(id, {
      id,
      center: spec.center,
      polygon: [spec.center, spec.center, spec.center],
      neighbors: [],
      terrain: spec.terrain ?? 'plains',
    });
  });
  for (const [a, b] of edges) {
    cells.get(a)!.neighbors.push(b);
    cells.get(b)!.neighbors.push(a);
  }
  for (const c of cells.values()) c.neighbors.sort((x, y) => x - y);
  return { cells, seed: 0, donorMapId: 'synthetic' };
}

/** Line board: cell i at (i, 0), edges i—i+1, terrain per index. */
export function lineBoard(terrains: TerrainKey[]): Board {
  const specs = terrains.map((terrain, i) => ({ center: [i, 0] as Vec2, terrain }));
  const edges: [CellId, CellId][] = [];
  for (let i = 0; i + 1 < terrains.length; i++) edges.push([i, i + 1]);
  return syntheticBoard(specs, edges);
}

export function makeUnit(
  id: string,
  faction: FactionId,
  cell: CellId,
  type = 'infantry',
  count = 10,
): UnitInstance {
  return { id, type, faction, cell, count, stance: 'aggressive', attackedFrom: [] };
}
