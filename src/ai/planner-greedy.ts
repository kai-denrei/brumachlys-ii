// The v1 greedy heuristic planner (spec §8.2). PURE & deterministic — all
// tie-breaks via FNV-1a, no ambient randomness; the Rng parameter is accepted
// per the OrderPlanner interface but unused (reserved for stochastic planners).
//
// Per own unit, in initiative order (init desc, FNV `unitId:round` asc — the
// resolver's §2.2 rule, so "earlier-planned ally" matches execution order):
//   1. Candidates = Dijkstra-reachable cells + STAY-PUT. Stay-put is always a
//      candidate even when the current cell is outside the unit's own
//      reachable set (placeForce can put vehicles on mountains — can leave,
//      never re-enter). Visible-enemy cells block pass-through but ARE valid
//      destinations: a §2.5 charge into a §2.6 brawl, accepted only when the
//      exact brawl simulation says the target dies outright at tolerable
//      cost. Cells that will hold a friendly are excluded: planned
//      destinations of already-planned units plus current cells of
//      not-yet-planned (lower-initiative, so they move later) units.
//   2. Best attack per candidate: over visible enemies within [minRange,
//      maxRange] of the candidate that this unit can damage. Expected damage
//      via the REAL weewar model — B = 0 floor for opening strikes, B = 2
//      estimate for follow-ups onto a target an ally already hit (§5.3
//      gang-up is real at resolution). Target value adds focus-fire and
//      kill bonuses, prices the counter from the POST-damage count when we
//      out-initiative the target (§2.7 applies damage before the counter),
//      and refunds the target's own zone-threat entry (suppression policy —
//      see the inline note). Ties → lower remaining count, then FNV.
//      The chosen attack is emitted as an EXPLICIT order (spec §8.2).
//   3. expectedDamageTaken(candidate) = Σ over visible enemies that can hit
//      the cell, shadowed by the resolver's real nearest-target auto rule
//      (committed allies closer to an enemy absorb its one shot), with
//      speculative move-required threats discounted (threatConcentration),
//      plus a fog-risk "phantom threat" around the unscouted enemy camp
//      that scales with how many enemy units could still be hiding.
//   4. score = attackValue − w.damageTaken·eff·taken
//            + w.terrainArmorBonus·armorBonus (only when threatened)
//            + w.advance·(terrain-aware cost reduction toward visible
//              enemies, else the enemy anchor, else the nearest fog).
//      `eff` scales caution by depletion and decays it near the round
//      limit (§2.8 timeout is a draw — the army must convert).
//   5. Stance: defensive if no attack chosen and taken > 0; else aggressive.
//      Emitted only when it differs from the unit's current stance.
//
// Weights load from data/ai.json (tunable without code changes, §8.2);
// createGreedyPlanner accepts overrides for tests/experiments. The §8.2
// baseline weights (0.8/0.15/…) were retuned against the §13.6 acceptance
// fixture — data/ai.json is the source of truth.
//
// E4 — CONQUEST (addendum §B.7). The same engine grows conquest-gated
// branches, active ONLY when view.conquest is present (skirmish behavior is
// bit-identical — the §13.6 acceptance suite pins it):
//   • capture objectives: personnel units claim capturable (neutral or
//     believed-enemy) bases as advance targets — greedy assignment in
//     initiative order, scored by distance / threat / spread; vehicles
//     ESCORT (advance toward visible enemies, else the claimed frontier)
//     and are taxed for squatting on base cells they cannot capture;
//   • a direct capture bonus for ending a personnel unit's round on a
//     capturable base (the §B.2 flip), a defend bonus for standing on or
//     covering an own base under visible threat, and a spawn-block tax for
//     parking on own safe bases;
//   • the desperation curve re-keys from ROUND_LIMIT (meaningless when
//     roundLimit is null) to the BASE DIFFERENTIAL — down on bases the
//     income gap compounds so urgency rises; baseless, the §B.5 grace is
//     ticking and the army goes all-out for the nearest capturable base;
//   • buys (conquest-economy.ts) spend down credits each round at safe
//     spawnable bases — counter-composition vs seen enemies, personnel
//     floor for capture capacity.
// Conquest weights live in their OWN data/ai.json section ("conquest") —
// tunable freely without touching the sacred skirmish numbers.
//
// Performance: per-enemy BFS hop maps + threat sets are precomputed once per
// planOrders call, so the per-candidate loop is O(enemies) hash lookups.
// Measured ≈0.5 ms avg / ≈2 ms max for 8 units on a 254-cell donor board
// (acceptance test reports it) — far under the ~50 ms UI-thread budget.

import aiJson from '../../data/ai.json';
import type { Board, CellId, TerrainKey } from '../board/types';
import { attackDamage, battleExchange } from '../core/combat/weewar';
import type { Order } from '../core/orders';
import { IMPASSABLE, findPath, movementCostsFor, reachableCells } from '../core/pathing';
import type { MovementCosts } from '../core/pathing';
import { ROUND_LIMIT } from '../core/resolver';
import { fnv1a32, initTieKey } from '../core/rng';
import type { Rng } from '../core/rng';
import type { FactionId, Stance, UnitInstance, UnitType } from '../core/types';
import { planConquestBuys } from './conquest-economy';
import type { ConquestPlan, OrderPlanner } from './planner';
import type { FactionView } from './view';

export type GreedyWeights = {
  damageDealt: number;
  damageTaken: number;
  terrainArmorBonus: number;
  advance: number;
  focusFire: number;
  /** Threat-concentration discount: every enemy fires once per round, so a
   *  candidate covered by k enemies does not eat k full attacks. taken =
   *  maxThreat + threatConcentration·(sum − max). 1 = raw spec sum. */
  threatConcentration: number;
};

export const DEFAULT_GREEDY_WEIGHTS: GreedyWeights = aiJson.greedy;

/** E4 conquest weights — a SEPARATE data/ai.json section ("conquest"): the
 *  skirmish numbers above are pinned by the §13.6 acceptance suite, these
 *  are free to tune. All bonuses are in the planner's score units (1 ≈ one
 *  expected damage point dealt). */
