// Core game types (spec §2). Pure data shapes — no logic, no module state.
// Adapted from v1's core/types.ts: Hex → CellId, economy/capture types cut
// (parking lot, spec §16), gang-up accumulator carries {cell, ranged} entries
// per spec §5.3 instead of bare hexes.

import type { Board, CellId, TerrainKey } from '../board/types';
import type { Order } from './orders';
// Type-only imports — erased at compile time, so the runtime import graph
// stays acyclic (combat/* runtime-imports only board geometry + this module's
// types, never this module's values).
import type { GangUpBreakdown } from './combat/gangup';
import type { AttackTerms } from './combat/model';

export type FactionId = 0 | 1;

/** E2 (conquest addendum §B): skirmish is the v1 game unchanged; conquest
 *  adds bases, credits, production, and its own win conditions. A GameState
 *  without `mode` is a skirmish state (pre-E2 shape — bit-identical). */
export type GameMode = 'skirmish' | 'conquest';

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
  /** Veterancy (v0.8): accrued experience in credit-value units. 10% of each
   *  killed unit's type cost. Optional — absent means 0 (legacy fixtures). */
  xp?: number;
  /** Veterancy rank = floor(2*xp / ownCost). Grants +rank attack strength and
   *  is healed +2 count per rank gained. Optional — absent means 0. */
  rank?: number;
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
  cost: number; // credits to buy (conquest addendum §B.3); ignored in skirmish
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

// ── Resolution event log (P4) ────────────────────────────────────────────────
// Discriminated event log emitted by the P4 resolver; the P8 replay UI
// consumes it. Every combat event carries a full AttackBreakdown so the §9.4
// breakdown modal can show `A + Ta − D − Td + B → p → damage` with gang-up
// contributions itemized — the math is never invisible (v1 lesson).

/** Formula terms + itemized gang-up for one strike (§9.4 breakdown modal).
 *  For counters and brawls B is 0 and `gangUp.contributions` is empty. */
export type AttackBreakdown = AttackTerms & { gangUp: GangUpBreakdown };

/** Why a move ended short of its planned destination (§2.5). */
export type TruncationReason =
  | 'budget' // terrain cost exhausted the movement budget
  | 'enemy-contact' // mid-path enemy: surprise contact, stopped one cell short
  | 'friendly-occupied' // may not END on a friendly cell: backed up
  | 'invalid-step' // stale/illegal path step (re-validated at execution time)
  | 'vacancy-failed'; // v1.1: entered on a vacancy promise that broke — bounced back

/** Skirmish (§2.8): annihilation / mutual-annihilation / round-limit.
 *  Conquest (addendum §B.5): conquest (enemy holds zero units AND zero
 *  bases), base-collapse (3 consecutive baseless round-ends), round-limit
 *  (optional limit reached — most bases, then most total unit count, then
 *  draw). */
export type GameOverReason =
  | 'annihilation'
  | 'mutual-annihilation'
  | 'round-limit'
  | 'conquest'
  | 'base-collapse';

/** §2.8 — winner `null` means draw. */
export type GameOutcome = { winner: FactionId | null; reason: GameOverReason };

/** Why a conquest buy failed at Phase E (credits never deducted — the
 *  "refund" is that the spend simply doesn't happen). */
export type SpawnFailReason = 'occupied' | 'base-lost' | 'no-credits';

