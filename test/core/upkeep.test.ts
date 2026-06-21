// Phase E upkeep (upkeep addendum §2/§3) — income → upkeep → buys, clamp at
// zero, new-recruit exemption, rate-0 disable, and conquest mode-gating.
// Real unit data; synthetic boards. Mirrors the fixture construction in
// test/core/conquest.test.ts.

import { describe, it, expect } from 'vitest';
import { resolveRound } from '../../src/core/resolver';
import type { BuysByFaction } from '../../src/core/resolver';
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

type ConquestOpts = {
  bases: Record<CellId, FactionId | null>;
  credits?: Record<FactionId, number>;
};

function makeConquestState(board: Board, units: UnitInstance[], opts: ConquestOpts): GameState {
  return {
    round: 1,
    phase: 'planning',
    board,
    units: Object.fromEntries(units.map((u) => [u.id, u])),
    pendingOrders: { 0: [], 1: [] },
    rngSeed: 7,
    log: [],
    mode: 'conquest',
    bases: opts.bases,
    credits: opts.credits ?? { 0: 1000, 1: 1000 },
    baseless: { 0: 0, 1: 0 },
    roundLimit: null,
  };
}

function resolve(board: Board, state: GameState, o0: Order[] = [], o1: Order[] = [], buys?: BuysByFaction) {
  return resolveRound(board, state, { 0: o0, 1: o1 }, types, weewar, buys);
}

const upkeepEvents = (log: ResolutionEvent[], f: 0 | 1) =>
  log.filter((e): e is Extract<ResolutionEvent, { type: 'upkeep' }> => e.type === 'upkeep' && e.faction === f);

