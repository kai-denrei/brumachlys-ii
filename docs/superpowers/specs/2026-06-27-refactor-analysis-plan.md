# Refactor Analysis — verified, prioritized phased plan

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

## Phase 3 — Safe DRY & pure utilities  ·  risk: low (each gated by its suite)
- `clamp`/`clamp01` → `src/core/math.ts` (D1+D7, 6 sites). **Guard:** `weewar.ts` is combat/
  (frozen) — keep numeric output byte-identical; run resolver vectors.
- `center()` merge → `ui/skin/geometry.ts` (D2/FX4); reuse pure `board/vec.ts` from `ui` for
  inlined `Math.hypot/cos/sin` (D4, 49+ sites — *not* a parallel util).
- `loadUnits` → store `useUnitTypes()` selector (AR5/RR2; App/Replay/RulesModal/VictoryDashboard/
  BannerRecap stop re-importing+re-memoizing).
- Type safety: kill `as unknown as` double-casts in io/data-loader (hand validator, **not** a new
  Zod dep) + guard RulesModal cast (T4); add `assertNever` exhaustiveness on `ResolutionEvent`
  (T7 — type-only, catches future missing handlers).
- AI safe mechanical extractions (AI2 `getDefensiveArmorBonus`, AI4 `isBetterAttack`). **Guard:**
  AI acceptance byte-identical on all seeds; no reordering.

## Phase 4 — Component decomposition  ·  risk: medium (UI structure; logic unchanged)
Regression suite is the guard; move code, not logic.
- **App.tsx 1686 → assembler** (A1–A8/AR1): extract `useReplayDriver`, `useBeatClock`,
  `useAnnouncement`, `useKeyboardShortcuts`, `usePlanningLayer`, store-facade hooks; split
  `<PlanningBoard>`/`<ReplayBoard>` containers. **Preserve wall-clock-from-mount** (enteredAt
  resets only on mount/script change; seek = cursor move only).
- **App→Board 30-prop drill → `useReplayFrame()`** returning one compact frame object (B3/AR2).
- **Board.tsx layer split** (B4): `<BoardCells/Highlights/Ghosts/Units/Overlays>`.
- **ReplayFx → `src/ui/skin/fx/` tree** (FX1/FX2/FX3): projectiles/impacts/unit-verbs/callouts +
  `projStyleVars` + `<EffectGroup>`. *Keyed-remount stays at Board → safe.*
- **Replay.tsx dock split** (RR3/RR5): Scrubber/TimelineStrip/Controls + `StatGridCell`.
- **Store slicing** (ST1/ST2/ST3/AR3/AR4): shell vs game vs replay vs settings slices via
  `combine()`; move pure helpers (settleDependentOrders→core, countWitnessedBrawls→state/replay)
  out; `state/selectors.ts`; `state/replay-pipeline.ts` coordinator.

## Phase 5 — Performance & bundle (mobile-first)  ·  risk: medium (quantify KB/ms; verify on phone)
- **Lazy-load skins** (P1/P6/P8): watercolor webp + sprite PNGs (~130 KB off critical path at
  default 'icon' mode) via `React.lazy` guarded by `renderMode`; glyph fallback while loading.
- **Code-split Replay + BuildDashboard** (P2, ~55–75 KB). **Guard:** prefetch the replay chunk on
  COMMIT so FX is loaded before playback — never change replay timing/determinism.
- **Kill per-frame allocs** (P3): App.tsx:381/253/1114 `new Map/Set` every frame → ref-diff/memoize.
- Memoize layer1 Dijkstra (P4), visibleCells (P5), fog inversion (P7); fix Board `toScreen`
  dep-cascade (B1) + spriteByUnit O(N²) (B5).

## Phase 6 — CSS modularization  ·  risk: low→medium (last; needs bundler CSS support for the split)
- Tokenize ink-color rgba (C1, 42+ sites) + spacing/timing scale (C6); `.fx-svg-transform` class
  (C2); `will-change`/`contain` on FX (C4); unify reduced-motion (C5). Then split styles.css 4778
  → feature modules (C3 — verify breakpoints 430/700px, z-index 6–40).

## Phase 7 — Higher-risk type / replay / AI refactors  ·  risk: HIGH (skeptic + byte-identity gate)
**Each requires:** an independent skeptic review **and** byte-identical replay/AI/combat vectors
before merge. Some are DEFER/DROP.
- ReplayFxData → discriminated union (FX5/T2) — internal payload shape change; builder emits
  discriminator; replay script must stay byte-identical.
- `GameState → Skirmish|Conquest` union (T3); `Strike` mist-union (T1 — **DEFER**, removes
  `fromMist`).
- `buildReplay` → extract `handleAttackRun` (R1) — **MED**, line-947 visibility recompute is
  load-bearing; do not reorder.
- AI `planUnit` decompose (AI7 — MED); AI scorer API + unit tests (AI9). **DROP/DEFER:** R6 (vision
  cache), AI10 (ConquestMovementPlanner) — reorder risk outweighs gain.

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