export type ResolutionEvent =
  | { type: 'stance'; unitId: string; stance: Stance }
  | { type: 'move'; unitId: string; from: CellId; to: CellId; pathTaken: CellId[] }
  | {
      type: 'path-truncated';
      unitId: string;
      planned: CellId;
      actual: CellId;
      reason: TruncationReason;
    }
  | {
      type: 'attack'; // Phase B real attack (explicit or auto)
      attackerId: string;
      defenderId: string;
      attackerCell: CellId;
      defenderCell: CellId;
      damage: number;
      bonusB: number; // == breakdown.gangUp.total
      defenderCountAfter: number;
      counterFired: boolean; // a `counter` event follows iff true
      breakdown: AttackBreakdown;
    }
  | {
      type: 'counter'; // defender's return fire inside the attacker's slot
      attackerId: string; // the countering unit (the original defender)
      defenderId: string; // the original attacker, now taking the counter
      attackerCell: CellId;
      defenderCell: CellId;
      damage: number;
      defenderCountAfter: number;
      breakdown: AttackBreakdown; // B always 0 — counters never gang up
    }
  | {
      type: 'brawl-exchange'; // Phase A.5 (§2.6) — one full mutual exchange
      cell: CellId;
      higherInitId: string;
      lowerInitId: string;
      higherInitDamageDealt: number;
      lowerInitDamageDealt: number; // 0 when the lower-init side cannot return (range/armor gate)
      higherInitCountAfter: number;
      lowerInitCountAfter: number;
      higherInitBreakdown: AttackBreakdown;
      lowerInitBreakdown: AttackBreakdown | null; // null when no return strike fired
    }
  | { type: 'kill'; unitId: string; cell: CellId; faction: FactionId }
  | { type: 'lost-target'; attackerId: string; targetCell: CellId }
  // ── E2 conquest events (addendum §B; skirmish never emits these). Every
  // one carries the acting faction so the replay feed can filter what each
  // side may see (buys are blind: enemy spawn/income/capture events surface
  // only when the affected cell is visible — E3's fog feed enforces this).
  | {
      type: 'capture'; // Phase B.5 — a personnel unit flips a base (§B.2)
      unitId: string;
      cell: CellId;
      from: FactionId | null; // null = was neutral
      to: FactionId;
      /** v0.6 — the claim CONSUMES the claimant: the unit is removed from
       *  state by this event (no separate `kill` is emitted — it did not die
       *  in combat; the UI renders a dissolve-into-the-flag, not a death).
       *  Casualty accounting MUST still count it as a loss for its owner
       *  (the owner is `to` — the capturing faction). Always `true`; kept
       *  explicit so the replay/UI contract is visible in the event itself. */
      unitConsumed: true;
    }
  | {
      type: 'income'; // Phase E — perBase × bases owned at that moment (§B.3)
      faction: FactionId;
      bases: number; // bases owned when income accrued
      amount: number;
      creditsAfter: number;
    }
  | {
      type: 'spawn'; // Phase E — a buy resolved onto its (vacant) base (§B.4)
      unitId: string;
      typeKey: string;
      cell: CellId;
      faction: FactionId;
      creditsAfter: number;
    }
  | {
      type: 'spawn-failed'; // Phase E — buy failed; credits NOT spent (§B.4)
      cell: CellId;
      faction: FactionId;
      unitTypeKey: string;
      reason: SpawnFailReason;
    }
  | {
      type: 'promotion'; // v0.8 — end-of-round veterancy rank-up (survivors only)
      unitId: string;
      cell: CellId;
      faction: FactionId;
      rank: number; // the NEW rank after promotion
      healedTo: number; // count after the +2/rank heal (capped at 10)
    }
  | { type: 'game-over'; outcome: GameOutcome };

export type GameState = {
  round: number; // 1-indexed
  phase: GamePhase;
  board: Board;
  units: Record<string, UnitInstance>;
  pendingOrders: Record<FactionId, Order[]>;
  rngSeed: number; // xorshift32 state
  log: ResolutionEvent[];
  /** E1 discovery fog (conquest addendum §A): cells each faction has EVER
   * had inside its vision union. Accumulates on every vision computation —
   * round start and (for the player) every replay frame — and NEVER shrinks.
   * Optional: newGame leaves it unset in BOTH modes; the store seeds it via
   * core/fog seedDiscovery at battle start (conquest passes bases so owned
   * bases' vision-2 footprints count — addendum §A/§B.1). Absent ⇒ treated
   * as empty (everything dark) by the tier helpers. */
  discovered?: Record<FactionId, ReadonlySet<CellId>>;
  /** Set by the resolver when the game ends (§2.8); absent while running. */
  outcome?: GameOutcome;
  // ── E2 conquest fields (addendum §B). ALL absent in skirmish states —
  // the pre-E2 GameState shape is preserved bit-identically; absent `mode`
  // means skirmish. newGame(.., 'conquest') populates every one of these.
  mode?: GameMode;
  /** Base ownership by cell; `null` = neutral "empty base spot" (§B.1). */
  bases?: Record<CellId, FactionId | null>;
  /** Credits per faction (§B.3). */
  credits?: Record<FactionId, number>;
  /** Consecutive round-ends each faction held zero bases (§B.5 grace
   *  counter; resets to 0 the moment a base is held at a round end). */
  baseless?: Record<FactionId, number>;
  /** Conquest round limit; `null` = no limit (default — §B.5). Skirmish
   *  ignores this and keeps the fixed resolver ROUND_LIMIT of 40. */
  roundLimit?: number | null;
};
