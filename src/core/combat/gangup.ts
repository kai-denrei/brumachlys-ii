// Angle-based gang-up classification — the II innovation (spec §5.3).
// Replaces v1's hex-adjacency classification with board-geometry angles, so
// the same semantics work on any cell graph (hex neighbors sit at 60° steps:
// adjacent 60°, flanking 120°, opposite 180°).
//
// Each defender accumulates `attackedFrom: {cell, ranged}[]` within a round
// (cleared at round end). COUNTER-ATTACKS ARE NEVER APPENDED — the P4
// resolver only calls makeAttackedFromEntry for real attacks (explicit,
// auto-attack, brawl initiation), never for counters.
//
// At each attack, before damage, every PRIOR entry classifies as:
//   • entry.ranged                → +1 (fired from graphDistance > 1)
//   • θ <  60°                    → adjacent  +1
//   • 60° ≤ θ < 135°              → flanking  +2
//   • θ ≥ 135°                    → opposite  +3
// where θ = angleAt(board, defenderCell, entry.cell, currentAttackerCell).

import type { Board, CellId } from '../../board/types';
import { angleAt, graphDistance } from '../../board/geometry';
import type { AttackedFromEntry } from '../types';

export type GangUpClass = 'ranged' | 'adjacent' | 'flanking' | 'opposite';

export const GANGUP_WEIGHT: Record<GangUpClass, number> = {
  ranged: 1,
  adjacent: 1,
  flanking: 2,
  opposite: 3,
};

/** Build the accumulator entry for an attack that just fired. `ranged` is
 *  decided here, at fire time: attacker stood at graphDistance > 1. */
export function makeAttackedFromEntry(
  board: Board,
  defenderCell: CellId,
  attackerCell: CellId,
): AttackedFromEntry {
  return {
    cell: attackerCell,
    ranged: graphDistance(board, attackerCell, defenderCell) > 1,
  };
}

/** Classify one prior entry relative to the current attacker (spec §5.3). */
export function classifyPriorAttack(
  board: Board,
  defenderCell: CellId,
  currentAttackerCell: CellId,
  prior: AttackedFromEntry,
): GangUpClass {
  if (prior.ranged) return 'ranged';
  const theta = angleAt(board, defenderCell, prior.cell, currentAttackerCell);
  if (theta < 60) return 'adjacent';
  if (theta < 135) return 'flanking';
  return 'opposite';
}

export type GangUpContribution = {
  entry: AttackedFromEntry;
  cls: GangUpClass;
  weight: number;
};

export type GangUpBreakdown = {
  total: number; // B in the combat formula
  contributions: GangUpContribution[]; // itemized for the §9.4 breakdown modal
};

/** Full itemized breakdown — the replay UI shows each contribution (§9.4). */
export function gangUpBreakdown(
  board: Board,
  defenderCell: CellId,
  currentAttackerCell: CellId,
  priors: readonly AttackedFromEntry[],
): GangUpBreakdown {
  const contributions: GangUpContribution[] = [];
  let total = 0;
  for (const entry of priors) {
    const cls = classifyPriorAttack(board, defenderCell, currentAttackerCell, entry);
    const weight = GANGUP_WEIGHT[cls];
    contributions.push({ entry, cls, weight });
    total += weight;
  }
  return { total, contributions };
}

/** B for the combat formula. Does not mutate `priors`. */
export function gangUpBonus(
  board: Board,
  defenderCell: CellId,
  currentAttackerCell: CellId,
  priors: readonly AttackedFromEntry[],
): number {
  return gangUpBreakdown(board, defenderCell, currentAttackerCell, priors).total;
}
