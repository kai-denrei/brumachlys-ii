// src/core/combat — pluggable resolution models + gang-up geometry. PURE.

export type {
  AttackContext,
  AttackTerms,
  Combatant,
  ExchangeContext,
  ExchangeResult,
  ResolutionModel,
} from './model';
export { attackDamage, battleExchange, explainAttack, roundDamage, weewar } from './weewar';
export {
  GANGUP_WEIGHT,
  classifyPriorAttack,
  gangUpBonus,
  gangUpBreakdown,
  makeAttackedFromEntry,
} from './gangup';
export type { GangUpBreakdown, GangUpClass, GangUpContribution } from './gangup';
