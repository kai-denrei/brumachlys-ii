// The P4 round resolver (spec §2). PURE — same (board, state, orders, types,
// model) → byte-identical event logs. Never mutates its inputs; returns a
// fresh GameState plus the round's ResolutionEvent log.
//
// Resolution order (§2.1):
//   0. Stance orders apply at resolution start, before Phase A (§2.3).
//   A. Movement, in initiative order (init desc, FNV-1a `unitId + ":" + round`
//      asc — §2.2). Paths are RE-VALIDATED step by step at execution time
//      (orders may have been planned against stale fog): adjacency, terrain
//      passability, budget, and the §2.5 conflict rules —
//        • friendly mid-path: pass through; may not END on a friendly cell
//          (back up one cell at a time; if none, stay put) — UNLESS every
//          friendly on the planned final cell still has a pending move
//          elsewhere (v1.1 VACANCY PROMISE: the mover completes in, trusting
//          the occupant to leave; settled at the end of Phase A)
//        • enemy mid-path: surprise contact — stop one cell short
//        • enemy at the planned destination at EXECUTION time: the move
//          completes into the enemy's cell — a charge (even if the enemy was
//          fog-hidden at planning time or arrived earlier this Phase A)
//        • two units, same empty destination: the earlier (higher-init) mover
//          claims it; the later one stops back (friendly) or charges (enemy)
//   A-end. VACANCY SETTLEMENT (v1.1): invariant — max one same-faction unit
//      per cell. If a promise broke (the occupant's move failed and it
//      stayed), the INCOMING unit bounces back along its own resolved path to
//      the first cell free of any living unit (last resort: its origin, even
//      if occupied — which cascades). Conflicted cells are processed in
//      ascending order, bouncers in init order; iterate until stable. Bounded:
//      every bounce strictly shortens the bouncer's resolved path. Each
//      bounce emits a `move` event (the walk back animates in the replay)
//      plus `path-truncated` with reason 'vacancy-failed'.
//      Decisions (deban): truncated moves never gamble on a promise — only a
//      walk that COMPLETES to its planned cell can enter on one; the keeper
//      of a conflicted cell is, in order, the unit standing on its own
//      round-start cell, then a normal mover, then a promised entrant
//      (ties: init order).
//   A.5 Brawls (§2.6): every cell holding both factions repeats
//      battleExchange(higherInit, lowerInit) until one side is at 0. B = 0,
//      shared-cell terrain bonuses for both, stances ignored by OMITTING
//      `stance` from the exchange contexts (the designed P3 mechanism).
//      Both sides reaching 0 in one exchange is legal — the cell ends empty.
//   B. Combat, in initiative order (§2.7): explicit attacks fizzle with a
//      `lost-target` event if the target cell holds no enemy in range at fire
//      time; aggressive units auto-attack the nearest visible enemy in range
//      (visibility through the ATTACKER's faction fog; tie-break nearest,
//      then lowest count, then FNV — §2.4); damage applies immediately
//      (concentrate fire is intentional); the counter fires inside the
//      attacker's slot via battleExchange's gates.
//   End: dead units' queued orders dropped (enforced by aliveness checks at
//      each phase), attackedFrom accumulators cleared, win/draw per §2.8.
//
// Decisions where the spec is open (deban):
//   • Brawl exchanges pass `distance: 1` — melee adjacency semantics, so the
//     §13.4 vector holds and artillery's minRange-2 "cannot counter adjacent"
//     glass-cannon rule stays meaningful inside a brawl.
//   • Brawl initiation counts as a real attack for gang-up (P3 gangup.ts
//     contract): each distinct defender in a brawl gets ONE attackedFrom
//     entry (same-cell ⇒ degenerate angle ⇒ adjacent +1 for later attackers).
//   • A unit in hold-fire drops a stale explicit attack silently (the P7 UI
//     blocks queueing one; the resolver just refuses to fire it).
//   • Auto-attacks with no available target skip silently — `lost-target` is
//     reserved for explicit orders whose target evaporated.
//   • Explicit attacks re-check RANGE only at fire time (§2.7 names range
//     alone); the target may have left the attacker's vision and still be hit.
//   • Mutual-immunity brawls (neither side can deal damage — impossible with
//     the §6.1 roster, possible with future data) break after one zero-zero
//     exchange, both sides surviving on the shared cell.

