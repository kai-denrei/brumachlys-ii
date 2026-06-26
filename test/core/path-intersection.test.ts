// Unit tests for the shared path-intersection helpers (addendum 2026-06-22 §1):
// pathsShareCell / firstSharedCell. These are the geometric core extracted from
// the resolver's forced-crossing pre-pass so the AI crossing-awareness heuristic
// and the resolver share one definition. Pure functions over CellId lists.

import { describe, expect, test } from 'vitest';
import { firstSharedCell, pathsShareCell } from '../../src/core/pathing';

describe('pathsShareCell', () => {
  test('disjoint lists do not share a cell', () => {
    expect(pathsShareCell([0, 1, 2], [3, 4, 5])).toBe(false);
  });

  test('one shared cell is enough', () => {
    expect(pathsShareCell([0, 1, 2], [5, 2, 9])).toBe(true);
  });

  test('overlap at the END of one list still counts', () => {
    expect(pathsShareCell([0, 1, 2, 3], [9, 8, 3])).toBe(true);
  });

  test('overlap at the START of one list still counts', () => {
    expect(pathsShareCell([3, 1, 2], [3, 8, 9])).toBe(true);
  });

  test('a single common cell among many counts', () => {
    expect(pathsShareCell([0, 1, 2, 3, 4], [10, 11, 4, 12])).toBe(true);
  });

  test('empty either side → no overlap', () => {
    expect(pathsShareCell([], [1, 2])).toBe(false);
    expect(pathsShareCell([1, 2], [])).toBe(false);
    expect(pathsShareCell([], [])).toBe(false);
  });

  test('symmetric: sharing is order-independent for the boolean form', () => {
    const a = [4, 5, 6];
    const b = [6, 7, 8];
    expect(pathsShareCell(a, b)).toBe(pathsShareCell(b, a));
  });

  test('identical lists share', () => {
    expect(pathsShareCell([7, 8, 9], [7, 8, 9])).toBe(true);
  });
});

describe('firstSharedCell', () => {
  test('returns null when disjoint', () => {
    expect(firstSharedCell([0, 1, 2], [3, 4, 5])).toBeNull();
  });

  test('returns the first cell of `a` that is also in `b` (a-order)', () => {
    // Both 2 and 3 are shared; 2 comes first in `a` → 2.
    expect(firstSharedCell([0, 2, 3], [3, 2, 9])).toBe(2);
  });

  test('order is taken from `a`, not `b` (asymmetric)', () => {
    const a = [5, 6, 7];
    const b = [7, 6, 5];
    // First shared in a-order is 5; in b-order it would be 7.
    expect(firstSharedCell(a, b)).toBe(5);
    expect(firstSharedCell(b, a)).toBe(7);
  });

  test('single shared cell is returned regardless of position', () => {
    expect(firstSharedCell([0, 1, 2, 3], [9, 8, 3])).toBe(3);
  });

  test('empty either side → null', () => {
    expect(firstSharedCell([], [1, 2])).toBeNull();
    expect(firstSharedCell([1, 2], [])).toBeNull();
    expect(firstSharedCell([], [])).toBeNull();
  });

  test('the first shared cell is consistent with pathsShareCell', () => {
    const a = [10, 11, 12, 13];
    const b = [20, 12, 21];
    expect(pathsShareCell(a, b)).toBe(true);
    expect(firstSharedCell(a, b)).toBe(12);
  });
});
