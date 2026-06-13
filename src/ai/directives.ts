// v0.6 — group directives: one-tap posture plans for the PLAYER's whole
// faction (the UI applies the returned orders as the queued plan; the player
// then overrides individual units — these are ordinary Order[], nothing
// special about them). PURE, deterministic, fog-fair: the only input is the
// faction's honest FactionView (the same view the AI planners get), so a
// directive can never read hidden enemy state. The Rng parameter is accepted
// per the planner convention but unused (reserved for stochastic variants).
//
// Three postures (all MOVEMENT postures — none emits attack orders; the
// resolver's §2.4 aggressive auto-attack handles targets of opportunity):
//
//   forward-deploy   Advance toward the nearest believed-capturable base
//                    (conquest, personnel — the §B.2 capture targets) or
//                    enemy contact (visible enemies, else the enemy anchor,
//                    else the nearest fog). Aggressive stance.
//   tactical-retreat Fall back toward the faction's own ground — nearest
//                    believed-own base (conquest), else the own placement
//                    anchor — steering AWAY from known threats (visible
//                    enemies repel candidate cells). Defensive stance.
//   fortify          Hold, or step AT MOST ONE CELL to the best defensive
//                    terrain in immediate reach (armor bonus); artillery
//                    (minRange > 1) keeps its range lines — it never steps
//                    where a visible enemy would sit inside its dead zone.
//                    Defensive stance.
//
// Every own unit receives a stance order (the posture itself — this is also
// the all-units coverage guarantee) plus a move order when the chosen cell
// differs from where it stands. Units are planned in initiative order (the
// resolver's §2.2 sort), tracking planned destinations so no two units plan
// onto the same cell — exactly the greedy planner's collision discipline.
// Mode-awareness is purely view-driven: `view.conquest` present ⇒ conquest
// targets; absent ⇒ skirmish targets. Fast: a handful of BFS/Dijkstra fields
// per call (well under 10 ms for 8 units on a donor board — pinned by test).

import type { CellId } from '../board/types';
import type { Order } from '../core/orders';
import { findPath, movementCostsFor, reachableCells } from '../core/pathing';
import { initTieKey } from '../core/rng';
import type { Rng } from '../core/rng';
import type { Stance } from '../core/types';
import { bfsHops, multiSourceCost, multiSourceHops } from './fields';
import type { FactionView } from './view';

export type GroupDirective = 'forward-deploy' | 'tactical-retreat' | 'fortify';

/** Hops within which a visible enemy repels a retreat candidate. */
const RETREAT_THREAT_RADIUS = 3;
/** Retreat threat weight, in advance-field units (tenths of movement). */
const RETREAT_THREAT_WEIGHT = 6;

/** Cost-field distance normalizer (one plains step = 3 tenths). */
const ADVANCE_NORM = 3;

