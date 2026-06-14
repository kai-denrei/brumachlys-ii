// src/board — mesh kernel + game-facing board graph. PURE (spec §0).
// Public surface: game code should need only these.

export type { Board, Cell, CellId, TerrainKey, Vec2 } from './types';
export { generateUniformBoard, generateCells, extractCells, poissonRadiusFor } from './generate';
export { generateBoard, placeForce, targetCellsFor } from './donor';
export type { DonorMap, DonorTile, FactionId } from './donor';
export { graphDistance, angleAt, cellsWithin, cellsWithinD } from './geometry';

// Mesh internals — exposed for the P2 donor pipeline and tests, not for game logic.
export { generateMesh, relax, relaxStep, boundaryVertices } from './grid';
export type { Mesh, Quad, GenerateMeshParams } from './grid';
export { buildHalfEdge } from './halfedge';
export { extractDualCells } from './dual';
export { mulberry32 } from './rng';
export { poissonDisk } from './poisson';
export { hexLattice, hexDistance } from './hex';
