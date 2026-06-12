// src/ai — fog-fair, deterministic order planners (spec §8). PURE (spec §0).
// Public surface for the state layer (solo play calls planOrders when the
// player commits) and for stronger future planners (§16 parking lot).

export type { FactionView } from './view';
export { buildFactionView } from './view';
export type { OrderPlanner } from './planner';
export { createGreedyPlanner, greedyPlanner, DEFAULT_GREEDY_WEIGHTS } from './planner-greedy';
export type { GreedyWeights } from './planner-greedy';
export { doNothingPlanner } from './planner-donothing';
