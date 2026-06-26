// @vitest-environment jsdom
// VICTORY DASHBOARD — data layer: roundHistory accumulates one RoundRecord per
// round when each summary closes (AFTER the existing recap accumulation, same
// fog-filtered source), and resets to [] on startBattle / exitBattle / rematch.
// Conquest fields (credits/basesHeld/unitsAlive) are present ONLY in conquest;
// in skirmish they are omitted (the dashboard's economy section hides on them).

import { beforeEach, describe, expect, it } from 'vitest';
import type { CellId } from '../../src/board/types';
import type { FactionId, GameState } from '../../src/core/types';
import type { ReplayScript, Strike, TimelineSlot } from '../../src/state/replay';
import { layoutPhases } from '../../src/state/replay-timing';
import { EMPTY_RECAP, useAppStore } from '../../src/state/store';

const s = () => useAppStore.getState();

function brawlStrike(cell: CellId, att: string, def: string): Strike {
  return {
    kind: 'brawl',
    attackerId: att,
    attackerType: 'infantry',
    attackerCell: cell,
    attackerFaction: 0,
    defenderId: def,
    defenderType: 'infantry',
    defenderCell: cell,
    defenderFaction: 1,
    damage: 3,
    fromMist: false,
    breakdown: {
      A: 8,
      Ta: 0,
      D: 4,
      Td: 0,
      B: 0,
      vet: 0,
      gangUp: { total: 0, contributions: [] },
      p: 0.7,
      damage: 3,
    },
  };
}

function slot(kind: TimelineSlot['kind'], strikes: Strike[] = []): TimelineSlot {
  return { kind, actorType: 'infantry', actorFaction: 0, strikes };
}

function script(over: Partial<ReplayScript> = {}): ReplayScript {
  return {
    slots: [],
    frames: [],
    log: [],
    discovered: new Set<CellId>(),
    phases: layoutPhases(),
    combatants: { cells: new Set<CellId>(), units: new Set<string>() },
    summary: { kills: [], damageDealt: [0, 0], fizzles: 0 },
    ...over,
  };
}

/** A minimal skirmish GameState (no conquest fields). */
function skirmishGame(round: number, over = false): GameState {
  return {
    round,
    phase: over ? 'over' : 'planning',
    board: { cells: new Map(), seed: 0, donorMapId: 't' },
    units: { a: { id: 'a', type: 'infantry', faction: 0, cell: 0, count: 8, stance: 'aggressive', attackedFrom: [] } },
    pendingOrders: { 0: [], 1: [] },
    rngSeed: 1,
    log: [],
    ...(over ? { outcome: { winner: 0 as FactionId, reason: 'annihilation' as const } } : {}),
  };
}

/** A minimal conquest GameState carrying credits/bases/units. */
function conquestGame(round: number, opts: { credits: number; bases: Record<CellId, FactionId | null>; livingPlayer: number }): GameState {
  const units: GameState['units'] = {};
  for (let i = 0; i < opts.livingPlayer; i++) {
    units[`p${i}`] = { id: `p${i}`, type: 'infantry', faction: 0, cell: i, count: 8, stance: 'aggressive', attackedFrom: [] };
  }
  // an enemy + a dead player unit (count 0) to prove the count filters correctly
  units['e0'] = { id: 'e0', type: 'tank', faction: 1, cell: 50, count: 10, stance: 'aggressive', attackedFrom: [] };
  units['dead'] = { id: 'dead', type: 'sniper', faction: 0, cell: 99, count: 0, stance: 'aggressive', attackedFrom: [] };
  return {
    round,
    phase: 'planning',
    board: { cells: new Map(), seed: 0, donorMapId: 't' },
    units,
    pendingOrders: { 0: [], 1: [] },
    rngSeed: 1,
    log: [],
    mode: 'conquest',
    bases: opts.bases,
    credits: { 0: opts.credits, 1: 500 },
    baseless: { 0: 0, 1: 0 },
    roundLimit: null,
  };
}

