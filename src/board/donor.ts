// donor.ts — Weewar donor pipeline (spec §4.1 steps 3–7). PURE.
//
// `generateBoard(donorMap, seed, targetCells?)` is the spec §3.3 signature: the
// donor-less P1 variant lives on as `generateUniformBoard` (generate.ts). The
// board receives a parsed DonorMap object — never raw XML (parsing is src/io).
//
// Frame contract (P1 handoff): the mesh lives in the inset [0.075, 0.925]²
// square. Donor normalization maps the donor's hex-center bounding box into
// that same frame (uniform scale, centered — aspect preserved), and the 1.4×
// donor-tile-pitch deletion radius is expressed in this normalized space.
//
// Cell-id contract (P1 handoff): deletion removes Map entries WITHOUT
// renumbering ids; survivors keep their generation-order ids (sparse).
// Surviving cells' neighbor lists are pruned to surviving ids.
//
// Decisions this file makes where §4.1 is silent (recorded in deban):
// - Largest-component tie-break: bigger wins; equal size → component containing
//   the smallest cell id (deterministic).
// - "Can host both factions' placements" = both anchors resolve to distinct
//   passable cells AND placeForce(board, anchor, 8) succeeds for each faction
//   independently (8 = §6.4 standard army). Mutual overlap of the two BFS
//   regions is NOT checked here — actual army placement is P4/P6 territory.
// - Donor missing a faction-0 or faction-1 anchor source (no base, no start
//   unit) is a donor validation error — thrown immediately, not retried.
// - Board.seed records the seed that actually produced the board (may be
//   requested seed + k after connectivity-guard retries).
// - Donor y grows downward (screen convention); board space is y-up math
//   convention, so normalization flips y to preserve the donor's visual
//   orientation.

import type { Board, Cell, CellId, TerrainKey, Vec2 } from './types';
import { generateCells } from './generate';

export type FactionId = 0 | 1;

export type DonorTile = { x: number; y: number; terrain: TerrainKey };

/** Parsed donor map — plain data, produced by src/io/weewar-xml.ts. Arrays are
 * in document order ("first base" / "first start unit" anchor semantics).
 * The E2 fields are optional so pre-E2 donor literals stay valid. */
export type DonorMap = {
  id: string;
  name: string;
  tiles: DonorTile[];
  bases: Array<{ x: number; y: number; faction: FactionId | null }>;
  startUnits: Array<{ x: number; y: number; faction: FactionId }>;
  /** E2 (addendum §B.3): donor XML credit values; 0/absent ⇒ fallback. */
  initialCredits?: number;
  perBaseCredits?: number;
  /** E2 (addendum §B.6): start units whose Weewar type mapped through
   * UNIT_MAP, document order. Kept separate from `startUnits` (which keeps
   * EVERY faction-0/1 position for anchoring, typed or not). */
  typedStartUnits?: Array<{ x: number; y: number; faction: FactionId; unitTypeKey: string }>;
};

/** E2 (addendum §B.3): credit fallback when the donor XML omits the values. */
export const DEFAULT_CREDITS = 100;

/** §4.1 step 4. */
export function targetCellsFor(donor: DonorMap): number {
  return Math.max(60, Math.min(250, donor.tiles.length));
}

/** §4.1 step 5: deletion radius = 1.4 × donor tile pitch (normalized space). */
export const DELETE_PITCH_FACTOR = 1.4;

/** §4.1 step 6: largest land component must hold ≥ 80% of land cells. */
export const MIN_LAND_FRACTION = 0.8;

/** §4.1 step 6: max retries with seed+1 before erroring visibly. */
export const MAX_RETRIES = 8;

/** §6.4 standard army size — the connectivity guard's placeability probe. */
export const GUARD_FORCE_SIZE = 8;

const SQRT3 = Math.sqrt(3);

// --- step 3: odd-r offset → pixel → normalized board frame -------------------

type DonorFrame = {
  /** normalized hex-center position per donor tile, same order as donor.tiles */
  centers: Vec2[];
  /** donor tile pitch (adjacent hex center distance) in normalized space */
  pitch: number;
  /** map an arbitrary donor (x, y) offset coordinate into the frame */
  project: (x: number, y: number) => Vec2;
  /** estimated fraction of the square mesh frame that survives silhouette
   * deletion: bbox short side plus the 1.4-pitch deletion margin on both
   * sides, over the long side. */
  keptFraction: number;
};

