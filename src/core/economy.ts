// economy.ts — pure conquest economy math (upkeep addendum §1). No state, no
// RNG, no DOM. Shared by the resolver (Phase E debit) and the UI (net-income
// projection) so both compute upkeep identically.

import type { UnitInstance, UnitType, FactionId } from './types';
import type { Board } from '../board/types';

/** Default per-turn upkeep: 1% of unit cost per count-point, capping at 10% of
 *  cost at full strength (count 10). Absent board rate ⇒ this; 0 disables. */
export const DEFAULT_UPKEEP_RATE = 0.01;

/** Resolve the board's upkeep rate, applying the default when unset. 0 is a
 *  valid explicit value (disables upkeep) and is preserved. */
export function upkeepRateOf(board: Board): number {
  const r = board.economy?.upkeepRate;
  return r === undefined ? DEFAULT_UPKEEP_RATE : r;
}

/** One unit's per-turn upkeep: round(cost × rate × count). */
export function unitUpkeep(unitType: UnitType, count: number, rate: number): number {
  return Math.round(unitType.cost * rate * count);
}

/** Total upkeep for one faction's LIVING units (count > 0). */
export function factionUpkeep(
  units: Iterable<UnitInstance>,
  faction: FactionId,
  unitTypes: Readonly<Record<string, UnitType>>,
  rate: number,
): number {
  let sum = 0;
  for (const u of units) {
    if (u.faction !== faction || u.count <= 0) continue;
    const ut = unitTypes[u.type];
    if (ut) sum += unitUpkeep(ut, u.count, rate);
  }
  return sum;
}