import type { Board, CellId, TerrainKey } from '../board/types';
import { graphDistance } from '../board/geometry';
import { initTieKey } from './rng';
import { IMPASSABLE } from './pathing';
import { gangUpBreakdown, makeAttackedFromEntry } from './combat/gangup';
import type { GangUpBreakdown } from './combat/gangup';
import type { AttackContext, Combatant, ResolutionModel } from './combat/model';
import { visibleCells } from './fog';
import type { BuyOrder, Order } from './orders';
import type {
  AttackBreakdown,
  FactionId,
  GameOutcome,
  GameState,
  ResolutionEvent,
  TruncationReason,
  UnitInstance,
  UnitType,
} from './types';

/** §2.8 — both factions alive at the end of this round number ⇒ draw.
 *  SKIRMISH ONLY: conquest uses GameState.roundLimit (null = no limit). */
export const ROUND_LIMIT = 40;

/** Conquest addendum §B.5: a faction holding zero bases for this many
 *  consecutive round-ends loses (both ⇒ draw). */
export const BASELESS_GRACE = 3;

/** Hard safety cap; the min-damage floor ends real brawls far sooner. */
const BRAWL_MAX_EXCHANGES = 200;

/** Brawl exchange distance: melee adjacency (see header decision). */
const BRAWL_DISTANCE = 1;

export type OrdersByFaction = Readonly<Record<FactionId, readonly Order[]>>;

/** E2: queued buys per faction (flattenBuys output — base cell ascending;
 *  the resolver re-sorts anyway). PARALLEL to OrdersByFaction: buys are
 *  per-base, not per-unit, so they never enter the Order arrays. */
export type BuysByFaction = Readonly<Record<FactionId, readonly BuyOrder[]>>;

export type ResolveResult = { state: GameState; events: ResolutionEvent[] };

type MoveOrder = Extract<Order, { kind: 'move' }>;
type AttackOrder = Extract<Order, { kind: 'attack' }>;
type StanceOrder = Extract<Order, { kind: 'stance' }>;

