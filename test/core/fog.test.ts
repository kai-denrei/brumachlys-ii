// Fog of war — ported from v1 test/fog.test.ts, hex range → cellsWithin on a
// synthetic line board. Spec §7: union of cellsWithin(unit.cell, vision) over
// the faction's living units.

import { describe, expect, test } from 'vitest';
import { visibleCells } from '../../src/core/fog';
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
