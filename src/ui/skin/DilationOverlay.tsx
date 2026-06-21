// DilationOverlay.tsx — R3 (DILATION cues + analog dilation CLOCK) of the
// combat-readability pass. SCREEN-ANCHORED HUD chrome present ONLY during the
// WAVE A (ranged/artillery) window:
//
//   • DilationVignette — cools the board (a ~22% global desaturation, source
//     spec §10 DILATION_DESAT) and closes a subtle vignette, layered OVER the
//     board (and on top of the R2 spotlight — it does not replace it). Pure
//     chrome; never on a unit token.
//   • DilationClock    — a small analog face anchored in a FIXED HUD corner
//     (upper-right of the action). A single gold (--gold) hand on a dark face
//     with 12 tick marks; over the full WAVE_A window the hand advances LESS
//     THAN one rotation (~0.9 turn). Fades in/out at the wave edges (the `fade`
//     envelope), gone by INTERLUDE. The clock's presence IS the "we are in
//     dilated time" signal.
//
// HARD RULES (addendum): the clock is a single HUD/overlay element, screen-
// anchored, NEVER drawn on or anchored to a unit token, and it NEVER reuses the
// unit radar's ring/badge geometry or classes. Unit radar badges are untouched.
//
// Both are PURE reads of the dilationAt(script, cursor) payload — playback never
// mutates state. Reduced-motion: the CSS pins these as a static cool end-state
// (no harsh transition), per the spec.

import { DILATION_HAND_TURNS } from '../../state/replay';

/** R3: WAVE_A board cooling + vignette (a fixed full-bleed overlay). The cool
 *  desaturation + vignette are CSS; this only mounts/unmounts the layer while
 *  the WAVE_A window is active so the cue engages on WAVE A and releases over
 *  the INTERLUDE back toward normal. `progress` is reserved for a future
 *  intra-wave deepening; the layer itself is binary (present during WAVE A). */
export function DilationVignette({
  active,
}: {
  active: boolean;
  /** 0..1 through the WAVE_A window (reserved; the cool is a CSS end-state). */
  progress?: number;
}): React.ReactElement | null {
  if (!active) return null;
  return <div className="dilation-vignette" aria-hidden="true" />;
}

/** Clock geometry (HUD px). Deliberately distinct from any unit-token radar
 *  badge — this is screen chrome, a fixed size in the corner. */
const R = 22; // face radius
const C = 28; // face center (R + padding)
const TICKS = 12;
const TICK_OUTER = R - 2;
const TICK_INNER = R - 6;
const HAND_LEN = R - 7;

/** R3: the analog dilation clock — a single HUD overlay, present only during
 *  WAVE A. Single gold hand, 12 ticks, dark face; the hand sweeps `turns` (< 1
 *  rotation across the window). Opacity follows the `fade` envelope so it fades
 *  in at WAVE A's start and out at its end (gone by INTERLUDE). NEVER attached
 *  to a unit; NEVER reuses radar geometry. */
export function DilationClock({
  active,
  turns,
  fade,
}: {
  active: boolean;
  /** 0..1 through the WAVE_A window (drives the hand via `turns`). */
  progress?: number;
  /** the hand's rotation in turns (< 1 over the full window). */
  turns: number;
  /** 0..1 opacity multiplier from the fade envelope. */
  fade: number;
}): React.ReactElement | null {
  if (!active) return null;

  // Single hand: rotate `turns` of a full circle, 12-o'clock origin, clockwise.
  const deg = (turns % 1) * 360;
  const tipDefault = { x: C, y: C - HAND_LEN };
  // Rotate the tip about the center by `deg` (clockwise from straight up).
  const rad = (deg * Math.PI) / 180;
  const tipX = C + (tipDefault.x - C) * Math.cos(rad) - (tipDefault.y - C) * Math.sin(rad);
  const tipY = C + (tipDefault.x - C) * Math.sin(rad) + (tipDefault.y - C) * Math.cos(rad);

  const ticks = Array.from({ length: TICKS }, (_, k) => {
    const a = (k / TICKS) * Math.PI * 2;
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    return {
      x1: C + TICK_INNER * sin,
      y1: C - TICK_INNER * cos,
      x2: C + TICK_OUTER * sin,
      y2: C - TICK_OUTER * cos,
      key: k,
    };
  });

  return (
    <div
      className="dilation-clock"
      aria-hidden="true"
      style={{ opacity: fade }}
      data-turns={turns}
    >
      <svg
        className="dilation-clock-face"
        viewBox={`0 0 ${C * 2} ${C * 2}`}
        width={C * 2}
        height={C * 2}
      >
        {/* dark face */}
        <circle className="dilation-clock-disc" cx={C} cy={C} r={R} />
        {/* 12 tick marks */}
        {ticks.map((t) => (
          <line
            key={t.key}
            className="dilation-clock-tick"
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
          />
        ))}
        {/* single gold hand */}
        <line
          className="dilation-clock-hand"
          x1={C}
          y1={C}
          x2={tipX}
          y2={tipY}
          data-deg={deg}
        />
        <circle className="dilation-clock-hub" cx={C} cy={C} r={2.2} />
      </svg>
    </div>
  );
}

/** Exposed so the App's wiring stays in sync with the hand-sweep budget. */
export const DILATION_CLOCK_TURNS = DILATION_HAND_TURNS;