describe('roundHistory data layer (victory dashboard)', () => {
  beforeEach(() => {
    useAppStore.setState({
      screen: 'battle',
      uiPhase: 'summary',
      game: null,
      battleLog: [],
      casualties: [],
      recap: EMPTY_RECAP,
      roundHistory: [],
      replay: null,
    });
  });

  it('closeSummary appends one RoundRecord per round (skirmish: no economy fields)', () => {
    useAppStore.setState({
      game: skirmishGame(3),
      replay: {
        round: 3,
        script: script({
          summary: {
            kills: [
              { id: 'x', type: 'tank', faction: 1 as FactionId },
              { id: 'y', type: 'infantry', faction: 0 as FactionId },
            ],
            damageDealt: [9, 4],
            fizzles: 2,
          },
          slots: [slot('brawl', [brawlStrike(5, 'a', 'x')]), slot('brawl', [brawlStrike(5, 'a', 'x')])],
        }),
      },
    });
    s().closeSummary();
    expect(s().roundHistory).toHaveLength(1);
    const r = s().roundHistory[0]!;
    expect(r.round).toBe(3);
    expect(r.damageDealt).toEqual([9, 4]);
    expect(r.kills).toBe(2); // both witnessed kills this round
    expect(r.fizzles).toBe(2);
    expect(r.brawls).toBe(1); // one witnessed brawl chain
    // skirmish: no conquest economy fields
    expect(r.credits).toBeUndefined();
    expect(r.basesHeld).toBeUndefined();
    expect(r.unitsAlive).toBeUndefined();
  });

  it('accumulates one record per round across rounds (one entry per closeSummary)', () => {
    useAppStore.setState({
      game: skirmishGame(1),
      replay: { round: 1, script: script({ summary: { kills: [], damageDealt: [3, 1], fizzles: 0 } }) },
    });
    s().closeSummary();
    useAppStore.setState({
      uiPhase: 'summary',
      game: skirmishGame(2),
      replay: { round: 2, script: script({ summary: { kills: [{ id: 'z', type: 'tank', faction: 1 as FactionId }], damageDealt: [5, 6], fizzles: 1 } }) },
    });
    s().closeSummary();
    expect(s().roundHistory.map((r) => r.round)).toEqual([1, 2]);
    expect(s().roundHistory[1]!.damageDealt).toEqual([5, 6]);
    expect(s().roundHistory[1]!.kills).toBe(1);
  });

  it('conquest: each record carries credits, basesHeld, unitsAlive from the post-round state', () => {
    useAppStore.setState({
      game: conquestGame(2, { credits: 325, bases: { 0: 0, 5: 0, 9: 1, 12: null }, livingPlayer: 3 }),
      replay: { round: 2, script: script({ summary: { kills: [], damageDealt: [4, 2], fizzles: 0, creditsSpent: 75 } }) },
    });
    s().closeSummary();
    const r = s().roundHistory[0]!;
    expect(r.credits).toBe(325);
    expect(r.basesHeld).toBe(2); // bases owned by faction 0 (cells 0 and 5)
    expect(r.unitsAlive).toBe(3); // living faction-0 units (count > 0)
  });

  it('appends on the game-over close too (summary → banner path)', () => {
    useAppStore.setState({
      game: skirmishGame(5, true),
      replay: { round: 5, script: script({ summary: { kills: [], damageDealt: [6, 1], fizzles: 0 } }) },
    });
    s().closeSummary();
    expect(s().uiPhase).toBe('over');
    expect(s().roundHistory).toHaveLength(1);
    expect(s().roundHistory[0]!.round).toBe(5);
  });

  it('resets on a new battle (rematch) and is empty after exitBattle', () => {
    useAppStore.setState({
      roundHistory: [{ round: 1, damageDealt: [1, 1], kills: 0, fizzles: 0, brawls: 0 }],
    });
    s().rematch(42);
    expect(s().roundHistory).toEqual([]);

    useAppStore.setState({
      roundHistory: [{ round: 1, damageDealt: [1, 1], kills: 0, fizzles: 0, brawls: 0 }],
    });
    s().exitBattle();
    expect(s().roundHistory).toEqual([]);
  });
});
