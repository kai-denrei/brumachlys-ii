// donor.test.ts — §4.1 donor pipeline (P2): determinism, silhouette deletion,
// connectivity guard, anchors, placeForce, size-adaptive force sizing, and the
// bundled donors (count derived from data/maps/, small + large).
//
// Node-env tests read donor XMLs from data/maps/ with fs (fs stays OUT of
// src/; the ui-facing src/io/donor-registry.ts uses Vite ?raw instead).

import { describe, expect, it, vi, beforeAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import {
  generateBoard,
  placeForce,
  targetCellsFor,
  adaptiveForceSizeFor,
  GUARD_FORCE_SIZE,
  MIN_LAND_FRACTION,
  PLAYABLE_FLOOR_CELLS,
} from '../../src/board/donor';
import type { DonorMap, DonorTile, FactionId } from '../../src/board/donor';
import { DONOR_ENTRIES } from '../../src/io/donor-registry';
import type { Board, Cell, TerrainKey } from '../../src/board/types';
import { parseWeewarMap, toDonorMap } from '../../src/io/weewar-xml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAPS_DIR = resolve(__dirname, '../../data/maps');

const TERRAIN_KEYS: TerrainKey[] = ['plains', 'woods', 'mountains', 'swamp', 'water', 'base'];

beforeAll(() => {
  // Donor XMLs carry unmapped air/naval start units → expected parser warnings.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function loadDonorFile(file: string): DonorMap {
  return toDonorMap(parseWeewarMap(readFileSync(join(MAPS_DIR, file), 'utf-8')));
}

/** Synthetic donor: a wide strip (rows 0–4 of a 24-wide grid) with a water
 * border on the outer ring and a base per faction. Guarantees silhouette
 * deletion (bbox is much wider than tall → big dead bands in the square
 * mesh frame). */
function syntheticDonor(): DonorMap {
  const tiles: DonorTile[] = [];
  const bases: DonorMap['bases'] = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 24; x++) {
      const border = x === 0 || y === 0 || x === 23 || y === 4;
      let terrain: TerrainKey = border ? 'water' : 'plains';
      if (x === 2 && y === 2) terrain = 'base';
      if (x === 21 && y === 2) terrain = 'base';
      if (x === 10 && y === 2) terrain = 'woods';
      if (x === 12 && y === 2) terrain = 'mountains';
      tiles.push({ x, y, terrain });
    }
  }
  bases.push({ x: 2, y: 2, faction: 0 });
  bases.push({ x: 21, y: 2, faction: 1 });
  return { id: 'synthetic-strip', name: 'Synthetic Strip', tiles, bases, startUnits: [] };
}

function snapshot(board: Board) {
  return {
    seed: board.seed,
    donorMapId: board.donorMapId,
    placementAnchors: board.placementAnchors,
    cells: [...board.cells.entries()].map(([id, c]) => ({
      id,
      cellId: c.id,
      center: c.center,
      polygon: c.polygon,
      neighbors: c.neighbors,
      terrain: c.terrain,
    })),
  };
}

function landIds(board: Board): number[] {
  return [...board.cells.values()].filter((c) => c.terrain !== 'water').map((c) => c.id);
}

/** Largest-component check: BFS over non-water cells from one land cell must
 * reach every land cell (the §4.1 guard keeps exactly one land component). */
