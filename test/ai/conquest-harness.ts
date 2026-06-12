// E4 conquest sim harness — drives resolveRound directly with BOTH factions'
// {orders, buys} (the §B.7 acceptance loop), mirroring the skirmish
// acceptance harness's pattern plus the two conquest-specific duties:
//   • belief threading: each faction's known-base-ownership memory
//     (view.conquest.bases) is passed back into the next round's
//     buildFactionView — exactly what the store must do (view.ts contract);
//   • buys: planRound dispatches planConquest when the planner has it, and
//     the buys feed resolveRound's 6th argument.

import { performance } from 'node:perf_hooks';
import type { Board } from '../../src/board/types';
import { weewar } from '../../src/core/combat/weewar';
import { resolveRound } from '../../src/core/resolver';
import { createRng } from '../../src/core/rng';
import type { FactionId, GameState, UnitType } from '../../src/core/types';
import { buildFactionView } from '../../src/ai/view';
import type { KnownBases } from '../../src/ai/view';
import { planRound } from '../../src/ai/planner';
import type { OrderPlanner } from '../../src/ai/planner';

export type ConquestReport = {
  state: GameState;
  /** Rounds fully resolved (cap reached without outcome ⇒ === maxRounds). */
  rounds: number;
  baseCounts: [number, number];
  unitCounts: [number, number];
  /** Per-faction-round planning times, ms — both factions interleaved. */
  planTimesMs: number[];
};

/** Play one conquest game to outcome or the round cap. Deterministic. */
export function playConquest(
  board: Board,
  state0: GameState,
  planners: [OrderPlanner, OrderPlanner],
  types: Readonly<Record<string, UnitType>>,
  seed: number,
  maxRounds: number,
): ConquestReport {
  let state = state0;
  const planTimesMs: number[] = [];
  const known: [KnownBases | undefined, KnownBases | undefined] = [undefined, undefined];

  while (!state.outcome && state.round <= maxRounds) {
    const v0 = buildFactionView(board, state, 0, types, known[0]);
    const v1 = buildFactionView(board, state, 1, types, known[1]);
    known[0] = v0.conquest!.bases;
    known[1] = v1.conquest!.bases;
    const rng = createRng((seed * 1000 + state.round) >>> 0 || 1);
    const t0 = performance.now();
    const p0 = planRound(planners[0], v0, rng);
    const t1 = performance.now();
    const p1 = planRound(planners[1], v1, rng);
    const t2 = performance.now();
    planTimesMs.push(t1 - t0, t2 - t1);
    ({ state } = resolveRound(
      board,
      state,
      { 0: p0.orders, 1: p1.orders },
      types,
      weewar,
      { 0: p0.buys, 1: p1.buys },
    ));
  }

  const baseCounts: [number, number] = [0, 0];
  for (const owner of Object.values(state.bases ?? {})) {
    if (owner !== null) baseCounts[owner as FactionId]++;
  }
  const unitCounts: [number, number] = [0, 0];
  for (const u of Object.values(state.units)) {
    if (u.count > 0) unitCounts[u.faction]++;
  }
  return { state, rounds: state.round - 1, baseCounts, unitCounts, planTimesMs };
}