export type ConquestWeights = {
  /** Ending a personnel unit's round on a capturable base (§B.2 flip). */
  captureBonus: number;
  /** Per visible-enemy-count threat near a base, when CHOOSING capture
   *  targets — hot bases are worth approaching with force, not solo. */
  baseThreat: number;
  /** Target-assignment spread: penalty per ally already claiming a base. */
  claimSpread: number;
  /** Standing on (full) / covering (scaled) an own base under visible
   *  threat — an occupied base cannot be flipped (§B.2 needs to END there). */
  defendBase: number;
  /** Tax for parking on an own SAFE base — it blocks Phase E production. */
  spawnBlock: number;
  /** Tax for a vehicle ending on any base cell it cannot capture — vehicles
   *  escort the personnel, they don't squat objectives. */
  vehicleSquat: number;
  /** Personnel fraction floor for buys (capture capacity — economy module). */
  personnelFloor: number;
  /** Conquest pressure per base of believed deficit (3 behind ≈ all-out). */
  pressurePerBaseDown: number;
  /** Conquest pressure per base of believed SURPLUS — the leader smells
   *  blood. This is the symmetry breaker the mirror stall needs: the
   *  stall-clock/overdrive escalation saturates IDENTICALLY for both sides
   *  (both end at the same max pressure, the standoff re-stabilizes), but
   *  surplus pressure stacks ON TOP of the ceiling, so any transient base
   *  lead turns into a one-sided surge that consolidates it. */
  pressurePerBaseUp: number;
  /** Capture-bonus multiplier slope under pressure: at full desperation the
   *  flip is worth captureBonus × (1 + capturePressure). */
  capturePressure: number;
  /** Advance-weight multiplier slope under pressure: at full desperation a
   *  cell of march is worth w.advance × (1 + advancePressure) — enough to
   *  pull pinned units OUT of an even firefight and into the capture race. */
  advancePressure: number;
  /** Stall-breaker ramp: pressure also rises with the round clock, starting
   *  here… (mirror standoffs have base deficit 0 forever — without a clock
   *  NOTHING converts; observed: 80 rounds, 5-5 bases, 70-unit armies parked
   *  at the frontier trading ~2 attacks a round). */
  stallPressureStart: number;
  /** …reaching full desperation this many rounds later. */
  stallPressureRamp: number;
  /** Overdrive level at which the massed thrust gives way to the fan-out
   *  raid (> 1 disables the raid entirely — thrust persists). */
  raidThreshold: number;
  /** OVERDRIVE: the second escalation stage, ramping over this many rounds
   *  AFTER the stall ramp saturates. Saturated desperation (urgency floor
   *  0.25, one massed thrust) was measured to be a stable mirror
   *  equilibrium — both sides max out identically, captures ping-pong one
   *  frontier base, production replaces every loss, 0/3 seeds convert. Past
   *  saturation, overdrive (a) decays caution all the way to ZERO (rangers
   *  walk through sniper fire onto objectives), and (b) switches the massed
   *  thrust to a FAN-OUT RAID: personnel spread across ALL capturable
   *  bases, threat-blind, near-flat distance discount — five simultaneous
   *  objectives cannot all be answered by a frontier-pinned defense, so
   *  base counts finally diverge and §B.5 collapse becomes reachable. */
  overdriveRamp: number;
  /** Stop buying at this many own living units — units beyond what the map
   *  can maneuver just gridlock the frontier (observed in the same stall:
   *  uncapped mirror games grew 70–80-unit hordes that out-produced each
   *  other in place and flipped nothing). */
  maxForce: number;
  /** Force cap per believed-own base (supply): effective cap =
   *  min(maxForce, forcePerBase × own bases). THE conquest snowball — a
   *  flat cap equalizes the armies and the leader's income edge converts
   *  to nothing but hoard; a per-base cap makes bases→army→bases the
   *  positive feedback loop, and a collapsing faction's shrinking cap is
   *  the death spiral that actually ENDS mirror games (economy module). */
  forcePerBase: number;
  /** Idle-credit threshold (≈ 2× the costliest unit) above which the economy
   *  buys the top shelf (artillery/heavytank) instead of the cheap line —
   *  hoarded income converted to siege quality (economy module). */
  richFloor: number;
};

export const DEFAULT_CONQUEST_WEIGHTS: ConquestWeights = aiJson.conquest;

/** Hop radius within which visible enemies register as threat on a base. */
const BASE_THREAT_RADIUS = 4;

/** Full-board BFS hop distances from `from` (optionally depth-capped).
 *  Hop metric matches graphDistance — range and vision are hop-based. */
function bfsHops(board: Board, from: CellId, maxHops = Infinity): Map<CellId, number> {
  const dist = new Map<CellId, number>([[from, 0]]);
  let frontier: CellId[] = [from];
  for (let d = 1; d <= maxHops && frontier.length > 0; d++) {
    const next: CellId[] = [];
    for (const id of frontier) {
      for (const n of board.cells.get(id)!.neighbors) {
        if (dist.has(n)) continue;
        dist.set(n, d);
        next.push(n);
      }
    }
    frontier = next;
  }
  return dist;
}

/** Advance distances are walking costs in tenths; one plains step is 3, so
 *  dividing by this makes w.advance read "per plains-cell-equivalent". */
const ADVANCE_NORM = 3;

/** How far the hidden danger of an unscouted enemy camp extends from its
 *  anchor: forces place on BFS rings 0–2 around it (§4.1 step 7), plus
 *  attack range and one surprise step. Extending to 6 (hidden-artillery
 *  umbrella = ring 2 + range 4) was tried and froze whole sieges: the army
 *  then held a ring too far out for its own vision to scout the camp, the
 *  hold never released, round-limit draw. 5 accepts that the outermost
 *  umbrella band is entered at some risk. */
const CAMP_HOLD = 5;

/** Flat surcharge when a simulated charge-brawl ends with our own unit at 0:
 *  the one-round score cannot see the unit's lost future, so without this a
 *  10-for-10 mutual annihilation prices as a win. Roughly half a unit. */
const CHARGE_DEATH_PENALTY = 5;

/** Deliberate charges must destroy the target outright and cost at most this
 *  many own counts — a sanity cap; the value formula (losses at parity +
 *  death surcharge) decides below it. Was 4 ("cheap finishers only"), which
 *  forbade the grenadier's BEST weapon: it wins brawls against humvee/tank
 *  ~10:6 — far better than any ranged opening personnel have against armor,
 *  and the matchup seed 11 lives or dies on (vehicle-walled map, personnel
 *  must erase 40 armored counts). */
const CHARGE_MAX_LOSS = 7;

/** Phase A.5 brawl outcome (§2.6), simulated EXACTLY with the real model:
 *  repeated mutual exchanges (B = 0, stances omitted, shared-cell terrain,
 *  melee distance) until one side is destroyed or no progress is possible.
 *  Deterministic, so the planner may rely on it. */
function simulateBrawl(
  ours: { count: number; type: UnitType },
  theirs: { count: number; type: UnitType },
  terrain: TerrainKey,
): { ourEnd: number; theirEnd: number } {
  let a = ours.count;
  let b = theirs.count;
  const oursHigher = ours.type.initiative >= theirs.type.initiative;
  for (let i = 0; i < 100 && a > 0 && b > 0; i++) {
    const att = oursHigher
      ? { count: a, type: ours.type, terrain }
      : { count: b, type: theirs.type, terrain };
    const def = oursHigher
      ? { count: b, type: theirs.type, terrain }
      : { count: a, type: ours.type, terrain };
    const r = battleExchange({ attacker: att, defender: def, distance: 1, bonusB: 0 });
    if (oursHigher) {
      a = r.attackerCount;
      b = r.defenderCount;
    } else {
      b = r.attackerCount;
      a = r.defenderCount;
    }
    if (r.attackerDamageDealt === 0 && r.defenderCounterDealt === 0) break; // mutual immunity
  }
  return { ourEnd: a, theirEnd: b };
}

/** Phantom threat at the heart of an unscouted enemy camp, in DAMAGE units:
 *  while the camp-hold zone is substantially fogged, hidden defenders'
 *  auto-fire is invisible to the visible-enemy taken model, so cells deep in
 *  the zone carry an assumed exposure that fades to 0 at the hold radius.
 *  Damage units matter — the predecessor (a slope priced in w.advance
 *  multiples, ~0.6/hop) was dwarfed by any 8-damage strike value, so units
 *  walked single-file into the fogged camp and died to 4–5 hidden
 *  auto-attacks (observed, seed 11: grenadier 10→1 and sniper 10→2 in one
 *  round each). 6 ≈ one typical p≈0.6 strike from a full hidden defender.
 *  Pricing it through `taken` (not a flat penalty) keeps it depletion- and
 *  urgency-scaled, and — critically — makes the fogged-state evaluation
 *  agree with the visible-state one, which kills the observed period-2
 *  limit cycle (advance in fog → see 5 enemies → retreat → fog → repeat). */
const PHANTOM_THREAT = 5;

/** Multi-source BFS hop distances (terrain-blind). */
function multiSourceHops(board: Board, sources: readonly CellId[]): Map<CellId, number> {
  const dist = new Map<CellId, number>();
  let frontier: CellId[] = [];
  for (const s of sources) {
    if (!board.cells.has(s) || dist.has(s)) continue;
    dist.set(s, 0);
    frontier.push(s);
  }
  for (let d = 1; frontier.length > 0; d++) {
    const next: CellId[] = [];
    for (const id of frontier) {
      for (const n of board.cells.get(id)!.neighbors) {
        if (dist.has(n)) continue;
        dist.set(n, d);
        next.push(n);
      }
    }
    frontier = next;
  }
  return dist;
}

