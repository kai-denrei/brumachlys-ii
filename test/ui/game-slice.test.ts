// @vitest-environment jsdom
// P8 game slice: commit → AI plans → resolveRound → events + advanced state +
// replay script; outcome detection → banner phase; new-battle reset.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Board, Cell, CellId, TerrainKey, Vec2 } from '../../src/board/types';
import type { FactionId, GameState, UnitInstance } from '../../src/core/types';
import { useAppStore } from '../../src/state/store';

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
  return { cells, seed: 0, donorMapId: 'p8-test', placementAnchors: [0, n - 1] };
}

function unit(
  id: string,
  faction: FactionId,
  cell: CellId,
  type = 'infantry',
  count = 10,
): UnitInstance {
  return { id, type, faction, cell, count, stance: 'aggressive', attackedFrom: [] };
}

function seedGame(board: Board, units: UnitInstance[]) {
  const game: GameState = {
    round: 1,
    phase: 'planning',
    board,
    units: Object.fromEntries(units.map((u) => [u.id, u])),
    pendingOrders: { 0: [], 1: [] },
    rngSeed: 7,
    log: [],
  };
  useAppStore.setState({
    screen: 'battle',
    board,
    game,
    uiPhase: 'planning',
    replay: null,
    selectedUnitId: null,
    orders: {},
    focus: null,
  });
}

const s = () => useAppStore.getState();

describe('game slice (P8)', () => {
  beforeEach(() => {
    useAppStore.setState({
      screen: 'start',
      donorId: '53316',
      seed: 7,
      board: null,
      game: null,
      uiPhase: 'planning',
      replay: null,
      orders: {},
    });
  });

  it('full commit on a real board: events produced, state advanced, replay armed', () => {
    s().startBattle(); // Valley Road, seed 7
    const before = s().game!;
    expect(before.round).toBe(1);

    // Queue something for one own unit (commit gates at ≥1 order).
    const own = Object.values(before.units).find((u) => u.faction === 0)!;
    expect(s().tryQueueOrder({ kind: 'stance', unitId: own.id, stance: 'defensive' }).ok).toBe(
      true,
    );
    s().commit();

    const after = s();
    expect(after.uiPhase).toBe('replay');
    expect(after.game!.round).toBe(2); // resolver advanced the round
    expect(after.game!.log.length).toBeGreaterThan(0); // event log present
    expect(after.replay).not.toBeNull();
    expect(after.replay!.round).toBe(1); // the round that just resolved
    expect(after.replay!.script.frames.length).toBeGreaterThan(0);
    expect(after.orders).toEqual({}); // queues spent
    // The stance order made it through to the resolved state.
    expect(after.game!.units[own.id]!.stance).toBe('defensive');

    // Determinism: same battle, same orders → identical event log.
    const log1 = JSON.stringify(after.game!.log);
    s().startBattle();
    const own2 = Object.values(s().game!.units).find((u) => u.faction === 0)!;
    s().tryQueueOrder({ kind: 'stance', unitId: own2.id, stance: 'defensive' });
    s().commit();
    expect(JSON.stringify(s().game!.log)).toBe(log1);
  });

  it('replay → summary → planning phase machine', () => {
    s().startBattle();
    const own = Object.values(s().game!.units).find((u) => u.faction === 0)!;
    s().tryQueueOrder({ kind: 'stance', unitId: own.id, stance: 'aggressive' });
    s().commit();
    expect(s().uiPhase).toBe('replay');
    s().finishReplay();
    expect(s().uiPhase).toBe('summary');
    s().closeSummary();
    expect(s().uiPhase).toBe('planning'); // no outcome yet on round 1
    expect(s().replay).toBeNull(); // script spent
  });

  it('commit is a no-op outside planning or after the game ended', () => {
    s().startBattle();
    const own = Object.values(s().game!.units).find((u) => u.faction === 0)!;
    s().tryQueueOrder({ kind: 'stance', unitId: own.id, stance: 'defensive' });
    s().commit();
    const round = s().game!.round;
    s().commit(); // uiPhase is 'replay' — ignored
    expect(s().game!.round).toBe(round);
  });

  it('outcome detection: last enemy unit dies → summary leads to the banner', () => {
    // 3-cell line: player tank vs a 1-count enemy infantry in contact. The
    // infantry cannot escape (the tank blocks pass-through) and dies to
    // either the tank's attack, its counter, or a charge brawl — whatever
    // the AI plans. Faction 1 hits zero ⇒ winner 0 (§2.8).
    seedGame(lineBoard(3), [unit('pt', 0, 1, 'tank'), unit('ei', 1, 2, 'infantry', 1)]);
    expect(s().tryQueueOrder({ kind: 'attack', unitId: 'pt', targetCell: 2 }).ok).toBe(true);
    s().commit();
    const g = s().game!;
    expect(g.outcome).toEqual({ winner: 0, reason: 'annihilation' });
    expect(g.phase).toBe('over');
    s().finishReplay();
    s().closeSummary();
    expect(s().uiPhase).toBe('over'); // banner shows
    expect(s().replay).not.toBeNull(); // timeline still browsable under it
  });

  it('autopilot commit plans faction 0 with the same greedy AI', () => {
    s().startBattle();
    s().commitAutopilot(); // no manual orders needed
    expect(s().uiPhase).toBe('replay');
    expect(s().game!.round).toBe(2);
  });

  it('new battle (rematch) resets to round 1 planning with the given seed', () => {
    seedGame(lineBoard(3), [unit('pt', 0, 1, 'tank'), unit('ei', 1, 2, 'infantry', 1)]);
    s().tryQueueOrder({ kind: 'attack', unitId: 'pt', targetCell: 2 });
    s().commit();
    s().finishReplay();
    s().closeSummary();
    expect(s().uiPhase).toBe('over');

    s().rematch(123);
    const after = s();
    expect(after.seed).toBe(123);
    expect(after.screen).toBe('battle');
    expect(after.uiPhase).toBe('planning');
    expect(after.replay).toBeNull();
    expect(after.game!.round).toBe(1);
    expect(after.game!.outcome).toBeUndefined();
    expect(Object.values(after.game!.units).length).toBe(16);
  });
});
