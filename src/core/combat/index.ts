// src/core/combat — pluggable resolution models + gang-up geometry. PURE.

export type {
  AttackContext,
  Combatant,
  ExchangeContext,
  ExchangeResult,
  ResolutionModel,
} from './model';
export { attackDamage, battleExchange, roundDamage, weewar } from './weewar';
export {
  GANGUP_WEIGHT,
  classifyPriorAttack,
  gangUpBonus,
  gangUpBreakdown,
  makeAttackedFromEntry,
} from './gangup';
export type { GangUpBreakdown, GangUpClass, GangUpContribution } from './gangup';
