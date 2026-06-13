// Order types (spec §2.3) + planning-time validation and queue logic (P7).
// PURE — no DOM, no randomness, no imports from ui/state.
//
// Max one move + one attack + one stance per unit per round: enforced
// STRUCTURALLY by UnitOrders (one optional slot per kind); queueOrder
// replaces the same-kind slot (edit semantics), so a queue can never hold
// two orders of one kind for one unit. validateOrder treats a same-kind
// queued order as "being replaced" and ignores it.
//
// The P4 resolver re-checks legality at execution time; this module gates
// INPUT — what the player may queue given what their faction can see.

import type { Board, CellId, TerrainKey } from '../board/types';
import { graphDistance } from '../board/geometry';
import type { FactionId, Stance, UnitInstance, UnitType } from './types';
import { IMPASSABLE } from './pathing';

export type Order =
  | { kind: 'move'; unitId: string; path: CellId[] } // destination cells only, start excluded
  | { kind: 'attack'; unitId: string; targetCell: CellId }
  | { kind: 'stance'; unitId: string; stance: Stance }
  | { kind: 'capture'; unitId: string }; // v0.8 — opt-in claim (consumes the unit)

export type MoveOrder = Extract<Order, { kind: 'move' }>;
export type AttackOrder = Extract<Order, { kind: 'attack' }>;
export type StanceOrder = Extract<Order, { kind: 'stance' }>;
export type CaptureOrder = Extract<Order, { kind: 'capture' }>;
export type OrderKind = Order['kind'];

/** A unit's planned round: at most one order per kind (spec §2.3). */
export type UnitOrders = {
  move?: MoveOrder;
  attack?: AttackOrder;
  stance?: StanceOrder;
  capture?: CaptureOrder; // v0.8
};

/** All queued orders for one faction, by unit id. Treated as immutable. */
export type OrderQueues = Readonly<Record<string, UnitOrders>>;

// --- validation ---------------------------------------------------------------

export type OrderRejection =
  | 'unknown-unit' // order.unitId not in ctx.units
  | 'dead-unit' // count <= 0
  | 'empty-path' // move with no steps
  | 'broken-path' // step not a neighbor of the previous cell / unknown cell
  | 'impassable' // a path cell's terrain is impassable for the unit
  | 'over-budget' // cumulative step cost exceeds the unit's movement budget
  | 'ends-on-friendly' // §2.5: may not END on a friendly-occupied cell
  | 'through-enemy' // mid-path cell holds a VISIBLE enemy (hidden ones are unknowable)
  | 'target-not-visible' // attack target cell outside the faction's vision
  | 'no-target' // no enemy unit on the (visible) target cell
  | 'out-of-range' // graphDistance from planned end position outside [minRange, maxRange]
  | 'cannot-damage' // attackStrengths[defender armorType] == 0 (types.ts contract)
  | 'hold-fire-blocks-attack'; // §2.4: hold-fire and an explicit attack can't coexist

export type ValidationResult = { ok: true } | { ok: false; reason: OrderRejection };

const OK: ValidationResult = { ok: true };
function reject(reason: OrderRejection): ValidationResult {
  return { ok: false, reason };
}

export type OrderContext = {
  board: Board;
  /** Units KNOWN to the ordering faction: all own units + visible enemies.
   * Hidden enemies must not be in this list — planning fog ignores only
   * units, never terrain (spec §7). */
  units: readonly UnitInstance[];
  unitTypes: Readonly<Record<string, UnitType>>;
  /** visibleCells(board, units, faction, types) for the ordering faction. */
  visible: ReadonlySet<CellId>;
  /** The unit's already-queued orders. Same-kind entry is ignored (it is the
   * one being replaced); other kinds interact: a queued move shifts the
   * attack-range origin, a queued hold-fire blocks attacks and vice versa. */
  queued?: UnitOrders;
  /** v1.1 vacancy moves: ALL queued orders of the ordering faction, by unit
   * id. A move may END on a friendly-occupied cell iff that friendly has a
   * queued move whose destination is a DIFFERENT cell (a vacancy promise —
   * the resolver bounces the mover back if the promise breaks). Omitting
   * this disables the allowance (strict §2.5 behaviour). */
  allQueued?: OrderQueues;
  /** E1 discovery fog (addendum §A): the ordering faction's BELIEVED terrain
   * per cell — dark cells assumed plains, memory/live cells truth (see
   * core/fog assumedTerrainView). Move cost/passability validates against
   * THIS, so optimistic plans into the dark queue cleanly; the resolver
   * re-paths against truth and truncates ('invalid-step') on surprise.
   * Default: truth (legacy behaviour, full-knowledge callers). */
  assumedTerrain?: (cell: CellId) => TerrainKey;
};

