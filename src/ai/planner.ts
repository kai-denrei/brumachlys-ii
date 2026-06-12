// OrderPlanner — the swappable AI interface (spec §8.1). PURE.
// Planners receive only a fog-filtered FactionView (built by src/ai/view.ts)
// and a seeded Rng; they never read hidden state. Stronger planners (MCTS …)
// are parking-lot items (§16) behind this same interface.
//
// E4 (conquest addendum §B.7): conquest rounds also produce BUY orders. The
// contract is widened COMPATIBLY: `planConquest` is optional — a planner
// without it simply never buys (the do-nothing acceptance opponent), and
// `planOrders` keeps its exact pre-E4 shape for skirmish callers. Callers
// should not branch by hand: use `planRound` below.

import type { Order, BuyOrder } from '../core/orders';
import type { Rng } from '../core/rng';
import type { FactionView } from './view';

/** One faction's full conquest round: unit orders + per-base buy orders.
 *  `buys` is flattenBuys-shaped (base cell ascending) — feed it straight to
 *  resolveRound's 6th argument. */
export type ConquestPlan = { orders: Order[]; buys: BuyOrder[] };

export interface OrderPlanner {
  key: string;
  /** Pure & deterministic: same view + same rng state → identical orders. */
  planOrders(view: FactionView, rng: Rng): Order[];
  /** Conquest planning (orders + buys in one pass). Optional: planners that
   *  don't implement it field no production. Only meaningful when
   *  `view.conquest` is present; same purity/determinism contract. */
  planConquest?(view: FactionView, rng: Rng): ConquestPlan;
}

/**
 * THE entry point for the store / sim harnesses — plan one faction-round for
 * either mode. Dispatch: conquest view + a conquest-capable planner →
 * planConquest; anything else → planOrders with no buys. The result always
 * has the {orders, buys} shape, so the caller can uniformly pass
 * `{0: p0.orders, 1: p1.orders}` and `{0: p0.buys, 1: p1.buys}` to
 * resolveRound (buys are ignored by the resolver in skirmish anyway).
 */
export function planRound(planner: OrderPlanner, view: FactionView, rng: Rng): ConquestPlan {
  if (view.conquest && planner.planConquest) return planner.planConquest(view, rng);
  return { orders: planner.planOrders(view, rng), buys: [] };
}