export function resolveRound(
  board: Board,
  state: GameState,
  ordersByFaction: OrdersByFaction,
  unitTypes: Readonly<Record<string, UnitType>>,
  model: ResolutionModel,
  /** E2 conquest buys (addendum §B.4). Ignored entirely in skirmish. */
  buysByFaction?: BuysByFaction,
): ResolveResult {
  const conquest = state.mode === 'conquest';
  const next = cloneState(board, state);
  const events: ResolutionEvent[] = [];
  const round = state.round;

  // ── Sanitize orders into per-unit slots ───────────────────────────────────
  // Faction ownership enforced (an order may only address that faction's own
  // unit); orders for unknown/dead units drop. Contract: max one order per
  // kind per unit (§2.3) — on violation the LAST one in that faction's array
  // wins (shuffle-invariance is only guaranteed for contract-valid input).
  const stanceOf = new Map<string, StanceOrder>();
  const moveOf = new Map<string, MoveOrder>();
  const attackOf = new Map<string, AttackOrder>();
  for (const faction of [0, 1] as const) {
    for (const order of ordersByFaction[faction] ?? []) {
      const u = next.units[order.unitId];
      if (!u || u.faction !== faction || u.count <= 0) continue;
      if (order.kind === 'stance') stanceOf.set(order.unitId, order);
      else if (order.kind === 'move') moveOf.set(order.unitId, order);
      else attackOf.set(order.unitId, order);
    }
  }

  // ── Deterministic ordering helpers (§2.2) ─────────────────────────────────
  const initOf = (u: UnitInstance): number => unitTypes[u.type]?.initiative ?? 0;
  const cmpUnits = (a: UnitInstance, b: UnitInstance): number => {
    const ia = initOf(a);
    const ib = initOf(b);
    if (ia !== ib) return ib - ia; // initiative descending
    const ha = initTieKey(a.id, round);
    const hb = initTieKey(b.id, round);
    if (ha !== hb) return ha - hb; // FNV tie-key ascending
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // absolute total order
  };

  const alive = (): UnitInstance[] => Object.values(next.units).filter((u) => u.count > 0);
  const terrainOf = (cell: CellId): TerrainKey => board.cells.get(cell)!.terrain;
  const enemyAt = (cell: CellId, faction: FactionId): UnitInstance | undefined =>
    alive().find((u) => u.cell === cell && u.faction !== faction);
  const friendlyAt = (cell: CellId, faction: FactionId, exceptId: string): UnitInstance | undefined =>
    alive().find((u) => u.cell === cell && u.faction === faction && u.id !== exceptId);
  const friendliesAt = (cell: CellId, faction: FactionId, exceptId: string): UnitInstance[] =>
    alive().filter((u) => u.cell === cell && u.faction === faction && u.id !== exceptId);
  const killUnit = (u: UnitInstance): void => {
    events.push({ type: 'kill', unitId: u.id, cell: u.cell, faction: u.faction });
    delete next.units[u.id];
  };

  // ── 0. Stance orders apply first (§2.3) ───────────────────────────────────
  const stanceUnits = [...stanceOf.keys()].map((id) => next.units[id]!).sort(cmpUnits);
  for (const u of stanceUnits) {
    const order = stanceOf.get(u.id)!;
    u.stance = order.stance;
    events.push({ type: 'stance', unitId: u.id, stance: order.stance });
  }

  // ── A. Movement (§2.5) ────────────────────────────────────────────────────
  /** Per-mover resolved-path record — the vacancy settlement's bounce data. */
  type MoveRecord = {
    origin: CellId;
    pathTaken: CellId[]; // resolved forward path (trimmed when bounced)
    planned: CellId;
    promised: boolean; // entered its final cell on a vacancy promise
  };
  const moveRecords = new Map<string, MoveRecord>();
  const executedMoves = new Set<string>();

  const movers = [...moveOf.keys()].map((id) => next.units[id]!).sort(cmpUnits);
  for (const u of movers) {
    const order = moveOf.get(u.id)!;
    const ut = unitTypes[u.type];
    if (!ut || order.path.length === 0) continue;

    let budget = ut.movement;
    let cur = u.cell;
    const pathTaken: CellId[] = [];
    let reason: TruncationReason | null = null;

    for (let i = 0; i < order.path.length; i++) {
      const step = order.path[i]!;
      const isLast = i === order.path.length - 1;
      const curCell = board.cells.get(cur);
      const stepCell = board.cells.get(step);
      // Execution-time re-validation: the step must be an existing neighbor.
      if (!curCell || !stepCell || !curCell.neighbors.includes(step)) {
        reason = 'invalid-step';
        break;
      }
      const stepCost = ut.terrainEffects[stepCell.terrain]?.movementCost ?? IMPASSABLE;
      if (stepCost >= IMPASSABLE) {
        reason = 'invalid-step';
        break;
      }
      if (stepCost > budget) {
        reason = 'budget';
        break;
      }
      const enemy = enemyAt(step, u.faction);
      if (enemy && !isLast) {
        reason = 'enemy-contact'; // surprise contact: stop one cell short
        break;
      }
      budget -= stepCost;
      pathTaken.push(step);
      cur = step;
      // isLast && enemy ⇒ charge: the move COMPLETES into the enemy's cell;
      // the brawl resolves in Phase A.5.
    }

    // v1.1 vacancy promise: a walk that COMPLETED to its planned final cell
    // may stay on a friendly-occupied cell iff every friendly there has a
    // still-pending move whose destination is a different cell. Truncated
    // walks never gamble on a promise (deban decision).
    const reachedPlanned = reason === null && pathTaken.length === order.path.length;
    let promised = false;
    if (reachedPlanned && pathTaken.length > 0) {
      const occupants = friendliesAt(cur, u.faction, u.id);
      promised =
        occupants.length > 0 &&
        occupants.every((f) => {
          if (executedMoves.has(f.id)) return false; // its move already ran (or failed)
          const m = moveOf.get(f.id);
          if (!m || m.path.length === 0) return false;
          return m.path[m.path.length - 1] !== f.cell; // pending move ELSEWHERE
        });
    }

    // May not END on a friendly-occupied cell: back up (if none, stay put).
    // Cells walked through earlier this slot can only be empty or friendly
    // (a mid-path enemy would have stopped the walk), so backing up is safe.
    if (!promised) {
      while (pathTaken.length > 0 && friendlyAt(pathTaken[pathTaken.length - 1]!, u.faction, u.id)) {
        pathTaken.pop();
        reason = 'friendly-occupied';
        cur = pathTaken.length > 0 ? pathTaken[pathTaken.length - 1]! : u.cell;
      }
    }

    const planned = order.path[order.path.length - 1]!;
    moveRecords.set(u.id, { origin: u.cell, pathTaken: [...pathTaken], planned, promised });
    executedMoves.add(u.id);
    if (cur !== u.cell) {
      events.push({ type: 'move', unitId: u.id, from: u.cell, to: cur, pathTaken: [...pathTaken] });
      u.cell = cur;
    }
    if (planned !== cur) {
      events.push({
        type: 'path-truncated',
        unitId: u.id,
        planned,
        actual: cur,
        reason: reason ?? 'invalid-step',
      });
    }
  }

  // ── A-end. Vacancy settlement (v1.1) ──────────────────────────────────────
  // Invariant: max one same-faction unit per cell. Broken promises bounce the
  // INCOMING unit back along its own resolved path to the first cell free of
  // any living unit (last resort: its origin, even if occupied — cascades).
  // Bounded: every bounce strictly shortens the bouncer's resolved path.
  {
    let bounceBudget = 0;
    for (const rec of moveRecords.values()) bounceBudget += rec.pathTaken.length;

    /** Claim strength on a conflicted cell (lower keeps): standing on its own
     *  round-start cell beats a normal mover beats a promised entrant. */
    const claim = (u: UnitInstance): number => {
      const rec = moveRecords.get(u.id);
      if (!rec || u.cell === rec.origin) return 0;
      return rec.promised ? 2 : 1;
    };

    const bounce = (u: UnitInstance): void => {
      const rec = moveRecords.get(u.id);
      if (!rec || rec.pathTaken.length === 0) return; // defensive — claim 0 never bounces
      const from = u.cell;
      const cells = rec.pathTaken;
      const back: CellId[] = [];
      let landing = rec.origin;
      let landingIdx = -1;
      for (let i = cells.length - 2; i >= -1; i--) {
        const cell = i >= 0 ? cells[i]! : rec.origin;
        back.push(cell);
        const occupied = alive().some((o) => o.id !== u.id && o.cell === cell);
        if (!occupied) {
          landing = cell;
          landingIdx = i;
          break;
        }
        // i === -1: origin fallback even if occupied (cascade resolves it).
      }
      rec.pathTaken = landingIdx >= 0 ? cells.slice(0, landingIdx + 1) : [];
      u.cell = landing;
      events.push({ type: 'move', unitId: u.id, from, to: landing, pathTaken: back });
      events.push({
        type: 'path-truncated',
        unitId: u.id,
        planned: rec.planned,
        actual: landing,
        reason: 'vacancy-failed',
      });
    };

    for (let iter = 0; iter <= bounceBudget; iter++) {
      const groups = new Map<string, UnitInstance[]>();
      for (const u of alive()) {
        const key = `${u.cell}:${u.faction}`;
        const g = groups.get(key);
        if (g) g.push(u);
        else groups.set(key, [u]);
      }
      const conflicted = [...groups.entries()]
        .filter(([, g]) => g.length > 1)
        .sort(([a], [b]) => {
          const [ca, fa] = a.split(':').map(Number) as [number, number];
          const [cb, fb] = b.split(':').map(Number) as [number, number];
          return ca - cb || fa - fb;
        });
      if (conflicted.length === 0) break;
      let bouncedAny = false;
      for (const [, group] of conflicted) {
        const sorted = [...group].sort((a, b) => claim(a) - claim(b) || cmpUnits(a, b));
        for (const u of sorted.slice(1)) {
          bounce(u);
          bouncedAny = true;
        }
      }
      if (!bouncedAny) break; // defensive — distinct origins make claim-0 ties impossible
    }
  }

  // ── A.5. Brawls (§2.6) ────────────────────────────────────────────────────
  // Brawls only remove units, never relocate them — the contested-cell list
  // is computed once after Phase A, in ascending cell order.
  const factionsAt = new Map<CellId, Set<FactionId>>();
  for (const u of alive()) {
    let set = factionsAt.get(u.cell);
    if (!set) {
      set = new Set();
      factionsAt.set(u.cell, set);
    }
    set.add(u.faction);
  }
  const contestedCells = [...factionsAt.entries()]
    .filter(([, factions]) => factions.size > 1)
    .map(([cell]) => cell)
    .sort((a, b) => a - b);

  for (const cell of contestedCells) {
    const terrain = terrainOf(cell);
    const brawlMarked = new Set<string>(); // defenders already in the accumulator
    for (let exchange = 0; exchange < BRAWL_MAX_EXCHANGES; exchange++) {
      const here = alive()
        .filter((u) => u.cell === cell)
        .sort(cmpUnits);
      if (here.length < 2) break;
      const att = here[0]!;
      const def = here.find((u) => u.faction !== att.faction);
      if (!def) break; // one faction left — survivor keeps the cell
      const attType = unitTypes[att.type];
      const defType = unitTypes[def.type];
      if (!attType || !defType) break;

      // Brawl initiation is a real attack — accumulate once per defender.
      if (!brawlMarked.has(def.id)) {
        def.attackedFrom.push(makeAttackedFromEntry(board, cell, cell));
        brawlMarked.add(def.id);
      }

      // Stances ignored by OMITTING stance (§2.6); both share the terrain.
      const attC: Combatant = { count: att.count, type: attType, terrain };
      const defC: Combatant = { count: def.count, type: defType, terrain };
      const r = model.battleExchange({
        attacker: attC,
        defender: defC,
        distance: BRAWL_DISTANCE,
        bonusB: 0,
      });
      att.count = r.attackerCount;
      def.count = r.defenderCount;
      events.push({
        type: 'brawl-exchange',
        cell,
        higherInitId: att.id,
        lowerInitId: def.id,
        higherInitDamageDealt: r.attackerDamageDealt,
        lowerInitDamageDealt: r.defenderCounterDealt,
        higherInitCountAfter: r.attackerCount,
        lowerInitCountAfter: r.defenderCount,
        higherInitBreakdown: breakdownFor(model, { attacker: attC, defender: defC, bonusB: 0 }),
        lowerInitBreakdown: r.counterFired
          ? breakdownFor(model, { attacker: defC, defender: attC, bonusB: 0 })
          : null,
      });
      if (def.count <= 0) killUnit(def);
      if (att.count <= 0) killUnit(att);
      // Mutual immunity: no progress possible — both survive on the cell.
      if (r.attackerDamageDealt === 0 && r.defenderCounterDealt === 0) break;
    }
  }

  // ── B. Combat (§2.7) ──────────────────────────────────────────────────────
  type FireAction = { unitId: string; explicitTarget: CellId | null };
  const fireActions: FireAction[] = [];
  for (const u of alive().sort(cmpUnits)) {
    if (u.stance === 'hold-fire') continue; // never fires (stale orders drop)
    const explicit = attackOf.get(u.id);
    if (explicit) fireActions.push({ unitId: u.id, explicitTarget: explicit.targetCell });
    else if (u.stance === 'aggressive') fireActions.push({ unitId: u.id, explicitTarget: null });
  }

  for (const action of fireActions) {
    const att = next.units[action.unitId];
    if (!att || att.count <= 0) continue; // died earlier this Phase B
    const attType = unitTypes[att.type];
    if (!attType) continue;

    let target: UnitInstance | null = null;
    if (action.explicitTarget !== null) {
      const occ = enemyAt(action.explicitTarget, att.faction);
      const dist = occ ? graphDistance(board, att.cell, occ.cell) : Infinity;
      if (!occ || dist < attType.minRange || dist > attType.maxRange) {
        events.push({ type: 'lost-target', attackerId: att.id, targetCell: action.explicitTarget });
        continue;
      }
      target = occ;
    } else {
      // E2: in conquest, owned bases extend the attacker faction's vision
      // (addendum §B.1) — ownership here is round-start ownership (captures
      // flip at Phase B.5, after combat).
      target = pickAutoTarget(board, next, att, attType, unitTypes, round, conquest ? next.bases : undefined);
      if (!target) continue; // nothing visible in range — silent
    }
    const defType = unitTypes[target.type];
    if (!defType) continue;

    const dist = graphDistance(board, att.cell, target.cell);
    const gang = gangUpBreakdown(board, target.cell, att.cell, target.attackedFrom);
    const attC: Combatant = {
      count: att.count,
      type: attType,
      terrain: terrainOf(att.cell),
      stance: att.stance,
    };
    const defC: Combatant = {
      count: target.count,
      type: defType,
      terrain: terrainOf(target.cell),
      stance: target.stance,
    };
    const r = model.battleExchange({
      attacker: attC,
      defender: defC,
      distance: dist,
      bonusB: gang.total,
    });
    // Accumulate AFTER computing B: this attack is a prior for the NEXT one.
    // The counter below never accumulates (P3 gang-up contract).
    target.attackedFrom.push(makeAttackedFromEntry(board, target.cell, att.cell));
    att.count = r.attackerCount;
    target.count = r.defenderCount;

    events.push({
      type: 'attack',
      attackerId: att.id,
      defenderId: target.id,
      attackerCell: att.cell,
      defenderCell: target.cell,
      damage: r.attackerDamageDealt,
      bonusB: gang.total,
      defenderCountAfter: r.defenderCount,
      counterFired: r.counterFired,
      breakdown: breakdownFor(model, { attacker: attC, defender: defC, bonusB: gang.total }, gang),
    });
    if (r.counterFired) {
      events.push({
        type: 'counter',
        attackerId: target.id,
        defenderId: att.id,
        attackerCell: target.cell,
        defenderCell: att.cell,
        damage: r.defenderCounterDealt,
        defenderCountAfter: r.attackerCount,
        breakdown: breakdownFor(model, { attacker: defC, defender: attC, bonusB: 0 }),
      });
    }
    if (target.count <= 0) killUnit(target);
    if (att.count <= 0) killUnit(att);
  }

  // ── B.5. Captures (conquest only — addendum §B.2, v0.6 rules change) ──────
  // A personnel unit ending the round alive on a base cell not owned by its
  // faction flips it immediately — and is CONSUMED by the claim: the unit is
  // removed from state (operator rules change, v0.6). The capture event
  // carries `unitConsumed: true`; no `kill` event is emitted (this is not a
  // combat death — replay renders a dissolve, casualty rows still count it
  // as a loss for its owner). B.5 runs AFTER all Phase B combat, so every
  // order the unit held this round already resolved; only its future-round
  // orders are moot (the sanitize pass drops orders for unknown units).
  // Vehicles never capture. Init order (the round's one ordering mechanism,
  // §2.2) — deterministic when units of both factions share a base cell
  // (mutual-immunity brawl edge: flips run in sequence, each claimant
  // consumed in turn — the LAST flip, i.e. the lowest-initiative unit's,
  // stands, and ALL of them are spent).
  if (conquest) {
    const bases = next.bases!;
    for (const u of alive().sort(cmpUnits)) {
      if (!(u.cell in bases)) continue;
      const ut = unitTypes[u.type];
      if (!ut || ut.armorType !== 'personnel') continue;
      const from = bases[u.cell]!;
      if (from === u.faction) continue; // own base — no-op
      bases[u.cell] = u.faction;
      events.push({
        type: 'capture',
        unitId: u.id,
        cell: u.cell,
        from,
        to: u.faction,
        unitConsumed: true,
      });
      delete next.units[u.id]; // spent in the claim — distinct from a kill
    }
  }

  // ── End of round: bookkeeping + Phase E + win/draw ────────────────────────
  for (const u of Object.values(next.units)) u.attackedFrom = [];

  let outcome: GameOutcome | null = null;
  if (!conquest) {
    // Skirmish §2.8 — UNCHANGED (bit-identical to pre-E2).
    let f0 = 0;
    let f1 = 0;
    for (const u of alive()) {
      if (u.faction === 0) f0++;
      else f1++;
    }
    if (f0 === 0 && f1 === 0) outcome = { winner: null, reason: 'mutual-annihilation' };
    else if (f1 === 0) outcome = { winner: 0, reason: 'annihilation' };
    else if (f0 === 0) outcome = { winner: 1, reason: 'annihilation' };
    else if (round >= ROUND_LIMIT) outcome = { winner: null, reason: 'round-limit' };
  } else {
    // ── E. Income + production (addendum §B.3/§B.4), then win/loss (§B.5).
    // Deterministic order: income faction 0 then 1; spawns by base cell
    // ascending (faction asc breaks the stale-cross-faction-buy tie).
    const bases = next.bases!;
    const credits = next.credits!;
    const baseless = next.baseless!;
    const perBase = board.economy?.perBaseCredits ?? 100;
    const ownedBases = (f: FactionId): number => {
      let n = 0;
      for (const owner of Object.values(bases)) if (owner === f) n++;
      return n;
    };

    // Income accrues per base owned at this moment (post-capture).
    for (const faction of [0, 1] as const) {
      const owned = ownedBases(faction);
      const amount = owned * perBase;
      credits[faction] += amount;
      events.push({ type: 'income', faction, bases: owned, amount, creditsAfter: credits[faction] });
    }

    // Buy resolution. Sanitize mirrors the order sanitize above: unknown unit
    // types drop silently; multiple buys for one base — the LAST one wins
    // (contract-valid input never has duplicates: BuyQueues is per-base).
    const tagged: Array<{ faction: FactionId; order: BuyOrder }> = [];
    for (const faction of [0, 1] as const) {
      const byBase = new Map<CellId, BuyOrder>();
      for (const order of buysByFaction?.[faction] ?? []) {
        if (!unitTypes[order.unitTypeKey]) continue;
        byBase.set(order.baseCell, order);
      }
      for (const order of byBase.values()) tagged.push({ faction, order });
    }
    tagged.sort((a, b) => a.order.baseCell - b.order.baseCell || a.faction - b.faction);

    for (const { faction, order } of tagged) {
      const ut = unitTypes[order.unitTypeKey]!;
      const fail = (reason: 'occupied' | 'base-lost' | 'no-credits'): void => {
        events.push({
          type: 'spawn-failed',
          cell: order.baseCell,
          faction,
          unitTypeKey: order.unitTypeKey,
          reason,
        });
      };
      if (bases[order.baseCell] !== faction) {
        fail('base-lost'); // lost (or never owned) before Phase E — no spend
      } else if (alive().some((u) => u.cell === order.baseCell)) {
        fail('occupied'); // vacant of ANY unit required (own included)
      } else if (credits[faction] < ut.cost) {
        fail('no-credits'); // defensive — entry validation caps committed cost
      } else {
        credits[faction] -= ut.cost;
        // Deterministic, collision-free id: one buy per base per round.
        const id = `f${faction}-r${round}-b${order.baseCell}-${order.unitTypeKey}`;
        next.units[id] = {
          id,
          type: order.unitTypeKey,
          faction,
          cell: order.baseCell,
          count: 10,
          stance: 'aggressive',
          attackedFrom: [],
        };
        events.push({
          type: 'spawn',
          unitId: id,
          typeKey: order.unitTypeKey,
          cell: order.baseCell,
          faction,
          creditsAfter: credits[faction],
        });
      }
    }

    // ── Win/loss (§B.5), checked at round end AFTER Phase E (a spawn can
    // save a unitless faction; income/captures count). Order: conquest
    // insta-win, base collapse, optional round limit.
    let u0 = 0;
    let u1 = 0;
    let c0 = 0;
    let c1 = 0;
    for (const u of alive()) {
      if (u.faction === 0) {
        u0++;
        c0 += u.count;
      } else {
        u1++;
        c1 += u.count;
      }
    }
    const b0 = ownedBases(0);
    const b1 = ownedBases(1);

    const dead0 = u0 === 0 && b0 === 0;
    const dead1 = u1 === 0 && b1 === 0;
    if (dead0 && dead1) outcome = { winner: null, reason: 'conquest' };
    else if (dead1) outcome = { winner: 0, reason: 'conquest' };
    else if (dead0) outcome = { winner: 1, reason: 'conquest' };

    // Grace counters update at EVERY round end (recapture resets to 0).
    baseless[0] = b0 === 0 ? baseless[0] + 1 : 0;
    baseless[1] = b1 === 0 ? baseless[1] + 1 : 0;
    if (!outcome) {
      const collapsed0 = baseless[0] >= BASELESS_GRACE;
      const collapsed1 = baseless[1] >= BASELESS_GRACE;
      if (collapsed0 && collapsed1) outcome = { winner: null, reason: 'base-collapse' };
      else if (collapsed0) outcome = { winner: 1, reason: 'base-collapse' };
      else if (collapsed1) outcome = { winner: 0, reason: 'base-collapse' };
    }

    if (!outcome && next.roundLimit != null && round >= next.roundLimit) {
      // Most bases, then most TOTAL UNIT COUNT (sum of strength points —
      // recorded decision: richer tiebreak than a raw headcount), then draw.
      let winner: FactionId | null = null;
      if (b0 !== b1) winner = b0 > b1 ? 0 : 1;
      else if (c0 !== c1) winner = c0 > c1 ? 0 : 1;
      outcome = { winner, reason: 'round-limit' };
    }
  }

  next.round = round + 1;
  next.pendingOrders = { 0: [], 1: [] };
  if (outcome) {
    next.outcome = outcome;
    next.phase = 'over';
    events.push({ type: 'game-over', outcome });
  } else {
    next.phase = 'planning';
  }
  next.log = events;
  return { state: next, events };
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** §2.4 auto-target: nearest VISIBLE enemy in range that the attacker can
 *  damage; ties → lowest count, then FNV tie-key, then id (absolute order). */
function pickAutoTarget(
  board: Board,
  state: GameState,
  att: UnitInstance,
  attType: UnitType,
  unitTypes: Readonly<Record<string, UnitType>>,
  round: number,
  bases?: Readonly<Record<CellId, FactionId | null>>,
): UnitInstance | null {
  // Visibility through the ATTACKER's faction fog, at fire time (deaths
  // earlier this Phase B already shrank/grew nobody's vision but the dead's).
  // E2: `bases` (conquest only) adds owned bases' vision-2 footprints.
  const visible = visibleCells(board, Object.values(state.units), att.faction, unitTypes, bases);
  const candidates: Array<{ u: UnitInstance; dist: number }> = [];
  for (const u of Object.values(state.units)) {
    if (u.faction === att.faction || u.count <= 0) continue;
    if (!visible.has(u.cell)) continue;
    const ut = unitTypes[u.type];
    if (!ut) continue;
    if ((attType.attackStrengths[ut.armorType] ?? 0) <= 0) continue;
    const dist = graphDistance(board, att.cell, u.cell);
    if (dist < attType.minRange || dist > attType.maxRange) continue;
    candidates.push({ u, dist });
  }
  candidates.sort((a, b) => {
    if (a.dist !== b.dist) return a.dist - b.dist;
    if (a.u.count !== b.u.count) return a.u.count - b.u.count;
    const ha = initTieKey(a.u.id, round);
    const hb = initTieKey(b.u.id, round);
    if (ha !== hb) return ha - hb;
    return a.u.id < b.u.id ? -1 : 1;
  });
  return candidates[0]?.u ?? null;
}

/** Attach the model's formula terms (or a damage-only fallback) + gang-up. */
function breakdownFor(
  model: ResolutionModel,
  ctx: AttackContext,
  gang?: GangUpBreakdown,
): AttackBreakdown {
  const terms = model.explainAttack
    ? model.explainAttack(ctx)
    : { A: 0, Ta: 0, D: 0, Td: 0, B: ctx.bonusB, p: 0, damage: model.attackDamage(ctx) };
  return { ...terms, gangUp: gang ?? { total: 0, contributions: [] } };
}

/** Deep-copy the mutable parts; the board is immutable and shared by
 *  reference (the `board` parameter is authoritative). Conquest fields are
 *  cloned (and defaulted defensively) ONLY when the state is conquest-mode —
 *  skirmish states keep their pre-E2 shape bit-identically. */
function cloneState(board: Board, state: GameState): GameState {
  const units: Record<string, UnitInstance> = {};
  for (const [id, u] of Object.entries(state.units)) {
    units[id] = { ...u, attackedFrom: u.attackedFrom.map((e) => ({ ...e })) };
  }
  const next: GameState = { ...state, board, units, pendingOrders: { 0: [], 1: [] }, log: [] };
  if (state.mode === 'conquest') {
    next.bases = { ...(state.bases ?? {}) };
    next.credits = { 0: state.credits?.[0] ?? 0, 1: state.credits?.[1] ?? 0 };
    next.baseless = { 0: state.baseless?.[0] ?? 0, 1: state.baseless?.[1] ?? 0 };
    next.roundLimit = state.roundLimit ?? null;
  }
  return next;
}
