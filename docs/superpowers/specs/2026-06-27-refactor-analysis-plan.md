# Refactor Analysis — verified, prioritized phased plan

## ▶ RESUME STATE (2026-06-29) — read this first
**DEPLOY STATUS (2026-06-29):** AI7 **steps 4–8** (commits `0cbbc48`→`e3cf0f8`) are committed on
`sprite-animation` but **NOT yet pushed / PR'd** — the branch is 5 ahead of `origin/sprite-animation`.
All 5 are byte-identical refactors (golden green WITHOUT regen + a serial skeptic PASS each; 1307
tests, `tsc -b`, purity green). Push + PR→`main` when ready to deploy (the earlier P1–P6 + AI7 1–3
work below was already merged + LIVE).

**DONE + green + DEPLOYED (1307 tests, `tsc -b`, purity, prod build all green; merged to `main`
via PR #6+#7 and LIVE on GitHub Pages):**
audit · **P1** hygiene · **P2** test-kit · **P3** (mostly dissolved on survey) · **P4 partial** — 5
App hooks + **`usePlanningLayer`** (App 1686→1252) · **P5** — B5 spriteByUnit O(N²)→O(N) + *measured*
no per-frame render hotspot (rest premature) · **P6** — C1 palette tokens + C3 split styles.css→12
modules.
**4 replay-FX bugs FIXED:** fog-vs-spotlight (artillery target dark) · tracer-laser (aligned shot) ·
same-cell stab "laser" (forced-crossing brawl — render only the impact cross) · on-board HP count
"back at 10" (`rederiveFrameCounts` — bucket+regroup desynced per-frame counts from display order;
re-derive each COMBAT frame in display order, monotonic; non-combat frames incl. promotion-heal
untouched). See memory `replay-fx-open-2026-06-28` + [[dev]] deban.
**P7 STARTED (high-risk AI/replay, gate-first):**
- **AI9 DONE** — byte-identity GOLDEN-MASTER for the greedy planner (`test/ai/planner-golden.test.ts`
  + `test/ai/__fixtures__/*.json`): pins the full per-round order stream across 3 vs-do-nothing full
  games (16/31/38), a greedy-vs-greedy mirror (16), a conquest game (7), the synthetic focus-fire
  board. Regen `GEN_GOLDEN`-gated (NOT `vitest -u`) + CI-no-regen guard + LF-pinned. This is THE gate
  for every AI refactor below — output must stay byte-identical (golden green WITHOUT regen).
- **AI7 steps 1–8 DONE** — the planner's per-round PRECOMPUTE + the conquest/advance objective
  machinery + the first two scorer helpers are lifted out of the ~1100-line
  `createGreedyPlanner.plan()` closure to module-level pure fns, each byte-identical (golden green
  WITHOUT regen + a serial skeptic PASS per step):
  - steps 1–3 (per-round precompute): `computeEnemyInfos` · `computeBaseIntel` · `computeDesperation`.
  - **step 4** `computeConquestObjectives` (claims/targetOf/thrust/raid/escortSources → `{targetOf,
    escortSources}`); **step 5** `computeAdvanceContext` (anchor/holdScale phantom scalars + shared
    advanceSources/advHops → `{anchorHops,holdScale,holdActive,advanceSources,advHops}`); **step 6**
    `buildAdvanceFields` (per-unit advFieldByUnit/advHopsByUnit; objectives hoisted to `cq ? … : null`
    in plan(), branch on `!objectives` ≡ old `!cq`). → completes old NEXT items 1 (conquest-objectives)
    + 2 (advance-field builders).
  - **step 7** `nearestCommittedTo(ei, plannedPosition, ownTypeById)` (plan-level scorer helper, reads
    the live accumulating maps by ref — single call site); **step 8** `fogTouched(view, cell)` (the
    fog-touch predicate; was a per-unit-loop closure but captured only loop-invariant view/board →
    hoist-safe; single call site inside phantomAt).

**▶ NEXT = AI7 item 3, the per-candidate SCORER core — the DEEP, HIGH-RISK part. Extract the remaining
per-unit-loop helpers (each captures per-unit loop state — `u`/`ut`/`costs`/`holdRadius`/the unit's
reach/advField — so each needs its captured inputs threaded explicitly), in ASCENDING risk:**
1. **`phantomAt(cell)`** (~line 1149) — next-easiest: captures plan-level `holdActive`/`anchorHops`/
   `holdScale` + the PER-UNIT `holdRadius` (= `Math.max(ut.vision, CAMP_HOLD)`) + calls module-level
   `fogTouched`. Pass `{holdActive, anchorHops, holdScale, holdRadius}` (or view + a ctx obj). Single
   call cluster (the `taken`/phantom terms). Module-level `fogTouched` is already its only sub-call.
2. **`advanceAt(cell)`** (~1073) + **`cqBonusAt(cell, survives)`** (~1096) — the advance/capture credit
   terms; capture the unit's `advField`/`unitAdvHops`/`baseCost`/`baseHops` + conquest weights + base intel.
3. **`crossingAdjustOf(ownPath)`** (~1208) — forced-crossing rank adjust; the deepest single helper.
4. **`cmpPick(a,b)`** (~1491) — the final Pick comparator/tie-break; pins the ORDER stream most directly.
Gate EACH behind the golden (green WITHOUT regen) + one serial skeptic; extract incrementally,
commit per step. `plan()` is still the big closure — these helpers are where the order stream is decided.
Then the remaining type/replay P7 items: **T3** GameState union (mind the `mode`-absent skirmish
shape — see Phase 7), **FX5/T2** ReplayFxData union, **R1** `handleAttackRun`.
**Then** the deferred **P4** (PlanningBoard/ReplayBoard containers + store slicing ST1/2/3 — the
biggest single item, a fresh architectural design, not a verbatim move).
Still OWED before tagging v0.9: the **AI re-tune / sweep harness** (4 cumulative acceptance reseeds
have hollowed the signal — see [[dev]]/[[pm]] OQ).

**METHOD for each AI7 step (proven, repeat it):** (a) grep the block's symbols to confirm which
outputs are used OUTSIDE it (don't over-destructure → `noUnusedLocals` will bark); (b) lift to a
module-level pure fn (view + weights + already-computed inputs), keep internal-only locals internal;
(c) `tsc -b` THEN the golden (must be green WITHOUT regen) THEN full `npm test`; (d) commit per step.
Reminders: **no Workflow fan-out** (16 GB box); `tsc -b` after EVERY edit (vitest doesn't typecheck);
heavy resolver-loop tests need an explicit `{ timeout: 30_000 }` (the default 5000ms is a CI trap);
dev server `vite --port 5199 --strictPort`. Branch `sprite-animation`; PR→`main` deploys to Pages.

**P7 DISCIPLINE (non-negotiable, see §Phase 7 + Risk Register + the bottom resumption note):**
work **sequentially, NO Workflow fan-out** (16 GB box — memory `no-workflow-fanout-on-kainode`); gate
EACH item behind **one independent skeptic subagent (run serially)** + a **byte-identical** replay/AI/
combat-vector diff before merge; **never re-baseline a vector to dodge a refactor / never reseed AI**.
After EVERY edit (incl. tests) run `tsc -b` before committing — `npm test` does NOT typecheck (memory
`tsc-b-after-every-edit`). Dev server convention: `vite --port 5199 --strictPort` (don't pkill -f vite).

**Status:** ✅ **RESUMED & COMPLETED 2026-06-27.** The 14-dimension audit was re-run
**memory-safely** (sequential, one read-only subagent at a time — never a fan-out)
and the prioritized phased plan below is now written. **Phase 1 (hygiene / dead code /
helper extraction) is COMPLETE** — byte-identical, tsc clean, 1293/1293 green, purity
green (new `src/ui/board-geometry.ts` + `src/ui/text-format.ts`, 3 `fmtRange` copies
merged, 3 in-file-only exports un-exported, `markDirectiveModified` hoisted, determinism
guardrail comments added). **Phase 2 (shared test-kit) is COMPLETE** — new `test/fixtures.ts`
(canonical `bd` + `assertByteIdentical` seam + synthetic re-exports); the `bd` AttackBreakdown
factory deduped across 11 files (byte-identical, verified by hashing; 1293 green). *Deferred
within P2 (lower value / variant-heavy):* `toScreen` (8 identical copies — trivial follow-on),
and `unit`/`lineBoard`/`rowBoard` (genuinely divergent per-test bodies — merging would risk
masking), plus the vitest jsdom/node split (TS5) and AI seed-lock doc (TS4). **Phases 3–7 not
started.**

> **Why this was paused (do not repeat):** the original `refactor-analysis` workflow
> ran ~14 audit auditors **concurrently** (`pipeline`, capped at `min(16, cores−2)` =
> **8** live subagents on this 10-core box) plus a nested verify fan-out. Each subagent
> is a 2–3 GB node process → 24–27 GB on a **16 GB** machine → macOS "out of application
> memory" ×3. **On this machine, never run the Workflow tool / multi-agent fan-out for
> this codebase.** See memory `no-workflow-fanout-on-kainode`.

## How it was resumed (memory-safe method — reuse this)

- Mined the 14 dimension prompts + constraint text + schemas from the paused script
  (`…/workflows/scripts/refactor-analysis-wf_3cd5bf7d-b75.js`) — do **not** run it as-is.
- Walked the dimensions **one at a time**: a single `Explore` subagent per dimension,
  awaited fully, findings appended to a durable file, raw context dropped, then the next.
  **Peak ≈ main session + 1 subagent ≈ 6 GB.** Never two agent calls in one turn.
- Verification done **in-session** (constraints already in context); ground-truth grep
  of every Phase-1 symbol before trusting line numbers. Risky (determinism/AI/payload)
  findings are gated to late phases requiring an independent skeptic + byte-identity check.

---

## Hard constraints (any proposal violating these is wrong)

- **Purity:** `src/board`, `src/core`, `src/ai` stay pure & deterministic — no
  `Math.random`, `Date.now`, argless `new Date()`, DOM, or `ui/`/`state/` imports.
  `npm test` runs `scripts/check-purity.mjs` first. **(Confirmed holding — DIM 13.)**
  Note: the reverse is allowed — `ui/` MAY import pure `board/`/`core/` (e.g. `board/vec.ts`).
- **Frozen resolver:** combat/game logic + balance frozen. Structural/clarity refactors
  of pure logic OK only if behavior + test vectors are **byte-identical**.
- **Determinism:** replay is a pure function of (script, cursor); FX playback is uniformly
  wall-clock-from-mount + keyed-remount (the model lives at `Board` via `key={replayFx.key}`,
  NOT in FX internals — so FX sub-renderers split safely). No per-effect replay clocks;
  `paused` is not threaded into FX. Scrubbing only moves the cursor, never re-runs the resolver.
- **Mobile-first:** the board is the screen — touch targets, bundle size, phone perf.
- **Tests green:** 1293 tests; replay/combat/AI vectors must **not** be re-baselined to dodge
  a refactor (the deban log flags AI "reseed-masking": reseeds now ×4 — re-tune, don't reseed).
- **Port, don't reinvent.** Decisions → `.deban` (local).

## Production size map (lines)

`src/ui` 12135 · `src/state` 4056 · `src/core` 2876 · `src/ai` 2453 ·
`src/board` 1698 · `src/io` 339. `styles.css` 4778. Largest: styles.css 4778;
state/replay.ts 2019; App.tsx 1686; ui/Board.tsx 1531; ai/planner-greedy.ts 1500;
ui/skin/ReplayFx.tsx 1456; state/store.ts 1257; core/resolver.ts 1032.

---

# THE PHASED PLAN

Phases are ordered so **risk increases monotonically** and **no phase starts on a frozen/red
prior**. Each phase is independently shippable with `npm test` green. Finding IDs map to the
catalog below. Effort: S<1day · M=2–4d · L>1wk.

## Phase 1 — Hygiene, dead code, Fast-Refresh fixes  ·  risk: none (no behavior change)
Pure-mechanical moves; tests green after each. **Executing now.**
1. **Un-export in-file-only symbols** (DC3): drop `export` from `DIRECTIVE_LABEL`
   (TopCta.tsx:20), `floaterSizeScale` (ReplayFx.tsx:1205), `ConquestOutcome`
   (Replay.tsx:771). *Grep-confirmed zero external/test usage.*
2. **Move non-component exports → util modules** (DC2/B2/RR1): `computeFollowView`+`View`,
   `staggerLayout`, `demoteSlot`, `DEMOTE_SCALE` out of Board.tsx → `src/ui/board-geometry.ts`;
   `outcomeText` out of Replay.tsx + consolidate the 3 `fmtRange` copies (Sheets.tsx:227,
   UnitPicker.tsx:16, RulesModal.tsx:170) → `src/ui/text-format.ts`. Re-import in the
   component files; repoint test imports (board/stagger/move-demote/banner-conquest/rules-modal).
   *Each is used both internally and by tests — extract, don't delete.*
3. **`markDirectiveModified()` helper** (ST6): DRY the 4 inline
   `directive ? {…modified:true} : null` sites (store.ts:933/944/1034/1041).
4. **Guardrail doc comments** (FX6/R7/AR7/AR8): keyed-remount/wall-clock model atop ReplayFx;
   3-stage replay-builder contract at replay.ts:375; `dilationDepth`(beat) vs `replaySpeed`
   (transport) orthogonality; dilation-clock closed-form determinism header. *Near-free; lowers
   the risk of every later phase.*

## Phase 2 — Shared test-kit  ·  risk: low (test-only; fixtures must be byte-identical)
No production code. **Guard:** `assertByteIdentical` over old-vs-new fixture JSON before commit;
no weakened assertions; no reseed.
- `test/fixtures.ts` umbrella (TS7) exporting `bd` (TS1, dup ×10, −120 LOC), `lineBoard`
  (TS2, dup ×6), `unit`/`makeUnit` (TS3, dup ×6), `ctx`, documented `SEEDS`. Add
  `assertByteIdentical` seam (TS8). Split jsdom vs node vitest projects (TS5). Optionally split
  the 1232-line replay-build.test.ts by describe block (TS6 — move only).
- **TS4 (process guard):** lock AI acceptance seeds with rationale; flag reseed-without-retune.

## Phase 3 — Safe DRY & pure utilities  ·  **mostly DISSOLVED ON SURVEY** (2026-06-27)
**Survey verdict — the audit over-counted "duplication" here; most items are distinct functions
sharing a name/concept, not real dupes.** Only one small win was real and shipped:
- ✅ **DONE (T4):** RulesModal `roster.find(...) as UnitType` ×2 → explicit non-null guard (removed
  the type-escapes + the now-unused `UnitType` import).
- ❌ **D1 clamp → core/math — NO real dup.** The only generic `[0,1]` clamp is `weewar.ts:41`
  (used only in weewar); `dilation-clock`'s `clamp01(a,b,t)` is a *different* function (inverse-lerp);
  `clampZoom/Depth/Frame/ReplaySpeed` are distinct domain wrappers. Nothing to merge.
- ❌ **D2/FX4 `center()` merge** — the two copies differ (one returns `cell.center`, one returns
  `toScreen(cell.center)`); not worth a shared module for two 3-line variants.
- ❌ **D4 reuse `board/vec.ts`** — 49+ inline `Math.hypot/cos/sin` sites; large churn, cosmetic. Skip.
- ⏸ **AR5 `loadUnits` → store selector** — `loadUnits()` just returns the cached static-JSON ref
  (the `useMemo`s are essentially free); marginal. Deferred.
- ⏸ **io/data-loader `as unknown as`** — controlled, documented, already pinned by
  `test/core/data.test.ts`; a runtime validator would duplicate that test for static bundled data. Left.
- ⏸ **T7 assertNever** — there is no `switch` on `ResolutionEvent` (if-chains), so this is a real
  restructure, not a type-only freebie. Deferred to Phase 4/7.
- ⏸ **AI2/AI4 extractions** — touch the brittle FROZEN planner for ~5 LOC; risk/reward poor. Deferred.

## Phase 4 — Component decomposition  ·  risk: medium (UI structure; logic unchanged)  ·  **clean hooks DONE**
Regression suite is the guard; move code, not logic.
- **App.tsx 1686 → 1411 (−16%)** (A1–A8/AR1): 5 hooks extracted into `src/ui/hooks/` + the Phase-1
  `board-geometry` move.
  - ✅ **DONE (verbatim pure moves, 1293 green + tsc clean each):** `useKeyboardShortcuts`
    (Enter/Escape), `useAnnouncement` ("Your turn" auto-advance + backstop + phase-exit clear),
    `useAutopilot` (Full-Auto), `useBeatClock` (§4 focal-spotlight rAF clock — wall-clock-from-mount
    verbatim), `useReplayDriver` (frameIdx/paused/breakdownSlot + advance loop + seek/scrub; resets
    its own state on [script]; ~30 readers consume the returned values).
  - ✅ **DONE (A3 `usePlanningLayer`, 2026-06-27, commit 27806de — verbatim, App 1412→1261):** the
    entangled planning layer (assumedTerrain, knownUnits/boardUnits, selected, friendlyAt/
    visibleEnemyAt, pathOpts, layer1, ghosts, proposalGhost, pathTo) moved to `src/ui/hooks/
    usePlanningLayer.ts`. DE-RISKED by destructuring the hook return into the SAME local names →
    every onCellTap/render consumer (~126 sites) is byte-identical; memos keep exact deps, helpers
    keep per-render identity. **IN-BROWSER validated** (Playwright vs :5199): select → reach-tint=13,
    tap → proposal-ghost, tap again → committed ghost-order; no page errors. 1295 green, tsc+purity.
  - 🛑 **STILL DEFERRED — the `<PlanningBoard>`/`<ReplayBoard>` containers (B3/AR2 prop drill via
    `useReplayFrame()`) and store slicing (ST1/2/3):** containers are medium; store slicing is the
    biggest single item (slice AppState via `combine()`, move pure helpers to core/state, add
    selectors.ts + replay-pipeline.ts) — a fresh architectural design, not a verbatim move. Carry
    the same in-browser-validation discipline.
  - 🔎 **IN-BROWSER CHECK (deferred to the bug session):** the 5 extracted hooks are unit-verified
    (replay-seek-app/round-tempo/dilation-app/full-auto/propose-confirm/recap cover them) but a
    localhost pass is still owed — spotlight dim, "Your turn" pill, Enter/Escape, Full-Auto,
    seek/scrub/pause. (That session also fixes the 2 pre-existing FX bugs — see memory `replay-fx-open-issues`.)
- **App→Board 30-prop drill → `useReplayFrame()`** returning one compact frame object (B3/AR2).
- **Board.tsx layer split** (B4): `<BoardCells/Highlights/Ghosts/Units/Overlays>`.
- **ReplayFx → `src/ui/skin/fx/` tree** (FX1/FX2/FX3): projectiles/impacts/unit-verbs/callouts +
  `projStyleVars` + `<EffectGroup>`. *Keyed-remount stays at Board → safe.*
- **Replay.tsx dock split** (RR3/RR5): Scrubber/TimelineStrip/Controls + `StatGridCell`.
- **Store slicing** (ST1/ST2/ST3/AR3/AR4): shell vs game vs replay vs settings slices via
  `combine()`; move pure helpers (settleDependentOrders→core, countWitnessedBrawls→state/replay)
  out; `state/selectors.ts`; `state/replay-pipeline.ts` coordinator.

## Phase 5 — Performance & bundle (mobile-first)  ·  **PARTIALLY DONE** (modal split)
- ✅ **DONE — code-split the phase-gated modals** (P2): `BuildDashboard` (App) + `RulesModal` +
  `PipelineModal` (TopBar) via `React.lazy` + `Suspense`. **Main JS chunk 552.84 → 520.31 KB**
  (gzip 165.70 → 156.14, −9.6 KB); ~35 KB moved to on-demand chunks. 2 TopBar affordance tests
  now `waitFor` the lazy mount (assertions unchanged). 1293 green.
- ❌ **P1/P6/P8 "lazy-load skins" was a MIS-PREMISE** — the watercolor webp (~590 KB) and sprite
  PNGs (~160 KB) are ALREADY lazy: Vite emits them as separate on-demand asset files fetched only
  when their skin renders, so at default 'icon' mode they're never downloaded. They were never on
  the JS critical path. Splitting their *components* saves only ~10–15 KB JS — not done (low value).
- ⏸ **Code-split core Replay** (rest of P2) — DEFER: ReplayDock/ReplayFx play every round; lazy
  would stutter. Needs the prefetch-on-COMMIT guard; not worth the risk yet (main chunk only
  ~20 KB over the 500 KB warning now).
- ✅ **DONE (B5 spriteByUnit O(N²)→O(N), 2026-06-28):** precompute every unit's screen position once
  (a `screenPos` map) instead of re-projecting every enemy for every infantry unit in the at-rest
  facing scan. Behaviour-identical (insertion order preserves the nearest-enemy tie-break); sprite
  tests green.
- ✅ **MEASURED — no per-frame render hotspot (so the rest is premature):** B1 `toScreen` cascade is
  ALREADY mitigated (toScreen is `useMemo([cells])`, stable unless `board` changes — no per-render
  identity churn). visibleCells/fog/layer1 do NOT recompute per replay frame: the replay branch
  renders the builder's precomputed `frame.fog`/`frame.units`, and the planning memos' deps (`game`)
  don't mutate mid-playback. A Playwright long-task probe over 16 s of `?autopilot=greedy` self-play
  (many rounds of planning + resolver + per-frame replay render) recorded **exactly ONE long task
  (128 ms — the AI/resolver compute at a COMMIT, not render); ZERO render-jank tasks during replay.**
- ⏸ **DROP/DEFER (no measured problem):** P3 per-frame alloc pooling, P4 layer1 Dijkstra cache,
  P5/P7 visibleCells/fog memoization — already fast for this scale (~14 units); pooling/caching add
  complexity + regression risk for negligible gain. Revisit only if a real hotspot appears
  (bigger maps / many units).

## Phase 6 — CSS modularization  ·  **C1 + C3 DONE** (2026-06-28; value-preserving)
- ✅ **DONE (C1 tokenize):** the palette was duplicated as raw decimal triplets across 105 rgba()
  literals (ink ×79, faction-a ×20, paper ×4, faction-b ×2). Added `--ink-rgb`/`--faction-a-rgb`/
  `--faction-b-rgb`/`--paper-rgb` companions to the existing hex vars; rewrote each literal to
  `rgba(var(--*-rgb), <alpha>)`. Provably value-preserving; in-browser confirmed the vars resolve to
  the original literals. One source of truth for the palette.
- ✅ **DONE (C3 split):** styles.css 4764 → a barrel that `@import`s **12 feature modules** in cascade
  order (base/board/start-screen/dock/planning/replay-fx/replay-dock/replay-panels/modals/hud/
  conquest/animation). Pure line-range cut at the `/* --- SECTION --- */` headers; concatenating the
  modules back reproduces the original byte-for-byte (asserted before writing). base.css font url()
  → `../fonts/`. Validated: production build green (CSS still one 61 KB bundle), in-browser all module
  requests + woff2 resolve, no errors; the fx-language CSS-contract test follows the barrel now.
- ⏸ **DEFERRED/DROPPED (low value or non-pure):** C2 `.fx-svg-transform` (30 sites, but needs markup
  changes across the FX components — not a pure-CSS dedup); C4 `will-change`/`contain` (NOT value-
  preserving — can shift stacking/paint; really a P5-perf item, validate visually); C5 unify reduced-
  motion (MOOT post-split — each module now owns its reduced-motion beside its component); C6 spacing/
  timing tokens (judgment-heavy, varied values, low value vs the colour set).

## Phase 7 — Higher-risk type / replay / AI refactors  ·  risk: HIGH (skeptic + byte-identity gate)
**Each requires:** an independent skeptic review **and** byte-identical replay/AI/combat vectors
before merge. Some are DEFER/DROP.
- ReplayFxData → discriminated union (FX5/T2) — internal payload shape change; builder emits
  discriminator; replay script must stay byte-identical.
- `GameState → Skirmish|Conquest` union (T3); `Strike` mist-union (T1 — **DEFER**, removes
  `fromMist`).
- `buildReplay` → extract `handleAttackRun` (R1) — **MED**, line-947 visibility recompute is
  load-bearing; do not reorder.
- ✅ **DONE (AI9 test half, 2026-06-28):** byte-identity GOLDEN MASTER of the greedy planner's full
  output, `test/ai/planner-golden.test.ts` (+ `__fixtures__/*.json`). The pre-existing AI net was
  property-only (greedy wins ≥2/3 seeds) + a coarse same-seed-final-state determinism check — it did
  NOT pin the per-round ORDER stream, so a tie-break/target drift from an AI7 refactor could pass
  silently. The golden closes that: it records the COMPLETE order stream and fails on any drift.
  Vectors: 3 vs-do-nothing full games (seeds 16/31/38 — mirrors acceptance `playGame` byte-for-byte),
  a greedy-vs-greedy mirror (seed 16 — only moving-enemy vector; covers enemy-reactive + 17 defensive
  stances), a conquest game (seed 7 — `planConquest` buys + capture orders; closes the conquest-blind
  gap since planUnit/scorer is shared), + the synthetic focus-fire board (isolates the scorer with no
  resolver). Discipline: regen is `GEN_GOLDEN`-gated (NOT `vitest -u`) so a refactor drift can't be
  swept by an auto-update; a CI guard forbids regen in CI; `.gitattributes` pins LF; verified
  deterministic (byte-stable across regen) + teeth-checked (corrupt a value → red). Independent
  skeptic reviewed (PASS-WITH-FIXES → all fixes applied: faithfulness, CRLF, CI guard, +mirror,
  +conquest, rng-comment). **NOTE:** the AI9 "scorer API" extraction is folded into AI7 — do it there.
- AI `planUnit` decompose (AI7 — MED): now GATED by the AI9 golden — output must stay byte-identical.
  **DROP/DEFER:** R6 (vision cache), AI10 (ConquestMovementPlanner) — reorder risk outweighs gain.

---

# FINDINGS CATALOG (verified; by dimension)

Severity high/med/low · effort S/M/L · IDs referenced by the phases above.
**Cross-cutting dedupes:** DC2=B2=RR1 (non-component exports) · A1–A8≈AR1 (App) · B3≈AR2 (prop drill) ·
ST1≈AR4 (store) · AR5≈RR2 (loadUnits) · FX5≈T2 (ReplayFxData) · FX4≈D2 (center) · B1/B5≈D3 (Board maps).

**css (DIM1):** C1 ink→vars (dup,H,M); C2 .fx-svg-transform (dup,M,M); C3 split monolith (arch,M,L);
C4 will-change/contain (perf,M,S); C5 reduced-motion unify (a11y,L,M); C6 spacing/timing tokens (dup,M,M);
C7 co-locate board styles (clarity,L,S); C8 FX perf-budget doc (perf,L,S).

**replay-builder (DIM2):** R1 extract handleAttackRun (decomp,H,L, MED-determinism); R2 buildCombatBeats
(dup,M,S); R3 pushFrame helper (dup,M,M); R4 bucketAttackRun (clarity,M,M); R5 createCallout (dup,L,M);
R6 vision cache (perf,L,M, **DROP**); R7 doc 3-stage contract (arch,L,S).

**app (DIM3):** A1 20 effects→~5 hooks (arch,H,L); A2 Planning/ReplayBoard containers (decomp,H,M);
A3 usePlanningLayer (decomp,H,M); A4 store-facade hooks (decomp,M,M); A5 useBeatClock (arch,M,M);
A6 useAnnouncement (decomp,M,S); A7 useKeyboardShortcuts (clarity,M,S); A8 useReplayDriver (decomp,M,M).

**board (DIM4):** B1 break toScreen dep-cascade (perf,H,M); B2 non-component exports→util (arch,M,S, **P1**);
B3 group 39 props (decomp,M,M); B4 layer sub-components (decomp,M,L); B5 spriteByUnit O(N²) (perf,M,M);
B6 move geometry helpers+tests (clarity,L,S); B7 memoize render predicates (perf,L,S).

**replay-fx (DIM5):** FX1 fx/ tree split (decomp,M,M); FX2 projStyleVars (dup,L,S); FX3 EffectGroup (arch,M,M);
FX4 fx-geometry utils (dup,L,S); FX5 ReplayFxData union (types,M,M, **MED/P7**); FX6 doc keyed-remount
(clarity,L,S, **P1 guardrail**); FX7 rename ImpactSpark (clarity,L,S); FX8 FX perf baseline test (perf,L,M).

**store (DIM6):** ST1 slice AppState (decomp,H,L); ST2 pure helpers→core (arch,M,M); ST3 selectors.ts
(clarity,M,M); ST4 accumulatePostRoundDiscovery (arch,M,S); ST5 PendingMove invariant (types,L,S);
ST6 markDirectiveModified (clarity,L,S, **P1**).

**ai (DIM7) — structure-only, byte-identical, guard each:** AI1 collectCandidateThreat (dup,H,M);
AI2 getDefensiveArmorBonus (dup,M,S, **P3**); AI3 scoreCandidate (dup,M,M); AI4 isBetterAttack (dup,L,S, **P3**);
AI5 heap multiSourceCost (perf,L,L); AI6 estimateEnemyPath (clarity,L,M); AI7 planUnit decompose
(arch,M,L, **P7**); AI8 applyForcedCrossingRank (clarity,L,M); AI9 scorer API+tests (tests,M,M);
AI10 ConquestMovementPlanner (arch,L,L, **DEFER**).

**types (DIM8):** T1 Strike union (types,H,M, **DEFER runtime-shape**); T2 ReplayFrame/FxData phase-union
(types,M,L, **P7**); T3 GameState union (types,M,M, **P7**); T4 kill double-casts+guard (types,H,S, **P3**);
T5 doc non-null `!` (types,M,M); T6 narrow Board props (types,L,L); T7 assertNever exhaustiveness (types,L,S, **P3**).

**duplication (DIM9):** D1+D7 clamp→core/math (dup,M,S, **P3**); D2 center merge (dup,L,S); D3 Board map-builder
helper (decomp,M,M); D4 reuse board/vec.ts in ui (clarity,L,M, **P3**); D5 RULES_PALETTE (clarity,L,S);
D6 doc keyed-remount (clarity,L,S).

**performance (DIM10):** P1 lazy watercolor (perf,H,M, **P5**); P2 code-split Replay/BuildDashboard
(decomp,M,M, **P5 prefetch**); P3 per-frame allocs (perf,H,S, **P5**); P4 layer1 Dijkstra cache (perf,M,M);
P5 visibleCells memo (perf,M,M); P6/P8 split skin components (decomp,M,M); P7 fog inversion memo (perf,L,S).

**tests (DIM11):** TS1 bd ×10 (dup,H,S, **P2**); TS2 lineBoard ×6 (dup,M,M); TS3 unit ×6 (dup,M,M);
TS4 reseed-masking guard (tests,H,L, **P2 process**); TS5 jsdom/node split (arch,L,S); TS6 split replay-build
test (clarity,L,M); TS7 central test-kit (arch,M,M, **P2**); TS8 assertByteIdentical seam (arch,M,M, **P2**).

**deadcode (DIM12):** DC1 fmtRange ×3 (dup,H,S, **P1**); DC2 non-component exports (arch,M,M, **P1**);
DC3 un-export in-file-only (deadcode,L,S, **P1**); DC4 skin barrel clean (no-op); DC5 organize test consts (clarity,L,M).

**architecture (DIM13):** **purity + determinism confirmed holding.** AR1 App split (decomp,H,L);
AR2 useReplayFrame (arch,H,M); AR3 replay-pipeline.ts (clarity,M,S); AR4 store shell/game split (decomp,M,M);
AR5 centralize loadUnits (dup,L,S, **P3**); AR6 board README (clarity,L,S); AR7 dilation orthogonality doc
(clarity,L,S, **P1**); AR8 dilation-clock contract doc (clarity,L,S, **P1**).

**replay-render (DIM14):** RR1 outcomeText→util (clarity,L,S, **P1**); RR2 dedup loadUnits (dup,M,S);
RR3 split ReplayDock (decomp,M,M); RR4 VizSection (clarity,L,S); RR5 StatGridCell (dup,M,M);
RR6 VictoryDashboard props (arch,L,M); RR7 TimelineStrip (decomp,L,M); RR8 mobile touch-target audit (a11y,L,M).

---

# RISK REGISTER (do not promote to early phases)

| Item | Touches | Guard required |
|---|---|---|
| R1 handleAttackRun | replay determinism (visibility recompute order) | byte-identical replay vectors; no reorder; skeptic |
| R6 vision cache | replay fog-honesty | **DROP** — order load-bearing, gain small |
| FX5 / T2 ReplayFxData union | emitted payload shape | replay script byte-identical; skeptic |
| T1 Strike union | removes `fromMist` field | **DEFER** — replay vectors byte-identical |
| AI7 planUnit / AI1/AI3 | AI determinism (draw/tie order) | AI acceptance byte-identical all seeds; **no reseed** |
| AI10 ConquestMovementPlanner | AI determinism | **DEFER** — reorder risk |
| D1 clamp | weewar.ts (frozen combat) | resolver vectors byte-identical |
| P2 code-split replay | wall-clock-from-mount | prefetch FX before playback |
| TS1–3 test-kit | fixture identity | `assertByteIdentical` old vs new; no weakened assertions |

**Resumption process note:** any future continuation of the risky phases must use the same
memory-safe loop (sequential, one subagent), and gate each Phase-7 / AI / determinism item behind
**one** independent skeptic subagent (run serially) + a byte-identity diff — never a fan-out.
