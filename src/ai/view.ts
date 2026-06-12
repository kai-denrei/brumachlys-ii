// FactionView — the game state as one faction is allowed to see it (spec
// §8.1). PURE. Built through the SAME visibleCells used for the player's fog
// (src/core/fog.ts) — symmetric honesty: the AI never reads hidden state.
//
// Contents:
//   • own units, full detail
//   • enemy units ONLY if they stand on a cell inside the faction's vision
//     union (the §13.6 fairness probe asserts no unit leaks past this)
//   • the full board (terrain is always visible — only units hide, spec §7)
//   • the ENEMY's placement anchor (board.placementAnchors): §8.2 lets the
//     planner advance toward it when no enemy is visible
//   • E4 conquest (addendum §B.7): a `conquest` block — own credits, base
//     LOCATIONS (map knowledge — the recorded addendum-§A asymmetry: "the
//     local force knows the land", and bases are land), and base OWNERSHIP
//     only as honestly KNOWABLE (see ConquestView.bases). Absent in skirmish.
//
// Units are defensively cloned so a planner can never mutate live GameState
// through the view.

import type { Board, CellId } from '../board/types';
import { visibleCells } from '../core/fog';
import type { FactionId, GameState, UnitInstance, UnitType } from '../core/types';

/** Believed base ownership by cell (`null` = believed neutral). This is the
 *  faction's KNOWLEDGE, not truth — it goes stale for bases outside vision. */
export type KnownBases = Readonly<Record<CellId, FactionId | null>>;

/** E4 (addendum §B.7): the conquest extension of FactionView. Every field is
 *  honestly knowable by the faction — fairness probes pin this. */
export type ConquestView = {
  /** OWN credits only. Enemy credits are hidden state and never appear. */
  credits: number;
  /** ALL base sites on the board, ascending. Locations are map knowledge
   *  (recorded addendum-§A asymmetry); OWNERSHIP is not — see `bases`. */
  baseCells: readonly CellId[];
  /** BELIEVED ownership per base: initial ownership (public setup knowledge)
   *  + flips the faction has since observed. Concretely: a base currently in
   *  the vision union shows truth; any other base shows the last value this
   *  faction saw (threaded via buildFactionView's `prevKnownBases`). Unseen
   *  enemy captures therefore do NOT appear — the belief is stale until the
   *  faction looks again. THREAD THIS FORWARD: pass `view.conquest.bases`
   *  back into the next round's buildFactionView call as `prevKnownBases`;
   *  omitting it falls back to truth (correct at round 1 — current truth IS
   *  the initial ownership — but a hidden-state leak any round after). */
  bases: KnownBases;
  /** Own §B.5 grace counter — consecutive round-ends at zero bases. The spec
   *  shows it to the player, so the AI may know its own. */
  ownBaseless: number;
  /** The battle's optional round limit (public game setting; null = none). */
  roundLimit: number | null;
};

export type FactionView = {
  faction: FactionId;
  round: number;
  /** Full board — terrain is public knowledge (spec §7). */
  board: Board;
  /** The faction's own living units, full detail. Sorted by id. */
  own: UnitInstance[];
  /** Living enemy units on visible cells ONLY. Sorted by id. */
  enemies: UnitInstance[];
  /** The faction's vision union — ⋃ cellsWithin(unit.cell, vision); in
   *  conquest, owned bases (per TRUTH — the engine grants base vision by
   *  truth, §B.1/resolver) contribute BASE_VISION as well. */
  visible: ReadonlySet<CellId>;
  /** The opposing faction's placement anchor (advance target when nothing
   *  is visible, §8.2). Null on boards without placementAnchors. */
  enemyAnchor: CellId | null;
  /** Total enemy units ever fielded — public setup knowledge (§6.4).
   *  CONQUEST: restricted to the INITIAL setup force. Units the enemy
   *  produced later are NOT counted — hidden spawns are not knowable (they
   *  are a proxy for hidden enemy credits; counting them would leak).
   *  Spawned units are recognized by the resolver's spawn id shape. */
  enemyTotal: number;
  /** Enemy units known destroyed. FAIR: in a two-faction game every enemy
   *  loss is this faction's own kill or brawl — always witnessed. Combined
   *  with `enemyTotal` and `enemies`, planners may derive how many enemy
   *  units could still be hiding in the fog WITHOUT reading positions.
   *  CONQUEST: initial-force deaths only (same restriction as enemyTotal). */
  enemyDead: number;
  /** Unit-type registry — public data, passed through for the planner. */
  unitTypes: Readonly<Record<string, UnitType>>;
  /** E4: conquest knowledge block. Present iff state.mode === 'conquest'. */
  conquest?: ConquestView;
};

