// E4 conquest buy logic (addendum §B.7). PURE & deterministic — no rng at
// all: composition choice and base ordering are fully determined by the view.
//
// Shape of the heuristic:
//   • SPEND DOWN: every round, buy at owned spawnable bases (believed-own,
//     no planned friendly / visible enemy on the cell) while credits last.
//     Idle credits are dead tempo — income compounds through map control,
//     not a bank balance.
//   • PERSONNEL FLOOR: capture capacity is the win condition's currency —
//     keep at least `floorFrac` of the (post-buy) force personnel.
//   • COUNTER-COMPOSITION: tally VISIBLE enemy strength by armor class
//     (honest current intel — no memory, no hidden reads). Armor-heavy
//     opposition → grenadier/tank wall; personnel-heavy → sniper/humvee;
//     nothing seen → a cost-efficient tank/ranger backbone (the floor logic
//     alternates it into a mixed force naturally).
//   • THREAT MODEL: a base with a visible enemy within OVERRUN_HOPS is
//     "about to be overrun" — buy there only when no safer base exists
//     (spawning into a doomed base donates credits; spawning a defender at
//     the LAST base is still right). Safer bases fill first regardless.

import type { Board, CellId } from '../board/types';
import type { BuyOrder } from '../core/orders';
import type { UnitType } from '../core/types';
import type { FactionView } from './view';

/** Enemy within this many hops of a base ⇒ the base is "about to be
 *  overrun" for buy purposes (most rosters reach 3–5 cells per round). */
const OVERRUN_HOPS = 2;

