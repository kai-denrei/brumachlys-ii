// usePlanningLayer — the order-entry planning derivations, extracted VERBATIM
// from App.tsx (v1.6 refactor Phase 4). Layer 1 (§9.2: reachable tint, target
// rings, aim cells, vision edge, friction) + Layer 2 (§9.3: ghost orders) plus
// the planning-fog unit views, the selected unit, the friend/enemy lookups and
// the pathing policy they share. PURE derivations of (board, units, orders,
// selection, fog) — no store writes, no DOM. Every memo keeps its exact deps
// (incl. the documented exhaustive-deps suppressions); the helpers stay plain
// per-render functions (same identity cadence as before) so consuming handlers
// in App see byte-identical staleness behavior — only the definitions moved.

import { useMemo } from 'react';
import {
  assumedTerrainView,
  enemyFrictionAt,
  findConvergences,
  movementCostsFor,
  plannedEndCell,
  reachableCells,
} from '../../core';
import { findPath } from '../../core/pathing';
import { occupantVacates, type OrderQueues } from '../../core/orders';
import type { UnitInstance, UnitType } from '../../core/types';
import { cellsWithin, cellsWithinD, graphDistance } from '../../board/geometry';
import type { Board, CellId } from '../../board/types';
import { PLAYER_FACTION, type PendingMove } from '../../state/store';
import type { GhostOrder, ProposalGhostMark } from '../skin';

