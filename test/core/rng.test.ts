// Ported from v1 test/rng.test.ts — imports adapted only.
// FNV-1a reference vectors from http://www.isthe.com/chongo/tech/comp/fnv/

import { describe, expect, test } from 'vitest';
import { createRng, fnv1a32, initTieKey } from '../../src/core/rng';

describe('xorshift32 RNG', () => {
  test('same seed produces same sequence', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 8 }, () => a.next());
    const seqB = Array.from({ length: 8 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  test('different seeds diverge', () => {
    const a = createRng(42);
    const b = createRng(43);
    const seqA = Array.from({ length: 4 }, () => a.next());
    const seqB = Array.from({ length: 4 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  test('clone advances independently of original', () => {
    const a = createRng(7);
    a.next();
    const b = a.clone();
    const fromA = [a.next(), a.next()];
    const fromB = [b.next(), b.next()];
    expect(fromA).toEqual(fromB);
    // After both have advanced equally, further independence:
    a.next();
    expect(a.state).not.toBe(b.state);
  });

  test('next returns a non-zero unsigned 32-bit int', () => {
    const r = createRng(1);
    for (let i = 0; i < 100; i++) {
      const v = r.next();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });

  test('nextFloat is in [0, 1)', () => {
    const r = createRng(99);
    for (let i = 0; i < 200; i++) {
      const v = r.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('seed 0 is rejected (xorshift fixed-point)', () => {
    expect(() => createRng(0)).toThrow();
  });
});

describe('FNV-1a 32-bit', () => {
  test('empty string → offset basis', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
  });

  test('"a"', () => {
    expect(fnv1a32('a')).toBe(0xe40c292c);
  });

  test('"foobar"', () => {
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  test('returns unsigned 32-bit', () => {
    const v = fnv1a32('any-input-string');
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(v)).toBe(true);
  });

  test('similar strings produce dissimilar hashes (avalanche)', () => {
    const a = fnv1a32('unit-0:1');
    const b = fnv1a32('unit-1:1');
    expect(a).not.toBe(b);
  });
});

describe('initTieKey (spec §2.2: hash(unitId + ":" + round))', () => {
  test('deterministic for same (unitId, round)', () => {
    expect(initTieKey('unit-A', 5)).toBe(initTieKey('unit-A', 5));
  });

  test('matches the spec separator exactly', () => {
    expect(initTieKey('unit-A', 5)).toBe(fnv1a32('unit-A:5'));
  });

  test('different rounds diverge', () => {
    expect(initTieKey('unit-A', 5)).not.toBe(initTieKey('unit-A', 6));
  });

  test('different unit IDs diverge', () => {
    expect(initTieKey('unit-A', 5)).not.toBe(initTieKey('unit-B', 5));
  });
});
