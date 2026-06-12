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
//
// Units are defensively cloned so a planner can never mutate live GameState
// through the view.

import type { Board, CellId } from '../board/types';
import { visibleCells } from '../core/fog';
import type { FactionId, GameState, UnitInstance, UnitType } from '../core/types';

export type FactionView = {
  faction: FactionId;
  round: number;
  /** Full board — terrain is public knowledge (spec §7). */
  board: Board;
  /** The faction's own living units, full detail. Sorted by id. */
  own: UnitInstance[];
  /** Living enemy units on visible cells ONLY. Sorted by id. */
  enemies: UnitInstance[];
  /** The faction's vision union — ⋃ cellsWithin(unit.cell, vision). */
  visible: ReadonlySet<CellId>;
  /** The opposing faction's placement anchor (advance target when nothing
   *  is visible, §8.2). Null on boards without placementAnchors. */
  enemyAnchor: CellId | null;
  /** Total enemy units ever fielded — public setup knowledge (§6.4). */
  enemyTotal: number;
  /** Enemy units known destroyed. FAIR: in a two-faction game every enemy
   *  loss is this faction's own kill or brawl — always witnessed. Combined
   *  with `enemyTotal` and `enemies`, planners may derive how many enemy
   *  units could still be hiding in the fog WITHOUT reading positions. */
  enemyDead: number;
  /** Unit-type registry — public data, passed through for the planner. */
  unitTypes: Readonly<Record<string, UnitType>>;
};

const cloneUnit = (u: UnitInstance): UnitInstance => ({
  ...u,
  attackedFrom: u.attackedFrom.map((e) => ({ ...e })),
});

const byId = (a: UnitInstance, b: UnitInstance): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildFactionView(
  board: Board,
  state: GameState,
  faction: FactionId,
  unitTypes: Readonly<Record<string, UnitType>>,
): FactionView {
  const living = Object.values(state.units).filter((u) => u.count > 0);
  const visible = visibleCells(board, living, faction, unitTypes);

  const own = living.filter((u) => u.faction === faction).map(cloneUnit).sort(byId);
  const enemies = living
    .filter((u) => u.faction !== faction && visible.has(u.cell))
    .map(cloneUnit)
    .sort(byId);

  const enemyAnchor = board.placementAnchors
    ? board.placementAnchors[faction === 0 ? 1 : 0]
    : null;

  const allEnemy = Object.values(state.units).filter((u) => u.faction !== faction);
  const enemyTotal = allEnemy.length;
  const enemyDead = allEnemy.filter((u) => u.count <= 0).length;

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
  };
}
