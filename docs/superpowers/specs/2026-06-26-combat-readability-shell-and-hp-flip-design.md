# Combat readability — shell flight fix + HP flip-down pip

Date: 2026-06-26
Branch: `sprite-animation`
Status: design (approved approach, pre-plan)

Two combat-readability improvements observed during live play of the stage-3
replay FX (commit `bdafb59`). Both are about making a single combat exchange
*legible*: you should see the artillery shell fly, and you should see a unit's
HP visibly tick down when it is hit.

---

## §0 — Scope

In scope:
1. **Shell flight fix** — the artillery shell round must visibly travel its
   parabola during replay (bug).
2. **HP flip-down pip** — the defender token's count pip flips DOWN to its new
   value *after* the visual hit lands, reusing the split-flap feel (feature).

Out of scope (explicitly): the sniper "horizontal line" earlier note (the live
observation reframed the artillery issue as the spotlight/shell bug, not fog;
the tracer-guide persistence is NOT addressed here); the canvas split-flap
driver; touching the existing `-N` damage floater (it stays).

Purity: all builder changes live in `src/state/` (already DOM-free, pure). The
render changes live in `src/ui/`. No new `Math.random` / `Date.now`.

---

## §1 — Shell flight fix (bug)

### Root cause
`Shell` (`src/ui/skin/ReplayFx.tsx:417-430`) moves the shell round with an SVG
SMIL `<animateMotion begin="${delay}ms">`. SMIL `begin` is **document-timeline
relative**, not element-mount relative. The whole `board-replay-fx` group is
**remounted every frame** (Board keys `ReplayFx` by `replayFx.key`). When it
mounts mid-document (document time ≫ `delay`), SMIL treats the motion as having
already begun in the past and — with `fill="freeze"` — snaps the round straight
to its landing point. Meanwhile the round's **opacity** is a CSS animation
(`.fx-shell-round` → `fx-shell-fly`, mount-relative) which DOES play. Net: the
round blinks in/out at the impact cell, the dashed trail (CSS, mount-relative)
draws the arc, but the round never *flies* it. Reads as "dotted arc shown, no
animation." (NOT fog, NOT the spotlight dim — the dim is per-cell/per-unit and
never touches the FX layer.)

### Fix
Make the motion mount-relative. Keep the existing quadratic parabola path (`d`),
`keyPoints`/`keyTimes` envelope, and `rotate="auto"`. Change the SMIL element to
`begin="indefinite"` and start it explicitly on mount via a ref + effect calling
`beginElementAt(delaySeconds)` (or `beginElement()` after a `delay` timer) so the
motion's t=0 is the mount, exactly like the CSS opacity/trail tracks. This keeps
the SVG-native `animateMotion` (the comment block at `ReplayFx.tsx:402-416`
documents why CSS `offset-path` was rejected — that reasoning still holds; we are
only fixing the *clock*, not the mechanism).

- `Shell` gains a `useRef` to the `<animateMotion>` element and a `useEffect`
  that calls `el.beginElement()` once on mount (the SMIL `begin="indefinite"`
  means it waits for that call). The intra-beat `delay` is folded by starting a
  `setTimeout(delay)` before `beginElement()`, OR by keeping `begin="${delay}ms;
  indefinite"` and additionally restarting on mount — simplest is
  `begin="indefinite"` + `setTimeout(beginElement, delay)`.
- Reduced-motion: unchanged (CSS already degrades; the round simply appears at
  the target, which is acceptable).

### Acceptance
- During a replay artillery exchange, the shell round is seen leaving the
  attacker, arcing over the parabola, and landing at the impact cell ~0.88 of the
  beat — every time, including the 2nd+ artillery beat of a turn (the remount
  case that currently fails).
- The dashed trail and impact ring timing are visually unchanged.

---

## §2 — HP flip-down pip (feature)

### Goal
When a surviving defender is hit, its corner count pip (which already doubles as
the HP readout, `src/ui/skin/UnitRenderer.tsx:231-243`) **holds the old value**
until the impact spark lands, then **flips DOWN** through the intermediate values
(e.g. 8→7→6→5) with a split-flap downward-fold cascade. The existing floating
`-N` pill is kept (user choice: "flip pip, keep -N floater"). Damage is already
computed upstream; this is purely a presentation delay + animation.

