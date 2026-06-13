// ResolutionModel — the pluggable combat interface (spec §5.1).
// The P4 resolver depends ONLY on this interface; II v1 ships the `weewar`
// implementation. Future models (`simple`, `stance-rps`) are parked (§16).
//
// Contexts are board-agnostic: gang-up geometry (B) and unit distance are
// computed by the caller (using src/core/combat/gangup.ts and board geometry)
// and passed in as plain numbers, so a model never touches the board.

import type { TerrainKey } from '../../board/types';
import type { Stance, UnitType } from '../types';

/** One side of an engagement. `stance` omitted → stance modifiers ignored
 *  (Phase A.5 brawls ignore stances, spec §2.6). */
export type Combatant = {
  count: number; // current sub-unit count (1..10; 0 = dead)
  type: UnitType;
  terrain: TerrainKey;
  stance?: Stance;
  /** v0.8 veterancy: +rank added to attack strength A (only when base A > 0). */
  damageBonus?: number;
};

export type AttackContext = {
  attacker: Combatant;
  defender: Combatant;
  /** Gang-up bonus B (spec §5.3) — 0 for counters and brawls. */
  bonusB: number;
};

export type ExchangeContext = {
  attacker: Combatant;
  defender: Combatant;
  /** graphDistance between the two units — gates the defender's counter
   *  against its own min/max range (artillery cannot counter adjacent). */
  distance: number;
  bonusB: number;
};

export type ExchangeResult = {
  attackerCount: number;
  defenderCount: number;
  attackerDamageDealt: number; // dmg attacker inflicted on defender
  defenderCounterDealt: number; // dmg counter inflicted on attacker (0 if no counter)
  counterFired: boolean;
};

/** Itemized formula terms for one strike — what the §9.4 breakdown modal
 *  shows (`A + Ta − D − Td + B → p → damage`). `B` echoes ctx.bonusB; the
 *  gang-up itemization is attached by the resolver (it owns the geometry). */
export type AttackTerms = {
  /** base attack strength + vet (vet is suppressed to 0 when base A = 0) */
  A: number;
  Ta: number;
  D: number;
  Td: number;
  B: number;
  /** v0.8 veterancy bonus folded into A; equals attacker.damageBonus when base A > 0, else 0. */
  vet: number;
  p: number; // 0 when the attack cannot fire (A <= 0 or a side is dead)
  damage: number; // == attackDamage(ctx)
};

export interface ResolutionModel {
  key: string; // 'weewar' for II v1
  attackDamage(ctx: AttackContext): number; // pure
  battleExchange(ctx: ExchangeContext): ExchangeResult; // pure
  /** Optional: itemized terms for replay breakdowns (§9.4). Models without it
   *  still resolve; the resolver falls back to damage-only breakdowns. */
  explainAttack?(ctx: AttackContext): AttackTerms; // pure
}
