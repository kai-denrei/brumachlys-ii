// newGame (P4 setup) — mirror-army assembly on donor boards: determinism,
// collision-free placement across all 5 bundled donors × seeds {7, 8}, and
// the interleaved-placement fallback for overlapping BFS regions.
//
// Node-env tests read donor XMLs from data/maps/ with fs (same convention as
// test/board/donor.test.ts — fs stays out of src/).

import { describe, expect, it, test, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { newGame } from '../../src/core/setup';
import { generateBoard } from '../../src/board/donor';
import type { DonorMap } from '../../src/board/donor';
import type { Board } from '../../src/board/types';
import type { GameState } from '../../src/core/types';
import { parseWeewarMap, toDonorMap } from '../../src/io/weewar-xml';
import { loadUnits, loadScenarios } from '../../src/io/data-loader';
import { lineBoard } from './synthetic';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAPS_DIR = resolve(__dirname, '../../data/maps');
const DONOR_IDS = ['55480', '33564', '53316', '63319', '34069'];
const SEEDS = [7, 8];

const types = loadUnits();
const standard = loadScenarios()['standard']!;

beforeAll(() => {
  // Donor XMLs carry unmapped air/naval start units → expected parser warnings.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function loadDonorFile(id: string): DonorMap {
  return toDonorMap(parseWeewarMap(readFileSync(join(MAPS_DIR, `${id}.xml`), 'utf-8')));
}

/** Comparable snapshot — board compared by identity-relevant scalars only
 * (Map does not JSON-serialize; board determinism is P2's covered ground). */
function snapshot(state: GameState) {
  return JSON.stringify({
    round: state.round,
    phase: state.phase,
    rngSeed: state.rngSeed,
    units: state.units,
    pendingOrders: state.pendingOrders,
    log: state.log,
    boardSeed: state.board.seed,
    donor: state.board.donorMapId,
  });
}

describe('data/scenarios.json', () => {
  test('standard scenario fields one of each of the 8 land units (§6.4)', () => {
    expect([...standard.forces].sort()).toEqual(
      ['sniper', 'humvee', 'ranger', 'infantry', 'grenadier', 'tank', 'artillery', 'heavytank'].sort(),
    );
    expect(standard.forces).toHaveLength(8);
    for (const key of standard.forces) expect(types[key]).toBeDefined();
  });
});

describe('newGame on the 5 bundled donors × seeds {7, 8}', () => {
  for (const id of DONOR_IDS) {
    for (const seed of SEEDS) {
      it(`donor ${id}, seed ${seed}: collision-free mirror armies, deterministic`, () => {
        const donor = loadDonorFile(id);
        const board: Board = generateBoard(donor, seed);
        const state = newGame(board, standard.forces, types, seed);

        const units = Object.values(state.units);
        expect(units).toHaveLength(16);

        // No placement collisions: 16 distinct cells.
        const cells = units.map((u) => u.cell);
        expect(new Set(cells).size).toBe(16);

        // Every cell exists, is passable land, and units start full strength.
        for (const u of units) {
          const cell = board.cells.get(u.cell);
          expect(cell).toBeDefined();
          expect(cell!.terrain).not.toBe('water');
          expect(u.count).toBe(10);
          expect(u.stance).toBe('aggressive');
          expect(u.attackedFrom).toEqual([]);
        }

        // Mirror armies: 8 per faction, one of each type.
        for (const faction of [0, 1] as const) {
          const own = units.filter((u) => u.faction === faction);
          expect(own).toHaveLength(8);
          expect(own.map((u) => u.type).sort()).toEqual([...standard.forces].sort());
        }

        // Initial state shape.
        expect(state.round).toBe(1);
        expect(state.phase).toBe('planning');
        expect(state.pendingOrders).toEqual({ 0: [], 1: [] });
        expect(state.log).toEqual([]);
        expect(state.outcome).toBeUndefined();

        // Determinism: same inputs → identical state.
        expect(snapshot(newGame(board, standard.forces, types, seed))).toBe(snapshot(state));
      });
    }
  }
});

describe('overlapping placement regions (small-board collision)', () => {
  test('adjacent anchors → interleaved placement, no collisions, deterministic', () => {
    const board = lineBoard(Array(16).fill('plains'));
    board.placementAnchors = [7, 8]; // BFS regions overlap immediately
    const forces = ['infantry', 'tank', 'ranger'];
    const state = newGame(board, forces, types, 7);

    const units = Object.values(state.units);
    expect(units).toHaveLength(6);
    expect(new Set(units.map((u) => u.cell)).size).toBe(6);

    // Interleave is exact: factions alternate taking the next free cell of
    // their own BFS stream (depth asc, id asc within a depth).
    //   f0 stream from 7: 7, 6, 8, 5, 9, ...   f1 stream from 8: 8, 7, 9, 6, 10, ...
    //   picks: f0=7, f1=8, f0=6, f1=9, f0=5, f1=10
    const cellOf = (faction: 0 | 1, i: number, type: string) =>
      state.units[`f${faction}-${i}-${type}`]!.cell;
    expect([cellOf(0, 0, 'infantry'), cellOf(0, 1, 'tank'), cellOf(0, 2, 'ranger')]).toEqual([7, 6, 5]);
    expect([cellOf(1, 0, 'infantry'), cellOf(1, 1, 'tank'), cellOf(1, 2, 'ranger')]).toEqual([8, 9, 10]);

    expect(snapshot(newGame(board, forces, types, 7))).toBe(snapshot(state));
  });

  test('board too small to host both armies → explicit error', () => {
    const board = lineBoard(Array(5).fill('plains'));
    board.placementAnchors = [2, 3];
    expect(() => newGame(board, standard.forces, types, 7)).toThrow(/not enough placement cells/);
  });
});

describe('newGame validation', () => {
  test('board without placementAnchors → explicit error', () => {
    const board = lineBoard(Array(20).fill('plains')); // no anchors set
    expect(() => newGame(board, standard.forces, types, 7)).toThrow(/placementAnchors/);
  });

  test('unknown unit type in the force list → explicit error', () => {
    const board = lineBoard(Array(20).fill('plains'));
    board.placementAnchors = [0, 19];
    expect(() => newGame(board, ['zeppelin'], types, 7)).toThrow(/unknown unit type/);
  });

  test('seed 0 normalizes to a valid non-zero rng seed', () => {
    const board = lineBoard(Array(20).fill('plains'));
    board.placementAnchors = [0, 19];
    const state = newGame(board, ['infantry'], types, 0);
    expect(state.rngSeed).toBe(1);
  });
});