### Approach (A — native SVG/CSS flip-card)
Reuse the split-flap *model* (one card per value, forward-stepping, downward
fold) but render it natively in the SVG token so it pans/zooms/clips with the
board for free. NOT the canvas `splitflap.ts` driver (rejected: per-token canvas
overlays are heavy and misalign on a moving token).

### Data — AS BUILT (pure timing in `replay-timing.ts`, computed in Board)
The token needs three things per hit defender this frame: the OLD count, the NEW
count, and WHEN to flip (frame-relative ms of the witnessed impact).

- `ImpactMark` (`ReplayFx.tsx:43`) gains ONE field: `damage: number`. `fxImpacts`
  (`src/App.tsx:1110`) populates it from `s.damage`. (We did NOT put `flipAtMs`
  on `ImpactMark` — timing is derived from the beats instead, see below.)
- Two PURE helpers in `src/state/replay-timing.ts` (unit-tested,
  `test/ui/hp-flip-timing.test.ts`):
  - `impactTimeByCell(beats)` → `Map<CellId, ms>`: the LAST witnessed impact
    time per target cell, `beat.start + p.delay + p.impact × beat.dur` (the SAME
    frame-relative basis the projectile CSS/SMIL delays ride, so the fold lands
    on the spark).
  - `buildHpFlips(impacts, beats, countOf)` → `Map<defenderId, HpFlip>`: sums
    damage per defender, arms a flip ONLY when a witnessed projectile lands on
    the defender's cell (FOG HONESTY — a mist hit has no projectile, so no flip
    and no timing leak), and sets `fromCount = countOf(id) + Σdamage`,
    `toCount = countOf(id)`, `flipAtMs`.
- Frame-relative (not turn-relative): the token re-arms via a keyed inner remount
  each frame (like recoil), so the CountFlap clock starts at frame mount — the
  same mount the projectiles use. No `frameStartTime` offset is needed.

### Render — AS BUILT (`Board.tsx` + `UnitRenderer` + `CountFlap`)
- Board computes `flipByUnit = buildHpFlips(replayFx.fx.impacts, replayFx.fx.beats,
  id => unitById.get(id)?.count)` in a `useMemo` (mirrors `recoilByUnit`) and
  threads `flip={flipByUnit.get(unit.id) ?? null}` + `flipKey={replayFx.key}` into
  `UnitRenderer`.
- `UnitRenderer`'s count pip renders `CountFlap` (new, `src/ui/skin/CountFlap.tsx`)
  when a flip is armed, keyed by `flip${flipKey}` so each frame re-arms it; else
  the static numeral exactly as today.
- `CountFlap`:
  - Holds `fromCount`, then after `flipAtMs` steps down one value per `STEP_MS`
    (90 ms) to `toCount`, driven by frame-relative timers (`setTimeout`). Each
    stepped value is a `<text key={idx}>` so it remounts and replays the CSS
    `.count-flap-card` downward fold (`scaleY` with a small overshoot); the held
    value carries no class and does not animate.
  - Color follows the existing count-as-health grading on the CURRENT value.
- Reduced-motion: `prefersReducedMotion()` (matchMedia, guarded) → snap straight
  to `toCount`, no hold, no class. `.count-flap-card` is also in the
  `prefers-reduced-motion` CSS block as a belt-and-suspenders.

### Sequencing / determinism
- Determinism lives in the PURE builder: `buildHpFlips` derives
  (`fromCount`, `toCount`, `flipAtMs`) deterministically from the script + cursor
  with NO wall-clock (no `Date.now`/`performance.now`/`Math.random`) — same input
  ⇒ same output (unit-tested). The token re-arms via a per-frame keyed remount
  (`flipKey = replayFx.key`), so landing on a frame always replays the identical
  flip → scrub-identical.
