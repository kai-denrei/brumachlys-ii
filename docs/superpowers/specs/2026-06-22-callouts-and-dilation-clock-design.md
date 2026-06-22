# Brumachlys II — Combat Callouts + Bullet-Time Dilation Clock

> Operator-approved 2026-06-22. Two linked presentation features that add cinematic
> flair to the auto-resolution replay. **Presentation only — resolver frozen.**
> Both evolve existing systems (the "path interrupted!" sign; the R3 dilation clock).
> Source clock vendored: `2026-06-22-dilation-clock-SOURCE.html`.

---

## 0. Context — what already exists

- **R3 dilation clock** (`src/ui/skin/DilationOverlay.tsx` + `dilationAt` in `replay.ts`):
  a simple SVG analog face, single gold hand, fades in/out **only during WAVE_A**. This
  is **replaced** (decision 1).
- **Combat-readability tempo** (R1): the replay already runs `SPOTLIGHT → HOLD →
  WAVE_A (dilated, ~2×) → INTERLUDE → WAVE_B → SETTLE`, with cooling/vignette (R3).
  Movement frames play before, at normal pace.
- **"path interrupted!" sign** (`CrossSign`), the **SkirmishLog** (top-right), the **R8
  WebAudio** module (`combatAudio.ts`, toggle off by default), and **R7 time↔frame
  mapping** (`frameAtTime` / `frameStartTime` / `totalDuration`).

## 1. Hard rules

- **Presentation only.** No resolver/core/board/ai change. Both features are pure reads
  of the replay script + cursor.
- **Determinism / pure playback.** Playback is a function of `(turn, t)`. NO `Math.random`
  in either feature — the callout flavor term is chosen by a **deterministic hash of the
  event** (FNV, as used elsewhere) so scrubbing/replaying shows the SAME word. The clock is
  already a deterministic closed-form `handAngle(t)`.
- **Fog honesty.** Callouts and the clock obey the existing fog rules — a callout never
  fires for an event the player could not witness (mist kills, dark cells).
- Mobile-first; reduced-motion degrades both to static end-states.

---

## 2. Feature A — Combat callouts (event pop-ups)

Generalize the single "path interrupted!" sign into a **callout system**: a transient
military-font pop-up at the event, fading out, with a **randomly-but-deterministically
chosen** flavor term per event type.

### 2.1 Term tables (verbatim)
| Event | Terms (pick one, seeded) |
|---|---|
| Crossing / path-interrupted | `CONTACT!` · `Skirmish!` · `Engage!` · `Meeting Engagement!` |
| No target (lost-target / fizzle) | `No Target!` · `SNAFU!` · `WTF!` · `MIA!` · `DUSTWUN!` · `Out of Position!` |
| Base captured | `CAPT!` · `Captured!` · `All your Bases Are Belong To Us!` |
| Own unit destroyed | `<unit type> Down!` · `KIA!` · `MIA!` |
| Enemy unit destroyed | `Tango Down!` · `Target Down!` · `Kill Confirmed!` · `Hit!` · `Neutralized!` · `Destroyed!` |

`<unit type>` interpolates the unit's display name (e.g. `Sniper Down!`).

### 2.2 Source events (from the replay log, fog-gated)
- `path-interrupted` → crossing table. **Replaces** the literal `CrossSign` text (the
  callout becomes the sign; keep its position + fog gating).
- `lost-target` → no-target table. (Surfaces fizzles, which today are nearly silent.)
- `capture` → base-captured table (alongside the existing capture/flag FX).
- `kill` → own table if `faction === PLAYER_FACTION`, else enemy table.

### 2.3 Behavior
- **Anchor: at the event on the board** (decision 3) — the callout pops near the event's
  cell (kill cell, crossing cell, captured base, defender cell) and floats up + fades
  (~900–1200 ms), like an upgraded sign. Reuse the floater/sign rise pattern.
- **Deterministic term:** `terms[ fnv(eventKey) % terms.length ]`, where `eventKey` is a
  stable per-event string (e.g. `"kill:"+unitId+":"+round`, `"cross:"+unitId+":"+cell`).
  Stable across replay/scrub, varied between events.
- **Military font:** vendor a free **OFL stencil display font** (proposed: *Black Ops One*)
  as a woff2 under `src/ui/fonts/`, `@font-face`, used for callouts ONLY (system/log text
  stays JetBrains Mono). OFL permits bundling; note the license in the fonts dir.
- **Stacking:** multiple simultaneous kills in a wave → stagger/offset callouts so they
  don't overlap illegibly (small vertical offset per concurrent callout on a cell, or a
  short queue). Cap concurrent callouts to avoid spam.
- Pure read of the script; fog-gated; reduced-motion → static fade.

### 2.4 Data
A new per-frame FX field (e.g. `ReplayFrame.callouts: { cell; text; kind }[]`) built in
`buildReplay` from the events above (same fog filter as the rest), rendered in `ReplayFx`.
The flavor term may be resolved at build time (deterministic) or at render from `eventKey`.

