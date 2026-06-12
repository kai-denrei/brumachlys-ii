// Core game types (spec §2). Pure data shapes — no logic, no module state.
// Adapted from v1's core/types.ts: Hex → CellId, economy/capture types cut
// (parking lot, spec §16), gang-up accumulator carries {cell, ranged} entries
// per spec §5.3 instead of bare hexes.

import type { Board, CellId, TerrainKey } from '../board/types';
import type { Order } from './orders';

export type FactionId = 0 | 1;

export type Stance = 'aggressive' | 'defensive' | 'hold-fire';

export type ArmorType = 'personnel' | 'armored' | 'naval' | 'air';

export type GamePhase = 'planning' | 'resolution' | 'replay' | 'over';

/** One prior-attack record on a defender (spec §5.3). Cleared at round end.
 *  `ranged` is fixed at fire time: attacker was at graphDistance > 1. */
export type AttackedFromEntry = { cell: CellId; ranged: boolean };

export type UnitInstance = {
  id: string;
  type: string; // key into the UnitType registry, e.g. 'infantry'
  faction: FactionId;
  cell: CellId;
  count: number; // 1..10
  stance: Stance;
  /** Gang-up accumulator (spec §5.3). Counter-attacks are NEVER appended. */
  attackedFrom: AttackedFromEntry[];
};

export type TerrainEffect = {
  movementCost: number; // tenths; >= 99 = impassable for this unit type
  attackBonus: number; // Ta in the formula
  armorBonus: number; // Td in the formula
};

export type UnitType = {
  key: string;
  name: string;
  description: string;
  cost: number; // unused in II v1 (economy is parked, spec §16)
  movement: number; // total movement budget (tenths)
  initiative: number;
  armor: number; // D in the formula
  armorType: ArmorType;
  minRange: number;
  maxRange: number;
  vision: number;
  attackStrengths: Record<ArmorType, number>; // 0 = cannot attack that armor type
  terrainEffects: Record<TerrainKey, TerrainEffect>;
};

export type TerrainType = {
  key: TerrainKey;
  description: string;
  passable: ArmorType[];
};

// Discriminated event log emitted by the P4 resolver; replay UI consumes it.
// Defined here so P3 types are complete; v1 shape minus economy/capture,
// plus the Phase A.5 brawl exchange (spec §2.6).
export type ResolutionEvent =
  | { type: 'stance'; unitId: string; stance: Stance }
  | { type: 'move'; unitId: string; from: CellId; to: CellId; pathTaken: CellId[] }
  | { type: 'path-truncated'; unitId: string; planned: CellId; actual: CellId }
  | { type: 'attack'; attackerId: string; defenderId: string; damage: number; bonusB: number }
  | { type: 'counter'; attackerId: string; defenderId: string; damage: number }
  | {
      type: 'brawl-exchange';
      cell: CellId;
      higherInitId: string;
      lowerInitId: string;
      higherInitDamageDealt: number;
      lowerInitDamageDealt: number;
    }
  | { type: 'kill'; unitId: string }
  | { type: 'lost-target'; attackerId: string; targetCell: CellId };

export type GameState = {
  round: number; // 1-indexed
  phase: GamePhase;
  board: Board;
  units: Record<string, UnitInstance>;
  pendingOrders: Record<FactionId, Order[]>;
  rngSeed: number; // xorshift32 state
  log: ResolutionEvent[];
};