/** The vacancy-promise gate (v1.1): may `mover` plan to END on `occ`'s cell?
 * True iff the occupant has a queued move whose destination differs from the
 * cell it currently occupies. Exported so the store can re-validate
 * dependents when the occupant's move is edited or removed. */
export function occupantVacates(occ: UnitInstance, allQueued: OrderQueues | undefined): boolean {
  const path = allQueued?.[occ.id]?.move?.path;
  if (!path || path.length === 0) return false;
  return path[path.length - 1] !== occ.cell;
}

/**
 * The cell a unit will occupy when Phase B fires, as far as planning can
 * know: the queued move's destination if one exists, else the current cell.
 * DECISION (P7): attack range is validated from this PLANNED END POSITION —
 * an attack queued together with a move means "move there, then shoot",
 * matching resolver §2.7 (attacks fire after movement; out-of-range after
 * moving = fizzle). Validating from the current cell instead would let
 * players queue guaranteed fizzles and block legal move-and-shoot plans.
 */
export function plannedEndCell(unit: UnitInstance, queued?: UnitOrders): CellId {
  const path = queued?.move?.path;
  return path && path.length > 0 ? path[path.length - 1]! : unit.cell;
}

export function validateOrder(ctx: OrderContext, order: Order): ValidationResult {
  const unit = ctx.units.find((u) => u.id === order.unitId);
  if (!unit) return reject('unknown-unit');
  if (unit.count <= 0) return reject('dead-unit');
  const ut = ctx.unitTypes[unit.type];
  if (!ut) return reject('unknown-unit');

  switch (order.kind) {
    case 'move':
      return validateMove(ctx, unit, ut, order);
    case 'attack':
      return validateAttack(ctx, unit, ut, order);
    case 'stance':
      // §2.4: stance is always a legal order — except hold-fire while an
      // explicit attack is queued (the UI blocks entering hold-fire then).
      if (order.stance === 'hold-fire' && ctx.queued?.attack) {
        return reject('hold-fire-blocks-attack');
      }
      return OK;
    case 'capture':
      // capture is always queueable; the resolver decides if it actually fires
      // (personnel + ends on a capturable base) — otherwise it's a harmless no-op.
      return OK;
  }
}

function occupant(
  units: readonly UnitInstance[],
  cell: CellId,
  exceptUnitId?: string,
): UnitInstance | undefined {
  return units.find((u) => u.cell === cell && u.count > 0 && u.id !== exceptUnitId);
}

function validateMove(
  ctx: OrderContext,
  unit: UnitInstance,
  ut: UnitType,
  order: MoveOrder,
): ValidationResult {
  const { board, units, visible } = ctx;
  const path = order.path;
  if (path.length === 0) return reject('empty-path');

  let prev = unit.cell;
  let cost = 0;
  for (let i = 0; i < path.length; i++) {
    const step = path[i]!;
    const cell = board.cells.get(step);
    if (!cell) return reject('broken-path');
    if (!board.cells.get(prev)!.neighbors.includes(step)) return reject('broken-path');

    // E1: cost against the faction's BELIEVED terrain (dark ⇒ plains).
    const terrain = ctx.assumedTerrain ? ctx.assumedTerrain(step) : cell.terrain;
    const stepCost = ut.terrainEffects[terrain]?.movementCost ?? IMPASSABLE;
    if (stepCost >= IMPASSABLE) return reject('impassable');
    cost += stepCost;
    if (cost > ut.movement) return reject('over-budget');

    const occ = occupant(units, step, unit.id);
    const isLast = i === path.length - 1;
    if (occ && occ.faction === unit.faction) {
      // Friendly: pass-through fine, ending on it is not (§2.5) — UNLESS the
      // occupant has a queued move elsewhere (v1.1 vacancy promise).
      if (isLast && !occupantVacates(occ, ctx.allQueued)) return reject('ends-on-friendly');
    } else if (occ && visible.has(step) && !isLast) {
      // Visible enemy mid-path: the player KNOWS the move would stop short —
      // don't let them queue it. A visible enemy at the DESTINATION is a
      // deliberate charge (§2.5) and is allowed. Hidden enemies never reach
      // this branch: ctx.units excludes them (fog ignores only units).
      return reject('through-enemy');
    }
    prev = step;
  }
  return OK;
}

