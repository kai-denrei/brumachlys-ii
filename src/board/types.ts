// types.ts — game-facing board types (spec §3.2). PURE.
//
// All game logic sees only `Board` — never the mesh. Cell size/shape is purely
// visual; every cell is one game space.

/** Stable cell identifier: index in generation order. */
export type CellId = number;

export type Vec2 = [number, number];

/** Spec §6.2 — six terrain keys. P1 boards are all-plains. */
export type TerrainKey = 'plains' | 'woods' | 'mountains' | 'swamp' | 'water' | 'base';

export type Cell = {
  id: CellId;
  /** Primary vertex position — used for angles, distances, unit placement. */
  center: Vec2;
  /** CCW render ring (math convention, y up). */
  polygon: Vec2[];
  /** Sorted ascending for determinism. */
  neighbors: CellId[];
  terrain: TerrainKey;
};

export type Board = {
  /** Only playable cells (deleted cells absent). */
  cells: Map<CellId, Cell>;
  seed: number;
  donorMapId: string;
};
