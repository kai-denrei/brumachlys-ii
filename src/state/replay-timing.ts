// replay-timing.ts — R1 (TEMPO BACKBONE) of the combat-readability pass.
// PURE presentation config + classification. This layer NEVER touches resolved
// values (damage, counts, fog, log): it only decides, for presentation, which
// range-band wave a combat event belongs to and how long each phase window of
// a round's combat playback lasts.
//
// The model (adaptation plan §1/§2, source spec §2/§4): a round's combat plays
// as range-band WAVES — a slow dilated WAVE_A (artillery + ranged) then a quick
// WAVE_B (close combat). The 2:1 ratio (WAVE_A ≈ 2×WAVE_B) is the load-bearing
// tempo contrast and MUST be preserved if the defaults change.
//
// Band classification is derived from data the resolver already emits:
//   • artillery — attacker unitType.minRange >= 2 (the piece is indirect-fire)
//   • ranged    — non-artillery whose strike crossed graphDistance > 1
//   • melee     — distance 1, OR a brawl-exchange (same-cell mutual combat)
// No resolved value changes; this is a presentation tag only.

import type { Board, CellId } from '../board/types';
import { graphDistance } from '../board/geometry';
import type { UnitInstance, UnitType } from '../core/types';

/** Range-band of a single combat event, for presentation grouping. */
export type CombatBand = 'artillery' | 'ranged' | 'melee';

/** Which wave a band plays in: artillery+ranged = A (dilated), melee = B (quick). */
export type Wave = 'A' | 'B';

/** The kinds of strike the builder classifies. */
export type CombatStrikeKind = 'attack' | 'counter' | 'brawl' | 'brawl-return';

/** Phase-window durations (ms at 1× speed) — source spec §4 defaults. Expose
 *  all as config; keep WAVE_A ≈ 2×WAVE_B. */
export type PhaseDurations = {
  SPOTLIGHT: number;
  HOLD: number;
  WAVE_A: number;
  INTERLUDE: number;
  WAVE_B: number;
  SETTLE: number;
};

export const REPLAY_PHASE_DURATIONS: PhaseDurations = {
  SPOTLIGHT: 350,
  HOLD: 200,
  WAVE_A: 2800,
  INTERLUDE: 250,
  WAVE_B: 1400,
  SETTLE: 900,
};

/** One laid-out phase window: absolute start/end (ms) and its duration. */
export type PhaseWindow = { start: number; end: number; duration: number };

/** The six combat phases laid out end-to-end. */
export type PhaseLayout = {
  SPOTLIGHT: PhaseWindow;
  HOLD: PhaseWindow;
  WAVE_A: PhaseWindow;
  INTERLUDE: PhaseWindow;
  WAVE_B: PhaseWindow;
  SETTLE: PhaseWindow;
};

const PHASE_ORDER = ['SPOTLIGHT', 'HOLD', 'WAVE_A', 'INTERLUDE', 'WAVE_B', 'SETTLE'] as const;

/** Lay the phase windows out end-to-end from t=0. Pass a partial override to
 *  retune any duration (e.g. a global fast-forward by halving WAVE_A/WAVE_B —
 *  keep the 2:1 ratio if you do). */
export function layoutPhases(
  overrides: Partial<PhaseDurations> = {},
): PhaseLayout {
  const d: PhaseDurations = { ...REPLAY_PHASE_DURATIONS, ...overrides };
  const out = {} as PhaseLayout;
  let t = 0;
  for (const key of PHASE_ORDER) {
    const duration = d[key];
    out[key] = { start: t, end: t + duration, duration };
    t += duration;
  }
  return out;
}

/** Which wave a band plays in (presentation grouping, source spec §2). */
export function bandWave(band: CombatBand): Wave {
  return band === 'melee' ? 'B' : 'A';
}

/**
 * Classify a combat event into a presentation range-band. PURE — derived from
 * the attacking unit's type and the strike geometry the resolver already
 * computed. Changes NO resolved value (adaptation plan §2, source spec §2/§7).
 *
 * @param kind         the strike kind (brawl/brawl-return ⇒ always melee)
 * @param attacker     the unit that fired (its type decides artillery band)
 * @param attackerCell the firing cell
 * @param defenderCell the struck cell
 */
export function classifyBand(
  kind: CombatStrikeKind,
  attacker: UnitInstance,
  attackerCell: CellId,
  defenderCell: CellId,
  board: Board,
  unitTypes: Readonly<Record<string, UnitType>>,
): CombatBand {
  // A brawl is same-cell mutual combat — always melee, regardless of unit type.
  if (kind === 'brawl' || kind === 'brawl-return') return 'melee';

  // Artillery (indirect fire) is its own band whatever the distance.
  const minRange = unitTypes[attacker.type]?.minRange ?? 1;
  if (minRange >= 2) return 'artillery';

  // Otherwise: ranged if the shot crossed more than one cell, else melee.
  const dist = graphDistance(board, attackerCell, defenderCell);
  return dist > 1 ? 'ranged' : 'melee';
}