---

## 3. Feature B — Bullet-time dilation clock (Swiss-railway, full arc)

**Replace** the R3 clock with the vendored Swiss-railway clock, extended across the WHOLE
resolution (decision 1). It is the cinematic spine of the resolution.

### 3.1 The three-act arc (from the source HTML)
- **GLIDE** — during the **Move phase (1×)** the red second hand sweeps **smoothly**
  (continuous `W_NORMAL`).
- **SHIFT** — at the move→combat handover: white **bloom + red ripple**, the clock
  **grows/brightens in place** (decision 2 — top-right, NOT flying to center), the board
  cools (reuse the existing R3 cooling/vignette).
- **DILATION** — during the combat waves (WAVE_A especially) the hand stops gliding and
  advances in **discrete, decelerating ticks** (`tick‑tick‑tick … tick … tick`,
  `STEP_DEG=6°`, `easeOutBack` settle, spacing fast→slow) — "time grinding to a crawl."
- **RELEASE** — INTERLUDE/WAVE_B/SETTLE: ticks end, the clock recedes/fades; board
  resaturates (existing SETTLE).

### 3.2 Placement (decision 2)
Top-right HUD overlay where the SkirmishLog sits, present through the replay; during
dilation it **grows/brightens in place** (overlaying the log for the slow-mo beat),
then recedes. Layered above the log; never flies to center.

### 3.3 Architecture (canvas → React, driven by replay time)
- Port the vendored canvas drawing into a React component (`DilationClock`, canvas in a
  fixed top-right overlay). Keep the pure `handAngle(t)` / tick model.
- **Drive `t` from the replay's elapsed time**, not the demo's own timeline: a rAF in the
  component computes elapsed `t = frameStartTime(cursor) + (now − frameEnteredAt)·speed`,
  clamped to `totalDuration` (reuse R7 helpers), and **respects pause / speed / skip /
  scrub** (paused → `t` frozen; seek → `t` jumps; skip → end).
- **Map the clock's acts to the script:** GLIDE = the movement frames span; SHIFT = the
  move→WAVE_A boundary; DILATION = the WAVE_A window (decelerating ticks over its
  duration); RELEASE = after WAVE_A. Derive these boundary times from the script's frames +
  `ReplayScript.phases`.
- This **replaces** `DilationOverlay`'s clock; the R3 cooling/vignette + `dilationAt`
  cooling stay (the clock layers on top).

### 3.4 Audio (decision 4 — under the R8 toggle)
Add to `combatAudio.ts` (gated by the existing audio toggle, off by default), fired on
**forward play only** (not scrub/seek), synced to the clock acts:
- **whoom** at SHIFT (saw 420→55 Hz + reverb),
- **decelerating reverbed ticks** during DILATION, pitched-down + more reverb as it slows
  (synced to the clock's tick boundaries),
- a **low drone** (~46 Hz) during dilation, released at the end.

### 3.5 Does it change timing? No.
The clock VISUALIZES the existing dilation (WAVE_A is already temporally longer from R1).
It does not change resolver outcomes or the frame durations; the decelerating ticks are a
visual/audio conceit mapped onto the existing WAVE_A window.

---

## 4. Testing
- **Callouts:** the term pick is deterministic (same `eventKey` → same term; distinct events
  → distinct via the table); fog-gated (no callout for a mist kill); each source event maps
  to its table; `<unit type>` interpolates; reduced-motion static. A render test for the
  callout layer.
- **Clock:** `handAngle(t)` pure/closed-form (glide region linear; dilation region stepped);
  act boundaries map to the script's move/WAVE_A windows; pause freezes `t`, seek jumps,
  skip → end; placement top-right; reduced-motion static; replaces the R3 clock (no R3 clock
  refs remain). Audio gated by the toggle (no AudioContext when off; fires on play not scrub).
- Full suite green; purity clean; build clean. Update/replace the R3 clock tests + the
  CrossSign test (now a callout).

## 5. Build order
1. **Callouts** — vendor the stencil font; add the callout FX data in `buildReplay`
   (deterministic seeded term, fog-gated) + the render layer; migrate the path-interrupted
   sign → callout; tests. (Smaller, independent of the clock.)
2. **Clock visual** — port the Swiss-railway canvas clock; drive `t` from replay elapsed
   time (R7); map the glide/shift/dilation/release acts; top-right grows-in-place; replace
   R3 clock; tests.
3. **Clock audio** — whoom / decelerating ticks / drone in `combatAudio.ts` under the
   toggle; tests.
4. Each step: in-browser verify on a **dedicated port (5199, never :5173)**; tests green,
   build clean, bust, commit.

## 6. Non-goals
- No resolver/timing change (visual conceit only).
- Clock does not fly to center (grows in place, per decision 2).
- No `Math.random` (deterministic playback).

*End of design.*
