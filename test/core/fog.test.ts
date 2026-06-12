// Fog of war — ported from v1 test/fog.test.ts, hex range → cellsWithin on a
// synthetic line board. Spec §7: union of cellsWithin(unit.cell, vision) over
// the faction's living units.

import { describe, expect, test } from 'vitest';
import {
  DARK_ASSUMED_TERRAIN,
  accumulateDiscovery,
  assumedTerrainView,
  fogTier,
  seedDiscovery,
  visibleCells,
} from '../../src/core/fog';
import { loadUnits } from '../../src/io/data-loader';
import { lineBoard, makeUnit } from './synthetic';

const unitTypes = loadUnits(); // infantry vision 2, sniper vision 4 (spec §6.1)

// 10 plains cells in a line: 0—1—…—9.
const board = lineBoard(Array(10).fill('plains'));

describe('visibleCells (spec §7)', () => {
  test('own cell is always visible (cellsWithin includes origin)', () => {
    const v = visibleCells(board, [makeUnit('a', 0, 3)], 0, unitTypes);
    expect(v.has(3)).toBe(true);
  });

  test('infantry (vision 2): cells at distance ≤ 2 visible, distance 3 not', () => {
    const v = visibleCells(board, [makeUnit('a', 0, 0)], 0, unitTypes);
    expect(v.has(1)).toBe(true);
    expect(v.has(2)).toBe(true); // exactly at vision distance — ≤, not <
    expect(v.has(3)).toBe(false);
  });

  test('sniper (vision 4) sees farther', () => {
    const v = visibleCells(board, [makeUnit('s', 0, 0, 'sniper')], 0, unitTypes);
    expect(v.has(4)).toBe(true);
    expect(v.has(5)).toBe(false);
  });

  test('union over multiple friendly units', () => {
    const a = makeUnit('a', 0, 0); // sees 0..2
    const b = makeUnit('b', 0, 9); // sees 7..9
    const v = visibleCells(board, [a, b], 0, unitTypes);
    expect(v.has(0)).toBe(true);
    expect(v.has(2)).toBe(true);
    expect(v.has(7)).toBe(true);
    expect(v.has(9)).toBe(true);
    expect(v.has(4)).toBe(false); // midpoint — out of range of both
    expect(v.has(5)).toBe(false);
  });

  test('only the requested faction contributes', () => {
    const friendly = makeUnit('f', 0, 0);
    const enemy = makeUnit('e', 1, 9);
    const v = visibleCells(board, [friendly, enemy], 0, unitTypes);
    expect(v.has(9)).toBe(false);
    expect(v.has(8)).toBe(false);
  });

  test('a faction with no units sees nothing', () => {
    const v = visibleCells(board, [makeUnit('e', 1, 0)], 0, unitTypes);
    expect(v.size).toBe(0);
  });

  test('dead units (count 0) see nothing', () => {
    const dead = makeUnit('d', 0, 5, 'infantry', 0);
    const v = visibleCells(board, [dead], 0, unitTypes);
    expect(v.size).toBe(0);
  });

  test('enemy beyond every friendly vision union is invisible (the point of fog)', () => {
    const friendly = makeUnit('f', 0, 0); // vision 2
    const hidden = makeUnit('h', 1, 6);
    const v = visibleCells(board, [friendly, hidden], 0, unitTypes);
    expect(v.has(hidden.cell)).toBe(false);
  });
});

// --- E1 discovery fog (conquest addendum §A) ----------------------------------

describe('fogTier (E1 tier vectors)', () => {
  const discovered = new Set([0, 1, 2, 3]);
  const visible = new Set([2, 3, 4]);

  test('visible cell → live (even if also discovered)', () => {
    expect(fogTier(2, discovered, visible)).toBe('live');
    expect(fogTier(3, discovered, visible)).toBe('live');
  });

  test('visible but not yet in the discovered set → still live', () => {
    expect(fogTier(4, discovered, visible)).toBe('live');
  });

  test('discovered, not visible → memory', () => {
    expect(fogTier(0, discovered, visible)).toBe('memory');
    expect(fogTier(1, discovered, visible)).toBe('memory');
  });

  test('never seen → dark', () => {
    expect(fogTier(9, discovered, visible)).toBe('dark');
  });

  test('empty sets: everything dark', () => {
    expect(fogTier(0, new Set(), new Set())).toBe('dark');
  });
});

describe('accumulateDiscovery (never shrinks)', () => {
  test('union of prior and visible, as a NEW set', () => {
    const prior = new Set([0, 1]);
    const next = accumulateDiscovery(prior, [2, 3]);
    expect([...next].sort()).toEqual([0, 1, 2, 3]);
    expect(next).not.toBe(prior);
    expect(prior.size).toBe(2); // input untouched
  });

  test('shrinking vision NEVER shrinks discovery', () => {
    let disc: ReadonlySet<number> = new Set<number>();
    disc = accumulateDiscovery(disc, [0, 1, 2, 3, 4]); // wide vision
    disc = accumulateDiscovery(disc, [2]); // unit died — vision collapsed
    disc = accumulateDiscovery(disc, []); // no vision at all
    expect([...disc].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  test('absent prior (legacy GameState) treated as empty', () => {
    expect([...accumulateDiscovery(undefined, [5])]).toEqual([5]);
  });
});

describe('seedDiscovery (initial discovery = starting vision unions)', () => {
  test('each faction starts having discovered exactly its own vision union', () => {
    const a = makeUnit('a', 0, 0); // infantry vision 2 → 0..2
    const e = makeUnit('e', 1, 9); // infantry vision 2 → 7..9
    const seeded = seedDiscovery(board, [a, e], unitTypes);
    expect([...seeded[0]].sort()).toEqual([0, 1, 2]);
    expect([...seeded[1]].sort()).toEqual([7, 8, 9]);
  });
});

describe('assumedTerrainView (planning-side believed terrain)', () => {
  // 0:plains 1:mountains 2:water 3:plains — mountains/water hidden unless seen
  const terra = lineBoard(['plains', 'mountains', 'water', 'plains']);

  test('dark cells are assumed optimistic plains', () => {
    const view = assumedTerrainView(terra, new Set(), new Set());
    expect(DARK_ASSUMED_TERRAIN).toBe('plains');
    expect(view(1)).toBe('plains'); // truth: mountains — never seen
    expect(view(2)).toBe('plains'); // truth: water — never seen
  });

  test('memory cells use remembered TRUE terrain', () => {
    const view = assumedTerrainView(terra, new Set([1]), new Set());
    expect(view(1)).toBe('mountains');
    expect(view(2)).toBe('plains'); // still dark
  });

  test('live cells are truth', () => {
    const view = assumedTerrainView(terra, new Set(), new Set([2]));
    expect(view(2)).toBe('water');
  });
});
