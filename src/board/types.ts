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

/** E2 (conquest addendum §B.1): one donor base projected onto the board.
 * `faction` is the donor's startFaction (≥2 already collapsed to neutral). */
export type BaseSite = { cell: CellId; faction: 0 | 1 | null };

export type Board = {
  /** Only playable cells (deleted cells absent). */
  cells: Map<CellId, Cell>;
  /** The seed that actually produced the board (requested seed + k when the
   * §4.1 connectivity guard retried). */
  seed: number;
  donorMapId: string;
  /** §4.1 step 7 (P2): cell nearest each faction's first donor base (or first
   * start unit). [faction0, faction1]. Absent on donor-less uniform boards. */
  placementAnchors?: [CellId, CellId];
  /** E2 (addendum §B.1): donor base sites mapped to board cells (nearest
   * passable cell, document order, first-wins dedupe). Absent on donor-less
   * boards and boards generated before E2. */
  bases?: BaseSite[];
  /** E2 (addendum §B.3): donor economy values; fallback 100/100 applied at
   * generation when the donor XML omits them (≤ 0 treated as absent). */
  economy?: { initialCredits: number; perBaseCredits: number };
  /** E2 (addendum §B.6): donor start-unit type keys per faction (UNIT_MAP-
   * mapped entries only, document order). Empty ⇒ the default conquest force. */
  startUnitTypes?: [string[], string[]];
};