const cloneUnit = (u: UnitInstance): UnitInstance => ({
  ...u,
  attackedFrom: u.attackedFrom.map((e) => ({ ...e })),
});

const byId = (a: UnitInstance, b: UnitInstance): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A Phase-E production id (`f{n}-r{round}-b{cell}-{type}` — resolver §B.4),
 *  as opposed to a setup id (`f{n}-{i}-{type}`). Used to keep the conquest
 *  enemyTotal/enemyDead arithmetic on public setup knowledge only. */
const isSpawnId = (id: string): boolean => /^f[01]-r\d+-b\d+-/.test(id);

/**
 * Build one faction's honest view.
 *
 * `prevKnownBases` (conquest only): the faction's base-ownership belief from
 * the PREVIOUS round — pass the previous view's `conquest.bases`. The result
 * view carries the updated belief; thread it forward every round. When
 * omitted, believed ownership falls back to current truth — exactly right at
 * round 1 (truth = initial ownership, which is public), a fairness leak any
 * later round, so persistent callers (store, sim harnesses) MUST thread it.
 */
export function buildFactionView(
  board: Board,
  state: GameState,
  faction: FactionId,
  unitTypes: Readonly<Record<string, UnitType>>,
  prevKnownBases?: KnownBases,
): FactionView {
  const conquest = state.mode === 'conquest';
  const living = Object.values(state.units).filter((u) => u.count > 0);
  // Owned-base vision (§B.1) is granted by the ENGINE from truth ownership —
  // mirroring it here keeps the view's vision physically accurate (a base
  // flipped unseen stops seeing for you whether you know it or not).
  const visible = visibleCells(board, living, faction, unitTypes, conquest ? state.bases : undefined);

  const own = living.filter((u) => u.faction === faction).map(cloneUnit).sort(byId);
  const enemies = living
    .filter((u) => u.faction !== faction && visible.has(u.cell))
    .map(cloneUnit)
    .sort(byId);

  const enemyAnchor = board.placementAnchors
    ? board.placementAnchors[faction === 0 ? 1 : 0]
    : null;

  // Conquest: hidden spawns are unknowable — restrict the public army-size
  // arithmetic to the initial setup force (see field docs above).
  const allEnemy = Object.values(state.units).filter(
    (u) => u.faction !== faction && (!conquest || !isSpawnId(u.id)),
  );
  const enemyTotal = allEnemy.length;
  const enemyDead = allEnemy.filter((u) => u.count <= 0).length;

  let conquestView: ConquestView | undefined;
  if (conquest) {
    const truth = state.bases ?? {};
    const baseCells = Object.keys(truth)
      .map(Number)
      .sort((a, b) => a - b);
    // Believed ownership: truth where the faction is LOOKING, last-seen
    // belief everywhere else. Initial belief (no prevKnownBases) = truth,
    // which at round 1 is the public initial ownership.
    const believed: Record<CellId, FactionId | null> = {};
    for (const cell of baseCells) {
      believed[cell] =
        visible.has(cell) || prevKnownBases === undefined || !(cell in prevKnownBases)
          ? (truth[cell] ?? null)
          : (prevKnownBases[cell] ?? null);
    }
    conquestView = {
      credits: state.credits?.[faction] ?? 0,
      baseCells,
      bases: believed,
      ownBaseless: state.baseless?.[faction] ?? 0,
      roundLimit: state.roundLimit ?? null,
    };
  }

  return {
    faction,
    round: state.round,
    board,
    own,
    enemies,
    visible,
    enemyAnchor,
    enemyTotal,
    enemyDead,
    unitTypes,
    ...(conquestView ? { conquest: conquestView } : {}),
  };
}