/** Pointy-top odd-r offset → pixel (unit hex size): px = √3·(x + 0.5·(y&1)),
 * py = −1.5·y (y flipped: donor rows grow downward, board y is up). Adjacent
 * hex centers sit √3 apart in every direction — that's the pitch. */
function donorFrame(donor: DonorMap): DonorFrame {
  if (donor.tiles.length === 0) {
    throw new Error(`generateBoard: donor "${donor.id}" has no tiles`);
  }
  const pixel = (x: number, y: number): Vec2 => [SQRT3 * (x + 0.5 * (y & 1)), -1.5 * y];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const pixels = donor.tiles.map((t) => {
    const p = pixel(t.x, t.y);
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
    return p;
  });

  // Uniform scale fitting the bbox into the mesh frame [0.075, 0.925]²
  // (width 0.85, centered on 0.5). Aspect preserved; the shorter axis floats
  // centered. Degenerate bboxes (single row/column) clamp to one pitch.
  const span = Math.max(maxX - minX, maxY - minY, SQRT3);
  const s = 0.85 / span;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const project = (x: number, y: number): Vec2 => {
    const p = pixel(x, y);
    return [0.5 + (p[0] - cx) * s, 0.5 + (p[1] - cy) * s];
  };
  // Short bbox side + the deletion margin (1.4 pitch each side, pixel pitch =
  // √3), over the long side = the share of the square frame that survives
  // step-5 deletion (water-driven connectivity pruning excluded).
  const keptFraction = Math.min(
    1,
    (Math.min(maxX - minX, maxY - minY, span) + 2 * DELETE_PITCH_FACTOR * SQRT3) / span,
  );
  return {
    centers: pixels.map(([px, py]): Vec2 => [0.5 + (px - cx) * s, 0.5 + (py - cy) * s]),
    pitch: SQRT3 * s,
    project,
    keptFraction,
  };
}

/** The square mesh frame is larger than a non-square donor bbox; cells outside
 * the silhouette get deleted (§4.1 step 5). Compensate mesh density by the
 * estimated surviving fraction so the post-silhouette BOARD lands near
 * targetCells (that's what targetCells describes — §4.1 step 4 sizes the mesh
 * "to produce ≈ that many dual cells" on the playable board). Fraction clamped
 * at 1/4 to cap the transient mesh at 4× targetCells for pathologically thin
 * donors. */
function meshTargetFor(targetCells: number, frame: DonorFrame): number {
  return Math.round(targetCells / Math.max(frame.keptFraction, 0.25));
}

/** Introspection helper (donor curation stats, tests): the mesh-cell count
 * generateBoard will aim for before silhouette deletion. */
export function meshTargetForDonor(donor: DonorMap, targetCells: number = targetCellsFor(donor)): number {
  return meshTargetFor(targetCells, donorFrame(donor));
}

// --- steps 5–6 helpers --------------------------------------------------------

function isLand(terrain: TerrainKey): boolean {
  // Guard passability (P2 contract): water impassable, everything else land.
  return terrain !== 'water';
}

/** Nearest donor tile index for a point. Strict-less comparison + document
 * order ⇒ deterministic ties. Linear scan: ≤250 cells × ≤~500 tiles. */
function nearestTile(centers: Vec2[], p: Vec2): { index: number; dist: number } {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < centers.length; i++) {
    const dx = centers[i]![0] - p[0];
    const dy = centers[i]![1] - p[1];
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { index: best, dist: Math.sqrt(bestD) };
}

/** Prune every cell's neighbor list to ids still present in `cells`. */
function pruneNeighbors(cells: Map<CellId, Cell>): void {
  for (const cell of cells.values()) {
    cell.neighbors = cell.neighbors.filter((n) => cells.has(n));
  }
}

/** Connected components of land cells (adjacency restricted to land). */
function landComponents(cells: Map<CellId, Cell>): CellId[][] {
  const seen = new Set<CellId>();
  const components: CellId[][] = [];
  // Map iteration order = insertion order = ascending generation id.
  for (const [id, cell] of cells) {
    if (seen.has(id) || !isLand(cell.terrain)) continue;
    const comp: CellId[] = [];
    let frontier = [id];
    seen.add(id);
    while (frontier.length > 0) {
      const next: CellId[] = [];
      for (const c of frontier) {
        comp.push(c);
        for (const n of cells.get(c)!.neighbors) {
          if (seen.has(n)) continue;
          const nc = cells.get(n);
          if (!nc || !isLand(nc.terrain)) continue;
          seen.add(n);
          next.push(n);
        }
      }
      frontier = next;
    }
    components.push(comp);
  }
  return components;
}

