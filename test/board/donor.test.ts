// donor.test.ts — §4.1 donor pipeline (P2): determinism, silhouette deletion,
// connectivity guard, anchors, placeForce, and the 5 bundled donors.
//
// Node-env tests read donor XMLs from data/maps/ with fs (fs stays OUT of
// src/; the ui-facing src/io/donor-registry.ts uses Vite ?raw instead).

import { describe, expect, it, vi, beforeAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { generateBoard, placeForce, targetCellsFor, GUARD_FORCE_SIZE, MIN_LAND_FRACTION } from '../../src/board/donor';
import type { DonorMap, DonorTile, FactionId } from '../../src/board/donor';
import type { Board, TerrainKey } from '../../src/board/types';
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
    expect(() => generateBoard(donor, 7)).toThrow(/connectivity guard/);
    expect(MIN_LAND_FRACTION).toBe(0.8);
  });
});

describe('donor pipeline — 5 bundled donors (data/maps/)', () => {
  const files = readdirSync(MAPS_DIR).filter((f) => f.endsWith('.xml'));

  it('exactly 5 donors are bundled', () => {
    expect(files.length).toBe(5);
  });

  for (const file of files) {
    for (const seed of [7, 8]) {
      it(`${file} generates successfully at seed ${seed}`, () => {
        const donor = loadDonorFile(file);
        const board = generateBoard(donor, seed);
        expect(board.cells.size).toBeGreaterThanOrEqual(60);
        expect(board.donorMapId).toBe(donor.id);
        expect(landIsConnected(board)).toBe(true);
        expect(board.placementAnchors).toBeDefined();
        const [a0, a1] = board.placementAnchors!;
        expect(a0).not.toBe(a1);
        expect(placeForce(board, a0, GUARD_FORCE_SIZE).length).toBe(GUARD_FORCE_SIZE);
        expect(placeForce(board, a1, GUARD_FORCE_SIZE).length).toBe(GUARD_FORCE_SIZE);
        for (const cell of board.cells.values()) expect(TERRAIN_KEYS).toContain(cell.terrain);
      });
    }
  }

  it('bundled donors are deterministic: same donor + seed twice → deep-equal', () => {
    const donor = loadDonorFile(files[0]!);
    expect(snapshot(generateBoard(donor, 7))).toEqual(snapshot(generateBoard(donor, 7)));
  });

  it('targetCellsFor clamps to [60, 250]', () => {
    const donor = loadDonorFile(files[0]!);
    expect(targetCellsFor(donor)).toBe(Math.max(60, Math.min(250, donor.tiles.length)));
    expect(targetCellsFor({ ...donor, tiles: donor.tiles.slice(0, 10) })).toBe(60);
  });
});