/** BFS hops from `from`, capped — local threat probes only. */
function hopsWithin(board: Board, from: CellId, maxHops: number): Map<CellId, number> {
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

/** The slice of ConquestWeights the economy consumes. */
export type BuyTuning = {
  /** Personnel fraction floor (capture capacity). */
  personnelFloor: number;
  /** Stop buying at this many own living units — beyond what the map can
   *  maneuver, fresh units only gridlock the frontier. */
  maxForce: number;
  /** Per-believed-own-base force cap (supply) — see ConquestWeights. */
  forcePerBase: number;
  /** Overdrive level at which raid composition kicks in (see planner). */
  raidThreshold: number;
  /** Idle-credit threshold above which the top shelf is preferred. */
  richFloor: number;
  /** ARCHETYPE knob (default 0 = no skew). When > 0, the buy line collapses
   *  to a cheap-infantry spam: every purchase prefers infantry first, before
   *  any counter-composition. The numeric magnitude is unused beyond the
   *  on/off threshold — kept numeric so the whole tuning block stays a flat
   *  number map. The "swarm" personality (overwhelm by cheap numbers). */
  infantryBias: number;
  /** ARCHETYPE knob (default 0 = no skew). When > 0, buys prefer RANGED unit
   *  types (sniper at any wealth, artillery once affordable) ahead of the
   *  melee line, so the force keeps a standoff edge. The "marksman"
   *  personality (ranged and patient). */
  rangedBias: number;
};

/**
 * Plan the round's buys. `plannedEnd` is the planner's own-unit end-position
 * map (a buy on a base an own unit will stand on at round end is a known
 * spawn failure — don't waste the slot); visible enemies block likewise.
 * `overdrive` (0..1, planner's stall-overdrive level): past 0.5 the raid is
 * on — the composition pivots to FAST capture troops (see below).
 */
export function planConquestBuys(
  view: FactionView,
  plannedEnd: ReadonlyMap<string, CellId>,
  tuning: BuyTuning,
  overdrive = 0,
): BuyOrder[] {
  const cq = view.conquest;
  if (!cq) return [];
  const { board, unitTypes } = view;
  let credits = cq.credits;
  if (credits <= 0) return [];
  // Supply cap: per-base force, under the absolute ceiling. Believed-own
  // bases only (honest view) — losing ground shrinks the army you can field.
  let ownBases = 0;
  for (const cell of cq.baseCells) {
    if (cq.bases[cell] === view.faction) ownBases++;
  }
  const forceCap = Math.min(tuning.maxForce, tuning.forcePerBase * ownBases);
  if (view.own.length >= forceCap) return [];

  // Cells expected occupied at Phase E, as far as honest planning can know.
  const occupied = new Set<CellId>();
  for (const u of view.own) occupied.add(plannedEnd.get(u.id) ?? u.cell);
  for (const e of view.enemies) occupied.add(e.cell);

  // Believed-own, spawnable bases with a local threat reading.
  const sites: Array<{ cell: CellId; threat: number; overrun: boolean }> = [];
  for (const cell of cq.baseCells) {
    if (cq.bases[cell] !== view.faction) continue;
    if (occupied.has(cell) || !board.cells.has(cell)) continue;
    const near = hopsWithin(board, cell, OVERRUN_HOPS + 2);
    let threat = 0;
    let overrun = false;
    for (const e of view.enemies) {
      const d = near.get(e.cell);
      if (d === undefined) continue;
      threat += e.count * (OVERRUN_HOPS + 3 - d);
      if (d <= OVERRUN_HOPS) overrun = true;
    }
    sites.push({ cell, threat, overrun });
  }
  if (sites.length === 0) return [];
  // Safest first; cell asc breaks ties (determinism).
  sites.sort((a, b) => a.threat - b.threat || a.cell - b.cell);
  // Overrun bases are skipped only when a safer alternative exists (§B.7).
  const usable = sites.some((s) => !s.overrun) ? sites.filter((s) => !s.overrun) : sites;

  // Running composition (post-buy force) for the personnel floor. The floor
  // counts MELEE personnel only ("capture troops" — infantry/ranger/
  // grenadier): snipers are legally capturers too, but behaviorally they
  // kite at range and never step onto a contested base (observed: an army
  // of snipers+tanks holds a frontier forever and flips nothing). The
  // capture race runs on boots that close.
  // RAID (overdrive ≥ 0.5): the planner is fanning FAST personnel out
  // across all capturable bases — the capture race runs on speed.
  // Grenadiers (movement 6 — two cells a round) legally satisfy the floor
  // but never finish a 15-hop raid; observed: a 28-unit army with ONE
  // ranger, fan-out assigned, nothing ever flipped. In raid mode the floor
  // counts only fast melee personnel (movement ≥ 9: ranger/infantry) and
  // buys ranger-first — but the floor itself is NOT raised: a measured
  // ranger-heavy variant diluted the heavy siege line that actually breaks
  // walls, and every prior conversion regressed to a stall.
  const raid = overdrive >= tuning.raidThreshold;
  const counts = (ut: UnitType): boolean =>
    ut.armorType === 'personnel' && ut.maxRange <= 1 && (!raid || ut.movement >= 9);
  let captureTroops = 0;
  let total = 0;
  for (const u of view.own) {
    const ut = unitTypes[u.type];
    if (!ut) continue;
    total++;
    if (counts(ut)) captureTroops++;
  }
  // Visible enemy strength by armor class — counter-composition signal.
  let enemyArmored = 0;
  let enemyPersonnel = 0;
  for (const e of view.enemies) {
    const et = unitTypes[e.type];
    if (!et) continue;
    if (et.armorType === 'armored') enemyArmored += e.count;
    else enemyPersonnel += e.count;
  }

  // Artillery share cap: a 14-artillery porcupine was observed winning the
  // attrition war and STILL stalling — artillery cannot advance (minRange 2,
  // helpless adjacent, movement 6), so a stack of it holds ground forever
  // and converts nothing. At most a quarter of the force may be siege.
  let artilleryCount = 0;
  for (const u of view.own) {
    if (u.type === 'artillery') artilleryCount++;
  }

  const affordable = (key: string): UnitType | null => {
    if (key === 'artillery' && artilleryCount >= Math.ceil((total + 1) / 4)) return null;
    const ut = unitTypes[key];
    return ut && ut.cost <= credits ? ut : null;
  };
  /** Preference list for the next purchase, most-wanted first. */
  const preference = (): string[] => {
    const floorFrac = raid ? Math.min(tuning.personnelFloor, 0.25) : tuning.personnelFloor;
    const needCapture = captureTroops < Math.max(1, Math.ceil(floorFrac * (total + 1)));
    // ARCHETYPE: swarm — collapse the whole line to cheap infantry. Infantry
    // is melee personnel, so it satisfies the capture floor too; the bias
    // just removes every other unit from contention, so the force grows as a
    // pure infantry tide. (Defined before the floor branch so it overrides
    // both the capture line and the counter-composition / rich lines.)
    if (tuning.infantryBias > 0) return ['infantry'];
    // ARCHETYPE: marksman — lead with range. Sniper is melee-class personnel
    // (counts toward the floor) yet fires at distance, so a sniper-first line
    // both keeps capture capacity and holds standoff; artillery backs it once
    // affordable. Falls through to infantry only when nothing ranged fits.
    if (tuning.rangedBias > 0) {
      return needCapture ? ['sniper', 'artillery', 'infantry'] : ['artillery', 'sniper', 'infantry'];
    }
    if (needCapture) {
      // Melee personnel only — the floor exists for capture capacity.
      if (raid) return ['ranger', 'infantry']; // speed wins the capture race
      if (enemyArmored > enemyPersonnel) return ['grenadier', 'ranger', 'infantry'];
      return ['ranger', 'infantry'];
    }
    // RICH (idle credits ≥ 2× the costliest unit): hoarded income is dead
    // tempo — convert it to SIEGE QUALITY. Mirror games were observed
    // banking 15–20k while two cheap sniper/ranger walls (the old
    // anti-personnel preference) ground each other at replacement rate
    // forever: snipers hit armored for 2, nobody fielded a single artillery
    // (range 4 outguns the whole wall, uncounterable by melee) or heavytank
    // (armor 8 shrugs the wall off) because no preference list contained
    // them. The top shelf is what cracks a fortified frontier.
    const rich = credits >= tuning.richFloor;
    if (enemyArmored > enemyPersonnel) {
      return rich
        ? ['heavytank', 'artillery', 'tank', 'grenadier', 'infantry']
        : ['tank', 'grenadier', 'infantry'];
    }
    if (enemyPersonnel > enemyArmored) {
      return rich
        ? ['artillery', 'heavytank', 'sniper', 'humvee', 'infantry']
        : ['sniper', 'humvee', 'infantry'];
    }
    // Nothing seen: cost-efficient backbone (rich: quality backbone).
    return rich ? ['heavytank', 'artillery', 'tank', 'ranger'] : ['tank', 'ranger', 'infantry'];
  };

  const buys: BuyOrder[] = [];
  for (const site of usable) {
    if (total >= forceCap) break;
    let pick: UnitType | null = null;
    for (const key of preference()) {
      pick = affordable(key);
      if (pick) break;
    }
    if (!pick) break; // cheapest preferred unit unaffordable — done spending
    buys.push({ kind: 'buy', baseCell: site.cell, unitTypeKey: pick.key });
    credits -= pick.cost;
    total++;
    if (pick.key === 'artillery') artilleryCount++;
    if (counts(pick)) captureTroops++;
  }
  // flattenBuys shape: base cell ascending.
  return buys.sort((a, b) => a.baseCell - b.baseCell);
}
