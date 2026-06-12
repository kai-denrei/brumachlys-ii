// @vitest-environment jsdom
// E3 — conquest store plumbing: mode/round-limit reach newGame, buys queue
// through validateBuy (committed-total cap, replace semantics), commit routes
// flattenBuys into the resolver and the spawn lands; recap gains spent.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Board, Cell, CellId, TerrainKey, Vec2 } from '../../src/board/types';
import type { FactionId, GameState, UnitInstance } from '../../src/core/types';
import { EMPTY_RECAP, useAppStore } from '../../src/state/store';

function lineBoard(n: number, terrains: Partial<Record<number, TerrainKey>> = {}): Board {
  const cells = new Map<CellId, Cell>();
  for (let i = 0; i < n; i++) {
    cells.set(i, {
      id: i,
      center: [i, 0] as Vec2,
      polygon: [[i, 0] as Vec2, [i, 0] as Vec2, [i, 0] as Vec2],
      neighbors: [i - 1, i + 1].filter((j) => j >= 0 && j < n),
      terrain: terrains[i] ?? 'plains',
    });
  }
  return { cells, seed: 0, donorMapId: 'e3-test', placementAnchors: [0, n - 1] };
}

function unit(id: string, faction: FactionId, cell: CellId, type = 'infantry'): UnitInstance {
  return { id, type, faction, cell, count: 10, stance: 'aggressive', attackedFrom: [] };
}

/** Conquest game: player base 0 (vacant), enemy base 5; infantry mid-board. */
function seedConquest(credits = 200) {
  const board = lineBoard(6, { 0: 'base', 5: 'base' });
  const units = [unit('pi', 0, 2), unit('ei', 1, 4)];
  const game: GameState = {
    round: 1,
    phase: 'planning',
    board,
    units: Object.fromEntries(units.map((u) => [u.id, u])),
    pendingOrders: { 0: [], 1: [] },
    rngSeed: 7,
    log: [],
    mode: 'conquest',
    bases: { 0: 0, 5: 1 },
    credits: { 0: credits, 1: credits },
    baseless: { 0: 0, 1: 0 },
    roundLimit: null,
  };
  useAppStore.setState({
    screen: 'battle',
    board,
    game,
    uiPhase: 'planning',
    replay: null,
    selectedUnitId: null,
    orders: {},
    buys: {},
    focus: null,
    battleLog: [],
    casualties: [],
    recap: EMPTY_RECAP,
  });
}

const s = () => useAppStore.getState();

describe('conquest store (E3)', () => {
  beforeEach(() => {
    useAppStore.setState({
      screen: 'start',
      donorId: '53316',
      seed: 7,
      mode: 'conquest',
      roundLimit: null,
      board: null,
      game: null,
      uiPhase: 'planning',
      replay: null,
      orders: {},
      buys: {},
      casualties: [],
      recap: EMPTY_RECAP,
    });
  });

  it('defaults to conquest; startBattle builds a conquest GameState with the round limit', () => {
    s().setRoundLimit(60);
    s().startBattle(); // Valley Road, seed 7
    const g = s().game!;
    expect(g.mode).toBe('conquest');
    expect(g.bases).toBeDefined();
    expect(Object.keys(g.bases!).length).toBeGreaterThan(0);
    expect(g.credits).toBeDefined();
    expect(g.roundLimit).toBe(60);
    // discovery seeded WITH base vision: every own base cell self-discovered
    for (const [cell, owner] of Object.entries(g.bases!)) {
      if (owner === 0) expect(g.discovered![0].has(Number(cell))).toBe(true);
    }
  });

  it('skirmish mode keeps the v1 shape (no conquest fields, limit ignored)', () => {
    s().setMode('skirmish');
    s().setRoundLimit(60);
    s().startBattle();
    const g = s().game!;
    expect(g.mode).toBeUndefined();
    expect(g.bases).toBeUndefined();
    expect(g.credits).toBeUndefined();
    expect(g.roundLimit).toBeUndefined();
  });

  it('tryQueueBuy: own base only, committed total capped, replace + remove semantics', () => {
    seedConquest(200);
    // not my base
    expect(s().tryQueueBuy({ kind: 'buy', baseCell: 5, unitTypeKey: 'infantry' })).toEqual({
      ok: false,
      reason: 'not-own-base',
    });
    // not a base
    expect(s().tryQueueBuy({ kind: 'buy', baseCell: 2, unitTypeKey: 'infantry' })).toEqual({
      ok: false,
      reason: 'unknown-base',
    });
    // too expensive
    expect(s().tryQueueBuy({ kind: 'buy', baseCell: 0, unitTypeKey: 'heavytank' })).toEqual({
      ok: false,
      reason: 'insufficient-credits',
    });
    // queue, then REPLACE on the same base (its cost frees up: 200 stays legal)
    expect(s().tryQueueBuy({ kind: 'buy', baseCell: 0, unitTypeKey: 'infantry' }).ok).toBe(true);
    expect(s().tryQueueBuy({ kind: 'buy', baseCell: 0, unitTypeKey: 'sniper' }).ok).toBe(true);
    expect(Object.values(s().buys)).toEqual([{ kind: 'buy', baseCell: 0, unitTypeKey: 'sniper' }]);
    s().removeBuyOrder(0);
    expect(s().buys).toEqual({});
  });

  it('commit routes the buy to Phase E: spawn event, credits spent, queue cleared', () => {
    seedConquest(200);
    expect(s().tryQueueBuy({ kind: 'buy', baseCell: 0, unitTypeKey: 'infantry' }).ok).toBe(true);
    s().commit();
    const after = s();
    expect(after.uiPhase).toBe('replay');
    expect(after.buys).toEqual({}); // spent
    const spawns = after.game!.log.filter((e) => e.type === 'spawn');
    expect(spawns).toHaveLength(1);
    expect((spawns[0] as { cell: CellId }).cell).toBe(0);
    // 200 + 100 income (1 base × fallback 100) − 75 infantry = 225
    expect(after.game!.credits![0]).toBe(225);
    // replay frames carry the conquest feeds
    const frames = after.replay!.script.frames;
    expect(frames[0]!.bases).toBeDefined();
    expect(frames[frames.length - 1]!.credits).toBe(225);
    // recap: closing the summary accumulates the spend
    s().finishReplay();
    s().closeSummary();
    expect(s().recap.spent).toBe(75);
  });

  it('buys are blind: committing with only a buy (no unit orders) still resolves', () => {
    seedConquest(200);
    expect(s().tryQueueBuy({ kind: 'buy', baseCell: 0, unitTypeKey: 'ranger' }).ok).toBe(true);
    s().commit();
    expect(s().uiPhase).toBe('replay');
    expect(s().game!.round).toBe(2);
  });
});
