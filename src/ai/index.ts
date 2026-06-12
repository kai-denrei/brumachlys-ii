// src/ai — fog-fair, deterministic order planners (spec §8). PURE (spec §0).
// Public surface for the state layer (solo play calls planRound when the
// player commits) and for stronger future planners (§16 parking lot).
//
// E4 conquest wiring (for the store): build each faction's view with
// buildFactionView(board, state, faction, types, prevKnownBases) — thread
// `view.conquest.bases` forward each round as prevKnownBases (see view.ts) —
// then call planRound(planner, view, rng) and pass {orders} / {buys} to
// resolveRound's 3rd / 6th arguments.

export type { ConquestView, FactionView, KnownBases } from './view';
export { buildFactionView } from './view';
export type { ConquestPlan, OrderPlanner } from './planner';
export { planRound } from './planner';
export {
  createGreedyPlanner,
  greedyPlanner,
  DEFAULT_CONQUEST_WEIGHTS,
  DEFAULT_GREEDY_WEIGHTS,
} from './planner-greedy';
export type { ConquestWeights, GreedyWeights } from './planner-greedy';
export { doNothingPlanner } from './planner-donothing';
