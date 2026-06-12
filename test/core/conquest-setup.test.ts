// E2 conquest newGame (addendum §B.6) — bases/credits seeded from the donor
// pipeline, donor start-unit mapping vs the default force, determinism, and
// the guarantee that the SKIRMISH path's output shape is untouched (no
// conquest fields appear — bit-identity with pre-E2 states).

import { describe, expect, it, test, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { DEFAULT_CONQUEST_FORCE, newGame } from '../../src/core/setup';
import { generateBoard } from '../../src/board/donor';
import type { DonorMap } from '../../src/board/donor';
import type { GameState } from '../../src/core/types';
import { parseWeewarMap, toDonorMap } from '../../src/io/weewar-xml';
import { loadUnits, loadScenarios } from '../../src/io/data-loader';
import { lineBoard } from './synthetic';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAPS_DIR = resolve(__dirname, '../../data/maps');

const types = loadUnits();
const standard = loadScenarios()['standard']!;

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function loadDonorFile(id: string): DonorMap {
  return toDonorMap(parseWeewarMap(readFileSync(join(MAPS_DIR, `${id}.xml`), 'utf-8')));
}

function snapshot(state: GameState) {
  return JSON.stringify({
    round: state.round,
    phase: state.phase,
    rngSeed: state.rngSeed,
    units: state.units,
    mode: state.mode,
    bases: state.bases,
    credits: state.credits,
    baseless: state.baseless,
    roundLimit: state.roundLimit,
  });
}

describe('conquest newGame on donors', () => {
  it('Valley Road (53316): no donor start units → default force per faction', () => {
    const board = generateBoard(loadDonorFile('53316'), 7);
    const state = newGame(board, standard.forces, types, 7, 'conquest');

    expect(state.mode).toBe('conquest');
    expect(state.roundLimit).toBeNull();
    expect(state.baseless).toEqual({ 0: 0, 1: 0 });
    // Donor XML: initialCredits 200 — carried, not the fallback.
    expect(state.credits).toEqual({ 0: 200, 1: 200 });
    expect(board.economy).toEqual({ initialCredits: 200, perBaseCredits: 100 });

    // 2 donor bases (factions 0 and 1) → seeded ownership.
    const owners = Object.values(state.bases!);
    expect(owners.filter((o) => o === 0)).toHaveLength(1);
    expect(owners.filter((o) => o === 1)).toHaveLength(1);

    // Default force [infantry, infantry, ranger] per faction.
    for (const faction of [0, 1] as const) {
      const own = Object.values(state.units).filter((u) => u.faction === faction);
      expect(own.map((u) => u.type).sort()).toEqual([...DEFAULT_CONQUEST_FORCE].sort());
    }
    // scenarioForces ignored in conquest: 3 units per side, not 8.
    expect(Object.values(state.units)).toHaveLength(6);

    // Placement: distinct passable cells; faction's anchor = its first base.
    const cells = Object.values(state.units).map((u) => u.cell);
    expect(new Set(cells).size).toBe(cells.length);
    for (const u of Object.values(state.units)) {
      expect(board.cells.get(u.cell)!.terrain).not.toBe('water');
      expect(u.count).toBe(10);
      expect(u.stance).toBe('aggressive');
    }
    const firstBase = (f: 0 | 1) => board.bases!.find((b) => b.faction === f)!.cell;
    expect(cells).toContain(firstBase(0));
    expect(cells).toContain(firstBase(1));

    // Determinism.
    expect(snapshot(newGame(board, standard.forces, types, 7, 'conquest'))).toBe(snapshot(state));
  });

  it('Puddles (33564): donor start units (3 Troopers each) → mapped infantry force', () => {
    const board = generateBoard(loadDonorFile('33564'), 7);
    expect(board.startUnitTypes).toEqual([
      ['infantry', 'infantry', 'infantry'],
      ['infantry', 'infantry', 'infantry'],
    ]);
    const state = newGame(board, standard.forces, types, 7, 'conquest');
    for (const faction of [0, 1] as const) {
      const own = Object.values(state.units).filter((u) => u.faction === faction);
      expect(own.map((u) => u.type)).toEqual(['infantry', 'infantry', 'infantry']);
    }
    // Donor credits: 200 initial / 50 per base.
    expect(state.credits).toEqual({ 0: 200, 1: 200 });
    expect(board.economy!.perBaseCredits).toBe(50);
  });

  it('1v1 Showdown JMK (63319): DFA start units map to artillery', () => {
    const board = generateBoard(loadDonorFile('63319'), 7);
    expect(board.startUnitTypes![0]).toEqual(['artillery', 'artillery', 'artillery', 'artillery']);
    expect(board.startUnitTypes![1]).toEqual(['artillery', 'artillery', 'artillery', 'artillery']);
    const state = newGame(board, standard.forces, types, 7, 'conquest');
    expect(
      Object.values(state.units)
        .filter((u) => u.faction === 0)
        .map((u) => u.type),
    ).toEqual(['artillery', 'artillery', 'artillery', 'artillery']);
    expect(state.credits).toEqual({ 0: 2000, 1: 2000 });
  });

  it('roundLimit parameter lands on the state', () => {
    const board = generateBoard(loadDonorFile('53316'), 7);
    expect(newGame(board, standard.forces, types, 7, 'conquest', 60).roundLimit).toBe(60);
  });
});

describe('conquest newGame on bare boards', () => {
  test('board without donor base/economy data: empty bases, fallback credits, default force', () => {
    const board = lineBoard(Array(20).fill('plains'));
    board.placementAnchors = [0, 19];
    const state = newGame(board, standard.forces, types, 7, 'conquest');
    expect(state.bases).toEqual({});
    expect(state.credits).toEqual({ 0: 100, 1: 100 });
    expect(Object.values(state.units)).toHaveLength(2 * DEFAULT_CONQUEST_FORCE.length);
  });

  test('no bases AND no placementAnchors → explicit error', () => {
    const board = lineBoard(Array(20).fill('plains'));
    expect(() => newGame(board, standard.forces, types, 7, 'conquest')).toThrow(/placementAnchors/);
  });
});

describe('skirmish path is shape-identical to pre-E2', () => {
  test('default mode is skirmish; NO conquest fields appear on the state', () => {
    const board = lineBoard(Array(20).fill('plains'));
    board.placementAnchors = [0, 19];
    const implicit = newGame(board, ['infantry'], types, 7);
    const explicit = newGame(board, ['infantry'], types, 7, 'skirmish');
    for (const state of [implicit, explicit]) {
      expect('mode' in state).toBe(false);
      expect('bases' in state).toBe(false);
      expect('credits' in state).toBe(false);
      expect('baseless' in state).toBe(false);
      expect('roundLimit' in state).toBe(false);
    }
    expect(JSON.stringify(implicit)).toBe(JSON.stringify(explicit));
  });
});