export function usePlanningLayer(opts: {
  board: Board | null;
  units: UnitInstance[];
  orders: OrderQueues;
  selectedUnitId: string | null;
  pendingMove: PendingMove | null;
  types: Record<string, UnitType>;
  visible: ReadonlySet<CellId>;
  discovered: ReadonlySet<CellId>;
}) {
  const { board, units, orders, selectedUnitId, pendingMove, types, visible, discovered } = opts;

  // E1 planning honesty: dark cells are ASSUMED plains (cost 3) by every
  // planning-side path/preview — the overlay must not leak unscouted terrain.
  // The resolver re-paths against truth and truncates on surprise.
  const assumedTerrain = useMemo(
    () => (board ? assumedTerrainView(board, discovered, visible) : undefined),
    [board, discovered, visible],
  );

  // Planning fog (spec §7): enemy units outside the player's vision union do
  // NOT exist in the planning view — they're filtered out of `units` here.
  const knownUnits = useMemo(
    () => units.filter((u) => u.faction === PLAYER_FACTION || visible.has(u.cell)),
    [units, visible],
  );

  // Live stance preview (§9.2/§10.2): a queued stance restyles the token's
  // stroke immediately, before commit.
  const boardUnits = useMemo(
    () =>
      knownUnits.map((u) => {
        const queued = orders[u.id]?.stance?.stance;
        return queued && queued !== u.stance ? { ...u, stance: queued } : u;
      }),
    [knownUnits, orders],
  );

  const selected = useMemo(() => {
    const u = selectedUnitId ? boardUnits.find((x) => x.id === selectedUnitId) : undefined;
    return u && u.faction === PLAYER_FACTION ? u : undefined;
  }, [boardUnits, selectedUnitId]);

  const friendlyAt = (cell: CellId, except?: string): UnitInstance | undefined =>
    knownUnits.find(
      (u) => u.cell === cell && u.faction === PLAYER_FACTION && u.id !== except && u.count > 0,
    );
  const visibleEnemyAt = (cell: CellId): UnitInstance | undefined =>
    knownUnits.find((u) => u.cell === cell && u.faction !== PLAYER_FACTION && u.count > 0);

  /** Pathing policy for planning (§2.5, mirrored in core validateOrder):
   * friendlies traversable but not a destination — UNLESS they have a queued
   * move elsewhere (v1.1 vacancy promise: the tile tints and is orderable);
   * VISIBLE enemies block traversal but are charge destinations; hidden
   * enemies don't exist. */
  const pathOpts = (unit: UnitInstance) => ({
    canStopAt: (c: CellId) => {
      const f = friendlyAt(c, unit.id);
      return !f || occupantVacates(f, orders);
    },
    canPassThrough: (c: CellId) => !visibleEnemyAt(c),
  });

  // --- Layer 1 (§9.2): reachable tint, target rings, vision edge --------------
  const layer1 = useMemo(() => {
    if (!board || !selected) return undefined;
    const ut = types[selected.type];
    if (!ut) return undefined;
    const costs = movementCostsFor(ut);
    const budget = ut.movement;
    // v0.9 ENEMY FRICTION (movement friction near enemies): cells holding a
    // VISIBLE enemy add a soft per-step movement malus to ENTER an adjacent
    // cell (core/pathing enemyFrictionAt). Feed the SAME helper into the reach
    // search so the highlighted reach SHRINKS near enemies — the primary
    // message: the player SEES reduced reach (hidden enemies stay a resolution
    // surprise by design). Built from the rendered enemy units (visible,
    // opposing faction, alive).
    const visibleEnemyCells = new Set<CellId>();
    for (const e of knownUnits) {
      if (e.faction !== PLAYER_FACTION && e.count > 0) visibleEnemyCells.add(e.cell);
    }
    // Tint shows moves available FROM THE CURRENT CELL (a new tap replaces
    // any queued move); rings show targets from the PLANNED end position —
    // "where could I go" vs "who can my current plan shoot".
    const reach = reachableCells(board, costs, selected.cell, budget, {
      ...pathOpts(selected),
      assumedTerrain,
      extraCostAt: (c) => enemyFrictionAt(board, c, visibleEnemyCells),
    });
    const reachable = new Map<CellId, number>();
    // Friction cells: reachable cells whose ENTRY pays enemy friction (they
    // border a visible enemy). The Board tints these distinctly — a "slowed
    // here" cue so the malus is legible at planning, not a hidden surprise.
    const frictionCells = new Set<CellId>();
    for (const [cell, cost] of reach) {
      reachable.set(cell, (budget - cost) / budget);
      if (enemyFrictionAt(board, cell, visibleEnemyCells) > 0) frictionCells.add(cell);
    }

    const from = plannedEndCell(selected, orders[selected.id]);
    const targets = new Set<CellId>();
    for (const enemy of knownUnits) {
      if (enemy.faction === PLAYER_FACTION || enemy.count <= 0) continue;
      const d = graphDistance(board, from, enemy.cell);
      if (d >= ut.minRange && d <= ut.maxRange) targets.add(enemy.cell);
    }
    // v0.9 preemptive fire (area denial): a RANGED unit (maxRange > 1) may also
    // aim at an EMPTY, visible, in-range cell — the resolver hits whoever moves
    // there (enemy → hit; empty/friendly → fizzle). Surface those cells as a
    // distinct dashed aim-ring. Excluded cells: any occupant (enemy ones are
    // already solid target-rings, friendly ones aren't legal targets) AND any
    // movement-reachable cell — onCellTap treats reachable cells as a MOVE, so
    // an aim-ring there would be deceptive. Preemptive fire is for cells you're
    // holding range on, not ones you'd step onto. cellsWithinD yields each
    // cell's BFS distance, so no per-cell graphDistance is needed; it already
    // bounds at maxRange, so only the minRange floor must be checked.
    const aimCells = new Set<CellId>();
    if (ut.maxRange > 1) {
      for (const [cell, d] of cellsWithinD(board, from, ut.maxRange)) {
        if (d < ut.minRange) continue;
        if (!visible.has(cell)) continue;
        if (reachable.has(cell)) continue; // a move, not an aim
        if (knownUnits.some((u) => u.cell === cell && u.count > 0)) continue; // any occupant
        aimCells.add(cell);
      }
    }
    const visionEdge = new Set(cellsWithin(board, selected.cell, ut.vision));
    return { reachable, targets, aimCells, visionEdge, frictionCells };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, selected, knownUnits, orders, types, assumedTerrain, visible]);

  // --- Layer 2 (§9.3): ghost orders -------------------------------------------
  const ghosts = useMemo<GhostOrder[]>(() => {
    if (!board) return [];
    const converging = findConvergences(orders, knownUnits, PLAYER_FACTION);
    const convergingUnits = new Set<string>();
    for (const ids of converging.values()) for (const id of ids) convergingUnits.add(id);
    const out: GhostOrder[] = [];
    for (const unit of boardUnits) {
      if (unit.faction !== PLAYER_FACTION) continue;
      const uo = orders[unit.id];
      if (!uo || (!uo.move && !uo.attack)) continue;
      const dest = uo.move?.path[uo.move.path.length - 1];
      const atkTarget = uo.attack?.targetCell;
      out.push({
        unit,
        movePath: uo.move?.path,
        attackTarget: atkTarget,
        attackFrom: plannedEndCell(unit, uo),
        converging: convergingUnits.has(unit.id),
        // charge ghosts offset beside the occupant (see GhostOrder docs)
        destOccupied:
          dest !== undefined && knownUnits.some((u) => u.cell === dest && u.id !== unit.id),
        // v0.9 preemptive fire: an armed attack on a cell with no known unit is
        // an area-denial shot — flag it so the ghost draws a crosshair there.
        preemptive:
          atkTarget !== undefined &&
          !knownUnits.some((u) => u.cell === atkTarget && u.count > 0),
      });
    }
    return out;
  }, [board, boardUnits, knownUnits, orders]);

  // --- v0.9 propose-then-confirm: the PROPOSAL ghost --------------------------
  // The un-queued move proposal renders as its OWN ghost, visually distinct
  // from a committed queued-order ghost (Board draws it brighter + a dashed
  // destination ring + a "tap again / Enter" affordance). It only shows for the
  // currently-selected unit (the proposal invariant); a proposal whose unit is
  // somehow no longer selected (defensive) is dropped from the render.
  const proposalGhost = useMemo<ProposalGhostMark | null>(() => {
    if (!board || !pendingMove || !selected || pendingMove.unitId !== selected.id) return null;
    return {
      unit: selected,
      movePath: pendingMove.path,
      dest: pendingMove.dest,
      destOccupied: knownUnits.some((u) => u.cell === pendingMove.dest && u.id !== selected.id),
    };
  }, [board, pendingMove, selected, knownUnits]);

  /** Compute the planning-side path (start excluded) for a move to `cell` —
   * the same findPath call queueMoveTo used. Returns null if unreachable. */
  function pathTo(unit: UnitInstance, cell: CellId): CellId[] | null {
    if (!board) return null;
    const ut = types[unit.type];
    if (!ut) return null;
    const res = findPath(board, movementCostsFor(ut), unit.cell, cell, {
      budget: ut.movement,
      ...pathOpts(unit),
      assumedTerrain,
    });
    if (!res || res.path.length === 0) return null;
    return res.path;
  }

  return {
    knownUnits,
    boardUnits,
    selected,
    friendlyAt,
    visibleEnemyAt,
    layer1,
    ghosts,
    proposalGhost,
    pathTo,
  };
}