export function planDirective(
  directive: GroupDirective,
  view: FactionView,
  _rng: Rng,
): Order[] {
  const { board, unitTypes, round } = view;
  const cq = view.conquest;
  const orders: Order[] = [];

  // Initiative order — matches the resolver's §2.2 sort, so earlier-planned
  // units really do move first at resolution (collision discipline).
  const own = [...view.own].sort((a, b) => {
    const ia = unitTypes[a.type]?.initiative ?? 0;
    const ib = unitTypes[b.type]?.initiative ?? 0;
    if (ia !== ib) return ib - ia;
    const ha = initTieKey(a.id, round);
    const hb = initTieKey(b.id, round);
    if (ha !== hb) return ha - hb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // ── Shared target sets (honest view only) ─────────────────────────────────
  const enemyCells = [...new Set(view.enemies.map((e) => e.cell))].sort((a, b) => a - b);
  const ownAnchor = board.placementAnchors ? board.placementAnchors[view.faction] : null;

  /** Skirmish-style contact sources: visible enemies, else the enemy anchor,
   *  else the nearest fog (non-visible land — the endgame sweep). */
  const contactSources = (): CellId[] => {
    if (enemyCells.length > 0) return enemyCells;
    if (view.enemyAnchor !== null && board.cells.has(view.enemyAnchor)) return [view.enemyAnchor];
    return [...board.cells.values()]
      .filter((c) => !view.visible.has(c.id) && c.terrain !== 'water')
      .map((c) => c.id)
      .sort((a, b) => a - b);
  };

  /** Believed-capturable / believed-own base cells (conquest only). */
  const capturable: CellId[] = [];
  const ownBases: CellId[] = [];
  if (cq) {
    for (const cell of cq.baseCells) {
      if (!board.cells.has(cell)) continue;
      if (cq.bases[cell] === view.faction) ownBases.push(cell);
      else capturable.push(cell);
    }
  }

  // Per-enemy hop fields for the retreat repulsion (computed once, shared).
  const enemyHops =
    directive === 'tactical-retreat'
      ? view.enemies.map((e) => ({ count: e.count, hops: bfsHops(board, e.cell, RETREAT_THREAT_RADIUS) }))
      : [];

  // ── Collision discipline (greedy's): destinations of already-planned units
  // plus current cells of not-yet-planned ones block landing. ──────────────
  const friendlyOccupied = new Set<CellId>(own.map((u) => u.cell));
  const enemyCellSet = new Set<CellId>(enemyCells);

  for (const u of own) {
    const ut = unitTypes[u.type];
    if (!ut) continue;
    const costs = movementCostsFor(ut);
    const canStopAt = (c: CellId): boolean => !friendlyOccupied.has(c) && !enemyCellSet.has(c);
    const canPassThrough = (c: CellId): boolean => !enemyCellSet.has(c);

    let dest = u.cell;
    let stance: Stance;

    if (directive === 'fortify') {
      // Hold or step ≤1 cell to the best armor bonus in immediate reach.
      stance = 'defensive';
      // Artillery-style pieces (minRange > 1) keep their range lines: a move
      // is vetoed when a visible enemy would sit inside the new cell's dead
      // zone (the piece could neither fire nor counter from there). Holding
      // the CURRENT cell is always legal — the unit may already be pinned;
      // staying is not made worse by the veto.
      const keepsRangeLines = (cell: CellId): boolean => {
        if (ut.minRange <= 1 || view.enemies.length === 0) return true;
        const dead = bfsHops(board, cell, ut.minRange - 1);
        return !view.enemies.some((e) => dead.has(e.cell));
      };
      const armorAt = (cell: CellId): number =>
        ut.terrainEffects[board.cells.get(cell)!.terrain]?.armorBonus ?? 0;
      let best = u.cell;
      let bestScore = armorAt(u.cell);
      // Neighbors ascend (board invariant); only a STRICT armor improvement
      // moves, so ties keep the unit in place — deterministic and minimal.
      for (const n of board.cells.get(u.cell)!.neighbors) {
        const step = costs[board.cells.get(n)!.terrain] ?? Infinity;
        if (step > ut.movement) continue; // cannot afford even the one step
        if (!canStopAt(n) || !keepsRangeLines(n)) continue;
        const s = armorAt(n);
        if (s > bestScore) {
          bestScore = s;
          best = n;
        }
      }
      dest = best;
    } else if (directive === 'tactical-retreat') {
      // Toward own ground, away from known threats.
      stance = 'defensive';
      const sources: CellId[] =
        cq && ownBases.length > 0
          ? ownBases
          : ownAnchor !== null && board.cells.has(ownAnchor)
            ? [ownAnchor]
            : [];
      if (sources.length > 0) {
        const field = multiSourceCost(board, costs, sources);
        const hopField = multiSourceHops(board, sources);
        const distAt = (cell: CellId): number => {
          const dc = field.get(cell);
          if (dc !== undefined) return dc;
          const h = hopField.get(cell);
          return h !== undefined ? h * ADVANCE_NORM : Infinity;
        };
        const threatAt = (cell: CellId): number => {
          let t = 0;
          for (const e of enemyHops) {
            const d = e.hops.get(cell);
            if (d !== undefined) {
              t += ((RETREAT_THREAT_RADIUS + 1 - d) / (RETREAT_THREAT_RADIUS + 1)) * (e.count / 10);
            }
          }
          return t;
        };
        const reach = reachableCells(board, costs, u.cell, ut.movement, {
          canStopAt,
          canPassThrough,
        });
        let best = u.cell;
        let bestScore = distAt(u.cell) + RETREAT_THREAT_WEIGHT * threatAt(u.cell);
        for (const cell of [...reach.keys()].sort((a, b) => a - b)) {
          const s = distAt(cell) + RETREAT_THREAT_WEIGHT * threatAt(cell);
          if (s < bestScore || (s === bestScore && cell < best)) {
            bestScore = s;
            best = cell;
          }
        }
        dest = best;
      }
      // No anchor and no own base: hold in place, defensive.
    } else {
      // forward-deploy: advance toward capture targets / enemy contact.
      stance = 'aggressive';
      const isPersonnel = ut.armorType === 'personnel';
      let sources: CellId[];
      if (cq && isPersonnel && capturable.length > 0) {
        sources = capturable; // §B.2 capture targets — the nearest one pulls
      } else if (enemyCells.length > 0) {
        sources = enemyCells;
      } else if (cq && capturable.length > 0) {
        sources = capturable; // vehicles escort the claim frontier
      } else {
        sources = contactSources();
      }
      if (sources.length > 0) {
        const field = multiSourceCost(board, costs, sources);
        const hopField = multiSourceHops(board, sources);
        const distAt = (cell: CellId): number => {
          const dc = field.get(cell);
          if (dc !== undefined) return dc;
          const h = hopField.get(cell);
          return h !== undefined ? h * ADVANCE_NORM : Infinity;
        };
        const reach = reachableCells(board, costs, u.cell, ut.movement, {
          canStopAt,
          canPassThrough,
        });
        let best = u.cell;
        let bestScore = distAt(u.cell);
        for (const cell of [...reach.keys()].sort((a, b) => a - b)) {
          const s = distAt(cell);
          if (s < bestScore || (s === bestScore && cell < best)) {
            bestScore = s;
            best = cell;
          }
        }
        dest = best;
      }
    }

    // ── Emit: stance always (posture + all-units coverage), move when the
    // chosen cell differs and a path exists. ─────────────────────────────────
    orders.push({ kind: 'stance', unitId: u.id, stance });
    let landedOn = u.cell;
    if (dest !== u.cell) {
      const pr = findPath(board, costs, u.cell, dest, {
        budget: ut.movement,
        canStopAt,
        canPassThrough,
      });
      if (pr && pr.path.length > 0) {
        orders.push({ kind: 'move', unitId: u.id, path: pr.path });
        landedOn = dest;
      }
    }
    friendlyOccupied.delete(u.cell);
    friendlyOccupied.add(landedOn);
  }

  return orders;
}
