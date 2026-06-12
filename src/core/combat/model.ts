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

export interface ResolutionModel {
  key: string; // 'weewar' for II v1
  attackDamage(ctx: AttackContext): number; // pure
  battleExchange(ctx: ExchangeContext): ExchangeResult; // pure
}
