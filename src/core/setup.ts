// newGame — assemble a starting GameState (P4). PURE.
//
// Mirror armies (§6.4): both factions field the same scenario force list
// (data/scenarios.json — variants are data, not code). Units are placed on
// distinct passable land cells by ascending BFS distance from each faction's
// placement anchor (§4.1 step 7), via P2's placementAnchors + placeForce.
//
// P2 WARNING handled here: the two factions' BFS placement regions CAN
// overlap on small boards (P2's connectivity guard only probes each side
// independently). Collisions are detected by intersecting the two placeForce
// results and resolved by INTERLEAVED placement — factions alternate picking
// the next free cell of their own BFS stream (same ordering rule as
// placeForce: depth asc, id asc within a depth, land only). Deterministic,
// and identical to the independent placement whenever the regions are
// disjoint (each faction still receives the first n free cells of its own
// stream).

import type { Board, CellId } from '../board/types';
import { DEFAULT_CREDITS, placeForce } from '../board/donor';
import type { FactionId, GameMode, GameState, UnitInstance, UnitType } from './types';

/** One entry of data/scenarios.json. `forces` lists unit-type keys; both
 *  factions field the same list (mirror armies — fair by construction). */
export type Scenario = {
  name: string;
  description: string;
  forces: string[];
};

/** Conquest addendum §B.6: per-faction force when the donor has no mapped
 *  start units for that faction. */
export const DEFAULT_CONQUEST_FORCE: readonly string[] = ['infantry', 'infantry', 'ranger'];

/**
 * E2: `mode` defaults to 'skirmish' — the pre-E2 call shape and the resulting
 * GameState are BIT-IDENTICAL (no conquest fields, not even `mode`).
 * Conquest (addendum §B.6) ignores `scenarioForces`: each faction fields the
 * donor's mapped start units (board.startUnitTypes) where present, else
 * DEFAULT_CONQUEST_FORCE, placed by placeForce from the faction's first base.
 * `roundLimit` applies to conquest only (null = no limit, the default).
 */
export function newGame(
  board: Board,
  scenarioForces: readonly string[],
  unitTypes: Readonly<Record<string, UnitType>>,
  seed: number,
  mode: GameMode = 'skirmish',
  roundLimit: number | null = null,
): GameState {
  if (mode === 'conquest') return newConquestGame(board, unitTypes, seed, roundLimit);

  const anchors = board.placementAnchors;
  if (!anchors) {
    throw new Error('newGame: board has no placementAnchors (generate it from a donor)');
  }
  if (scenarioForces.length === 0) {
    throw new Error('newGame: scenario force list is empty');
  }
  for (const key of scenarioForces) {
    if (!unitTypes[key]) throw new Error(`newGame: unknown unit type "${key}"`);
  }

  const n = scenarioForces.length;
  // Fast path: P2's placeForce per faction. Falls back to interleaving when
  // the regions collide OR a region alone is too small for n (placeForce
  // throws; interleaving shares the full board and throws its own clearer
  // error if the board truly cannot host both armies).
  let independent: readonly [readonly CellId[], readonly CellId[]] | null;
  try {
    independent = [placeForce(board, anchors[0], n), placeForce(board, anchors[1], n)];
  } catch {
    independent = null;
  }
  const collides =
    independent !== null && new Set([...independent[0], ...independent[1]]).size < 2 * n;
  const placements =
    independent !== null && !collides ? independent : interleavedPlacement(board, anchors, n);

  // Unit k of the force list takes the k-th placement cell. Ids are
  // deterministic and unique even with duplicate types in a force list.
  const units: Record<string, UnitInstance> = {};
  for (const faction of [0, 1] as const) {
    scenarioForces.forEach((type, i) => {
      const id = `f${faction}-${i}-${type}`;
      units[id] = {
        id,
        type,
        faction,
        cell: placements[faction][i]!,
        count: 10,
        stance: 'aggressive',
        attackedFrom: [],
      };
    });
  }

  return {
    round: 1,
    phase: 'planning',
    board,
    units,
    pendingOrders: { 0: [], 1: [] },
    // Normalize to a non-zero u32 — createRng rejects 0 (xorshift fixpoint).
    rngSeed: seed >>> 0 || 1,
    log: [],
  };
}

/** Full BFS placement stream from an anchor — placeForce's ordering rule
 *  (depth asc, id asc within a depth, non-water only) without the length cap,
 *  so interleaving can skip cells the other faction already took. */
function landBfsOrder(board: Board, anchor: CellId): CellId[] {
  const start = board.cells.get(anchor);
  if (!start || start.terrain === 'water') {
    throw new Error(`newGame: anchor ${anchor} is missing or water`);
  }
  const out: CellId[] = [];
  const seen = new Set<CellId>([anchor]);
  let frontier: CellId[] = [anchor];
  while (frontier.length > 0) {
    frontier.sort((a, b) => a - b);
    out.push(...frontier);
    const next: CellId[] = [];
    for (const id of frontier) {
      for (const nb of board.cells.get(id)!.neighbors) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        const nc = board.cells.get(nb);
        if (!nc || nc.terrain === 'water') continue;
        next.push(nb);
      }
    }
    frontier = next;
  }
  return out;
}

