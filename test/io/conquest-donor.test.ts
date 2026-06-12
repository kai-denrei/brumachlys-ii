// E2 donor plumbing (conquest addendum §B.1/§B.3/§B.6) — toDonorMap carries
// economy values and UNIT_MAP-mapped start units; generateBoard projects
// base sites onto cells and applies the 100/100 credit fallback.

import { describe, expect, test, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseWeewarMap, toDonorMap } from '../../src/io/weewar-xml';
import { DEFAULT_CREDITS, generateBoard } from '../../src/board/donor';
import type { DonorMap, DonorTile } from '../../src/board/donor';
import type { TerrainKey } from '../../src/board/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const threeWaysXml = readFileSync(resolve(__dirname, 'fixtures/three-ways.xml'), 'utf-8');

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('toDonorMap — E2 fields', () => {
  test('carries initialCredits and perBaseCredits from the parsed map', () => {
    const donor = toDonorMap(parseWeewarMap(threeWaysXml));
    expect(donor.initialCredits).toBe(100);
    expect(donor.perBaseCredits).toBe(200);
  });

  test('typedStartUnits keeps mapped units with position, faction, and key', () => {
    const donor = toDonorMap(parseWeewarMap(threeWaysXml));
    // three-ways: 4 surviving Troopers (factions 0/1) → 4 infantry entries.
    expect(donor.typedStartUnits).toHaveLength(4);
    for (const u of donor.typedStartUnits!) {
      expect(u.unitTypeKey).toBe('infantry');
      expect([0, 1]).toContain(u.faction);
      expect(typeof u.x).toBe('number');
      expect(typeof u.y).toBe('number');
    }
    // startUnits (anchor source) is a superset shape: positions survive even
    // when types do not map — unchanged by E2.
    expect(donor.startUnits.length).toBeGreaterThanOrEqual(donor.typedStartUnits!.length);
  });

  test('unmapped unit types (air/naval) appear in startUnits but not typedStartUnits', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <map id="77"><name>Mixed</name><width>3</width><height>1</height><maxPlayers>2</maxPlayers>
        <terrain x="0" y="0" type="Base" startFaction="0" startUnit="Jet" startUnitOwner="0"/>
        <terrain x="1" y="0" type="Plains" startUnit="Trooper" startUnitOwner="1"/>
        <terrain x="2" y="0" type="Base" startFaction="1"/>
      </map>`;
    const donor = toDonorMap(parseWeewarMap(xml));
    expect(donor.startUnits).toHaveLength(2);
    expect(donor.typedStartUnits).toEqual([{ x: 1, y: 0, faction: 1, unitTypeKey: 'infantry' }]);
  });
});

// ── generateBoard carries conquest data onto the Board ───────────────────────

/** Synthetic 24×5 strip donor (same recipe as test/board/donor.test.ts):
 * water border, plains interior, bases at the ends. */
function stripDonor(overrides: Partial<DonorMap> = {}): DonorMap {
  const tiles: DonorTile[] = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 24; x++) {
      const border = x === 0 || x === 23 || y === 0 || y === 4;
      let terrain: TerrainKey = border ? 'water' : 'plains';
      if (x === 2 && y === 2) terrain = 'base';
      if (x === 21 && y === 2) terrain = 'base';
      tiles.push({ x, y, terrain });
    }
  }
  return {
    id: 'synthetic-strip',
    name: 'Synthetic Strip',
    tiles,
    bases: [
      { x: 2, y: 2, faction: 0 },
      { x: 21, y: 2, faction: 1 },
    ],
    startUnits: [],
    ...overrides,
  };
}

describe('generateBoard — conquest data on the Board', () => {
  test('base sites project to distinct passable cells with donor factions', () => {
    const board = generateBoard(stripDonor(), 7);
    expect(board.bases).toHaveLength(2);
    const [b0, b1] = board.bases!;
    expect(b0!.faction).toBe(0);
    expect(b1!.faction).toBe(1);
    expect(b0!.cell).not.toBe(b1!.cell);
    for (const site of board.bases!) {
      const cell = board.cells.get(site.cell);
      expect(cell).toBeDefined();
      expect(cell!.terrain).not.toBe('water');
    }
    // First-base anchors: the projected base cells ARE the placement anchors.
    expect(board.placementAnchors).toEqual([b0!.cell, b1!.cell]);
  });

  test('neutral bases (faction ≥ 2 collapsed to null upstream) stay neutral', () => {
    const donor = stripDonor({
      bases: [
        { x: 2, y: 2, faction: 0 },
        { x: 21, y: 2, faction: 1 },
        { x: 12, y: 2, faction: null },
      ],
    });
    const board = generateBoard(donor, 7);
    expect(board.bases!.filter((b) => b.faction === null)).toHaveLength(1);
  });

  test('donor credit values carry through; absent/zero values fall back to 100/100', () => {
    const withCredits = generateBoard(stripDonor({ initialCredits: 250, perBaseCredits: 50 }), 7);
    expect(withCredits.economy).toEqual({ initialCredits: 250, perBaseCredits: 50 });

    const absent = generateBoard(stripDonor(), 7);
    expect(absent.economy).toEqual({ initialCredits: DEFAULT_CREDITS, perBaseCredits: DEFAULT_CREDITS });

    const zeroes = generateBoard(stripDonor({ initialCredits: 0, perBaseCredits: 0 }), 7);
    expect(zeroes.economy).toEqual({ initialCredits: DEFAULT_CREDITS, perBaseCredits: DEFAULT_CREDITS });
  });

  test('typedStartUnits split per faction onto startUnitTypes (document order)', () => {
    const donor = stripDonor({
      typedStartUnits: [
        { x: 3, y: 2, faction: 0, unitTypeKey: 'infantry' },
        { x: 20, y: 2, faction: 1, unitTypeKey: 'tank' },
        { x: 4, y: 2, faction: 0, unitTypeKey: 'artillery' },
      ],
    });
    const board = generateBoard(donor, 7);
    expect(board.startUnitTypes).toEqual([['infantry', 'artillery'], ['tank']]);
  });

  test('no typed start units → empty lists (setup falls back to the default force)', () => {
    const board = generateBoard(stripDonor(), 7);
    expect(board.startUnitTypes).toEqual([[], []]);
  });

  test('determinism: same donor + seed → identical conquest data', () => {
    const a = generateBoard(stripDonor({ initialCredits: 250, perBaseCredits: 50 }), 7);
    const b = generateBoard(stripDonor({ initialCredits: 250, perBaseCredits: 50 }), 7);
    expect(JSON.stringify({ bases: a.bases, economy: a.economy, types: a.startUnitTypes })).toBe(
      JSON.stringify({ bases: b.bases, economy: b.economy, types: b.startUnitTypes }),
    );
  });
});
