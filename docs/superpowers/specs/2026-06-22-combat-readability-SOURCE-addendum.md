# Addendum — Analog Dilation Clock (WAVE A time-dilation cue)

**Amends:** `brumachlys-combat-resolution-visual-spec.md` §2, §5 (WAVE A), §8, §12.6

## Correction to the no-clock constraint

The original spec banned all clock/timer iconography to avoid colliding with the unit **radar**
badges. That was an over-correction. The two live in **different layers and registers** and do
not conflict:

- **Radar** = a *per-unit, diegetic* indicator rendered *on the token* (tile-distance calc on
  press). Part of the board.
- **Dilation clock** = a *single HUD/overlay element*, screen-anchored, not attached to any
  unit, present only during WAVE A. Part of the presentation chrome.

Different position, different scale, different lifetime, different purpose. **Reinstate the
analog clock as the WAVE A bullet-time cue.** Keep motion + vignette + desaturation as well —
the clock layers on top of them.

## The clock (carry over from the timing harness)

A small analog face, anchored in a fixed HUD corner (suggest upper-right of the action),
present **only during WAVE A**:

- **Single hand, slow sweep.** Over the full `WAVE_A` duration the hand advances **less than one
  rotation** (~0.9 turn). A barely-moving hand is the read: real time has nearly stopped while
  shells arc and rounds crawl.
- **Fade envelope.** Fade in over the first ~180 ms of WAVE A, fade out over the last ~180 ms;
  gone entirely by INTERLUDE. The clock's presence *is* the "we are in dilated time" signal; its
  disappearance hands the tempo back for WAVE B's quicker exhale.
- **Tick marks + accent hand.** 12 ticks, gold (`--gold`) hand on the dark face, consistent with
  the harness styling.
- **Diegetic justification.** It is the framing device for the held breath, not decoration — it
  appears precisely for the window in which time is slowed and the long-travel projectiles are
  watchable.

## Optional: bind ticks to audio

If audio (spec §11) is enabled, emit a soft tick as the hand crosses each tick mark. The audible
tick reinforces dilation through the ear without adding any further on-screen element — and pairs
naturally with the slow sweep.

## Hard separation rule (so they never get conflated again)

- The dilation clock must **never** be drawn on or anchored to a unit token, and must never reuse
  the radar's ring/badge geometry.
- Unit radar badges are **untouched** by this addendum and by the resolution animation generally.

## Amended acceptance criteria

Replaces §12.6:

> **12.6** — A single analog **dilation clock** renders as a HUD overlay during WAVE A only
> (fade in/out at the wave edges, hand sweeping <1 rotation across `WAVE_A`), layered with the
> motion/vignette/desaturation cues. It is screen-anchored, never attached to a unit, and never
> reuses unit-radar geometry. Unit radar badges remain unmodified.
