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

### Data (builder, pure — `src/state/replay.ts` + `ReplayFx`/Board types)
The token needs three things per hit defender this frame: the OLD count, the NEW
count, and WHEN to flip (the impact time within the turn).

- Extend `ImpactMark` (`ReplayFx.tsx:43`) with `damage: number` and the beat
  timing needed to place the flip: `flipAtMs` — the absolute ms (within the
  replay turn clock the token animations already use) at which the impact lands
  for this strike's beat. Derive from the owning beat: `beat.start +
  beat.dur * impactFraction` where `impactFraction` is the band's impact frac
  (`projectileKind(band).impact`, e.g. `WAVE_A_TRACER_IMPACT` / shell ~0.88 /
  stab ~0.5). Mist strikes still surface an impact (flash) and may flip too.
- `fxImpacts` builder (`src/App.tsx:1110-1123`) maps `s.damage` and the computed
  `flipAtMs` onto each surviving-defender impact. NEW count = the frame's
  post-combat `unit.count`; OLD count = `newCount + s.damage`.

### Render (`src/ui/Board.tsx` board-units + `UnitRenderer`)
- Board already iterates `unitById` for tokens. For a unit whose id is in this
  frame's impacts, pass the flip descriptor (`fromCount`, `toCount`, `flipAtMs`,
  and a per-frame `key`/`recoilKey` so it re-arms each frame like `recoil`) into
  `UnitRenderer`.
- `UnitRenderer`'s count pip renders a small flip-card component (new, in
  `src/ui/skin/`, e.g. `CountFlap.tsx`) when a flip descriptor is present;
  otherwise it renders the static numeral exactly as today. The flip-card:
  - Holds `fromCount` until `flipAtMs` (a CSS `animation-delay` keyed off the
    same per-turn clock origin the other token FX use, so it stays in sync with
    the impact spark — NO JS timer if a pure-CSS delay suffices).
  - Steps down `fromCount → toCount` one value per card with the split-flap
    downward-fold (a CSS 3D `rotateX` fold per step, staggered). Cap the step
    count visually for large deltas (cascade fast).
  - Lands on `toCount` and holds static (`forwards`).
  - Color follows the existing count-as-health grading
    (`UnitRenderer.tsx:241`): the landed value re-grades black/amber/red.
- Reduced-motion: snap directly to `toCount` (no fold), matching `RoundFlap` /
  `splitflap` `animate:false` convention.

### Sequencing / determinism
- The flip is placed on the same deterministic beat clock as the projectile and
  spotlight (no wall-clock). Same script + cursor ⇒ identical flip → scrub and
  replay are pixel-identical.
- A defender hit by multiple strikes in one turn (e.g. attack + counter on the
  same unit across beats) flips once per landing, stepping further down each
  time, in beat order.

### Acceptance
- Hitting a unit for N shows: impact spark/flash → THEN the count pip folds down
  through N values to the new total, while the `-N` pill still floats up.
- Before the impact lands, the pip still reads the OLD (pre-hit) count.
- A killed defender does NOT flip to a number (it gets the existing death verb /
  doomed glyph, never "0") — flip applies to SURVIVORS only (impacts already
  excludes `frame.kills`).
- Scrubbing back and forth reproduces the same animation deterministically.

---

## §3 — Files touched (anticipated)
- `src/ui/skin/ReplayFx.tsx` — `Shell` SMIL begin fix; `ImpactMark` type +
  `damage`/`flipAtMs`.
- `src/state/replay.ts` — surface `damage` + impact timing for surviving
  defenders (the beat clock already exists here / replay-timing).
- `src/App.tsx` — `fxImpacts` carries `damage` + `flipAtMs`; thread flip
  descriptors to Board.
- `src/ui/Board.tsx` — pass flip descriptor into `UnitRenderer` for hit units.
- `src/ui/skin/UnitRenderer.tsx` — render `CountFlap` for the count pip when a
  flip is armed; static otherwise.
- `src/ui/skin/CountFlap.tsx` (new) — the native SVG/CSS split-flap count card.
- `src/ui/styles.css` — `fx-shell-round` unchanged (opacity only); new
  `.count-flap*` keyframes for the downward fold.
- Tests: pure builder tests for the new `damage`/`flipAtMs` derivation; a
  `CountFlap` step/snap (reduced-motion) test.

## §4 — Risks / open questions
- SMIL `beginElement()` browser support: fine on all evergreen targets; mobile
  Safari supported. Verify on the actual deploy target during impl.
- Two-digit counts: the flip-card must handle 1- and 2-digit values (10+). The
  count pip is small — the fold must stay legible at fit-zoom; may render the
  whole number as one folding card rather than per-digit drums (simpler, still
  reads as a flap). Decide in plan.
- `flipAtMs` clock origin must match whatever origin the spotlight/projectile
  delays already use so the fold lands ON the spark, not before/after.