function landIsConnected(board: Board): boolean {
  const land = new Set(landIds(board));
  const first = [...land][0];
  if (first === undefined) return false;
  const seen = new Set([first]);
  const stack = [first];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const n of board.cells.get(id)!.neighbors) {
      if (!seen.has(n) && land.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen.size === land.size;
}

describe('donor pipeline — synthetic donor (silhouette + structure)', () => {
  const donor = syntheticDonor();
  const board = generateBoard(donor, 7);

  it('deterministic: same donor + seed → deep-equal boards (§3.3)', () => {
    expect(snapshot(generateBoard(donor, 7))).toEqual(snapshot(board));
  });

  it('different seed → different board', () => {
    expect(snapshot(generateBoard(donor, 19))).not.toEqual(snapshot(board));
  });

  it('silhouette: cells beyond 1.4× pitch of the strip were deleted (ids stay sparse, no renumbering)', () => {
    const ids = [...board.cells.keys()];
    const maxId = Math.max(...ids);
    expect(board.cells.size).toBeLessThan(maxId + 1); // gaps ⇒ deletion happened, ids kept
    for (const [id, cell] of board.cells) expect(cell.id).toBe(id);
    // The strip is 5 rows tall vs 24 columns wide: the kept band must be much
    // shorter than the full frame.
    const ys = [...board.cells.values()].map((c) => c.center[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.5);
  });

  it('every surviving terrain is a valid §6.2 key; donor terrains carried over', () => {
    const seen = new Set<TerrainKey>();
    for (const cell of board.cells.values()) {
      expect(TERRAIN_KEYS).toContain(cell.terrain);
      seen.add(cell.terrain);
    }
    expect(seen.has('plains')).toBe(true);
    expect(seen.has('water')).toBe(true); // border water adjacent to land is kept
  });

  it('adjacency stays symmetric and self-free after deletion', () => {
    for (const [id, cell] of board.cells) {
      expect(cell.neighbors).not.toContain(id);
      for (const n of cell.neighbors) {
        const nc = board.cells.get(n);
        expect(nc, `neighbor ${n} of ${id} must exist`).toBeDefined();
        expect(nc!.neighbors).toContain(id);
      }
    }
  });

  it('connectivity: non-water cells form a single component; kept water touches it', () => {
    expect(landIsConnected(board)).toBe(true);
    const land = new Set(landIds(board));
    for (const cell of board.cells.values()) {
      if (cell.terrain !== 'water') continue;
      expect(cell.neighbors.some((n) => land.has(n))).toBe(true);
    }
  });

  it('anchors: both present, distinct, passable, faction 0 west of faction 1 (donor bases)', () => {
    expect(board.placementAnchors).toBeDefined();
    const [a0, a1] = board.placementAnchors!;
    expect(a0).not.toBe(a1);
    for (const a of [a0, a1]) expect(board.cells.get(a)!.terrain).not.toBe('water');
    // donor base 0 sits at x=2, base 1 at x=21 → anchor centers must reflect that
    expect(board.cells.get(a0)!.center[0]).toBeLessThan(board.cells.get(a1)!.center[0]);
  });

  it('placeForce: n distinct passable cells, ascending BFS distance, deterministic', () => {
    const anchor = board.placementAnchors![0];
    const placed = placeForce(board, anchor, GUARD_FORCE_SIZE);
    expect(placed.length).toBe(GUARD_FORCE_SIZE);
    expect(new Set(placed).size).toBe(GUARD_FORCE_SIZE);
    expect(placed[0]).toBe(anchor);
    for (const id of placed) expect(board.cells.get(id)!.terrain).not.toBe('water');
    expect(placeForce(board, anchor, GUARD_FORCE_SIZE)).toEqual(placed);
    // ascending BFS distance: graph distance to anchor is non-decreasing
    const dist = bfsDepths(board, anchor);
    for (let i = 1; i < placed.length; i++) {
      expect(dist.get(placed[i]!)!).toBeGreaterThanOrEqual(dist.get(placed[i - 1]!)!);
    }
  });

  it('placeForce throws on a water anchor and on unknown cells', () => {
    const water = [...board.cells.values()].find((c) => c.terrain === 'water')!;
    expect(() => placeForce(board, water.id, 1)).toThrow(/water/);
    expect(() => placeForce(board, 999999, 1)).toThrow(/unknown/);
  });
});

describe('donor pipeline — adaptive force sizing (small-board safety net)', () => {
  /** Minimal synthetic board with `landCount` land cells + `waterCount` water
   * cells (terrain only — adaptiveForceSizeFor reads nothing else). */
  function boardWith(landCount: number, waterCount = 0): Board {
    const cells = new Map<number, Cell>();
    let id = 0;
    for (let i = 0; i < landCount; i++, id++) {
      cells.set(id, { id, center: [0, 0], polygon: [], neighbors: [], terrain: 'plains' });
    }
    for (let i = 0; i < waterCount; i++, id++) {
      cells.set(id, { id, center: [0, 0], polygon: [], neighbors: [], terrain: 'water' });
    }
    return { cells, seed: 0, donorMapId: 't' };
  }

  it('returns the full GUARD_FORCE_SIZE on a normal (floor-sized) board', () => {
    // PLAYABLE_FLOOR_CELLS of land ⇒ ⌊60/4⌋ = 15 → clamps to 8.
    expect(adaptiveForceSizeFor(boardWith(PLAYABLE_FLOOR_CELLS))).toBe(GUARD_FORCE_SIZE);
    expect(adaptiveForceSizeFor(boardWith(200))).toBe(GUARD_FORCE_SIZE);
  });

  it('scales DOWN on a tiny board so two forces still fit with room', () => {
    expect(adaptiveForceSizeFor(boardWith(12))).toBe(3); // ⌊12/4⌋
    expect(adaptiveForceSizeFor(boardWith(20))).toBe(5); // ⌊20/4⌋
  });

  it('never demands fewer than 1 unit while any land exists', () => {
    expect(adaptiveForceSizeFor(boardWith(1))).toBe(1);
    expect(adaptiveForceSizeFor(boardWith(3))).toBe(1); // ⌊3/4⌋=0 → clamps to 1
  });

  it('counts only land — water cells do not inflate the force', () => {
    expect(adaptiveForceSizeFor(boardWith(8, 100))).toBe(2); // ⌊8/4⌋, water ignored
  });
});

/** BFS depths over passable cells (mirror of placeForce's metric). */
function bfsDepths(board: Board, from: number): Map<number, number> {
  const dist = new Map([[from, 0]]);
  let frontier = [from];
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const id of frontier) {
      for (const n of board.cells.get(id)!.neighbors) {
        if (dist.has(n) || board.cells.get(n)!.terrain === 'water') continue;
        dist.set(n, dist.get(id)! + 1);
        next.push(n);
      }
    }
    frontier = next;
  }
  return dist;
}