function validateAttack(
  ctx: OrderContext,
  unit: UnitInstance,
  ut: UnitType,
  order: AttackOrder,
): ValidationResult {
  const { board, units, unitTypes, visible, queued } = ctx;

  // §2.4: hold-fire blocks explicit attacks. The planned stance is the queued
  // one if present, else the unit's current stance.
  const stance = queued?.stance?.stance ?? unit.stance;
  if (stance === 'hold-fire') return reject('hold-fire-blocks-attack');

  if (!visible.has(order.targetCell)) return reject('target-not-visible');
  const target = occupant(units, order.targetCell, unit.id);
  if (!target || target.faction === unit.faction) return reject('no-target');

  const targetType = unitTypes[target.type];
  if (targetType && (ut.attackStrengths[targetType.armorType] ?? 0) <= 0) {
    return reject('cannot-damage');
  }

  const from = plannedEndCell(unit, queued);
  const dist = graphDistance(board, from, order.targetCell);
  if (dist < ut.minRange || dist > ut.maxRange) return reject('out-of-range');

  return OK;
}

// --- queue logic ----------------------------------------------------------------

/** Add `order` to the queues, REPLACING any same-kind order for that unit
 * (edit semantics — this is what makes "max one per kind" structural). */
export function queueOrder(queues: OrderQueues, order: Order): OrderQueues {
  const unitOrders: UnitOrders = { ...queues[order.unitId], [order.kind]: order };
  return { ...queues, [order.unitId]: unitOrders };
}

/** Remove the unit's order of `kind`. Drops the unit's entry when empty. */
export function removeOrder(queues: OrderQueues, unitId: string, kind: OrderKind): OrderQueues {
  const existing = queues[unitId];
  if (!existing || !existing[kind]) return queues;
  const rest: UnitOrders = { ...existing };
  delete rest[kind];
  const next: Record<string, UnitOrders> = { ...queues };
  if (Object.keys(rest).length === 0) delete next[unitId];
  else next[unitId] = rest;
  return next;
}

/** Unit ids holding at least one queued order (dock chips, commit n/8). */
export function orderedUnitIds(queues: OrderQueues): Set<string> {
  const ids = new Set<string>();
  for (const [unitId, uo] of Object.entries(queues)) {
    if (uo.move || uo.attack || uo.stance || uo.capture) ids.add(unitId);
  }
  return ids;
}

/**
 * Flatten queues to the resolver's Order[] shape (GameState.pendingOrders).
 * Deterministic: unit ids ascending, stance → move → attack within a unit
 * (the resolver re-sorts by initiative; this fixes the input byte order).
 */
export function flattenOrders(queues: OrderQueues): Order[] {
  const orders: Order[] = [];
  for (const unitId of Object.keys(queues).sort()) {
    const uo = queues[unitId]!;
    if (uo.stance) orders.push(uo.stance);
    if (uo.move) orders.push(uo.move);
    if (uo.attack) orders.push(uo.attack);
    if (uo.capture) orders.push(uo.capture);
  }
  return orders;
}

// --- E2 conquest buy orders (addendum §B.4) -----------------------------------
//
// Buys are PER-BASE, not per-unit, so they live in their own queue structure
// (UnitOrders' one-slot-per-kind shape keys on unitId — a buy has none).
// BuyQueues mirrors the UnitOrders design one level up: one optional slot per
// base cell, queueBuy replaces the same-base slot (edit semantics) — "max one
// buy per owned base per round" is STRUCTURAL, exactly like "max one order
// per kind per unit". The resolver re-checks everything at Phase E.

