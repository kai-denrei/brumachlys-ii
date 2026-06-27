# Refactor Analysis — scope & findings to date (PAUSED)

**Status:** ⏸️ **PAUSED 2026-06-27.** Held until the kainode memory-crash problem is
resolved. The multi-agent audit workflow that was meant to populate this plan
(`refactor-analysis`, ~14 concurrent auditors + a verify fan-out) drove cmux to
**24–27 GB on a 16 GB machine** and triggered macOS "out of application memory"
three times. Do **not** relaunch a fan-out workflow on this box to finish this.
When resumed, drive it **sequentially** (one file / one subagent at a time) or
offload to a machine with headroom.

The verified, prioritized phased plan is **not yet written** — this file captures
the scope, the hard constraints, the hotspot map, and the smells already
observed, so resuming costs no rediscovery.

---

## How to resume (memory-safe)

The audit workflow script still exists (do not run it as-is here):
`~/.claude-kainode/projects/-Users-minikai-Dev-STB-BruchmalysII/<session>/workflows/scripts/refactor-analysis-wf_3cd5bf7d-b75.js`

It defines 14 audit dimensions (below) + an adversarial verify pass against the
hard constraints, returning `{ totalVerified, kept, findings }`. To finish without
crashing: walk the dimensions **one at a time** (sequential `agent()` or read the
files in-session yourself), verify each finding against the constraints, then
synthesize the phased plan into this file.

## Hard constraints (any proposal violating these is wrong)

- **Purity:** `src/board`, `src/core`, `src/ai` stay pure & deterministic — no
  `Math.random`, `Date.now`, argless `new Date()`, DOM, or `ui/`/`state/` imports.
  `npm test` runs `scripts/check-purity.mjs` first.
- **Frozen resolver:** combat/game logic + balance are frozen. Structural/clarity
  refactors of pure logic OK only if behavior + test vectors are byte-identical.
- **Determinism:** replay is a pure function of (script, cursor); the FX playback
  layer is uniformly wall-clock-from-mount + keyed-remount (no animation-play-state,
  `paused` not threaded into FX). No per-effect replay-time clocks.
- **Mobile-first:** the board is the screen — touch targets, bundle size, phone perf.
- **Tests green:** 1293 tests; replay/combat vectors must not be re-baselined to
  dodge a refactor.
- **Port, don't reinvent.** Decisions → `.deban` (local).

## Production size map (lines)

`src/ui` 12135 · `src/state` 4056 · `src/core` 2876 · `src/ai` 2453 ·
`src/board` 1698 · `src/io` 339. `styles.css` 4778.

Largest files: styles.css 4778; state/replay.ts 2019; App.tsx 1686; ui/Board.tsx
1531; ai/planner-greedy.ts 1500; ui/skin/ReplayFx.tsx 1456; state/store.ts 1257;
core/resolver.ts 1032; ui/Replay.tsx 860; ui/skin/EffectRenderer.tsx 758;
board/donor.ts 579; ui/RulesModal.tsx 537; ui/audio/combatAudio.ts 500;
ui/skin/CellRenderer.tsx 451; ui/skin/UnitRenderer.tsx 442;
state/replay-timing.ts 426; ui/BuildDashboard.tsx 413.

Largest tests: replay-build.test.ts 1232; resolver.test.ts 725; conquest.test.ts 687.
TLOC: ~25.3k prod TS + 4.8k CSS + 23.1k tests.

## Audit dimensions (the 14 the workflow covers)

1. **css** — styles.css (4778, one file): sectioning/modularization, dead &
   duplicated rules, magic-number repetition, reduced-motion/touch coverage, CSS
   that fights the SVG transform model.
2. **replay-builder** — state/replay.ts (2019) + replay-timing.ts: split the
   fog walk / wave bucketing / beat layout / FX assembly; preserve determinism + fog honesty.
3. **app** — App.tsx (1686): extract custom hooks (replay clock, beat clock,
   spotlight, fxImpacts, autopilot, seek/scrub); shrink to an assembler.
4. **board** — Board.tsx (1531): layer sub-components (cells/highlights/ghosts/
   units/overlays/popovers); per-unit useMemo builders; the `computeFollowView`
   non-component export (Fast-Refresh smell).
5. **replay-fx** — ReplayFx.tsx (1456) + EffectRenderer (758) + UnitRenderer (442):
   split projectile/impact/floater/callout/capture/death sub-renderers; dedupe the
   keyed-remount pattern; tame `ReplayFxData` optional-field sprawl.
6. **store** — store.ts (1257, Zustand): slice into game/replay/ui/conquest/settings;
   derived-vs-stored; selectors.
7. **ai** — planner-greedy.ts (1500): scorer/currency decomposition, path-estimation
   + crossing helpers; **structure-only, byte-identical behavior** (AI tests brittle —
   deban warns of reseed-masking).
8. **types** — optional-field sprawl → discriminated unions (ReplayFxData, ImpactMark,
   Beat); `any`/`as`/non-null casts; loose strings → literal unions; exhaustiveness.
9. **duplication** — repeated `toScreen`/`factionColor`/`center`/geometry/clamp; the
   keyed-remount re-arm pattern; per-frame Map-builder boilerplate; palette/spacing
   constants; skirmish-vs-conquest parallel logic.
10. **performance** — 551 KB single bundle (>500 KB warning): code-split lazy modals/
    dashboards/replay + canvas widgets; per-frame allocations; useMemo dep correctness;
    rAF loop cost. Quantify KB/ms; mobile-first.
11. **tests** — 23.1k lines/121 files: shared test-kit (makeUnit/makeBoard/rowBoard/
    toScreen redefined per file); the 1232-line replay-build.test.ts; slow donor sweep
    (~10s); brittle AI acceptance tests; jsdom opt-in repetition. No weaker assertions.
12. **deadcode** — unused exports; component files exporting non-components
    (computeFollowView/outcomeText/fmtRange — find them all); orphaned files; barrels
    hiding cycles; circular imports.
13. **architecture** — layering board→core→ai (pure) vs state vs ui; replay-pipeline
    coupling (state/replay ↔ ui/skin/ReplayFx ↔ App); cohesion of replay-timing/
    dilation-clock/replay/callouts; prop-drilling vs context; io/+board donor isolation.
14. **replay-render** — Replay.tsx (860): scrubber/recap/skirmish-log/casualty/
    dilation-clock UI decomposition; the `outcomeText` non-component export; shared
    replay-section primitives; share more with the live board.

## Smells already observed this session (pre-verification)

- Component files export non-component helpers (`computeFollowView` in Board,
  `outcomeText` in Replay, `fmtRange` in RulesModal) → React Fast-Refresh invalidates
  on edit. → move helpers to util modules.
- Many test files each redefine `makeUnit`/`makeBoard` fixtures → shared test-kit.
- Heavy prop-drilling App → Board → UnitRenderer.
- Per-frame `Map` rebuilds in Board (`recoilByUnit`/`flipByUnit`/etc).
- 551 KB bundle, >500 KB chunk warning, no code-splitting.

These are candidates, **not yet verified** against the constraints. Verify before
committing any to the phased plan.