/** Multi-source Dijkstra: cheapest walking cost (tenths, in this unit's
 *  terrain costs) from the nearest source. Sources seed at 0 even when the
 *  unit could not stand there (enemy on a mountain, fog cell in the hills);
 *  expansion only ever enters cells the unit can pass. */
function multiSourceCost(
  board: Board,
  costs: MovementCosts,
  sources: readonly CellId[],
): Map<CellId, number> {
  const dist = new Map<CellId, number>();
  const queue: { cell: CellId; cost: number }[] = [];
  for (const s of sources) {
    if (!board.cells.has(s)) continue;
    dist.set(s, 0);
    queue.push({ cell: s, cost: 0 });
  }
  while (queue.length > 0) {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i]!.cost < queue[bi]!.cost) bi = i;
    }
    const cur = queue.splice(bi, 1)[0]!;
    if (cur.cost > (dist.get(cur.cell) ?? Infinity)) continue;
    for (const n of board.cells.get(cur.cell)!.neighbors) {
      const cell = board.cells.get(n);
      if (!cell) continue;
      const step = costs[cell.terrain] ?? IMPASSABLE;
      if (step >= IMPASSABLE) continue;
      const nd = cur.cost + step;
      if (nd < (dist.get(n) ?? Infinity)) {
        dist.set(n, nd);
        queue.push({ cell: n, cost: nd });
      }
    }
  }
  return dist;
}

type EnemyInfo = {
  unit: UnitInstance;
  type: UnitType;
  /** BFS hops from the enemy's cell — attack range checks + advance metric. */
  distFrom: Map<CellId, number>;
  /** Cells inside the enemy's CURRENT [minRange, maxRange] ring — it hits
   *  these without moving (auto-attack / counter): near-certain damage. */
  nowZone: Set<CellId>;
  /** Cells this enemy could hit NEXT round: movement reach ∪ stay-put, then
   *  each firing cell's [minRange, maxRange] ring (occupancy ignored). */
  threatened: Set<CellId>;
  /** Memo: expected damage onto the unit being planned, by defender terrain. */
  takenByTerrain: Map<TerrainKey, number>;
};