export type BuyOrder = { kind: 'buy'; baseCell: CellId; unitTypeKey: string };

/** All queued buys for one faction, by base cell. Treated as immutable. */
export type BuyQueues = Readonly<Record<CellId, BuyOrder>>;

export type BuyRejection =
  | 'unknown-base' // baseCell is not a base site
  | 'not-own-base' // base exists but is neutral or enemy-owned
  | 'unknown-unit-type' // unitTypeKey not in the registry
  | 'insufficient-credits'; // total committed cost would exceed current credits

export type BuyValidationResult = { ok: true } | { ok: false; reason: BuyRejection };

export type BuyContext = {
  /** The ordering faction. */
  faction: FactionId;
  /** Current base ownership (GameState.bases). */
  bases: Readonly<Record<CellId, FactionId | null>>;
  /** The ordering faction's current credits. */
  credits: number;
  unitTypes: Readonly<Record<string, UnitType>>;
  /** The faction's already-queued buys. The same-base entry is ignored (it is
   * the one being replaced) — its cost frees up for the new order. */
  queued?: BuyQueues;
};

/** Addendum §B.4 entry validation: own base, valid unit type, and the TOTAL
 * committed cost (all queued buys + this one, same-base entry replaced)
 * within current credits. ≤1 buy per base is structural (queueBuy). */
export function validateBuy(ctx: BuyContext, order: BuyOrder): BuyValidationResult {
  if (!(order.baseCell in ctx.bases)) return { ok: false, reason: 'unknown-base' };
  if (ctx.bases[order.baseCell] !== ctx.faction) return { ok: false, reason: 'not-own-base' };
  const ut = ctx.unitTypes[order.unitTypeKey];
  if (!ut) return { ok: false, reason: 'unknown-unit-type' };
  let committed = ut.cost;
  for (const [cellKey, queued] of Object.entries(ctx.queued ?? {})) {
    if (Number(cellKey) === order.baseCell) continue; // being replaced
    committed += ctx.unitTypes[queued.unitTypeKey]?.cost ?? 0;
  }
  if (committed > ctx.credits) return { ok: false, reason: 'insufficient-credits' };
  return { ok: true };
}

/** Add `order`, REPLACING any queued buy on the same base (edit semantics). */
export function queueBuy(queues: BuyQueues, order: BuyOrder): BuyQueues {
  return { ...queues, [order.baseCell]: order };
}

/** Remove the buy queued on `baseCell` (no-op when none). */
export function removeBuy(queues: BuyQueues, baseCell: CellId): BuyQueues {
  if (!(baseCell in queues)) return queues;
  const next: Record<CellId, BuyOrder> = { ...queues };
  delete next[baseCell];
  return next;
}

/** Flatten to the resolver's BuyOrder[] shape: base cell ascending — the
 * deterministic Phase E spawn order (addendum §B / E2 determinism rule). */
export function flattenBuys(queues: BuyQueues): BuyOrder[] {
  return Object.keys(queues)
    .map(Number)
    .sort((a, b) => a - b)
    .map((cell) => queues[cell]!);
}

/**
 * Convergence detection (§9.3): cells where ≥2 of the faction's queued moves
 * end. Returns destination cell → unit ids (only entries with 2+ units).
 */
export function findConvergences(
  queues: OrderQueues,
  units: readonly UnitInstance[],
  faction: FactionId,
): Map<CellId, string[]> {
  const byDest = new Map<CellId, string[]>();
  for (const [unitId, uo] of Object.entries(queues)) {
    const path = uo.move?.path;
    if (!path || path.length === 0) continue;
    const unit = units.find((u) => u.id === unitId);
    if (!unit || unit.faction !== faction) continue;
    const dest = path[path.length - 1]!;
    const list = byDest.get(dest);
    if (list) list.push(unitId);
    else byDest.set(dest, [unitId]);
  }
  for (const [cell, ids] of [...byDest]) {
    if (ids.length < 2) byDest.delete(cell);
    else ids.sort();
  }
  return byDest;
}
