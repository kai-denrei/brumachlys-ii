// The do-nothing planner — test opponent for the §13.6 acceptance bar.
// Issues no orders at all. NOTE: its units still auto-attack in Phase B
// (default aggressive stance, §2.4), so beating it requires out-maneuvering,
// not just standing adjacent and trading.

import type { OrderPlanner } from './planner';

export const doNothingPlanner: OrderPlanner = {
  key: 'do-nothing',
  planOrders: () => [],
};
