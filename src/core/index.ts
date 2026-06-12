// src/core — game rules: rng, combat, gang-up, pathing, fog. PURE (spec §0).
// Public surface for the P4 resolver, P5 AI, and the UI layers.

export type {
  ArmorType,
  AttackedFromEntry,
  FactionId,
  GamePhase,
  GameState,
  ResolutionEvent,
  Stance,
  TerrainEffect,
  TerrainType,
  UnitInstance,
  UnitType,
} from './types';
export type { Order } from './orders';
export { createRng, fnv1a32, initTieKey } from './rng';
export type { Rng } from './rng';

export type {
  AttackContext,
  Combatant,
  ExchangeContext,
  ExchangeResult,
  ResolutionModel,
} from './combat/model';
export { attackDamage, battleExchange, roundDamage, weewar } from './combat/weewar';
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

export { visibleCells } from './fog';
