// @vitest-environment jsdom
// FULL AUTO — conquest self-play (the P1-never-buys bug fix).
//
// The bug: commitAutopilot planned faction-0 (P1) with greedyPlanner.planOrders
// (MOVES/ATTACKS ONLY) and committed; the player's BUYS came from store.buys
// (empty under autopilot), so P1 NEVER produced units while P2 (planned through
// the canonical ai.planRound → planConquest dispatcher) built a full economy.
//
// The fix: commitAutopilot now plans P1 through the SAME dispatcher under its
// own archetype (p1ArchetypeKey) and hands the resulting {orders, buys} to a
// widened commit(playerOrders, playerBuys). So in conquest Full Auto both
// factions self-play; in skirmish (no conquest view) planRound → planOrders
// returns no buys and behavior is unchanged.
//
// These assertions exercise the store seam directly (no React) over several
// rounds: faction-0 SPENDS credits / GROWS its army (it is not idle), the P1
// archetype is honored (distinct keys produce distinct production), and
// skirmish Full Auto still produces no buys.

import { beforeEach, describe, expect, it } from 'vitest';
import type { GameState } from '../../src/core/types';
import { useAppStore } from '../../src/state/store';

const s = () => useAppStore.getState();

/** Visible+alive faction-0 army count — grows only if P1 actually produces. */
function f0Army(g: GameState): number {
  return Object.values(g.units).filter((u) => u.faction === 0 && u.count > 0).length;
}

/** Drive one autopilot round to completion (commit → replay → summary → next
 *  planning), returning the round's fog-filtered own-spend (creditsSpent). */
function autopilotRound(): number {
  s().commitAutopilot();
  const spent = s().replay?.script.summary.creditsSpent ?? 0;
  s().finishReplay();
  s().closeSummary();
  return spent;
}

function setupConquest(p1ArchetypeKey: string): void {
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
    archetypeKey: 'balanced',
    p1ArchetypeKey,
    fullAuto: false,
  });
  s().startBattle();
}

describe('FULL AUTO — conquest self-play (P1 buys)', () => {
  beforeEach(() => {
    useAppStore.setState({ p1ArchetypeKey: 'balanced' });
  });

  it('a conquest Full Auto round produces faction-0 BUYS (own credits spent)', () => {
    setupConquest('balanced');
    expect(s().game!.mode).toBe('conquest');

    // Run several rounds; faction-0 MUST spend credits on production at least
    // once (the bug left this permanently 0 — P1 never bought).
    let totalSpent = 0;
    for (let r = 0; r < 6 && !s().game!.outcome; r++) {
      totalSpent += autopilotRound();
    }
    expect(totalSpent).toBeGreaterThan(0);
  });

  it('faction-0 is NOT idle — its army grows as it self-plays', () => {
    setupConquest('balanced');
    const start = f0Army(s().game!);

    let peak = start;
    for (let r = 0; r < 8 && !s().game!.outcome; r++) {
      autopilotRound();
      peak = Math.max(peak, f0Army(s().game!));
    }
    // Production lands new units on the board — the army count climbs past its
    // starting size (the old idle P1 only ever shrank as it lost units).
    expect(peak).toBeGreaterThan(start);
  });

  it("faction-0 credits MOVE round to round (income accrues + spend deducts)", () => {
    setupConquest('balanced');
    const seen = new Set<number>();
    for (let r = 0; r < 5 && !s().game!.outcome; r++) {
      seen.add(s().game!.credits?.[0] ?? -1);
      autopilotRound();
    }
    seen.add(s().game!.credits?.[0] ?? -1);
    // An idle P1 would either hoard a single rising figure or sit; a self-
    // playing one cycles through several distinct credit levels.
    expect(seen.size).toBeGreaterThan(1);
  });

  it('honors p1ArchetypeKey — distinct keys yield distinct production', () => {
    const run = (key: string): number[] => {
      setupConquest(key);
      const spend: number[] = [];
      for (let r = 0; r < 6 && !s().game!.outcome; r++) spend.push(autopilotRound());
      return spend;
    };
    const balanced = run('balanced');
    const swarm = run('swarm');
    // Both self-play (both spend), and the two archetypes diverge — the P1 key
    // genuinely drives the plan, not a hard-coded greedy planner.
    expect(balanced.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(swarm.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(JSON.stringify(balanced)).not.toBe(JSON.stringify(swarm));
  });

  it('changing p1ArchetypeKey mid-game takes effect on the NEXT round', () => {
    setupConquest('balanced');
    s().setP1Archetype('swarm');
    expect(s().p1ArchetypeKey).toBe('swarm');
    // The very next autopilot round plans through the swarm planner (the call
    // reads p1ArchetypeKey fresh) — it still self-plays (a round resolves).
    const round = s().game!.round;
    autopilotRound();
    expect(s().game!.round).toBe(round + 1);
  });
});

describe('FULL AUTO — skirmish unchanged (no buys)', () => {
  it('skirmish commitAutopilot resolves with NO conquest economy (no buys)', () => {
    useAppStore.setState({
      screen: 'start',
      donorId: '53316',
      seed: 7,
      mode: 'skirmish',
      roundLimit: null,
      board: null,
      game: null,
      uiPhase: 'planning',
      replay: null,
      orders: {},
      buys: {},
      p1ArchetypeKey: 'balanced',
      fullAuto: false,
    });
    s().startBattle();
    // Skirmish state is the pre-E2 shape — no `mode`, no `credits` (so no buys
    // ever flow; planRound → planOrders returns {orders, buys: []} and the
    // conquest override is withheld).
    expect(s().game!.mode).toBeUndefined();
    expect(s().game!.credits).toBeUndefined();

    s().commitAutopilot();
    expect(s().uiPhase).toBe('replay');
    // No conquest creditsSpent in skirmish (the field is absent / 0).
    expect(s().replay!.script.summary.creditsSpent ?? 0).toBe(0);
    // The resolved state still carries no conquest economy.
    expect(s().game!.credits).toBeUndefined();
  });
});