- The PLAYBACK schedules off element mount (the CountFlap timers / the Shell
  `beginElement`), exactly like every other FX in this layer — the CSS
  `--proj-delay` projectile tracks, the recoil (`fx-recoil`, re-armed by
  `recoilKey`), the dashed shell trail. This codebase has NO `animation-play-state`
  and does not thread `paused` into the FX layer: replay-pause halts FRAME
  ADVANCE, never in-frame FX. The flip is therefore consistent with the shipped
  FX model — it is NOT a separate replay-time clock, and intentionally so (a
  per-effect replay-time rewrite would desync it from every other effect).
- A defender hit by multiple strikes in one frame flips ONCE, through the full
  summed delta, after its last witnessed impact (same-cell brawlers each settle
  together after the exchange — see `buildHpFlips`).

### Acceptance
- Hitting a unit for N shows: impact spark/flash → THEN the count pip folds down
  through N values to the new total, while the `-N` pill still floats up.
- Before the impact lands, the pip still reads the OLD (pre-hit) count.
- A killed defender does NOT flip to a number (it gets the existing death verb /
  doomed glyph, never "0") — flip applies to SURVIVORS only (impacts already
  excludes `frame.kills`).
- Scrubbing back and forth reproduces the same animation deterministically.

---

## §3 — Files touched (AS BUILT)
- `src/state/replay-timing.ts` — `impactTimeByCell`, `buildHpFlips`, `HpFlip`
  (pure, the flip data + timing).
- `src/ui/skin/ReplayFx.tsx` — `Shell` SMIL begin fix; `ImpactMark` gains
  `damage` (NOT `flipAtMs` — timing is derived from beats).
- `src/App.tsx` — `fxImpacts` carries `damage`.
- `src/ui/Board.tsx` — `flipByUnit` (calls `buildHpFlips`), threads `flip`/
  `flipKey` into `UnitRenderer` (mirrors `recoilByUnit`).
- `src/ui/skin/UnitRenderer.tsx` — render `CountFlap` for the count pip when a
  flip is armed; static numeral otherwise.
- `src/ui/skin/CountFlap.tsx` (new) — the native SVG/CSS split-flap count card.
- `src/ui/styles.css` — new `.count-flap-card` keyframes (downward fold) + its
  reduced-motion entry. (`fx-shell-round` unchanged.)
- `src/state/replay.ts` — NOT touched (the strike `damage` was already there).
- Tests: `hp-flip-timing` (pure), `count-flap` (step/snap/reduced-motion),
  `hp-flip-wiring` (UnitRenderer), `hp-flip-board` (Board integration),
  `r4-projectile-fx` (+ shell `begin="indefinite"` regression).

## §4 — Risks / open questions (resolved)
- SMIL `beginElement()` browser support: fine on evergreen + mobile Safari.
- Two-digit counts (10): CountFlap uses the SAME font sizing as the static pip,
  which already renders "10" today — no NEW overflow introduced. Left as-is so
  the flip stays visually identical to the static pip (revisit both together if
  legibility ever needs work).
- Clock origin: resolved — `flipAtMs` is frame-relative (`beat.start + p.delay +
  p.impact × beat.dur`), the SAME basis the projectile delays ride, so the fold
  lands ON the spark.

## §5 — Adversarial review outcomes
A multi-agent review (4 dimensions, each finding independently verified) ran on
the diff. Disposition:
- **Fixed:** defensive last-impact-cell tracking in `buildHpFlips` (+test);
  dropped an unexplained `eslint-disable` and tightened CountFlap's effect deps;
  clarified the Shell pre-begin opacity-gate comment.
- **Refuted (consistency with the existing FX architecture):** "wall-clock timers
  violate determinism / pause / scrub" — the ENTIRE shipped FX layer (recoil,
  projectiles, trail) is wall-clock-from-mount with no `animation-play-state` and
  no `paused` thread; determinism is met by the pure builder; the flip is
  intentionally consistent with that model, not a separate replay-time clock.
- **Refuted (not a regression):** two-digit pip overflow is identical to the
  pre-existing static pip.
- **Accepted, low impact (documented):** same-cell brawl flips both defenders
  after the decisive impact (~75 ms), which reads as synchronized HP ticks.
