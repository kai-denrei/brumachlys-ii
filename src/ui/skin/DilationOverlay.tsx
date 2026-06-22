// DilationOverlay.tsx — R3 board COOLING/VIGNETTE chrome of the combat-
// readability pass. SCREEN-ANCHORED full-bleed overlay present during the
// WAVE A (ranged/artillery) window:
//
//   • DilationVignette — cools the board (a global desaturation, source spec
//     §10 DILATION_DESAT) and closes a subtle vignette, layered OVER the board
//     (and on top of the R2 spotlight — it does not replace it). Pure chrome;
//     never on a unit token.
//
// Phase 2: the analog dilation CLOCK that used to live here has been REPLACED by
// the Swiss-railway bullet-time clock (src/ui/skin/DilationClock.tsx), a fixed
// top-right canvas overlay driven by the replay's elapsed time across the WHOLE
// resolution. This module keeps ONLY the cooling/vignette (dilationAt still
// drives it); the clock layers on top.
//
// DilationVignette is a PURE read of the dilationAt(script, cursor) payload —
// playback never mutates state. Reduced-motion: the CSS pins it as a static cool
// end-state (no harsh transition), per the spec.

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
