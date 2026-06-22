# Brumachlys II — Combat Readability: Sequenced Beats + Focal Spotlight

> Operator-approved 2026-06-22. The cinematic resolution (waves + dilation clock +
> slider) made combat **slower** but not **readable**. This pass fixes the root cause.
> **Presentation only — the resolver is frozen.** No resolved value (damage, counts,
> fog, captures, log) changes; this reorders and re-paces *presentation* and adds
> visual focus. Builds on `2026-06-22-combat-readability-adaptation.md` and
> `2026-06-22-callouts-and-dilation-clock-design.md`.

---

## 0. Diagnosis — why the resolution still feels chaotic (the ultrathink)

1. **It is a simultaneous burst, not a sequence.** Within a combat wave every strike
   fires on the SAME envelope (`Projectile.delay === 0` for all WAVE_A — "never
   sequenced per-unit"). Six units firing = six tracers + six impacts + six floaters +
   six callouts at once. The eye tracks ~1–2 moving things; slowing the clock just
   yields six *slow* concurrent things. **Readability comes from sequencing, not
   uniform slow-mo.**
2. **The slow-mo has no focal point.** The whole board stays equally lit during
   dilation, so the viewer gets more time to stare at a chaotic wide shot. Nothing
   directs the eye.
3. **One global slider kills the contrast.** Readability lives in the contrast — brisk
   movement, then a sudden deep slow on *combat*. Scaling the whole replay erases the
   "now watch THIS" beat.

Cure: **sequence strikes into distinct beats, spotlight the active beat (dim the
rest), make the combat dilation independently deep, and calm each individual FX.**

## 1. Operator decisions (2026-06-22)
- **Readability:** *Sequence + spotlight* — strikes play as distinct beats, the active
  exchange spotlit, the rest dimmed, inside a deep dilation. Longest / most cinematic.
- **Slow control:** *Keep the global whole-replay speed slider AND add a separate
  combat-dilation-depth control* (two independent knobs).

## 2. Hard rules (unchanged invariants)
- **Presentation only.** No `src/core`, `src/board`, `src/ai` change. The resolver
  outcome is identical; beats are a presentation REORDER of already-resolved strikes.
- **Purity / determinism.** `replay-timing.ts` stays pure. Beat layout + spotlight are
  PURE functions of the frame's resolved strikes + the config. **No `Math.random`** —
  playback is a function of `(turn, t)`; scrub/replay must be identical.
- **Fog honesty.** A beat for a mist strike still withholds the source (impact-only);
  a fully-unwitnessable exchange produces no spotlight leak.
- **The P9 rule** (styles.css): CSS transform animations live on INNER groups only; the
  positioning translate stays an SVG attr on the OUTER group. No `offset-path`.
- Mobile-first. `prefers-reduced-motion` degrades to static end-states (no dimming
  flicker, instant beats).

---

## 3. Feature A — Sequenced combat beats

### 3.1 The beat model
- A **beat** = one shown exchange: a leading strike **+ its immediate counter**
  (crossfire) grouped together; an independent strike with no counter is its own beat;
  a brawl-exchange is one beat. Beats are built in the resolver's **natural strike
  order** (no outcome reorder — honesty).
- Within a wave, beats play **sequentially**, not concurrently. Beat *K+1* starts after
  beat *K*'s window. The existing `Projectile.delay` (currently always 0 for WAVE_A)
  becomes the per-beat **start offset** within the wave; WAVE_A projectiles are no
  longer a shared envelope.
- Keep the **WAVE_A (ranged + artillery) → WAVE_B (melee)** order. Sequence beats
  *within* each wave. (The 2:1 WAVE_A:WAVE_B duration heuristic is superseded — wave
  length is now beat-driven; the load-bearing contrast is movement-vs-combat, §5.)

### 3.2 Timing
- Each beat gets a base sub-window `BEAT_BASE` (ms at 1×, propose ~900 ms ranged /
  ~1200 ms artillery so the lob reads) scaled by the **dilation depth** (§5):
  `beatDur = BEAT_BASE × dilationDepth`. A wave's duration = Σ its beats' durations
  (plus a small inter-beat gap, propose ~120 ms, for a legible "tick" between beats).
- **Cap:** spotlight at most `MAX_SPOTLIT_BEATS` (propose 8) per wave; beyond that,
  remaining strikes collapse into a final faster "remainder" beat (play together,
  briefly) so a 30-unit melee doesn't run for a minute. `log()` nothing — but the
  remainder is visually distinct (no spotlight). Document the cap in code.
- The combat frame's total duration is recomputed from the laid-out beats; the R7
  time↔frame transport (`totalDuration`/`frameAtTime`/`frameStartTime`) and the
  scrubber must stay correct (they read frame durations — keep them authoritative).

### 3.3 Data
- Extend the combat `ReplayFrame` with `beats: Beat[]`, where
  `Beat = { start: number; dur: number; activeCells: CellId[]; projectiles: Projectile[] }`
  (`start`/`dur` relative to the frame; `activeCells` = the beat's attacker+defender
  cells for the spotlight). Built PURELY in `buildReplay`/`replay-timing` from the
  resolved strikes. Projectiles move from the flat per-frame list into their beat.
- A pure helper `beatAt(beats, tWithinFrame): Beat | null` (and an `activeCellsAt`) for
  the renderer + spotlight, deterministic, scrub-safe.

---

## 4. Feature B — Focal spotlight

- During a beat's window, the board **dims everything except `activeCells`**: non-active
  units + cells drop to a low opacity and desaturate (reuse `desaturate`/`darken` from
  `palette.ts` and the existing R3 cooling); the active attacker/defender (and their
  projectile/impact/floater/callout) render at full strength. Between beats and in
  SETTLE the board restores.
- Driven by `activeCellsAt(beats, t)` — a pure read, scrub-safe, fog-honest (a withheld
  source is never in `activeCells`). Layer this over the existing dilation cooling/
  vignette (the clock + cooling stay; the spotlight adds the per-beat focus).
- `prefers-reduced-motion`: no dimming animation — show the final/normal board (static).

---

## 5. Feature C — Combat dilation-depth control (second knob)

- New `store.dilationDepth: number` (propose range **1.0 → 4.0**, default **1.6**),
  persisted to `localStorage` (`brumachlys.dilationDepth`). It scales **combat beat
  durations only** (§3.2) — **movement frames are unaffected** (this restores the
  fast→slow contrast).
- A **second slider** in the replay dock, beside the existing whole-replay speed slider
  (§ the resolution slow-down slider, `replaySpeed`). Label "combat dilation"
  (shallow → deep); keyboard-operable, `aria-label` + `aria-valuetext` (e.g. "2.0×
  deep"). The two compose: effective per-beat wall time = `beatDur(dilationDepth) /
  replaySpeed`. The dilation **clock** + audio already read elapsed replay time, so they
  track the deeper dilation automatically; **map one decelerating clock tick per beat**
  so the ticks finally MEAN something (one tick = one exchange).
- Determinism: `dilationDepth` scales presentation wall-clock only; never feeds the
  resolver; the laid-out frame durations remain the transport authority.

---

## 6. Feature D — Contained dotted tracer (no off-frame laser)

- The sniper/ranged tracer guide currently reads as a **laser to the frame edge** when
  attacker + target are **aligned (same level / long shot)** — geometrically correct
  (`a→b`) but visually a beam across the board.
- Fixes: (a) render the guide as a **dotted line** (`stroke-dasharray`) from shooter to
  target, terminating AT the target; (b) **clip ALL replay FX to the board frame** (an
  SVG `clipPath` on the FX layer matching the board `viewBox`/`bbox`) so nothing can
  extend off-screen; (c) reproduce the aligned/long-shot case in the LIVE game (Full
  Auto, marksman, the "same level" clue) and confirm it reads as a contained dotted
  shot, not a laser. Keep the crawling round + impact (the round may stay solid; the
  *guide* becomes dotted).

## 7. Feature E — Capture callout fits the frame

- The capture callout (esp. the long term "All your Bases Are Belong To Us!") **overflows
  the board frame**, notably for an infantry capture near an edge.
- Fix: keep the callout text inside the board bounds — **clamp the anchor x/y** so the
  text box stays within the `viewBox`, and **scale the font / cap the width** (or prefer
  a shorter term near an edge) so the longest term is fully legible on-screen. Verify in
  the live game on an edge base capture.

## 8. Feature F — Artillery: higher, more natural, longer arc

- Make the shell parabola **higher and more natural** (raise the lob control point) and
  give it a **longer flight time** so it reads as a lobbed shell, not a blink. The shell
  rides its trail via SMIL `animateMotion` (the P9-safe fix) — increase the arc height
  and the motion `dur`, and ensure the flight fits within its (now beat-scaled, deeper)
  artillery beat window. Land late (~0.88 of its beat) so the hang-time fills the
  dilation.

---

## 9. Testing
- **Beats:** N exchanges → N sequential, non-overlapping beat windows; counters group
  with their strike; brawls = one beat; `dilationDepth` scales beat durations; the cap
  collapses the tail; deterministic (same turn → identical beats; no `Math.random`).
- **Spotlight:** `activeCellsAt(t)` returns the right beat's cells; non-active dimmed
  (render test); fog-honest (withheld source not active); reduced-motion static.
- **Dilation depth:** store + slider + persistence; scales combat only NOT movement;
  composes with `replaySpeed`; one clock tick per beat.
- **Transport:** `totalDuration`/`frameAtTime`/`frameStartTime` + scrubber stay correct
  with beat-driven frame durations; pause/seek/skip honor the new timing.
- **Tracer:** guide dotted; FX clipped to frame; the aligned long-shot is contained.
- **Capture text:** longest term fits within frame bounds at an edge.
- **Artillery:** higher control point + longer `dur`; lands ~0.88.
- Full suite green; `scripts/check-purity.mjs` clean; build clean; token bumped.

## 10. Build order
1. **Timing + data model** — beats (sequence, group, cap) + `dilationDepth` store +
   spotlight data (`beats`/`activeCellsAt`) in `replay-timing.ts` / `replay.ts` /
   `store.ts`; tests. Foundation — must be green before §2.
2. **Playback + clock + control** — `App.tsx` advance honors beat timing + the two
   knobs; `DilationClock.tsx` one tick per beat; the **second slider** in the dock;
   tests.
3. **Rendering** — spotlight dimming (`Board.tsx`/`ReplayFx.tsx`), sequenced-beat FX
   playback, + the three FX fixes (D dotted/clipped tracer, E capture text, F artillery
   arc) + `styles.css`; tests.
4. **Adversarial LIVE verify** — drive the REAL game (dedicated :5199, never :5173):
   confirm beats play one-at-a-time, the spotlight dims the rest, the dilation-depth
   knob deepens combat while movement stays brisk, the tracer is a contained dotted
   shot (incl. the aligned case), capture text fits, artillery arcs higher + longer.
   Measure; screenshot. (Lesson from the tracer bug: verify in the real game, not a
   synthetic happy-path.)

## 11. Non-goals
- No resolver / outcome / fog / log change (presentation reorder + re-pace only).
- The clock does not change resolved timing; ticks are mapped onto beats.
- Not redesigning the unit art, callout terms, or audio synthesis (those stay).

*End of design.*