describe('Phase E upkeep', () => {
  it('debits round(cost×rate×count) per living unit, after income', () => {
    // f0 owns base 0 (income +100), one full infantry (upkeep 8), starts 0.
    // f1 holds base 5 and a far unit so the game keeps running.
    const board = baseLine(6, [0, 5]);
    board.economy = { initialCredits: 0, perBaseCredits: 100 };
    const state = makeConquestState(
      board,
      [makeUnit('a', 0, 1, 'infantry'), makeUnit('b', 1, 4, 'infantry')],
      { bases: { 0: 0, 5: 1 }, credits: { 0: 0, 1: 0 } },
    );
    const { state: s, events } = resolve(board, state);
    const up = upkeepEvents(events, 0)[0]!;
    expect(up.amount).toBe(8);
    expect(up.creditsAfter).toBe(92); // income 100 − upkeep 8
    expect(up.units).toBe(1);
    expect(s.credits![0]).toBe(92);
  });

  it('emits income BEFORE upkeep for each faction', () => {
    const board = baseLine(6, [0, 5]);
    board.economy = { initialCredits: 0, perBaseCredits: 100 };
    const state = makeConquestState(
      board,
      [makeUnit('a', 0, 1, 'infantry'), makeUnit('b', 1, 4, 'infantry')],
      { bases: { 0: 0, 5: 1 }, credits: { 0: 0, 1: 0 } },
    );
    const { events } = resolve(board, state);
    const seq = events
      .filter((e) => (e.type === 'income' || e.type === 'upkeep') && 'faction' in e && e.faction === 0)
      .map((e) => e.type);
    expect(seq).toEqual(['income', 'upkeep']);
  });

  it('clamps at zero — never negative when upkeep exceeds credits', () => {
    // f0 owns no base (income 0) but holds savings 5; upkeep due 8 → paid 5,
    // creditsAfter 0. f1 holds a base so f0 is not annihilated this round.
    const board = baseLine(6, [5]);
    board.economy = { initialCredits: 0, perBaseCredits: 100 };
    const state = makeConquestState(
      board,
      [makeUnit('a', 0, 1, 'infantry'), makeUnit('b', 1, 4, 'infantry')],
      { bases: { 5: 1 }, credits: { 0: 5, 1: 0 } },
    );
    const { state: s, events } = resolve(board, state);
    const up = upkeepEvents(events, 0)[0]!;
    expect(up.amount).toBe(5);
    expect(up.creditsAfter).toBe(0);
    expect(s.credits![0]).toBe(0);
    expect(s.credits![0]).toBeGreaterThanOrEqual(0);
  });

  it('a unit BOUGHT this round pays no upkeep this round', () => {
    // f0 owns base 0 (vacant) + has one infantry standing elsewhere. It buys an
    // infantry on base 0; the upkeep event (emitted before the spawn) counts
    // only the pre-existing living unit, not the new recruit.
    const board = baseLine(6, [0, 5]);
    board.economy = { initialCredits: 0, perBaseCredits: 100 };
    const state = makeConquestState(
      board,
      [makeUnit('a', 0, 2, 'infantry'), makeUnit('b', 1, 4, 'infantry')],
      { bases: { 0: 0, 5: 1 }, credits: { 0: 200, 1: 0 } },
    );
    const buys: BuysByFaction = { 0: [{ kind: 'buy', baseCell: 0, unitTypeKey: 'infantry' }], 1: [] };
    const { state: s, events } = resolve(board, state, [], [], buys);
    const up = upkeepEvents(events, 0)[0]!;
    expect(up.units).toBe(1); // only the pre-existing 'a'
    expect(up.amount).toBe(8); // one full infantry
    // The bought infantry exists at round end but was NOT charged this round.
    expect(s.units['f0-r1-b0-infantry']).toBeDefined();
    // upkeep event index precedes the spawn event index (ordering proof).
    const upIdx = events.findIndex((e) => e.type === 'upkeep' && e.faction === 0);
    const spawnIdx = events.findIndex((e) => e.type === 'spawn');
    expect(upIdx).toBeGreaterThanOrEqual(0);
    expect(spawnIdx).toBeGreaterThan(upIdx);
  });

  it('upkeepRate 0 disables: amount 0, event still emitted', () => {
    const board = baseLine(6, [0, 5]);
    board.economy = { initialCredits: 0, perBaseCredits: 100, upkeepRate: 0 };
    const state = makeConquestState(
      board,
      [makeUnit('a', 0, 1, 'infantry'), makeUnit('b', 1, 4, 'infantry')],
      { bases: { 0: 0, 5: 1 }, credits: { 0: 0, 1: 0 } },
    );
    const { state: s, events } = resolve(board, state);
    const up = upkeepEvents(events, 0)[0]!;
    expect(up).toBeDefined();
    expect(up.amount).toBe(0);
    expect(up.creditsAfter).toBe(100); // income only, nothing drawn
    expect(s.credits![0]).toBe(100);
  });

  it('emits exactly one upkeep event per faction per round', () => {
    const board = baseLine(6, [0, 5]);
    board.economy = { initialCredits: 0, perBaseCredits: 100 };
    const state = makeConquestState(
      board,
      [makeUnit('a', 0, 1, 'infantry'), makeUnit('b', 1, 4, 'infantry')],
      { bases: { 0: 0, 5: 1 }, credits: { 0: 0, 1: 0 } },
    );
    const { events } = resolve(board, state);
    expect(upkeepEvents(events, 0)).toHaveLength(1);
    expect(upkeepEvents(events, 1)).toHaveLength(1);
  });

  it('skirmish emits no upkeep events (mode-gated)', () => {
    const board = baseLine(6, [0, 5]);
    board.economy = { initialCredits: 0, perBaseCredits: 100 };
    const skirmish: GameState = {
      round: 1,
      phase: 'planning',
      board,
      units: Object.fromEntries(
        [makeUnit('a', 0, 1, 'infantry'), makeUnit('b', 1, 4, 'infantry')].map((u) => [u.id, u]),
      ),
      pendingOrders: { 0: [], 1: [] },
      rngSeed: 7,
      log: [],
    };
    const { events } = resolve(board, skirmish);
    expect(events.every((e) => e.type !== 'upkeep')).toBe(true);
  });
});