describe('donor pipeline — connectivity guard failure modes', () => {
  it('donor without a faction-1 anchor source throws immediately (not retried)', () => {
    const donor = syntheticDonor();
    donor.bases = donor.bases.filter((b) => b.faction !== 1);
    expect(() => generateBoard(donor, 7)).toThrow(/no base or start unit for faction 1/);
  });

  it('split-land donor (two islands) fails the ≥80% guard visibly after retries', () => {
    // Two equal land islands separated by a wide water channel.
    const tiles: DonorTile[] = [];
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        const terrain: TerrainKey = x === 3 || x === 4 || x === 5 ? 'water' : 'plains';
        tiles.push({ x, y, terrain });
      }
    }
    const donor: DonorMap = {
      id: 'split',
      name: 'Split',
      tiles,
      bases: [
        { x: 1, y: 4, faction: 0 as FactionId },
        { x: 7, y: 4, faction: 1 as FactionId },
      ],
      startUnits: [],
    };
    expect(() => generateBoard(donor, 7)).toThrow(/playable board|connectivity guard/);
    expect(MIN_LAND_FRACTION).toBe(0.8);
  });

  it('runtime floor guard: donor "5" seeds 55/87 (raw 57-cell) retry up to the playable floor', () => {
    // Regression: meshTargetFor only BIASES the mesh up (SILHOUETTE_YIELD is an
    // estimate, not a bound). Donor "5" at these seeds realises a 57-cell board
    // (< PLAYABLE_FLOOR_CELLS) on the first attempt; the floor guard must treat
    // that like a connectivity failure and retry with seed+1 until it clears.
    const donor = loadDonorFile('5.xml');
    for (const seed of [55, 87]) {
      // First attempt alone is genuinely under-floor: with no retries the guard
      // FAILS the attempt and throws, naming the cell-count floor (proves the
      // test has teeth — without the guard this would silently return a 57-cell
      // board).
      expect(
        () => generateBoard(donor, seed, undefined, { maxRetries: 0 }),
        `seed ${seed} first attempt`,
      ).toThrow(new RegExp(`${PLAYABLE_FLOOR_CELLS}-cell playable floor`));
      // With retries the guard pushes past the floor (and records the real seed).
      const board = generateBoard(donor, seed);
      expect(board.cells.size, `seed ${seed} guarded`).toBeGreaterThanOrEqual(PLAYABLE_FLOOR_CELLS);
      expect(board.seed, `seed ${seed} retried`).toBeGreaterThan(seed);
    }
  });
});