// --- step 7: anchors and force placement -------------------------------------

/** Donor-space anchor source for a faction: first base, else first start unit
 * (document order). Throws if the donor offers neither — donor invalid. */
function anchorSource(donor: DonorMap, faction: FactionId): { x: number; y: number } {
  const base = donor.bases.find((b) => b.faction === faction);
  if (base) return base;
  const unit = donor.startUnits.find((u) => u.faction === faction);
  if (unit) return unit;
  throw new Error(
    `generateBoard: donor "${donor.id}" has no base or start unit for faction ${faction}`,
  );
}

/** Nearest passable (non-water) cell to a normalized point. Iteration in
 * ascending-id order + strict-less ⇒ deterministic ties. */
function nearestPassableCell(cells: Map<CellId, Cell>, p: Vec2): CellId | null {
  let best: CellId | null = null;
  let bestD = Infinity;
  for (const [id, cell] of cells) {
    if (!isLand(cell.terrain)) continue;
    const dx = cell.center[0] - p[0];
    const dy = cell.center[1] - p[1];
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

/**
 * §4.1 step 7 helper for P4/P6: the first `n` distinct passable (non-water)
 * land cells by ascending BFS distance from `anchor`, BFS restricted to
 * passable cells (armies don't deploy across water). Deterministic order:
 * depth ascending, then cell id ascending within a depth. Includes `anchor`
 * itself. Throws if the anchor is impassable/unknown or fewer than `n`
 * passable cells are reachable.
 *
 * Degree-2 rim-cell chains are fine: BFS only needs connectivity, not degree.
 */
export function placeForce(board: Board, anchor: CellId, n: number): CellId[] {
  const start = board.cells.get(anchor);
  if (!start) throw new Error(`placeForce: unknown anchor cell ${anchor}`);
  if (!isLand(start.terrain)) throw new Error(`placeForce: anchor cell ${anchor} is water`);

  const out: CellId[] = [];
  const seen = new Set<CellId>([anchor]);
  let frontier: CellId[] = [anchor];
  while (frontier.length > 0 && out.length < n) {
    frontier.sort((a, b) => a - b);
    for (const id of frontier) {
      out.push(id);
      if (out.length === n) break;
    }
    if (out.length === n) break;
    const next: CellId[] = [];
    for (const id of frontier) {
      for (const nb of board.cells.get(id)!.neighbors) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        const nc = board.cells.get(nb);
        if (!nc || !isLand(nc.terrain)) continue;
        next.push(nb);
      }
    }
    frontier = next;
  }
  if (out.length < n) {
    throw new Error(
      `placeForce: only ${out.length}/${n} passable cells reachable from anchor ${anchor}`,
    );
  }
  return out;
}

// --- the pipeline --------------------------------------------------------------

type AttemptResult =
  | { ok: true; board: Board }
  | { ok: false; reason: string };

function attempt(donor: DonorMap, frame: DonorFrame, seed: number, targetCells: number): AttemptResult {
  // Mesh → cells (P1 core; ids = generation order). Density compensated for
  // the donor's bbox aspect (see meshTargetFor).
  const cells = generateCells(seed, meshTargetFor(targetCells, frame));

  // Step 5: terrain by nearest donor tile; delete cells beyond 1.4× pitch.
  const deleteRadius = DELETE_PITCH_FACTOR * frame.pitch;
  for (const [id, cell] of cells) {
    const { index, dist } = nearestTile(frame.centers, cell.center);
    if (dist > deleteRadius) {
      cells.delete(id); // ids never renumbered
    } else {
      cell.terrain = donor.tiles[index]!.terrain;
    }
  }
  pruneNeighbors(cells);

  // Step 6: largest connected component of land cells.
  const components = landComponents(cells);
  if (components.length === 0) return { ok: false, reason: 'no land cells survived deletion' };
  const totalLand = components.reduce((acc, c) => acc + c.length, 0);
  let main = components[0]!;
  for (const c of components) {
    // bigger wins; equal size → smaller minimum id (components are discovered
    // in ascending-id order, so the first seen wins ties naturally).
    if (c.length > main.length) main = c;
  }
  if (main.length < MIN_LAND_FRACTION * totalLand) {
    return {
      ok: false,
      reason: `largest land component ${main.length}/${totalLand} < ${MIN_LAND_FRACTION * 100}%`,
    };
  }

  // Keep component + adjacent water (lakes render, are impassable).
  const keep = new Set<CellId>(main);
  for (const id of main) {
    for (const n of cells.get(id)!.neighbors) {
      const nc = cells.get(n);
      if (nc && !isLand(nc.terrain)) keep.add(n);
    }
  }
  for (const id of [...cells.keys()]) {
    if (!keep.has(id)) cells.delete(id);
  }
  pruneNeighbors(cells);

  // Step 7: anchors — nearest passable cell to each faction's donor anchor.
  const board: Board = { cells, seed, donorMapId: donor.id };
  const anchors: CellId[] = [];
  for (const faction of [0, 1] as const) {
    const src = anchorSource(donor, faction); // throws if donor invalid (not retryable)
    const cell = nearestPassableCell(cells, frame.project(src.x, src.y));
    if (cell === null) return { ok: false, reason: 'no passable cell for anchor' };
    anchors.push(cell);
  }
  if (anchors[0] === anchors[1]) {
    return { ok: false, reason: 'faction anchors collide on one cell' };
  }
  for (const a of anchors) {
    try {
      placeForce(board, a, GUARD_FORCE_SIZE);
    } catch (e) {
      return { ok: false, reason: `cannot host placement at anchor ${a}: ${(e as Error).message}` };
    }
  }
  board.placementAnchors = [anchors[0]!, anchors[1]!];

  // E2 (addendum §B): carry base sites, economy values, and mapped start-unit
  // types onto the Board so conquest setup (core/setup.ts) never sees the
  // donor. Base sites project like anchors (nearest passable cell); when two
  // donor bases land on one cell, the FIRST in document order wins.
  const baseSites: Board['bases'] = [];
  const baseCellsSeen = new Set<CellId>();
  for (const b of donor.bases) {
    const cell = nearestPassableCell(cells, frame.project(b.x, b.y));
    if (cell === null || baseCellsSeen.has(cell)) continue;
    baseCellsSeen.add(cell);
    baseSites.push({ cell, faction: b.faction });
  }
  board.bases = baseSites;
  board.economy = {
    initialCredits:
      donor.initialCredits !== undefined && donor.initialCredits > 0
        ? donor.initialCredits
        : DEFAULT_CREDITS,
    perBaseCredits:
      donor.perBaseCredits !== undefined && donor.perBaseCredits > 0
        ? donor.perBaseCredits
        : DEFAULT_CREDITS,
  };
  const startUnitTypes: [string[], string[]] = [[], []];
  for (const u of donor.typedStartUnits ?? []) {
    startUnitTypes[u.faction].push(u.unitTypeKey);
  }
  board.startUnitTypes = startUnitTypes;

  return { ok: true, board };
}

/**
 * Board generation from a Weewar donor (spec §3.3 / §4.1). Pure & deterministic:
 * same (donor, seed, targetCells) → identical Board.
 *
 * Connectivity-guard failures retry with seed+1, up to `maxRetries` (default 8,
 * §4.1 step 6); `maxRetries: 0` = first-try-only (donor curation uses this).
 * Cell-count variance at small targets is ±30% — the guard judges connectivity
 * fractions and placeability, never absolute counts, so drift is tolerated.
 */
export function generateBoard(
  donor: DonorMap,
  seed: number,
  targetCells: number = targetCellsFor(donor),
  opts: { maxRetries?: number } = {},
): Board {
  const { maxRetries = MAX_RETRIES } = opts;
  const frame = donorFrame(donor);
  const reasons: string[] = [];
  for (let k = 0; k <= maxRetries; k++) {
    const result = attempt(donor, frame, seed + k, targetCells);
    if (result.ok) return result.board;
    reasons.push(`seed ${seed + k}: ${result.reason}`);
  }
  throw new Error(
    `generateBoard: donor "${donor.id}" failed the connectivity guard after ${
      maxRetries + 1
    } attempt(s) —\n  ${reasons.join('\n  ')}`,
  );
}
