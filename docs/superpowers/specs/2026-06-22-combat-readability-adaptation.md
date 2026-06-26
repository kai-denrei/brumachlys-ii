# Brumachlys II — Combat-Resolution Readability: Adaptation Plan

> Adapts the operator's source spec + addendum (vendored as
> `2026-06-22-combat-readability-SOURCE-spec.md` / `-SOURCE-addendum.md`) to this codebase.
> Operator-approved 2026-06-22. **Presentation only — the resolver is frozen.**

---

## 0. The decision (why this doc exists)

The source spec is a presentation spec for a combat model this game does **not** have:

- Source assumes: two range-band **waves** (A ranged → B melee), **simultaneous** start-of-turn
  damage, **posthumous** attacks ON, and "vanilla ES modules, no build step."
- Brumachlys II: **initiative-ordered, sequential** combat, damage applied **immediately**,
  **no posthumous** (a killed unit is removed and never acts), concentrate-fire is an intentional
  rule; stack is **React + TypeScript + Vite + SVG**.

**Operator decision: adapt the visuals to the real model (presentation-only).** Keep the
resolver frozen; deliver the readability/drama that maps to sequential combat; drop or soften the
conceits that require simultaneity + posthumous. This yields ~70-80% of the source spec's value
with zero rules risk.

## 1. What maps, what's dropped/adapted

**Delivered (faithful on the real model):**
- SPOTLIGHT desaturate/highlight transition (planning→replay); resaturate in SETTLE.
- Range-band **tempo windows** as a *presentation grouping* of existing combat events:
  a slow **dilated ranged/artillery window** then a quick **melee/brawl window** — re-timing the
  frames `buildReplay` already emits, NOT reordering the resolver.
- Crawling **ranged tracers** and arcing **artillery shells** (hang-time, late landing) in the
  dilated window.
- **Dilation cues:** cool/desaturate + vignette during the ranged window, plus the **analog
  dilation clock** HUD overlay (source addendum): screen-anchored, WAVE-A only, fade in/out at
  edges, single gold hand sweeping <1 rotation. Never drawn on a unit; never reuses radar-badge
  geometry.
- **Category-colored damage numbers:** taken = ink, counter = grey, **kill = gold**; size ∝ magnitude.
- Optional **audio** (WebAudio synth, toggle, off by default) and optional **seek/scrub**.

**Dropped or adapted (require simultaneity/posthumous, which we don't have):**
- "0-HP unit still attacking" **DOOMED glyph / dead-man's-trigger** — cannot occur (nothing
  dies-then-acts). *Adapted:* a unit killed during the ranged window persists greyed
  (DOOMED-look) until it **dissolves in SETTLE** (deferred *fall*, not deferred *action*).
- **Coincident-impact collapse** to one frame — there are no simultaneous staggered hits to
  collapse (damage is sequential). *Dropped.* (Multiple hits on a target already read as a
  sequence, which is honest.)
- **"Killing blow in the air" mutual kills** — *partially real and celebrated*: brawl-exchange
  **mutual annihilation** genuinely happens (e.g. a forced-crossing 1v1), so crossfire/mutual
  death is dramatized **there** (both fall together in SETTLE), not via posthumous ranged trades.

## 2. Architecture mapping (no `/resolution/` vanilla layer)

The source's module layout maps onto existing files:
- `timeline.js` (pure `buildTimeline`) → extend `src/state/replay.ts` (`buildReplay` already
  produces the frame script; add the phase-window layout + event classification there, pure).
- `player.js` (transport) → `src/ui/Replay.tsx` + the App replay driver (already play/pause/
  speed/skip; add seek if we do the optional scrub).
- `draw/*` → `src/ui/skin/ReplayFx.tsx` (+ `EffectRenderer.tsx`) — extend the existing
  primitives (FlashArc, MistImpact, Floater, DeathFx, etc.).
- `config.js` → a replay-timing config module (durations §4 of source, exposed
  `WAVE_A`/`WAVE_B`/`speedMultiplier`).
- `overlay.js` → new spotlight/dilation/vignette overlay + the analog clock component.

**Event classification (presentation):** derive each combat event's band from existing data —
artillery = attacker `minRange ≥ 2`; ranged = fired at `graphDistance > 1`; melee = distance 1
or a `brawl-exchange`. No new resolver fields required for the core of this; if a field genuinely
helps (e.g. a band tag), add it to the emit without changing computed values (source §2/§7).

## 3. Phased build order (each phase: tests green, purity green, build clean, visual review)

- **R1 — Tempo backbone (pure):** event band-classification + phase-window layout
  (SPOTLIGHT→HOLD→WAVE_A→INTERLUDE→WAVE_B→SETTLE) in `buildReplay`, re-timing existing frames.
  Acceptance: no melee impact plays before all ranged impacts; tempo A≈2×B (defaults
  `WAVE_A=2800`, `WAVE_B=1400`). Config exposed.
- **R2 — Spotlight transition:** desaturate non-combatants / highlight combatants on
  planning→replay; resaturate in SETTLE. New overlay capability.
- **R3 — Dilation cues + analog clock:** cool/vignette during WAVE A; the HUD dilation clock
  (addendum) with fade envelope + <1-rotation gold hand; freeze non-projectile motion.
- **R4 — Projectile primitives:** crawling tracers (charge glint → crawl → spark + streak) and
  arcing shells (parabola, dashed trail, late landing ~0.88, dust+ring burst) in the dilated
  window; upgrade the instant FlashArc.
- **R5 — Damage-number categories:** taken=ink / counter=grey / kill=gold; size ∝ magnitude.
- **R6 — Deferred dissolve (adapted):** deaths hold (greyed DOOMED-look) and dissolve in SETTLE;
  brawl mutual-deaths fall together. No 0-HP-attacking state.
- **R7 (optional) — Seek/scrub transport.**
- **R8 (optional) — Audio** (synth, toggle, off by default; optional clock ticks).

## 4. Acceptance (adapted from source §12 + addendum §12.6)

1. Resolve order visible: no melee impact before all ranged/artillery impacts land.
2. Tempo contrast preserved (A ≈ 2×B; defaults 2800/1400).
3. Damage numbers category-colored; kills gold.
4. Analog **dilation clock** renders as a HUD overlay during the ranged window only (fade
   in/out, hand <1 rotation), layered with motion/vignette/desaturation; never on a unit, never
   reusing radar geometry; **radar badges untouched**.
5. Pure playback: a given frame is a stable function of the script + cursor; skip jumps to final
   state; playback never mutates game state.
6. Deaths dissolve in SETTLE (deferred fall); brawl mutual-deaths fall together.
7. Existing look preserved (paper/pastel, red/blue, JetBrains Mono); existing replay/FX tests
   stay green or are updated to the new timing intentionally.

## 5. Non-goals

- Any resolver/rules change (no two-wave, no simultaneous, no posthumous).
- The dropped conceits in §1 (DOOMED-glyph dead-man's-trigger, coincident collapse).
- Reworking fog/visibility (the replay's fog discipline is reused as-is).

*End of adaptation plan.*
