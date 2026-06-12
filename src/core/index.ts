// src/core — game rules: rng, combat, gang-up, pathing, fog. PURE (spec §0).
// Public surface for the P4 resolver, P5 AI, and the UI layers.

export type {
  ArmorType,
  AttackBreakdown,
  AttackedFromEntry,
  FactionId,
  GameOutcome,
  GameOverReason,
  GamePhase,
  GameState,
  ResolutionEvent,
  Stance,
  TerrainEffect,
  TerrainType,
  TruncationReason,
  UnitInstance,
  UnitType,
} from './types';
export type {
  AttackOrder,
  MoveOrder,
  Order,
  OrderContext,
  OrderKind,
  OrderQueues,
  OrderRejection,
  StanceOrder,
  UnitOrders,
  ValidationResult,
} from './orders';
export {
  findConvergences,
  flattenOrders,
  orderedUnitIds,
  plannedEndCell,
  queueOrder,
  removeOrder,
  validateOrder,
} from './orders';
export { createRng, fnv1a32, initTieKey } from './rng';
export type { Rng } from './rng';

export type {
  AttackContext,
  AttackTerms,
  Combatant,
  ExchangeContext,
  ExchangeResult,
  ResolutionModel,
} from './combat/model';
export { attackDamage, battleExchange, explainAttack, roundDamage, weewar } from './combat/weewar';
export {
  GANGUP_WEIGHT,
  classifyPriorAttack,
  gangUpBonus,
  gangUpBreakdown,
  makeAttackedFromEntry,
} from './combat/gangup';
export type { GangUpBreakdown, GangUpClass, GangUpContribution } from './combat/gangup';

export { IMPASSABLE, findPath, movementCostsFor, reachableCells } from './pathing';
export type { MovementCosts, PathOpts, PathResult } from './pathing';

export {
  DARK_ASSUMED_TERRAIN,
  accumulateDiscovery,
  assumedTerrainView,
  fogTier,
  seedDiscovery,
  visibleCells,
} from './fog';
export type { FogTier } from './fog';

export { ROUND_LIMIT, resolveRound } from './resolver';
export type { OrdersByFaction, ResolveResult } from './resolver';
export { newGame } from './setup';
export type { Scenario } from './setup';
