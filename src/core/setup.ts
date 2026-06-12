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
import { placeForce } from '../board/donor';
import type { GameState, UnitInstance, UnitType } from './types';

/** One entry of data/scenarios.json. `forces` lists unit-type keys; both
 *  factions field the same list (mirror armies — fair by construction). */
export type Scenario = {
  name: string;
  description: string;
  forces: string[];
};

export function newGame(
  board: Board,
  scenarioForces: readonly string[],
  unitTypes: Readonly<Record<string, UnitType>>,
  seed: number,
): GameState {
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
