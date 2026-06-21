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
import type { FactionId, UnitInstance, UnitType } from '../core/types';

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

// --- R4 (PROJECTILE + ATTACK MOTION primitives) ------------------------------
// Progress (p ∈ [0,1]) milestones over each wave's frame window, and the
// crossfire offset for WAVE_B counters. PURE config — source spec §8/§10. The
// motion primitives are CSS/SMIL parameterised by these; they change no resolved
// value, they only decide WHEN within a frame a projectile lands.

/** A ranged tracer crawls to its sharp impact spark at this fraction of the
 *  WAVE_A frame window (source spec §10 WAVE_A_TRACER_IMPACT). */
export const WAVE_A_TRACER_IMPACT = 0.8;
/** A lobbed artillery shell LANDS LATE — at this fraction of the WAVE_A frame
 *  window (source spec §10 WAVE_A_SHELL_IMPACT). The long hang-time is what
 *  fills the dilation. */
export const WAVE_A_SHELL_IMPACT = 0.88;
/** A ranged tracer's brief charge glint sits near the start of the crawl. */
export const WAVE_A_TRACER_CHARGE = 0.1;
/** A WAVE_B counter is offset from the strike it answers by this many ms (at 1×)
 *  so an exchange reads as TWO motions, a crossfire (source spec §10
 *  WAVE_B_COUNTER_OFFSET). */
export const WAVE_B_COUNTER_OFFSET = 75;

/** A single attack-motion primitive for a shown strike. The renderer animates
 *  it via CSS/SMIL parameterised by progress over the frame duration:
 *   • tracer — straight-line crawl (charge glint → crawl → spark), impact ~0.80.
 *   • shell  — high parabolic arc (dashed trail), LANDS LATE ~0.88, dust+ring.
 *   • stab   — short dash from attacker toward target (~0.5 reach) + flash.
 *  Mist strikes (attacker withheld) carry no projectile — the impact alone
 *  shows (the source never leaks). PURE — derived from band + strike geometry. */
export type Projectile = {
  kind: 'tracer' | 'shell' | 'stab';
  from: CellId;
  to: CellId;
  faction: FactionId;
  /** Fraction of the frame window at which the projectile lands (impact). */
  impact: number;
  /** ms delay before this projectile launches (WAVE_B crossfire offset — a
   *  counter trails the strike it answers by WAVE_B_COUNTER_OFFSET). 0 for the
   *  leading strike of an exchange and for all WAVE_A projectiles (shared
   *  envelope — never sequenced per-unit). */
  delay: number;
};

/** Map a combat band to its projectile kind + land fraction (R4). PURE. */
export function projectileKind(band: CombatBand): {
  kind: Projectile['kind'];
  impact: number;
} {
  if (band === 'artillery') return { kind: 'shell', impact: WAVE_A_SHELL_IMPACT };
  if (band === 'ranged') return { kind: 'tracer', impact: WAVE_A_TRACER_IMPACT };
  return { kind: 'stab', impact: 0.5 };
}

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

// --- R7 (SEEK / SCRUB transport) ---------------------------------------------
// Playback is a PURE function of (resolvedTurn, t): the script is a flat list of
// fixed-duration frames, so seeking is just moving the cursor — no resolver re-run,
// no state mutation (source spec §3). These helpers map between an elapsed time
// (ms at 1× speed) and a frame index via the cumulative frame durations, so a
// scrubber/seek can land on any frame or any point in time deterministically.
// PURE — they read only frame durations; they compute nothing about damage/fog.

/** A frame-like value carrying just the field these helpers read. */
type Timed = { duration: number };

/** Total run length (ms at 1×) of a frame list — the sum of all durations.
 *  0 for an empty list. PURE. */
export function totalDuration(frames: readonly Timed[]): number {
  let sum = 0;
  for (const f of frames) sum += f.duration;
  return sum;
}

/** Clamp a frame index into the valid cursor range [0, frames.length-1].
 *  An empty list clamps to 0. PURE — the transport's single bounds authority so
 *  seekToFrame and the slider can never address a non-existent frame. */
export function clampFrame(idx: number, frameCount: number): number {
  if (frameCount <= 0) return 0;
  const i = Math.trunc(idx);
  if (i < 0) return 0;
  if (i > frameCount - 1) return frameCount - 1;
  return i;
}

/** The elapsed time (ms at 1×) at which a given frame BEGINS — the running sum of
 *  every earlier frame's duration. frameStartTime(_, 0) === 0. Out-of-range
 *  indices clamp first. PURE — the inverse of frameAtTime at frame boundaries. */
export function frameStartTime(frames: readonly Timed[], idx: number): number {
  const i = clampFrame(idx, frames.length);
  let t = 0;
  for (let k = 0; k < i; k++) t += frames[k]!.duration;
  return t;
}

/** Map an elapsed time (ms at 1×) to the frame index it falls within, by a running
 *  sum over the cumulative frame durations. The frame that owns time `ms` is the
 *  one whose [start, start+duration) window contains it; `ms` exactly on a frame
 *  boundary belongs to the LATER frame (the one starting there), and `ms` at or
 *  past the total run length pins to the last frame. Negative / NaN pins to 0.
 *  PURE — the load-bearing seek-by-time mapping (source spec §3: seek(t) yields a
 *  correct, stable frame for any t ∈ [0, total]). Linear scan; frame counts are
 *  small (tens to low hundreds) so a binary search buys nothing here. */
export function frameAtTime(frames: readonly Timed[], ms: number): number {
  if (frames.length === 0) return 0;
  if (!(ms > 0)) return 0; // negative, 0, or NaN → first frame
  let acc = 0;
  for (let i = 0; i < frames.length; i++) {
    acc += frames[i]!.duration;
    // strictly LESS than the cumulative end ⇒ this frame owns `ms`; a value on
    // the boundary (=== acc) rolls to the next frame on the following iteration.
    if (ms < acc) return i;
  }
  return frames.length - 1; // at / past the total → last frame
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
