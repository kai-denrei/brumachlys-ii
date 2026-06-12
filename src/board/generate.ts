// generate.ts — game-facing board generation (spec §3.2, P1 scope). PURE.
//
// P1: `generateBoard(seed, targetCells)` — uniform board, all terrain 'plains',
// nothing deleted, no donor map. The internal split is deliberate so the P2
// donor pipeline can slot in between the two halves:
//
//   generateMesh+relax (grid.ts)  →  extractCells (here)  →  [P2: terrain
//   assignment / silhouette deletion / connectivity guard]  →  Board
//
// Cell ids are stable: index in generation order (= ascending primary-vertex
// index of the dual extraction). Deleting cells in P2 must NOT renumber the
// survivors — ids stay sparse, the Board map just loses entries.
//
// targetCells → poisson radius calibration: the dual-cell count of the
// pipeline scales as cells ≈ C / r² (measured over seeds {7, 42, 1337} at
// r ∈ [0.06, 0.15]: C = 2.07–2.68, mean ≈ 2.45). We aim with C = 2.45 and the
// tests assert the ±40% tolerance the spec grants (§13.2 "mesh granularity is
// approximate").

import type { Board, Cell, CellId, Vec2 } from './types';
import type { Mesh } from './grid';
import { generateMesh, relax } from './grid';
import { buildHalfEdge } from './halfedge';
import { extractDualCells } from './dual';

/** Empirical constant: dualCellCount ≈ CELL_DENSITY / r². */
const CELL_DENSITY = 2.45;

/** Relaxation target square side, proportional to seed spacing (oskar-procedure
 * shipped SIDE_LENGTH 0.06 against its default r = 0.1). */
const SIDE_LENGTH_FACTOR = 0.6;

/** Spec §3.1 stage 5: fixed iteration count, run to completion synchronously. */
const RELAX_ITERS = 100;

export function poissonRadiusFor(targetCells: number): number {
  if (!Number.isFinite(targetCells) || targetCells < 4) {
    throw new Error(`generateBoard: targetCells must be a number >= 4, got ${targetCells}`);
  }
  return Math.sqrt(CELL_DENSITY / targetCells);
}

/**
 * Extract the game-facing cells from a finalized (relaxed) mesh.
 *
 * - One cell per interior primary vertex (≥ 3 incident quads), id = index in
 *   generation order.
 * - polygon = incident quad centroids, CCW.
 * - Adjacency: two cells are neighbors iff their primary vertices share a quad
 *   edge (derived from the quad list — same edges the half-edge structure
 *   carries). neighbors sorted ascending for determinism.
 * - All terrain 'plains' (P1); P2 overwrites terrain and deletes cells AFTER
 *   extraction so ids stay stable.
 */
export function extractCells(mesh: Mesh): Map<CellId, Cell> {
  const halfEdge = buildHalfEdge(mesh);
  const { cells: dualCells } = extractDualCells(mesh, halfEdge);

  // primary-vertex index -> cell id (generation order)
  const idByVertex = new Map<number, CellId>();
  dualCells.forEach((dc, i) => idByVertex.set(dc.vertexIndex, i));

  // Adjacency from quad edges: an edge (a, b) of any quad whose both endpoints
  // are interior vertices links the two corresponding cells.
  const neighborSets: Set<CellId>[] = dualCells.map(() => new Set<CellId>());
  for (const q of mesh.quads) {
    for (let i = 0; i < 4; i++) {
      const a = q[i as 0 | 1 | 2 | 3];
      const b = q[((i + 1) % 4) as 0 | 1 | 2 | 3];
      const ca = idByVertex.get(a);
      const cb = idByVertex.get(b);
      if (ca === undefined || cb === undefined || ca === cb) continue;
      neighborSets[ca]!.add(cb);
      neighborSets[cb]!.add(ca);
    }
  }

  const cells = new Map<CellId, Cell>();
  dualCells.forEach((dc, i) => {
    cells.set(i, {
      id: i,
      center: [...dc.center] as Vec2,
      polygon: dc.centroids.map((p) => [...p] as Vec2),
      neighbors: [...neighborSets[i]!].sort((x, y) => x - y),
      terrain: 'plains',
    });
  });
  return cells;
}

/**
 * The shared mesh→cells core: generate + relax the mesh, extract game-facing
 * cells (all plains). Both the uniform P1 board and the P2 donor pipeline
 * (donor.ts) build on this. Pure and deterministic.
 */
export function generateCells(seed: number, targetCells: number): Map<CellId, Cell> {
  const r = poissonRadiusFor(targetCells);
  const mesh = generateMesh({ seed, r });
  relax(mesh, { n_iters: RELAX_ITERS, SIDE_LENGTH: SIDE_LENGTH_FACTOR * r });
  return extractCells(mesh);
}

/**
 * Donor-less board generation: uniform all-plains board (spec §12 P1; kept as
 * the test/dev variant). Pure and deterministic: same (seed, targetCells) →
 * identical Board. The spec §3.3 signature `generateBoard(donorMap, seed,
 * targetCells)` lives in donor.ts.
 */
export function generateUniformBoard(seed: number, targetCells: number): Board {
  return { cells: generateCells(seed, targetCells), seed, donorMapId: 'uniform' };
}