function interleavedPlacement(
  board: Board,
  anchors: readonly [CellId, CellId],
  n: number,
): [CellId[], CellId[]] {
  const streams = [landBfsOrder(board, anchors[0]), landBfsOrder(board, anchors[1])] as const;
  const ptr: [number, number] = [0, 0];
  const taken = new Set<CellId>();
  const out: [CellId[], CellId[]] = [[], []];
  for (let i = 0; i < n; i++) {
    for (const faction of [0, 1] as const) {
      const stream = streams[faction];
      let p = ptr[faction];
      while (p < stream.length && taken.has(stream[p]!)) p++;
      if (p >= stream.length) {
        throw new Error(
          `newGame: not enough placement cells for faction ${faction} (need ${n}, placed ${out[faction].length})`,
        );
      }
      taken.add(stream[p]!);
      out[faction].push(stream[p]!);
      ptr[faction] = p + 1;
    }
  }
  return out;
}

// ── E2: conquest setup (addendum §B.6) ───────────────────────────────────────

/** Conquest force list for one faction: the donor's UNIT_MAP-mapped start
 *  units where present (filtered to roster keys — donor data may predate a
 *  roster change), else the default force. */
function conquestForces(
  board: Board,
  faction: FactionId,
  unitTypes: Readonly<Record<string, UnitType>>,
): string[] {
  const donor = (board.startUnitTypes?.[faction] ?? []).filter((key) => unitTypes[key]);
  return donor.length > 0 ? donor : [...DEFAULT_CONQUEST_FORCE];
}

/** Same alternating rule as interleavedPlacement, generalized to per-faction
 *  force sizes (conquest armies need not mirror). Identical picks whenever
 *  n0 === n1 and the regions overlap the same way. */
function interleavedPlacementUneven(
  board: Board,
  anchors: readonly [CellId, CellId],
  counts: readonly [number, number],
): [CellId[], CellId[]] {
  const streams = [landBfsOrder(board, anchors[0]), landBfsOrder(board, anchors[1])] as const;
  const ptr: [number, number] = [0, 0];
  const taken = new Set<CellId>();
  const out: [CellId[], CellId[]] = [[], []];
  for (let i = 0; i < Math.max(counts[0], counts[1]); i++) {
    for (const faction of [0, 1] as const) {
      if (out[faction].length >= counts[faction]) continue;
      const stream = streams[faction];
      let p = ptr[faction];
      while (p < stream.length && taken.has(stream[p]!)) p++;
      if (p >= stream.length) {
        throw new Error(
          `newGame: not enough placement cells for faction ${faction} (need ${counts[faction]}, placed ${out[faction].length})`,
        );
      }
      taken.add(stream[p]!);
      out[faction].push(stream[p]!);
      ptr[faction] = p + 1;
    }
  }
  return out;
}

function newConquestGame(
  board: Board,
  unitTypes: Readonly<Record<string, UnitType>>,
  seed: number,
  roundLimit: number | null,
): GameState {
  // Bases seeded from the donor pipeline (board.bases; §B.1). Insertion
  // order = donor document order — deterministic.
  const bases: Record<CellId, FactionId | null> = {};
  for (const site of board.bases ?? []) bases[site.cell] = site.faction;

  // Placement anchor per faction: its FIRST owned base (donor document
  // order), else the P2 placement anchor (donor "first base, else first
  // start unit" — §4.1 step 7).
  const anchorFor = (faction: FactionId): CellId => {
    const own = (board.bases ?? []).find((site) => site.faction === faction);
    if (own) return own.cell;
    const fallback = board.placementAnchors?.[faction];
    if (fallback === undefined) {
      throw new Error(
        `newGame(conquest): faction ${faction} has no base and the board has no placementAnchors`,
      );
    }
    return fallback;
  };
  const anchors: [CellId, CellId] = [anchorFor(0), anchorFor(1)];

  const forces: [string[], string[]] = [
    conquestForces(board, 0, unitTypes),
    conquestForces(board, 1, unitTypes),
  ];
  for (const list of forces) {
    for (const key of list) {
      if (!unitTypes[key]) throw new Error(`newGame: unknown unit type "${key}"`);
    }
  }

  // Same placement strategy as skirmish: independent placeForce per faction,
  // interleaved fallback on collision or single-region shortfall.
  let independent: readonly [readonly CellId[], readonly CellId[]] | null;
  try {
    independent = [
      placeForce(board, anchors[0], forces[0].length),
      placeForce(board, anchors[1], forces[1].length),
    ];
  } catch {
    independent = null;
  }
  const collides =
    independent !== null &&
    new Set([...independent[0], ...independent[1]]).size < forces[0].length + forces[1].length;
  const placements =
    independent !== null && !collides
      ? independent
      : interleavedPlacementUneven(board, anchors, [forces[0].length, forces[1].length]);

  const units: Record<string, UnitInstance> = {};
  for (const faction of [0, 1] as const) {
    forces[faction].forEach((type, i) => {
      const id = `f${faction}-${i}-${type}`;
      units[id] = {
        id,
        type,
        faction,
        cell: placements[faction][i]!,
        count: 10,
        stance: 'aggressive',
        attackedFrom: [],
      };
    });
  }

  const initialCredits = board.economy?.initialCredits ?? DEFAULT_CREDITS;
  return {
    round: 1,
    phase: 'planning',
    board,
    units,
    pendingOrders: { 0: [], 1: [] },
    rngSeed: seed >>> 0 || 1,
    log: [],
    mode: 'conquest',
    bases,
    credits: { 0: initialCredits, 1: initialCredits },
    baseless: { 0: 0, 1: 0 },
    roundLimit,
  };
}
