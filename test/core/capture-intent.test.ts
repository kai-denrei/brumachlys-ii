// v0.8 — capture is now OPT-IN: a personnel unit on an unowned base flips it
// (and is consumed) ONLY if it has a { kind: 'capture' } order that round.
// Without the order the unit stands on the base, survives, and flips nothing.

import { describe, expect, test } from 'vitest';
import { resolveRound } from '../../src/core/resolver';
import { weewar } from '../../src/core/combat/weewar';
import { loadUnits } from '../../src/io/data-loader';
import type { Order } from '../../src/core/orders';
import type { FactionId, GameState, ResolutionEvent, UnitInstance } from '../../src/core/types';
import type { Board, CellId } from '../../src/board/types';
import { lineBoard, makeUnit } from './synthetic';

const types = loadUnits();

function baseLine(n: number, baseCells: CellId[]): Board {
  const terrains = Array(n).fill('plains');
  for (const c of baseCells) terrains[c] = 'base';
  return lineBoard(terrains);
}

function makeConquestState(board: Board, units: UnitInstance[], bases: Record<CellId, FactionId | null>): GameState {
  return {
    round: 1,
    phase: 'planning',
    board,
    units: Object.fromEntries(units.map((u) => [u.id, u])),
    pendingOrders: { 0: [], 1: [] },
    rngSeed: 7,
    log: [],
    mode: 'conquest',
    bases,
    credits: { 0: 1000, 1: 1000 },
    baseless: { 0: 0, 1: 0 },
    roundLimit: null,
  };
}

function resolve(board: Board, state: GameState, o0: Order[] = [], o1: Order[] = []) {
  return resolveRound(board, state, { 0: o0, 1: o1 }, types, weewar);
}

const ofType = <T extends ResolutionEvent['type']>(events: ResolutionEvent[], type: T) =>
  events.filter((e): e is Extract<ResolutionEvent, { type: T }> => e.type === type);

describe('capture intent gate (v0.8 — opt-in capture)', () => {
  test('1. No capture without an order: personnel on a neutral base, no capture order → no flip, unit survives', () => {
    // Infantry already standing on a neutral base. No capture order → should
    // NOT flip, NOT be consumed. Under the old automatic rule this would flip.
    const board = baseLine(5, [1]);
    // Faction 1 is far away (cell 4) so no combat fires.
    const state = makeConquestState(
      board,
      [makeUnit('inf', 0, 1, 'infantry'), makeUnit('far', 1, 4, 'infantry')],
      { 1: null },
    );
    // Pass only a hold-fire stance — no capture order.
    const { state: s, events } = resolve(board, state, [
      { kind: 'stance', unitId: 'inf', stance: 'hold-fire' },
    ],
    [{ kind: 'stance', unitId: 'far', stance: 'hold-fire' }]);
    // Base must stay neutral.
    expect(s.bases![1]).toBeNull();
    // No capture event.
    expect(ofType(events, 'capture')).toHaveLength(0);
    // Unit must still exist — NOT consumed.
    expect(s.units['inf']).toBeDefined();
  });

  test('2. Captures with an order: personnel on a neutral base + capture order → flip + unit consumed', () => {
    const board = baseLine(5, [1]);
    // Faction 1 is far away (cell 4) so no combat fires.
    const state = makeConquestState(
      board,
      [makeUnit('inf', 0, 1, 'infantry'), makeUnit('far', 1, 4, 'infantry')],
      { 1: null },
    );
    const { state: s, events } = resolve(board, state, [
      { kind: 'capture', unitId: 'inf' },
    ],
    // Faction 1 holds fire to avoid any cross-fire.
    [{ kind: 'stance', unitId: 'far', stance: 'hold-fire' }]);
    // Base must flip to faction 0.
    expect(s.bases![1]).toBe(0);
    // A capture event must be emitted.
    expect(ofType(events, 'capture')).toEqual([
      { type: 'capture', unitId: 'inf', cell: 1, from: null, to: 0, unitConsumed: true },
    ]);
    // Unit is consumed (not in next state, and no kill event).
    expect(s.units['inf']).toBeUndefined();
    expect(ofType(events, 'kill')).toHaveLength(0);
  });

  test('3. Capture order off a base is a no-op: personnel NOT on any base + capture order → no flip, unit survives', () => {
    // Infantry on a plain cell (not a base) with a capture order.
    // The capture gate must also check that the unit is actually on a base.
    const board = baseLine(4, [2]);
    const state = makeConquestState(
      board,
      [makeUnit('inf', 0, 0, 'infantry'), makeUnit('far', 1, 3, 'infantry')],
      { 2: null },
    );
    // Infantry is at cell 0, base is at cell 2 — not on a base.
    const { state: s, events } = resolve(board, state, [
      { kind: 'capture', unitId: 'inf' },
    ]);
    // No flip — infantry wasn't on the base.
    expect(s.bases![2]).toBeNull();
    expect(ofType(events, 'capture')).toHaveLength(0);
    // Unit must survive.
    expect(s.units['inf']).toBeDefined();
  });
});
