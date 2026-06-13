// v0.8 Veterancy tests — TDD suite written BEFORE implementation.
// Three scenarios:
//   1. XP on kill: survivor killer gains 10% of victim type's cost.
//   2. Promotion on threshold: pre-seeded xp tips floor(2*xp/cost) from 0→1,
//      producing a promotion event and a +2 heal.
//   3. No promotion for the dead: mutual kill → no promotion event.
//
// All unit types come from data/units.json (real balance numbers).
// Board factory and makeUnit from ./synthetic.

import { describe, expect, test } from 'vitest';
import { resolveRound } from '../../src/core/resolver';
import { weewar } from '../../src/core/combat/weewar';
import { loadUnits } from '../../src/io/data-loader';
import type { Order } from '../../src/core/orders';
import type { GameState, ResolutionEvent, UnitInstance } from '../../src/core/types';
import type { Board } from '../../src/board/types';
import { lineBoard, makeUnit } from './synthetic';

const types = loadUnits();

function makeState(board: Board, units: UnitInstance[], round = 1): GameState {
  return {
    round,
    phase: 'planning',
    board,
    units: Object.fromEntries(units.map((u) => [u.id, u])),
    pendingOrders: { 0: [], 1: [] },
    rngSeed: 7,
    log: [],
  };
}

function resolve(board: Board, state: GameState, o0: Order[] = [], o1: Order[] = []) {
  return resolveRound(board, state, { 0: o0, 1: o1 }, types, weewar);
}

const ofType = <T extends ResolutionEvent['type']>(events: ResolutionEvent[], type: T) =>
  events.filter((e): e is Extract<ResolutionEvent, { type: T }> => e.type === type);

// ── Test 1: XP on kill ───────────────────────────────────────────────────────
// Sniper (count=10, faction 0, cell=0) explicitly attacks sniper (count=1,
// faction 1, cell=1) — a count-1 target that cannot survive the exchange.
//
// Combat math (plains, no bonuses):
//   A=9 (sniper vs personnel), D=4 (sniper armor), p=0.75
//   engagements = min(10,1) = 1, damage = round(0.75) = 1 → victim at 0 → killed.
//   Counter fires (sniper minRange=1, maxRange=2, dist=1): same calc, damage=1
//   Attacker survives at count=9.
//
// XP expected = round(0.10 * 200) = 20  (sniper cost = 200).
describe('veterancy – XP on kill', () => {
  test('surviving attacker gains 10% of victim type cost as XP', () => {
    const board = lineBoard(['plains', 'plains']);
    const attacker = makeUnit('att', 0, 0, 'sniper', 10);
    const victim = makeUnit('vic', 1, 1, 'sniper', 1);
    const state = makeState(board, [attacker, victim]);

    const { state: s, events } = resolve(
      board,
      state,
      [{ kind: 'attack', unitId: 'att', targetCell: 1 }],
    );

    // Victim must be dead.
    const kills = ofType(events, 'kill');
    expect(kills.some((k) => k.unitId === 'vic')).toBe(true);

    // Killer must survive.
    expect(s.units['att']).toBeDefined();
    expect(s.units['att']!.count).toBeGreaterThan(0);

    // XP = round(0.10 * 200) = 20.
    expect(s.units['att']!.xp).toBe(20);
  });
});

// ── Test 2: Promotion on threshold ──────────────────────────────────────────
// Pre-seed the attacker's XP so that one more kill tips floor(2*xp/cost) from
// 0 to 1, triggering a promotion event.
//
// Sniper cost=200.  floor(2*xp/200) ≥ 1  ⟺  xp ≥ 100.
// Pre-seed xp=80 → after kill: xp=80+20=100 → newRank=1, oldRank=0.
// Heal = 2*(1-0)=2. Attacker count after combat = 9 (took 1 counter damage).
// healedTo = min(10, 9+2) = 10.
describe('veterancy – promotion on threshold', () => {
  test('kill that tips floor(2*xp/cost) to 1 triggers promotion with +2 heal', () => {
    const board = lineBoard(['plains', 'plains']);

    // Pre-seed XP 80 on the attacker — one kill away from rank 1.
    const attacker: UnitInstance = {
      ...makeUnit('att', 0, 0, 'sniper', 10),
      xp: 80,
    };
    const victim = makeUnit('vic', 1, 1, 'sniper', 1);
    const state = makeState(board, [attacker, victim]);

    const { state: s, events } = resolve(
      board,
      state,
      [{ kind: 'attack', unitId: 'att', targetCell: 1 }],
    );

    // Attacker survives and reaches rank 1.
    expect(s.units['att']).toBeDefined();
    expect(s.units['att']!.rank).toBe(1);

    // Exactly one promotion event for the attacker.
    const promos = ofType(events, 'promotion');
    expect(promos).toHaveLength(1);
    expect(promos[0]!.unitId).toBe('att');
    expect(promos[0]!.rank).toBe(1);

    // healedTo: attacker was at count=9 after combat, healed by 2 → 10 (capped).
    expect(promos[0]!.healedTo).toBe(10);
    expect(s.units['att']!.count).toBe(10);
  });
});

// ── Test 3: No promotion for the dead ───────────────────────────────────────
// Scenario: sniper (count=1, faction 0, cell=0) explicitly attacks a sniper
// (count=1, faction 1, cell=1). Both die simultaneously (mutual one-shot).
//
// Combat math:
//   A=9, D=4, p=0.75, engagements=1, damage=1 → victim at 0 (killed by attacker).
//   Counter (sniper, minRange=1): same calc → attacker at 0 (killed by counter).
//
// The attacker accrues XP for the kill but is then removed from state. Because
// promotion only runs for ALIVE units (count > 0), no promotion event is emitted.
describe('veterancy – no promotion for the dead', () => {
  test('killer that also dies this round does not receive a promotion event', () => {
    const board = lineBoard(['plains', 'plains']);
    const attacker = makeUnit('att', 0, 0, 'sniper', 1);
    const victim = makeUnit('vic', 1, 1, 'sniper', 1);
    const state = makeState(board, [attacker, victim]);

    const { events } = resolve(
      board,
      state,
      [{ kind: 'attack', unitId: 'att', targetCell: 1 }],
    );

    // Both must be killed.
    const kills = ofType(events, 'kill');
    expect(kills.some((k) => k.unitId === 'vic')).toBe(true);
    expect(kills.some((k) => k.unitId === 'att')).toBe(true);

    // Zero promotion events — dead units do not promote.
    expect(ofType(events, 'promotion')).toHaveLength(0);
  });
});