describe('donor pipeline — bundled donors (data/maps/), size-adaptive contract', () => {
  const files = readdirSync(MAPS_DIR).filter((f) => f.endsWith('.xml'));

  // Donor count is DERIVED, not hard-coded: every bundled XML must have a
  // matching DONOR_ENTRIES row and vice versa, so adding/removing a map can
  // never leave this assertion stale (the old `=== 5` failed the moment we
  // bundled three more maps).
  it('every data/maps/*.xml is registered in DONOR_ENTRIES and vice versa', () => {
    const dirIds = new Set(files.map((f) => f.replace(/\.xml$/, '')));
    const entryIds = new Set(DONOR_ENTRIES.map((e) => e.id));
    expect([...dirIds].sort()).toEqual([...entryIds].sort());
  });

  // SIZE-ADAPTIVE per-map contract. We no longer assert hard `cells.size >= 60`
  // and `placeForce(...).length === 8` for every map — those fail by design on
  // a 6-tile donor. Instead we assert the adaptive invariants that hold across
  // ALL sizes:
  //   - the board reaches the PLAYABLE_FLOOR (the mesh-density rule guarantees
  //     this even for the tiniest donor),
  //   - land is one connected component,
  //   - two distinct anchors exist,
  //   - the board's ADAPTIVE force size (1..GUARD_FORCE_SIZE) is placeable at
  //     each anchor,
  //   - every terrain is a valid §6.2 key,
  //   - every base site renders as 'base'.
  // Swept over seeds 1..64 so an unlucky seed cannot hide a regression. The wide
  // sweep has TEETH on the playable floor: donor "5" at seeds 55/87 realises a
  // raw 57-cell board (below the 60 floor) — the runtime floor guard in donor.ts
  // must retry those away, so every seed here clears PLAYABLE_FLOOR_CELLS.
  const SWEEP_SEEDS = Array.from({ length: 64 }, (_, i) => i + 1);

  for (const file of files) {
    it(`${file} generates a valid playable board across seeds 1..64`, () => {
      const donor = loadDonorFile(file);
      for (const seed of SWEEP_SEEDS) {
        const board = generateBoard(donor, seed);
        const ctx = `${file} seed ${seed}`;

        // Playable-size floor reached regardless of donor size.
        expect(board.cells.size, `${ctx}: below playable floor`).toBeGreaterThanOrEqual(
          PLAYABLE_FLOOR_CELLS,
        );
        expect(board.donorMapId).toBe(donor.id);

        // Single connected land component.
        expect(landIsConnected(board), `${ctx}: land not connected`).toBe(true);

        // Two distinct anchors.
        expect(board.placementAnchors, `${ctx}: no anchors`).toBeDefined();
        const [a0, a1] = board.placementAnchors!;
        expect(a0, `${ctx}: anchors collide`).not.toBe(a1);

        // Adaptive force is placeable at each anchor (1 ≤ force ≤ 8).
        const force = adaptiveForceSizeFor(board);
        expect(force).toBeGreaterThanOrEqual(1);
        expect(force).toBeLessThanOrEqual(GUARD_FORCE_SIZE);
        expect(placeForce(board, a0, force).length, `${ctx}: force unplaceable at a0`).toBe(force);
        expect(placeForce(board, a1, force).length, `${ctx}: force unplaceable at a1`).toBe(force);

        // Every terrain is a valid §6.2 key.
        for (const cell of board.cells.values()) {
          expect(TERRAIN_KEYS, `${ctx}: bad terrain`).toContain(cell.terrain);
        }

        // INVARIANT (v0.9): cell.terrain === 'base'  ⟺  cell ∈ board.bases.
        // Both directions, so no orphan base-terrain cell (renders/reports as a
        // base but is NOT capturable) and no registered base on non-base terrain.
        const registered = new Set((board.bases ?? []).map((s) => s.cell));
        for (const [id, cell] of board.cells) {
          const isBaseTerrain = cell.terrain === 'base';
          const isRegistered = registered.has(id);
          // (→) every registered base site renders as 'base'.
          // (←) every base-terrain cell is a registered, capturable base.
          expect(
            isBaseTerrain,
            `${ctx}: cell ${id} terrain==='base' is ${isBaseTerrain} but registered is ${isRegistered} (orphan/uncapturable base or non-base registered site)`,
          ).toBe(isRegistered);
        }

        // Declared sites are PRESERVED where placement is possible: collisions
        // fall through to the next free passable cell rather than silently
        // shrinking the base count. These bundled donors are all comfortably
        // larger than their base count, so every declared site is placeable and
        // the registered count must equal the donor's declared-site count.
        const donorBaseSites = donor.bases.length;
        expect(
          registered.size,
          `${ctx}: registered base count ${registered.size} < declared ${donorBaseSites} (a placeable declared site was dropped)`,
        ).toBeGreaterThanOrEqual(donorBaseSites);
      }
    });
  }

  // The five ORIGINAL large donors must still host the FULL standard army at
  // each anchor — the small-map adaptivity must not weaken the large-map
  // guarantee. (These all have ≥150 tiles → boards well above the floor → the
  // adaptive force is always the full GUARD_FORCE_SIZE.)
  const LARGE_DONOR_FILES = ['55480.xml', '33564.xml', '53316.xml', '63319.xml', '34069.xml'];
  for (const file of LARGE_DONOR_FILES) {
    it(`${file} (large donor) still hosts a full ${GUARD_FORCE_SIZE}-unit force at each anchor`, () => {
      const donor = loadDonorFile(file);
      for (const seed of [7, 8]) {
        const board = generateBoard(donor, seed);
        expect(adaptiveForceSizeFor(board)).toBe(GUARD_FORCE_SIZE);
        const [a0, a1] = board.placementAnchors!;
        expect(placeForce(board, a0, GUARD_FORCE_SIZE).length).toBe(GUARD_FORCE_SIZE);
        expect(placeForce(board, a1, GUARD_FORCE_SIZE).length).toBe(GUARD_FORCE_SIZE);
      }
    });
  }

  it('bundled donors are deterministic: same donor + seed twice → deep-equal', () => {
    const donor = loadDonorFile(files[0]!);
    expect(snapshot(generateBoard(donor, 7))).toEqual(snapshot(generateBoard(donor, 7)));
  });

  it('targetCellsFor clamps to [PLAYABLE_FLOOR, 250]', () => {
    const donor = loadDonorFile(files[0]!);
    expect(targetCellsFor(donor)).toBe(Math.max(PLAYABLE_FLOOR_CELLS, Math.min(250, donor.tiles.length)));
    // A tiny donor floors at PLAYABLE_FLOOR_CELLS (and the mesh subdivides
    // harder to actually reach it — see meshTargetFor).
    expect(targetCellsFor({ ...donor, tiles: donor.tiles.slice(0, 10) })).toBe(PLAYABLE_FLOOR_CELLS);
  });
});
