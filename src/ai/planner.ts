// OrderPlanner — the swappable AI interface (spec §8.1). PURE.
// Planners receive only a fog-filtered FactionView (built by src/ai/view.ts)
// and a seeded Rng; they never read hidden state. Stronger planners (MCTS …)
// are parking-lot items (§16) behind this same interface.

import type { Order } from '../core/orders';
import type { Rng } from '../core/rng';
import type { FactionView } from './view';

export interface OrderPlanner {
  key: string;
  /** Pure & deterministic: same view + same rng state → identical orders. */
  planOrders(view: FactionView, rng: Rng): Order[];
}
