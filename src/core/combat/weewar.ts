// The weewar resolution model (spec §5.2), ported from v1 core/combat.ts.
// Pure functions. No module state, no ambient randomness.
//
//   p = clamp(0.5 + 0.05 * ((A + Ta) - (D + Td) + B), 0, 1)
//   raw = roundDamage(min(attackerCount, defenderCount) * p)
//   damage = (A > 0 && p > 0 && raw === 0) ? 1 : raw
//
// The "min" is canonical: spec §5.2's formula text says `attackerCount * p`,
// but the §5.4 third vector (B=3, p=0.55, attacker count 10, defender count 6
// → damage 3) only holds with min — same contradiction v1 resolved in
// DECISIONS §B.13, the worked example wins. Thematic reading: the smaller
// count is the number of "engagements" in the duel.
//
// The minimum-damage floor (v1 §B.16, spec §5.2) prevents low-count defenders
// from becoming immortal: any valid attack (attacker CAN damage that armor
// type, p > 0) chips at least 1.
//
// Stance modifiers (spec §2.4 / §5.2): defender in `defensive` stance gets
// +1 Td. Contexts with `stance` omitted skip stance modifiers entirely —
// that is how Phase A.5 brawls "ignore stances" (§2.6).

import type {
  AttackContext,
  ExchangeContext,
  ExchangeResult,
  ResolutionModel,
} from './model';

// All damage values route through this single rounding function so a future
// swap (e.g. to banker's rounding) is a one-line change. Math.round = half-up.
export const roundDamage = (raw: number): number => Math.round(raw);

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

export function attackDamage(ctx: AttackContext): number {
  const { attacker, defender, bonusB } = ctx;
  if (attacker.count <= 0 || defender.count <= 0) return 0;

  // A is looked up by the *defender's* armor type in the *attacker's* table.
  const A = attacker.type.attackStrengths[defender.type.armorType];
  if (A <= 0) return 0; // cannot engage this armor type
  const D = defender.type.armor;
  const Ta = attacker.type.terrainEffects[attacker.terrain]?.attackBonus ?? 0;
  const terrainTd = defender.type.terrainEffects[defender.terrain]?.armorBonus ?? 0;
  const stanceTd = defender.stance === 'defensive' ? 1 : 0;
  const Td = terrainTd + stanceTd;

  const p = clamp01(0.5 + 0.05 * (A + Ta - (D + Td) + bonusB));
  const engagements = Math.min(attacker.count, defender.count);
  const raw = roundDamage(engagements * p);
  // Minimum-damage floor: never round to 0 when the attacker can damage this
  // armor type and the formula gave any positive probability.
  if (raw === 0 && p > 0) return 1;
  return raw;
}

// Mutual exchange (spec §2.7 counter semantics):
//   1. attacker hits defender (with bonusB)
//   2. defender counters with B=0 if (a) attacker is within the defender's
//      own min/max range, (b) defender can attack the attacker's armor type,
//      (c) defender is alive, and (d) defender is not in hold-fire
//   3. both damages computed against pre-exchange counts, applied together
//      (one tick of mutual loss)
//   4. counts floor at 0
export function battleExchange(ctx: ExchangeContext): ExchangeResult {
  const { attacker, defender, distance, bonusB } = ctx;

  const attackerDamageDealt = attackDamage({ attacker, defender, bonusB });

  const inRange = distance >= defender.type.minRange && distance <= defender.type.maxRange;
  const canTarget = defender.type.attackStrengths[attacker.type.armorType] > 0;
  const holdsFire = defender.stance === 'hold-fire';
  const counterFired = inRange && canTarget && defender.count > 0 && !holdsFire;

  const defenderCounterDealt = counterFired
    ? attackDamage({
        attacker: defender,
        defender: attacker,
        bonusB: 0, // counters never benefit from gang-up
      })
    : 0;

  return {
    attackerCount: Math.max(0, attacker.count - defenderCounterDealt),
    defenderCount: Math.max(0, defender.count - attackerDamageDealt),
    attackerDamageDealt,
    defenderCounterDealt,
    counterFired,
  };
}

export const weewar: ResolutionModel = {
  key: 'weewar',
  attackDamage,
  battleExchange,
};
