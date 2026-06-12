// E2 buy orders (conquest addendum §B.4) — planning-time validation and the
// per-base queue structure. ≤1 buy per base per round is STRUCTURAL
// (queueBuy replaces the same-base slot), mirroring UnitOrders' design.

import { describe, expect, test } from 'vitest';
import { flattenBuys, queueBuy, removeBuy, validateBuy } from '../../src/core/orders';
import type { BuyContext, BuyOrder, BuyQueues } from '../../src/core/orders';
import { loadUnits } from '../../src/io/data-loader';

const types = loadUnits();
const buy = (baseCell: number, unitTypeKey: string): BuyOrder => ({ kind: 'buy', baseCell, unitTypeKey });

function ctx(overrides: Partial<BuyContext> = {}): BuyContext {
  return {
    faction: 0,
    bases: { 3: 0, 5: 1, 9: null },
    credits: 300,
    unitTypes: types,
    ...overrides,
  };
}

describe('validateBuy', () => {
  test('own base, affordable, known type → ok', () => {
    expect(validateBuy(ctx(), buy(3, 'infantry'))).toEqual({ ok: true });
    expect(validateBuy(ctx(), buy(3, 'tank'))).toEqual({ ok: true }); // exactly 300
  });

  test('cell that is not a base site → unknown-base', () => {
    expect(validateBuy(ctx(), buy(4, 'infantry'))).toEqual({ ok: false, reason: 'unknown-base' });
  });

  test('enemy base → not-own-base', () => {
    expect(validateBuy(ctx(), buy(5, 'infantry'))).toEqual({ ok: false, reason: 'not-own-base' });
  });

  test('neutral base → not-own-base', () => {
    expect(validateBuy(ctx(), buy(9, 'infantry'))).toEqual({ ok: false, reason: 'not-own-base' });
  });

  test('unknown unit type → unknown-unit-type', () => {
    expect(validateBuy(ctx(), buy(3, 'zeppelin'))).toEqual({ ok: false, reason: 'unknown-unit-type' });
  });

  test('single buy above credits → insufficient-credits', () => {
    expect(validateBuy(ctx({ credits: 299 }), buy(3, 'tank'))).toEqual({
      ok: false,
      reason: 'insufficient-credits',
    });
  });

  test('TOTAL committed cost across queued buys is what counts', () => {
    const bases = { 3: 0 as const, 4: 0 as const };
    const queued: BuyQueues = { 4: buy(4, 'sniper') }; // 200 committed
    // 200 + 150 = 350 > 300 → rejected even though 150 alone fits.
    expect(validateBuy(ctx({ bases, credits: 300, queued }), buy(3, 'ranger'))).toEqual({
      ok: false,
      reason: 'insufficient-credits',
    });
    // 200 + 75 = 275 ≤ 300 → ok.
    expect(validateBuy(ctx({ bases, credits: 300, queued }), buy(3, 'infantry'))).toEqual({ ok: true });
  });

  test('same-base queued buy is the one being REPLACED — its cost frees up', () => {
    const queued: BuyQueues = { 3: buy(3, 'heavytank') }; // 600 committed
    // Replacing the heavytank with a tank (300) on the same base fits 300 credits.
    expect(validateBuy(ctx({ credits: 300, queued }), buy(3, 'tank'))).toEqual({ ok: true });
  });
});

describe('buy queue structure', () => {
  test('queueBuy replaces the same-base slot (≤1 buy per base, structural)', () => {
    let q: BuyQueues = {};
    q = queueBuy(q, buy(3, 'infantry'));
    q = queueBuy(q, buy(3, 'sniper'));
    q = queueBuy(q, buy(7, 'tank'));
    expect(Object.keys(q)).toHaveLength(2);
    expect(q[3]).toEqual(buy(3, 'sniper'));
  });

  test('removeBuy drops the slot; no-op when absent', () => {
    let q: BuyQueues = { 3: buy(3, 'infantry') };
    expect(removeBuy(q, 4)).toBe(q); // untouched reference
    q = removeBuy(q, 3);
    expect(q).toEqual({});
  });

  test('flattenBuys is base cell ascending (deterministic resolver input)', () => {
    let q: BuyQueues = {};
    q = queueBuy(q, buy(12, 'tank'));
    q = queueBuy(q, buy(3, 'infantry'));
    q = queueBuy(q, buy(7, 'sniper'));
    expect(flattenBuys(q).map((b) => b.baseCell)).toEqual([3, 7, 12]);
  });
});