export function createGreedyPlanner(
  overrides: Partial<GreedyWeights> = {},
  conquestOverrides: Partial<ConquestWeights> = {},
): OrderPlanner {
  const w: GreedyWeights = { ...DEFAULT_GREEDY_WEIGHTS, ...overrides };
  const cw: ConquestWeights = { ...DEFAULT_CONQUEST_WEIGHTS, ...conquestOverrides };

  /** The whole movement/attack pass — shared by both modes (conquest logic
   *  is gated on view.conquest). Also returns each own unit's planned end
   *  cell (the buy planner must know which base cells will be vacant) and
   *  the overdrive level (the buy planner pumps fast capture troops once
   *  the raid is on). */
  const plan = (
    view: FactionView,
  ): { orders: Order[]; plannedEnd: Map<string, CellId>; overdrive: number } => {
      const { board, unitTypes, round } = view;
      const cq = view.conquest;
      const orders: Order[] = [];

      // Initiative order — matches the resolver's §2.2 sort, so "earlier-
      // planned ally" coincides with "acts earlier at resolution".
      const own = [...view.own].sort((a, b) => {
        const ia = unitTypes[a.type]?.initiative ?? 0;
        const ib = unitTypes[b.type]?.initiative ?? 0;
        if (ia !== ib) return ib - ia;
        const ha = initTieKey(a.id, round);
        const hb = initTieKey(b.id, round);
        if (ha !== hb) return ha - hb;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });

      // ── Per-enemy precomputation (shared across all own units) ────────────
      const enemyInfos: EnemyInfo[] = [];
      for (const e of view.enemies) {
        const et = unitTypes[e.type];
        if (!et) continue;
        const distFrom = bfsHops(board, e.cell);
        const reach = reachableCells(board, movementCostsFor(et), e.cell, et.movement);
        const firing = [e.cell, ...[...reach.keys()].sort((a, b) => a - b)];
        const nowZone = new Set<CellId>();
        const threatened = new Set<CellId>();
        for (const f of firing) {
          for (const [cell, d] of bfsHops(board, f, et.maxRange)) {
            if (d < et.minRange) continue;
            threatened.add(cell);
            if (f === e.cell) nowZone.add(cell);
          }
        }
        enemyInfos.push({
          unit: e,
          type: et,
          distFrom,
          nowZone,
          threatened,
          takenByTerrain: new Map(),
        });
      }

      // ── Conquest base intel (addendum §B.7) ───────────────────────────────
      // Built ONLY from the honest view: believed ownership (cq.bases — stale
      // for unseen flips) + visible enemies. `threat` is visible enemy
      // strength within BASE_THREAT_RADIUS hops, nearer counting more.
      type BaseIntel = {
        cell: CellId;
        owner: FactionId | null; // BELIEVED owner
        hops: Map<CellId, number>; // full-board BFS from the base cell
        threat: number;
      };
      const baseIntel: BaseIntel[] = [];
      if (cq) {
        for (const cell of cq.baseCells) {
          if (!board.cells.has(cell)) continue;
          const hops = bfsHops(board, cell);
          let threat = 0;
          for (const ei of enemyInfos) {
            const d = hops.get(ei.unit.cell) ?? Infinity;
            if (d <= BASE_THREAT_RADIUS) {
              threat += (ei.unit.count * (BASE_THREAT_RADIUS + 1 - d)) / (BASE_THREAT_RADIUS + 1);
            }
          }
          baseIntel.push({ cell, owner: cq.bases[cell] ?? null, hops, threat });
        }
      }
      const baseAt = new Map<CellId, BaseIntel>(baseIntel.map((b) => [b.cell, b]));
      const capturableBases = baseIntel.filter((b) => b.owner !== view.faction);
      const ownBaseCount = baseIntel.length - capturableBases.length;
      const enemyBaseCount = capturableBases.filter((b) => b.owner !== null).length;
      const threatenedOwn = baseIntel.filter((b) => b.owner === view.faction && b.threat > 0);
      /** §B.5: zero believed-own bases — the grace counter is ticking. */
      const baseless = cq !== undefined && ownBaseCount === 0;

      // Desperation curve. SKIRMISH: §2.8 timeout is a draw — a LOSS of a
      // won siege — so caution decays toward the fixed ROUND_LIMIT, floor
      // 0.25: from ~70% of the limit on, the army accepts increasingly bad
      // trades to convert. (A "patience" variant that ALSO ran caution hot
      // early was tried and measured worse on every seed: it idled the melee
      // while the camp was strong, then compressed the same bad trades into
      // fewer rounds.)
      // CONQUEST (§B.7): roundLimit may be null — the curve re-keys to the
      // BASE DIFFERENTIAL. Even or ahead: patient (income compounds for us).
      // Behind: each believed base of deficit adds pressure (the income gap
      // compounds AGAINST us — waiting loses). BASELESS: the §B.5 grace
      // counter is ticking, full desperation, all-out for the nearest
      // capturable base. A stall-breaker clock rises regardless (mirror
      // standoffs have deficit 0 forever — without a clock NOTHING converts;
      // observed: 80 rounds, 5-5 bases, parked armies, ~2 attacks a round).
      // An optional round limit contributes its own late curve when set.
      let lateGame: number;
      let overdrive = 0;
      if (!cq) {
        lateGame = Math.max(0, round - Math.floor(ROUND_LIMIT * 0.7)) / (ROUND_LIMIT * 0.3);
      } else {
        const deficit = Math.max(0, enemyBaseCount - ownBaseCount);
        lateGame = baseless ? 1 : deficit * cw.pressurePerBaseDown;
        lateGame = Math.max(
          lateGame,
          Math.min(1, Math.max(0, round - cw.stallPressureStart) / cw.stallPressureRamp),
        );
        if (cq.roundLimit != null && cq.roundLimit > 0) {
          lateGame = Math.max(
            lateGame,
            Math.max(0, round - Math.floor(cq.roundLimit * 0.7)) / (cq.roundLimit * 0.3),
          );
        }
        // Overdrive: the stage past saturated desperation (see the weight's
        // doc comment). Pure round arithmetic — deterministic, view-only.
        overdrive = Math.min(
          1,
          Math.max(0, round - cw.stallPressureStart - cw.stallPressureRamp) / cw.overdriveRamp,
        );
      }
      // Caution: desperation drives it to the 0.25 floor; overdrive removes
      // the floor entirely — at full overdrive units price damage taken at 0
      // and walk through covering fire onto objectives. A saturated-but-
      // floored caution was measured as a stable mirror equilibrium.
      const urgency = (1 - 0.75 * Math.min(1, lateGame)) * (1 - overdrive);
      // Escalation pressure for the capture/advance payoffs: desperation
      // saturates at 1, overdrive stacks a second unit on top (0..2), and a
      // believed base SURPLUS stacks beyond the ceiling (the asymmetric
      // term — see pressurePerBaseUp).
      const surplus = cq ? Math.max(0, ownBaseCount - enemyBaseCount) : 0;
      const pressure = Math.min(1, lateGame) + overdrive + surplus * cw.pressurePerBaseUp;
      // Pressure-scaled capture payoff: at full desperation a flip is worth
      // chasing through covering fire (the patient value never converts a
      // defended frontier — observed).
      const captureBonusEff = cq ? cw.captureBonus * (1 + cw.capturePressure * pressure) : 0;
      // Pressure-scaled ADVANCE weight (conquest only): at the skirmish
      // 0.3/cell the engaged frontline never disengages — attack values
      // (~6–8) pin every unit in contact, production replaces every loss,
      // and the wall holds for 80 rounds (observed). Under pressure the
      // march itself must outbid a round of trading, so the thrust actually
      // moves; captures, not kills, are what convert a conquest standoff.
      const advWeight = cq ? w.advance * (1 + cw.advancePressure * pressure) : w.advance;

      // Advance objective (per-unit field built below, terrain-aware):
      //   1. visible enemies → walk toward the nearest one;
      //   2. none visible, enemy anchor not yet scouted → walk to the anchor
      //      (§8.2);
      //   3. anchor scouted and empty → sweep the fog: walk toward the
      //      nearest non-visible land cell (endgame search for hidden
      //      survivors — without it the army parks on the empty anchor while
      //      a last low-vision enemy hides one valley over, round-limit draw).
      // Terrain-aware matters: hop-based advance freezes armies on river
      // banks (the straight line across water counts fewer hops than the
      // bridge detour, so no reachable cell ever "gets closer"). Observed.
      // Camp-hold zone (fog discipline): the enemy placed on BFS rings around
      // its anchor, so while ANY cell within CAMP_HOLD hops of the anchor is
      // still fogged, hidden defenders may sit there — entering on advance
      // credit alone is how units walk single-file into the camp and die
      // piecemeal (observed repeatedly, in every visibility mode: partial
      // contact re-opened the lunges whenever the hold was gated on "nothing
      // visible"). Implemented as a penalty slope on candidates inside the
      // zone, active in ALL modes; deliberate attacks out-value it.
      const anchorKnown = view.enemyAnchor !== null && board.cells.has(view.enemyAnchor);
      const anchorHops = anchorKnown ? bfsHops(board, view.enemyAnchor!, CAMP_HOLD) : null;
      // Continuous release: phantom scales with HOW fogged the zone still
      // is — 1 when fully unscouted, 0 once ≥ 3/4 is visible. A binary
      // 25%-threshold hold was observed stalling whole sieges: a rim-
      // standing army keeps ~half the zone fogged forever, so the tax never
      // lifted and pace died; meanwhile a handful of fog pockets behind the
      // defenders must not keep taxing legitimate strikes either.
      let holdScale = 0;
      if (anchorHops) {
        let fogged = 0;
        for (const cell of anchorHops.keys()) {
          if (!view.visible.has(cell)) fogged++;
        }
        const frac = fogged / anchorHops.size;
        holdScale = Math.max(0, (frac - 0.25) / 0.75);
      }
      // The phantom prior also scales with how many enemy units could
      // actually BE hiding: total army size is public setup knowledge
      // (§6.4), every enemy death was witnessed (in a two-faction game all
      // enemy losses are our own kills/brawls), and visible enemies are
      // seen — so hidden = total − dead − visible is fair-fog arithmetic,
      // not a hidden-state read. 4+ possible hiders ≈ full camp prior; one
      // last survivor ≈ quarter strength. Without this the army froze at
      // the phantom wall for 12 final rounds while a single hidden humvee
      // count sat in the fog (observed, seed 13) — a round-limit draw of a
      // 19-counts-vs-1 position.
      let hiddenEnemies = Math.max(0, view.enemyTotal - view.enemyDead - view.enemies.length);
      // Conquest: the initial-force arithmetic above cannot see PRODUCTION
      // (hidden spawns are unknowable — view.ts restricts the public fields
      // to the setup force). While the enemy is believed to hold any base,
      // fresh defenders may be materializing behind the fog: keep a floor of
      // 2 possible hiders so the camp phantom never fully disarms against a
      // producing opponent. Belief-driven, not a hidden read.
      if (cq && enemyBaseCount > 0) hiddenEnemies = Math.max(hiddenEnemies, 2);
      holdScale *= Math.min(1, hiddenEnemies / 4);
      const holdActive = holdScale > 0;
      // Advance objective. While the camp-hold is active the objective is
      // ALWAYS the anchor — fog blinking otherwise alternates the field
      // between "visible pickets" and "anchor" and the whole army orbits the
      // rim in a limit cycle (observed: 8 synchronized no-attack rounds).
      // Attack values react to visible enemies regardless of this field.
      const advanceSources: CellId[] =
        anchorKnown && holdActive
          ? [view.enemyAnchor!]
          : enemyInfos.length > 0
            ? enemyInfos.map((ei) => ei.unit.cell).sort((a, b) => a - b)
            : [...board.cells.values()]
                .filter((c) => !view.visible.has(c.id) && c.terrain !== 'water')
                .map((c) => c.id)
                .sort((a, b) => a - b);
      // Hop field over the same sources: (a) fallback gradient for units the
      // cost field cannot reach (e.g. vehicles walled off by mountains —
      // they press toward the wall, from where artillery can still lob over:
      // range is hop-based), (b) the anchor-hold radius check below.
      const advHops = multiSourceHops(board, advanceSources);
      // Terrain-aware advance fields, one per unit (movement costs differ).
      const advFieldByUnit = new Map<string, Map<CellId, number>>();
      // Conquest: advance objectives are PER UNIT (capture targets), so the
      // hop fallback must be per unit too. Empty in skirmish — the shared
      // advHops above is used unchanged.
      const advHopsByUnit = new Map<string, Map<CellId, number>>();
      if (!cq) {
        for (const v of own) {
          const vt = unitTypes[v.type];
          if (!vt) continue;
          advFieldByUnit.set(v.id, multiSourceCost(board, movementCostsFor(vt), advanceSources));
        }
      } else {
        // ── Conquest capture objectives (addendum §B.7) ───────────────────
        // Personnel claim capturable bases greedily in initiative order
        // (`own` is already sorted): nearer is better, threatened is worse
        // (approach hot bases with force, not solo), already-claimed is
        // worse (spread the expansion). Believed-enemy bases get a small
        // bump (flipping one swings income BY two).
        // THRUST (high pressure — baseless or the desperation curve ≥ 0.7):
        // spreading 1–2 personnel per defended base converts NOTHING (each
        // probe dies to the local garrison and production replaces every
        // loss — observed equilibrium). Instead ALL personnel mass on the
        // single best capturable base (team-scored: reachable by many,
        // lightly held) and the escorts come with them — a breakthrough,
        // not a picket line.
        const claims = new Map<CellId, number>();
        const targetOf = new Map<string, CellId>();
        const allPersonnel = own.filter((v) => unitTypes[v.type]?.armorType === 'personnel');
        // RAID (overdrive ≥ 0.5): the massed thrust is what makes the mirror
        // ping-pong — both teams contest the SAME frontier base forever.
        // Raiders instead fan out across every capturable base, threat-blind
        // and with a near-flat distance discount (the rear bases are the
        // undefended ones); claimSpread doubled so claims really spread.
        // Only FAST personnel (movement ≥ 9) raid — a grenadier on a 15-hop
        // march contributes nothing for 8 rounds, while the same grenadier
        // in the siege line is the wall-breaker (measured: fanning everyone
        // out regressed every converted seed back to a stall).
        const raid = overdrive >= cw.raidThreshold && capturableBases.length > 0;
        const personnel = raid
          ? allPersonnel.filter((v) => (unitTypes[v.type]?.movement ?? 0) >= 9)
          : allPersonnel;
        const thrust = !raid && (baseless || lateGame >= 0.5) && capturableBases.length > 0;
        let thrustCell = -1;
        if (thrust) {
          // Team scoring with the threat term doubled: the thrust wants the
          // WEAKLY HELD base it can mass on, not the most contested one.
          let bestScore = -Infinity;
          for (const b of capturableBases) {
            let s = -2 * cw.baseThreat * b.threat + (b.owner !== null ? 0.5 : 0);
            let reachers = 0;
            for (const v of personnel) {
              const d = b.hops.get(v.cell) ?? Infinity;
              if (!Number.isFinite(d)) continue;
              reachers++;
              s += cw.captureBonus / (1 + d / 4);
            }
            if (reachers === 0) continue;
            if (s > bestScore || (s === bestScore && b.cell < thrustCell)) {
              bestScore = s;
              thrustCell = b.cell;
            }
          }
          if (thrustCell >= 0) {
            for (const v of personnel) {
              if (Number.isFinite(baseAt.get(thrustCell)!.hops.get(v.cell) ?? Infinity)) {
                targetOf.set(v.id, thrustCell);
              }
            }
          }
        }
        if (!thrust || thrustCell < 0) {
          for (const v of personnel) {
            let bestCell = -1;
            let bestScore = -Infinity;
            for (const b of capturableBases) {
              const d = b.hops.get(v.cell) ?? Infinity;
              if (!Number.isFinite(d)) continue;
              const s =
                cw.captureBonus / (1 + d / (raid ? 12 : 4)) +
                (b.owner !== null ? 0.5 : 0) -
                (raid ? 0 : cw.baseThreat * b.threat) -
                cw.claimSpread * (raid ? 2 : 1) * (claims.get(b.cell) ?? 0);
              if (s > bestScore || (s === bestScore && b.cell < bestCell)) {
                bestScore = s;
                bestCell = b.cell;
              }
            }
            if (bestCell >= 0) {
              targetOf.set(v.id, bestCell);
              claims.set(bestCell, (claims.get(bestCell) ?? 0) + 1);
            }
          }
        }
        // Vehicles escort rather than squat: during a thrust they move WITH
        // it (the push needs its fire support — attack values still engage
        // whatever crosses their range en route); otherwise toward visible
        // enemies, else the claimed frontier, else any capturable base,
        // else the skirmish fallback (fog sweep / anchor) — also the
        // personnel fallback when no capturable base is reachable.
        const claimedCells = [...new Set(targetOf.values())].sort((a, b) => a - b);
        const escortSources: CellId[] =
          thrust && thrustCell >= 0
            ? [thrustCell]
            : enemyInfos.length > 0
              ? enemyInfos.map((ei) => ei.unit.cell).sort((a, b) => a - b)
              : claimedCells.length > 0
                ? claimedCells
                : capturableBases.length > 0
                  ? capturableBases.map((b) => b.cell)
                  : advanceSources;
        for (const v of own) {
          const vt = unitTypes[v.type];
          if (!vt) continue;
          const t = targetOf.get(v.id);
          const sources = t !== undefined ? [t] : escortSources;
          advFieldByUnit.set(v.id, multiSourceCost(board, movementCostsFor(vt), sources));
          advHopsByUnit.set(v.id, multiSourceHops(board, sources));
        }
      }
      // NOTE on scouting: no unit gets a phantom exemption. An earlier
      // design let the best-vision unit creep inside the hold radius "to
      // scout" — observed suicide hole: the exemption zeroed the phantom on
      // exactly the rings where a hidden artillery umbrella sits, and the
      // scout died poking there (seed 11, sniper 10→3). Standing AT the
      // hold radius with vision 2–4 already reveals the camp's near rings;
      // massing there is both the safe and the revealing play.

      // ── Planning state ────────────────────────────────────────────────────
      // Cells that will hold a friendly when this unit lands: current cells
      // of everyone, updated to destinations as plans are made. Higher-init
      // units plan (and at resolution move) first, so a cell an earlier unit
      // vacates is genuinely free for a later one.
      const friendlyOccupied = new Set<CellId>(own.map((u) => u.cell));
      const enemyCells = new Set<CellId>(view.enemies.map((e) => e.cell));
      const focusTargets = new Set<string>(); // enemy ids already attacked by an ally
      // Expected damage already planned onto each enemy by earlier-planned
      // allies. Phase B applies damage immediately (§2.7) and we plan in the
      // same initiative order units fire in, so later allies legitimately see
      // softened counts; an enemy with plannedDamage ≥ count is treated as
      // dying — skipped as a target and discounted as a threat (kill credit).
      const plannedDamage = new Map<string, number>();
      const remainingCount = (e: UnitInstance): number =>
        e.count - (plannedDamage.get(e.id) ?? 0);

      // Menace: how hard each enemy hits the most vulnerable of OUR units —
      // killing it removes that future damage from the battle. Used as a
      // kill-bonus so finishing blows prefer the enemy's dangerous pieces
      // (their sniper/artillery shred personnel; leaving them for last costs
      // the whole campaign).
      const menaceOf = new Map<EnemyInfo, number>();
      for (const ei of enemyInfos) {
        let menace = 0;
        for (const v of own) {
          const vt = unitTypes[v.type];
          if (!vt) continue;
          const dmg = attackDamage({
            attacker: { count: ei.unit.count, type: ei.type, terrain: 'plains' },
            defender: { count: v.count, type: vt, terrain: 'plains' },
            bonusB: 0,
          });
          if (dmg > menace) menace = dmg;
        }
        menaceOf.set(ei, menace);
      }

      // Exposure shadowing: an enemy fires ONCE per round, and the resolver's
      // §2.4 auto-target rule picks the NEAREST in-range victim (ties →
      // lowest count). So the expected damage from an enemy onto a candidate
      // cell depends on whether a COMMITTED ally (planned earlier this round
      // — they really will stand there) is closer to that enemy:
      //   • ally strictly closer  → the enemy shoots the ally, we take 0;
      //   • ally at equal range   → coin-flip-ish tie rule → half;
      //   • no committed ally / we are nearest → full damage.
      // This replaced a divisor model that split each enemy's damage across
      // every ally whose movement FOOTPRINT touched the zone: priced as
      // "shared", a lone first mover walked into 2–3 covering auto-fires and
      // ate all of them undivided (observed, seed 11: sniper 10→3 poking
      // into the artillery umbrella; grenadier 10→1 lunging to the camp's
      // ring 1 in full view). Shadowing is truthful to the resolver AND
      // still bootstraps the pile-in: once the first attacker commits into a
      // zone, allies entering BEHIND it price that enemy at 0 — focus fire
      // concentrates instead of trickling in.
      const plannedPosition = new Map<string, CellId>(); // unit id → planned end cell
      const ownTypeById = new Map<string, UnitType>();
      for (const v of own) {
        const vt = unitTypes[v.type];
        if (vt) ownTypeById.set(v.id, vt);
      }

      // Strike support — the first-mover fix. A massed focus-kill is the
      // winning move against a defended cluster (3 attackers erase one
      // defender per round), but each unit prices its own entry ALONE: the
      // first striker sees every covering auto-fire undivided, declines,
      // and the assault never starts (observed: 12 rim rounds, zero
      // attacks, round-limit draw). So an attack's value gets to count its
      // plausible co-strikers: unplanned allies that could ALSO hit the
      // same target this round (their reach intersects the target's firing
      // ring and they can damage it). Their expected damage (×0.75
      // confidence) feeds the kill estimate, and the covering fire on the
      // entry cell is split among the strike group (an enemy still fires
      // only once). A lone unit with no allies in reach of ITS target gets
      // zero support — exactly the piecemeal-suicide case this must not
      // re-open.
      const reachOfAlly = new Map<string, ReadonlyMap<CellId, number>>();
      for (const v of own) {
        const vt = ownTypeById.get(v.id);
        if (!vt) continue;
        reachOfAlly.set(v.id, reachableCells(board, movementCostsFor(vt), v.cell, vt.movement));
      }
      /** enemy id → potential strikers among own units, in `own` order. */
      const supportersOf = new Map<string, { allyId: string; dmg: number }[]>();
      for (const ei of enemyInfos) {
        const list: { allyId: string; dmg: number }[] = [];
        for (const v of own) {
          const vt = ownTypeById.get(v.id);
          if (!vt || (vt.attackStrengths[ei.type.armorType] ?? 0) <= 0) continue;
          let inRing = false;
          const dNow = ei.distFrom.get(v.cell) ?? Infinity;
          if (dNow >= vt.minRange && dNow <= vt.maxRange) inRing = true;
          if (!inRing) {
            for (const cell of reachOfAlly.get(v.id)?.keys() ?? []) {
              const d = ei.distFrom.get(cell) ?? Infinity;
              if (d >= vt.minRange && d <= vt.maxRange) {
                inRing = true;
                break;
              }
            }
          }
          if (!inRing) continue;
          const dmg = attackDamage({
            attacker: { count: v.count, type: vt, terrain: 'plains' },
            defender: {
              count: ei.unit.count,
              type: ei.type,
              terrain: board.cells.get(ei.unit.cell)!.terrain,
            },
            bonusB: 0,
          });
          if (dmg > 0) list.push({ allyId: v.id, dmg });
        }
        supportersOf.set(ei.unit.id, list);
      }
      /** Nearest committed ally inside `ei`'s firing ring (hop distance from
       *  the enemy's current cell) that `ei` can damage. Recomputed per unit
       *  — commitments accumulate as planning proceeds. */
      const nearestCommittedTo = (ei: EnemyInfo): number => {
        let nearest = Infinity;
        for (const [id, cell] of plannedPosition) {
          const vt = ownTypeById.get(id);
          if (!vt || (ei.type.attackStrengths[vt.armorType] ?? 0) <= 0) continue;
          const d = ei.distFrom.get(cell) ?? Infinity;
          if (d < ei.type.minRange || d > ei.type.maxRange) continue;
          if (d < nearest) nearest = d;
        }
        return nearest;
      };

      // March boost, OPENING ONLY: with no enemy in sight and the game
      // young there is nothing to weigh against ground — stop strolling
      // (contact by ~R9 instead of ~R15; the round budget on a 30-cell map
      // is the scarcest resource). The phantom wall still gates arrival at
      // the camp rim. NOT applied to later no-contact rounds: mid-siege fog
      // blinks ("vis 0 this round") with a boosted advance re-opened the
      // piecemeal blind lunges; the endgame hunt is the urgency floor's job.
      const advBoost = enemyInfos.length === 0 && round <= 8 ? 2.5 : 1;

      for (const u of own) {
        const ut = unitTypes[u.type];
        if (!ut) continue;
        const costs = movementCostsFor(ut);
        // Enemy-occupied cells ARE valid destinations — a §2.5 charge into a
        // §2.6 brawl, evaluated by exact simulation below — but never
        // traversable mid-path.
        const canStopAt = (c: CellId): boolean => !friendlyOccupied.has(c);
        const canPassThrough = (c: CellId): boolean => !enemyCells.has(c);

        const reach = reachableCells(board, costs, u.cell, ut.movement, {
          canStopAt,
          canPassThrough,
        });
        // Stay-put is ALWAYS a candidate — even from a cell the unit could
        // never re-enter (vehicle placed on a mountain).
        const candidates: CellId[] = [u.cell, ...[...reach.keys()].sort((a, b) => a - b)];

        // Terrain-aware advance field in THIS unit's movement costs, with the
        // hop field as fallback when the cost field cannot reach this unit.
        // Conquest: the hop fallback is per unit too (capture objectives).
        const advField = advFieldByUnit.get(u.id) ?? new Map<CellId, number>();
        const unitAdvHops = advHopsByUnit.get(u.id) ?? advHops;
        const baseCost = advField.get(u.cell);
        const baseHops = unitAdvHops.get(u.cell);
        // Raw advance credit: cost-based when the field reaches both ends,
        // else hop-based (walled-off units press toward the barrier).
        const advanceAt = (cell: CellId): number => {
          const dc = advField.get(cell);
          if (baseCost !== undefined && dc !== undefined) {
            return (baseCost - dc) / ADVANCE_NORM;
          }
          const hc = unitAdvHops.get(cell);
          if (baseHops !== undefined && hc !== undefined) return baseHops - hc;
          return 0;
        };
        // ── Conquest score terms for ending THIS unit's round on `cell` ────
        // (0 in skirmish). Capture flips need the unit ALIVE at Phase B.5 —
        // the charge branch passes its brawl-survival verdict.
        const isPersonnel = ut.armorType === 'personnel';
        const cqBonusAt = (cell: CellId, survives: boolean): number => {
          if (!cq) return 0;
          let bonus = 0;
          const bi = baseAt.get(cell);
          if (bi) {
            if (bi.owner !== view.faction) {
              // Ending here flips it (§B.2) — the conquest payoff itself,
              // pressure-scaled (captureBonusEff). Vehicles cannot capture:
              // squatting an objective both wastes the escort and blocks the
              // flip a personnel ally would make.
              if (isPersonnel) bonus += survives ? captureBonusEff : 0;
              else bonus -= cw.vehicleSquat;
            } else if (bi.threat > 0) {
              // Standing ON an own threatened base denies the flip outright
              // (§B.2 requires the capturer to END there — occupied means a
              // charge/brawl instead of a free flip).
              bonus += cw.defendBase;
            } else {
              // Parking on an own SAFE base blocks Phase E production.
              bonus -= cw.spawnBlock + (isPersonnel ? 0 : cw.vehicleSquat);
            }
          }
          // Defend-base impulse: cells COVERING an own base under visible
          // threat gain value — adjacency strongest, fading by hop 2.
          for (const tb of threatenedOwn) {
            if (tb.cell === cell) continue;
            const d = tb.hops.get(cell) ?? Infinity;
            if (d <= 2) bonus += cw.defendBase * (d <= 1 ? 0.5 : 0.25);
          }
          return bonus;
        };
        // Hold radius: uniform — mass at the camp rim (see scouting note).
        const holdRadius = Math.max(ut.vision, CAMP_HOLD);
        // Full strength on the placement rings (0–2 — §4.1 puts the enemy
        // army THERE), fading to 0 at this unit's hold radius. The fade keeps
        // the scout's creep payable; the ring-2 plateau is what stops fogged
        // deep lunges (a linear-from-the-radius slope priced ring 2 at a
        // third of one hidden auto-attack — observed as still-suicidal).
        // On the placement rings (≤2) a cell that is itself fogged or
        // touches fog keeps the FULL plateau no matter how scouted the zone
        // is globally: a hider can be ON or NEXT TO it. The global
        // holdScale halving the plateau was the last open suicide door —
        // a grenadier kept diving onto a half-scouted ring-1 cell adjacent
        // to a hidden humvee and inside a hidden sniper's ring (seed 11,
        // R20, 10→2, every config).
        const fogTouched = (cell: CellId): boolean => {
          if (!view.visible.has(cell)) return true;
          for (const n of board.cells.get(cell)!.neighbors) {
            if (!view.visible.has(n)) return true;
          }
          return false;
        };
        const phantomAt = (cell: CellId): number => {
          if (!holdActive || !anchorHops) return 0;
          const ah = anchorHops.get(cell);
          if (ah === undefined || ah >= holdRadius) return 0;
          if (ah <= 2) {
            return PHANTOM_THREAT * (fogTouched(cell) ? Math.max(holdScale, 0.9) : holdScale);
          }
          return (holdScale * (PHANTOM_THREAT * (holdRadius - ah))) / (holdRadius - 2);
        };
        // Per-enemy nearest committed ally for THIS unit (depends on which
        // allies have already committed — recomputed as planning progresses).
        const shadowDistOf = new Map<EnemyInfo, number>();
        for (const ei of enemyInfos) shadowDistOf.set(ei, nearestCommittedTo(ei));
        // Depletion multiplier (counts are hit points — damaged units value
        // theirs more, up to ~×2 at 1 count) fades with the desperation
        // curve computed above the loop: desperation overrides
        // self-preservation.
        const dtEff = w.damageTaken * (1 + (1 - u.count / 10) * urgency) * urgency;

        type Pick = {
          cell: CellId;
          score: number;
          target: EnemyInfo | null;
          dealt: number;
          taken: number;
          tie: number;
          /** Brawl charge: move INTO this enemy's cell, no attack order. */
          charge: EnemyInfo | null;
          chargeDamage: number; // counts the brawl sim expects to destroy
        };
        let best: Pick | null = null;

        for (const cell of candidates) {
          const terrain = board.cells.get(cell)!.terrain;

          // ── Threat on this candidate, by certainty class ─────────────────
          //   • Enemies planned dead by earlier allies stop threatening
          //     (kill credit).
          //   • nowZone (the enemy hits this cell WITHOUT moving): one
          //     attack per round at the NEAREST in-range victim → shadowed
          //     by committed allies standing closer to the enemy.
          //   • Move-required threats: additionally speculative (the enemy
          //     must commit) → also discounted by threatConcentration.
          //   The chosen target's counter-fire is certain AND unshadowed
          //   (every attacked defender counters its own attacker) — handled
          //   in target selection below, swapped for its entry here.
          let sharedSum = 0;
          const sharedOf = new Map<EnemyInfo, number>();
          for (const ei of enemyInfos) {
            if (remainingCount(ei.unit) <= 0) continue;
            if (!ei.threatened.has(cell)) continue;
            if ((ei.type.attackStrengths[ut.armorType] ?? 0) <= 0) continue;
            let dmg = ei.takenByTerrain.get(terrain);
            if (dmg === undefined) {
              dmg = attackDamage({
                // Stances omitted (spec: ignore their stances); enemy Ta from
                // its current terrain — its firing cell is unknowable.
                attacker: {
                  count: ei.unit.count,
                  type: ei.type,
                  terrain: board.cells.get(ei.unit.cell)!.terrain,
                },
                defender: { count: u.count, type: ut, terrain },
                bonusB: 0,
              });
              ei.takenByTerrain.set(terrain, dmg);
            }
            const dMine = ei.distFrom.get(cell) ?? Infinity;
            const dAlly = shadowDistOf.get(ei) ?? Infinity;
            const shadow = dAlly < dMine ? 0 : dAlly === dMine ? 0.5 : 1;
            const contribution =
              (ei.nowZone.has(cell) ? dmg : w.threatConcentration * dmg) * shadow;
            sharedOf.set(ei, contribution);
            sharedSum += contribution;
          }

          // ── Charge candidate: enemy-occupied destination → §2.6 brawl ───
          if (enemyCells.has(cell)) {
            const targetEi = enemyInfos.find((ei) => ei.unit.cell === cell);
            // Skip if unknown, or allies already committed fire to it this
            // round (the brawl resolves in Phase A.5, BEFORE their Phase B
            // attacks — they would fizzle on the corpse).
            if (!targetEi || (plannedDamage.get(targetEi.unit.id) ?? 0) > 0) continue;
            const sim = simulateBrawl(
              { count: u.count, type: ut },
              { count: targetEi.unit.count, type: targetEi.type },
              terrain,
            );
            // Cheap finishers only (see CHARGE_MAX_LOSS).
            if (sim.theirEnd > 0 || u.count - sim.ourEnd > CHARGE_MAX_LOSS) continue;
            const chargeDamage = targetEi.unit.count - sim.theirEnd;
            // Brawl losses are CERTAIN (not next-round speculation), so own
            // counts price at parity — a charge must win its trade outright,
            // plus the death surcharge when the sim says we don't come back.
            const value =
              w.damageDealt * chargeDamage +
              (sim.theirEnd === 0 ? 0.6 * (menaceOf.get(targetEi) ?? 0) : 0) -
              (u.count - sim.ourEnd) -
              (sim.ourEnd === 0 ? CHARGE_DEATH_PENALTY : 0);
            // The brawl target is fully engaged — its shared entry swaps for
            // the sim outcome; other enemies still threaten the survivor.
            const taken = sharedSum - (sharedOf.get(targetEi) ?? 0) + phantomAt(cell);
            const armorBonus = taken > 0 ? (ut.terrainEffects[terrain]?.armorBonus ?? 0) : 0;
            const score =
              value -
              dtEff * taken +
              w.terrainArmorBonus * armorBonus +
              advWeight * advBoost * advanceAt(cell) +
              cqBonusAt(cell, sim.ourEnd > 0);
            const tie = fnv1a32(`${u.id}:${cell}:${round}`);
            if (
              !best ||
              score > best.score ||
              (score === best.score && (tie < best.tie || (tie === best.tie && cell < best.cell)))
            ) {
              best = {
                cell,
                score,
                target: null,
                dealt: 0,
                taken,
                tie,
                charge: targetEi,
                chargeDamage,
              };
            }
            continue;
          }

          // ── Best attack from this candidate (B = 0 floor estimate) ───────
          // Defender count = remaining after earlier-planned allies' damage
          // (we fire in the same initiative order we plan in, and Phase B
          // damage applies immediately — §2.7); enemies already planned dead
          // are skipped (no fizzle-on-corpse).
          // Target value swaps the target's SHARED contribution for its
          // CERTAIN counter-fire: a counter fires iff we stand inside the
          // target's own [minRange, maxRange] and it can damage us (§2.7) —
          // so snipers/artillery kiting outside the target's range pay
          // nothing, and a softened target (low remaining) counters weakly.
          let bestAtt: { ei: EnemyInfo; dealt: number; value: number; tie: number } | null = null;
          for (const ei of enemyInfos) {
            const remaining = remainingCount(ei.unit);
            if (remaining <= 0) continue;
            const d = ei.distFrom.get(cell) ?? Infinity;
            if (d < ut.minRange || d > ut.maxRange) continue;
            if ((ut.attackStrengths[ei.type.armorType] ?? 0) <= 0) continue;
            const enemyTerrain = board.cells.get(ei.unit.cell)!.terrain;
            // B = 0 floor for opening strikes; follow-ups on a target an
            // earlier-planned ally already hit estimate B = 2 (flanking-ish)
            // — the resolver really applies §5.3 gang-up, and pricing
            // follow-ups at the floor made planned kills look one round
            // slower than reality, stretching exposure.
            const dealt = attackDamage({
              attacker: { count: u.count, type: ut, terrain, stance: 'aggressive' },
              defender: {
                count: remaining,
                type: ei.type,
                terrain: enemyTerrain,
                stance: ei.unit.stance,
              },
              bonusB: (plannedDamage.get(ei.unit.id) ?? 0) > 0 ? 2 : 0,
            });
            if (dealt <= 0) continue;
            const canCounter =
              d >= ei.type.minRange &&
              d <= ei.type.maxRange &&
              (ei.type.attackStrengths[ut.armorType] ?? 0) > 0;
            // Counter strength: §2.7 applies OUR damage first, the
            // SURVIVORS counter. When we out-initiative the target our hit
            // lands before its Phase-B response, so the counter comes from
            // the post-damage count (a 10-count tank hit for 6 answers
            // with 4). Pricing counters from the full count — the previous
            // model — systematically overtaxed strikes on the slow heavy
            // pieces (tank init 6, heavytank 3) that the grind depends on.
            const counterCount =
              ut.initiative >= ei.type.initiative ? Math.max(0, remaining - dealt) : remaining;
            const counterDmg =
              canCounter && counterCount > 0
                ? attackDamage({
                    attacker: { count: counterCount, type: ei.type, terrain: enemyTerrain },
                    defender: { count: u.count, type: ut, terrain },
                    bonusB: 0,
                  })
                : 0;
            // Strike support on THIS target: unplanned allies that could
            // also hit it this round. Their damage (×0.75) feeds the kill
            // estimate; their presence splits the cell's covering fire
            // (everything except the target itself) across the group.
            let supportDmg = 0;
            let kSupport = 0;
            for (const s of supportersOf.get(ei.unit.id) ?? []) {
              if (s.allyId === u.id || plannedPosition.has(s.allyId)) continue;
              if (kSupport >= 3) break;
              supportDmg += 0.75 * s.dmg;
              kSupport += 1;
            }
            const killLikely = dealt + supportDmg >= remaining;
            // Covering fire AND the phantom estimate are per-ENEMY-shot
            // quantities — a strike group of k+1 doesn't eat them k+1 times.
            const coverRefund =
              (sharedSum - (sharedOf.get(ei) ?? 0) + phantomAt(cell)) *
              (1 - 1 / (1 + 0.5 * kSupport));
            // Threat-suppression offset: attacking a unit refunds its
            // zone-threat entry on this cell. Where the cell already eats
            // the target's auto-fire this is sunk-cost honesty (the auto
            // comes whether or not we engage; only the counter is
            // marginal); the surplus beyond the counter is a deliberate
            // suppression HEURISTIC — "the piece that threatens you most
            // is the piece to be killing" — which the one-round horizon
            // cannot derive from first principles. Cautious variants
            // (cap at counterDmg; refund only on killLikely) were measured
            // strictly worse on the acceptance fixture: they stop the
            // ranged grind onto the enemy's covering pieces and the siege
            // times out. Counters ARE additional to autos in the resolver
            // (one fire action per unit; counters resolve inside
            // battleExchange) — the refund is policy, not physics.
            const sunkOffset = sharedOf.get(ei) ?? 0;
            // Kill bonus: flat part (+1.5) prices the WIN CONDITION — every
            // enemy unit erased is one fewer attacker every later round and
            // a step toward annihilation; without it damage gets sprayed
            // and the endgame is six 1–3-count husks that each still shoot
            // and each cost a finishing visit (observed terminal state on
            // seed 11). Menace part prefers finishing the dangerous pieces.
            const value =
              w.damageDealt * dealt +
              (focusTargets.has(ei.unit.id) ? w.focusFire : 0) +
              (killLikely ? 1.5 + 0.6 * (menaceOf.get(ei) ?? 0) : 0) -
              dtEff * (counterDmg - sunkOffset - coverRefund);
            const tie = fnv1a32(`${u.id}->${ei.unit.id}:${round}`);
            if (
              !bestAtt ||
              value > bestAtt.value ||
              (value === bestAtt.value &&
                (remainingCount(bestAtt.ei.unit) > remaining ||
                  (remainingCount(bestAtt.ei.unit) === remaining && tie < bestAtt.tie)))
            ) {
              bestAtt = { ei, dealt, value, tie };
            }
          }
          // A net-negative attack is declined: the defensive stance both
          // suppresses the auto-attack (§2.4) and adds +1 armor, so "stand
          // here but do not engage" is the better plan the score reflects.
          // (Fresh const rather than `bestAtt = null` — the reassignment
          // trips a TS control-flow-analysis bailout in this large function
          // and `bestAtt` gets mis-narrowed to `never` below.)
          const chosenAtt = bestAtt !== null && bestAtt.value > 0 ? bestAtt : null;
          const taken = sharedSum + phantomAt(cell);

          // Cover is worthless when nothing can shoot you: the armor-bonus
          // term applies only on threatened candidates, otherwise defensive
          // terrain anchors the march into local optima (observed: units
          // freezing on woods/mountains far from any contact).
          const armorBonus = taken > 0 ? (ut.terrainEffects[terrain]?.armorBonus ?? 0) : 0;
          const adv = advanceAt(cell);

          const score =
            (chosenAtt?.value ?? 0) -
            dtEff * taken +
            w.terrainArmorBonus * armorBonus +
            advWeight * advBoost * adv +
            cqBonusAt(cell, true);
          const tie = fnv1a32(`${u.id}:${cell}:${round}`);

          if (
            !best ||
            score > best.score ||
            (score === best.score && (tie < best.tie || (tie === best.tie && cell < best.cell)))
          ) {
            best = {
              cell,
              score,
              target: chosenAtt?.ei ?? null,
              dealt: chosenAtt?.dealt ?? 0,
              taken,
              tie,
              charge: null,
              chargeDamage: 0,
            };
          }
        }

        if (!best) continue; // unreachable: stay-put always exists

        // ── Emit this unit's orders (stance, move, attack) ──────────────────
        let landedOn = u.cell;
        if (best.cell !== u.cell) {
          const pr = findPath(board, costs, u.cell, best.cell, {
            budget: ut.movement,
            canStopAt,
            canPassThrough,
          });
          if (pr && pr.path.length > 0) {
            orders.push({ kind: 'move', unitId: u.id, path: pr.path });
            landedOn = best.cell;
          }
        }
        if (best.target) {
          orders.push({ kind: 'attack', unitId: u.id, targetCell: best.target.unit.cell });
          focusTargets.add(best.target.unit.id);
          plannedDamage.set(
            best.target.unit.id,
            (plannedDamage.get(best.target.unit.id) ?? 0) + best.dealt,
          );
        }
        if (best.charge) {
          // Kill credit for the brawl: later-planned allies treat the charge
          // target as engaged/destroyed (Phase A.5 resolves before Phase B).
          plannedDamage.set(
            best.charge.unit.id,
            (plannedDamage.get(best.charge.unit.id) ?? 0) + best.chargeDamage,
          );
        }
        const stance: Stance =
          !best.target && !best.charge && best.taken > 0 ? 'defensive' : 'aggressive';
        if (stance !== u.stance) orders.push({ kind: 'stance', unitId: u.id, stance });

        friendlyOccupied.delete(u.cell);
        friendlyOccupied.add(landedOn);
        plannedPosition.set(u.id, landedOn);
      }

      return { orders, plannedEnd: plannedPosition, overdrive };
  };

  return {
    key: 'greedy',
    planOrders(view: FactionView, _rng: Rng): Order[] {
      return plan(view).orders;
    },
    // E4 (addendum §B.7): the conquest round — same movement/attack pass,
    // plus the economy module's spend-down buys against the planned end
    // positions. Callers go through planner.ts's planRound dispatcher.
    planConquest(view: FactionView, _rng: Rng): ConquestPlan {
      const { orders, plannedEnd, overdrive } = plan(view);
      return { orders, buys: planConquestBuys(view, plannedEnd, cw, overdrive) };
    },
  };
}

/** The default greedy planner with data/ai.json weights. */
export const greedyPlanner: OrderPlanner = createGreedyPlanner();
