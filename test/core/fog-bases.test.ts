// E2 base vision (conquest addendum §B.1) — owned bases contribute
// BASE_VISION to the faction's union; seedDiscovery includes base
// footprints; omitting `bases` (the skirmish path) is bit-identical to
// pre-E2 behaviour.

import { describe, expect, test } from 'vitest';
import { BASE_VISION, seedDiscovery, visibleCells } from '../../src/core/fog';
import { loadUnits } from '../../src/io/data-loader';
import { lineBoard, makeUnit } from './synthetic';

const types = loadUnits();

describe('visibleCells with bases', () => {
  // Line of 10 plains cells; heavytank (vision 1) at 0; bases at 6 (own),
  // 9 (enemy).
  const board = lineBoard(Array(10).fill('plains'));
  const units = [makeUnit('ht', 0, 0, 'heavytank')];

  test('owned base adds BASE_VISION cells around it', () => {
    const vis = visibleCells(board, units, 0, types, { 6: 0, 9: 1 });
    // Unit vision 1: cells 0,1. Base at 6 (vision 2): 4..8.
    expect([...vis].sort((a, b) => a - b)).toEqual([0, 1, 4, 5, 6, 7, 8]);
    expect(BASE_VISION).toBe(2);
  });

  test('enemy and neutral bases contribute nothing', () => {
    const vis = visibleCells(board, units, 0, types, { 6: 1, 9: null });
    expect([...vis].sort((a, b) => a - b)).toEqual([0, 1]);
  });

  test('base on a cell missing from the board is ignored', () => {
    const vis = visibleCells(board, units, 0, types, { 42: 0 });
    expect([...vis].sort((a, b) => a - b)).toEqual([0, 1]);
  });

  test('omitting bases (skirmish path) — identical to the pre-E2 call', () => {
    const without = visibleCells(board, units, 0, types);
    const withUndefined = visibleCells(board, units, 0, types, undefined);
    expect([...withUndefined].sort()).toEqual([...without].sort());
    expect([...without].sort((a, b) => a - b)).toEqual([0, 1]);
  });
});

describe('seedDiscovery with bases', () => {
  const board = lineBoard(Array(10).fill('plains'));
  const units = [makeUnit('a', 0, 0, 'heavytank'), makeUnit('b', 1, 9, 'heavytank')];

  test('each faction discovers its OWN bases footprint only', () => {
    const d = seedDiscovery(board, units, types, { 5: 0, 9: 1 });
    expect([...d[0]].sort((a, b) => a - b)).toEqual([0, 1, 3, 4, 5, 6, 7]);
    expect([...d[1]].sort((a, b) => a - b)).toEqual([7, 8, 9]); // unit vision ∪ base at 9
  });

  test('no bases argument — pre-E2 behaviour', () => {
    const d = seedDiscovery(board, units, types);
    expect([...d[0]].sort((a, b) => a - b)).toEqual([0, 1]);
    expect([...d[1]].sort((a, b) => a - b)).toEqual([8, 9]);
  });
});
