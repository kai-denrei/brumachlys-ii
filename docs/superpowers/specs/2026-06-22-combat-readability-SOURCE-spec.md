# Brumachlys — Combat Resolution: Visual Readability Pass

**Type:** Claude CLI build spec · **Layer:** presentation only · **Rules:** frozen

## 1. Goal

Make the simultaneous combat-resolution phase **legible and dramatic** through animation,
timing, and visual cues. The player must be able to read *what hit whom, in what order of
range-band, and who died* without re-reading the log.

This is a **visual layer only**. No rules, resolver, or state logic changes.

## 2. Scope — do NOT touch

- **Resolve order is frozen.** Two waves, in this order:
  - **WAVE A** — artillery + ranged (indirect / long range)
  - **WAVE B** — close combat (adjacent tile / same tile)
- **Damage is computed from start-of-turn state** (simultaneous). A unit killed in WAVE A
  still deals its committed WAVE B damage. This **"posthumous" behaviour stays ON** — it is a
  rule, not a setting to expose.
- **Do not modify the resolver.** Consume the event list the resolver already emits (the same
  data that drives `skirmish.log`). If the current emit lacks a field listed in §7, add the
  field to the emit *without* changing how values are computed.
- **Match existing Brumachlys visual language:** paper ground, pastel terrain, red (P1) /
  blue (P2) factions, JetBrains Mono for system/log text. Vanilla ES modules, **no build step**.
- **The circular badges on unit tokens are RADAR indicators** (tile-distance calculation on
  press), **not clocks.** Do **not** introduce any clock or timer iconography anywhere. Convey
  time-dilation only through motion speed, vignette, and desaturation.

## 3. Core principle — playback is a pure function of `(resolvedTurn, t)`

Resolution is already instant and deterministic. Build playback as a **separate layer** that,
given the resolved turn and an elapsed time `t`, renders exactly the frame for that `t`.
Playback never mutates game state.

Consequences (all of these are acceptance requirements):
- `seek(t)` produces a correct, stable frame for any `t ∈ [0, total]`.
- Scrub / pause / replay / **instant-resolve (skip to end)** come for free.
- No ambiguous mid-animation state; the board has already logically resolved.

## 4. Phase timeline

Durations, not speeds (higher = longer / slower). Defaults below; expose all as config.

| Phase        | Default | Purpose                                                              |
|--------------|---------|---------------------------------------------------------------------|
| `SPOTLIGHT`  | 350 ms  | desaturate + dim non-combatants; lift combat tiles/units            |
| `HOLD`       | 200 ms  | beat of stillness before anything fires                             |
| `WAVE_A`     | **2800 ms** | artillery + ranged, time-dilated                               |
| `INTERLUDE`  | 250 ms  | dilation releases; board snaps back toward normal saturation       |
| `WAVE_B`     | **1400 ms** | close combat                                                   |
| `SETTLE`     | 900 ms  | deferred dissolves, tile control changes, resaturate, ledger tick  |

The **2:1 ratio (A ≈ 2×B) is the load-bearing tempo contrast**: WAVE A is the slow, dilated
held breath (you watch shells arc and tracers crawl); WAVE B is the quicker, harder exhale.
Keep that ratio if these defaults change.

## 5. Per-phase behaviour

### SPOTLIGHT (mode transition)
The desaturation **is** the `planning → anim` transition — one gesture, not two. On commit:
non-combatant tiles and idle units desaturate (~toward grey) and drop to ~0.32 alpha; tiles
and units involved in this turn's combat stay full-colour and gain a soft highlight ring.
One spotlight pass for the whole turn (do **not** re-spotlight per wave — progressive focus
within a wave, see below).

### WAVE A — dilated (artillery + ranged)
- All **artillery shells** launch near the start of WAVE A, travel high parabolic arcs with a
  dashed trail, and **land late (~0.85–0.92 of WAVE_A)**. The long hang-time is what *fills*
  the dilation — that is the point of slowing time.
- All **ranged tracers** (snipers etc.): brief charge glint (~0.10), then the round **crawls**
  along its line (bullet-time) from ~0.15 to impact ~0.78–0.85, with a fading speed-streak tail.
- Shells and tracers **co-justify the dilation**: time is slow *so you can watch both travel*,
  and they converge on the climax of the wave.
- **Dilation cue (no clock):** during WAVE A, cool the board (~20–25% global desaturation),
  close a subtle vignette, and freeze all non-projectile motion. Slow motion + stillness +
  crawling rounds = bullet-time, read without any timer glyph. Release over INTERLUDE.
- **Bullet-time is one shared envelope over the whole wave**, never per-unit. If five snipers
  fire, all five tracers are in flight on the same dilated clock — do not sequence them.

### WAVE B — quick (close combat)
- Short stab/flash motions between adjacent units; punchier impacts; light screen-shake scaled
  to total damage landing on the tile.
- **Counters offset by ~60–90 ms** from the strike they answer, so an exchange reads as *two*
  motions (crossfire), not one.
- Normal saturation, no dilation. The tempo shift from WAVE A is itself a cue that range-band
  has changed.

### SETTLE
- Deferred dissolves play here (see §6), including units killed in WAVE A.
- Tiles that changed control flash/highlight.
- Resaturate the board (reverse SPOTLIGHT).
- Income / upkeep ledger ticks **last**, after the board has settled, so consequences land
  before the player re-plans.

## 6. Posthumous + coincident-impact model  *(the important part)*

The rule (start-of-turn damage, posthumous attacks ON) is unchanged. The job is to **present**
it so it never looks like a corpse fighting or a 0-HP unit dealing damage.

### 6a. Coincident impacts — collapse staggered hits onto one frame
For each `(target, wave)`: if the target receives **≥2 incoming hits in the same wave**, snap
all of their impact frames to a **single convergence frame** = the latest of them, and retime
the faster projectiles' travel so they all *land together*. Apply combined damage in one beat,
one combined impact burst, one shake (scaled to total). The target never stands visibly at an
intermediate HP between two staggered hits.

### 6b. Deferred dissolve — death is computed early, the *fall* is deferred
Decouple the death computation from the dissolve animation:

- `deathHitFrame` = the (converged) frame of the lethal blow → HP reaches 0 here. At this frame
  the unit enters a **DOOMED state**, it does **not** dissolve.
- `dissolveStart` = `max(deathHitFrame, lastOutgoingActionFrame, SETTLE.start)` — i.e. the unit
  only falls *after* it has finished every action it is committed to this turn, and never
  mid-action.

A unit killed by ranged fire in WAVE A therefore: takes the lethal hit (big number, recoil,
enters DOOMED state) → still delivers its committed WAVE B close attack while DOOMED → then
collapses in SETTLE. It reads as *"got its shot off, then the killing blow finished it,"* which
is the honest depiction of dead-man's-trigger.

**DOOMED-state rendering** (between `deathHitFrame` and `dissolveStart`): desaturate the unit
toward grey, add a small smoke wisp / flicker / hairline-crack treatment, and replace the HP
badge readout with a **death glyph (✕ or skull), not "0"** — a "0" unit still attacking is the
exact thing that feels wrong. The glyph says "destroyed, completing final action."

### 6c. "Killing blow in the air" — mutual kills (intra-wave crossfire)
When A→B and B→A fire in the same wave: launch both projectiles on the same frame, **offset
the two arcs so they visibly cross**, land both on the shared convergence frame, both register
lethal, both deferred-dissolve **together** in SETTLE. Lean into this — crossfire and the
mutual kill are signature moments simultaneity gives you that I-go-you-go cannot. Celebrate
them, don't smooth them out.

### Timeline-build pseudocode
```
buildTimeline(turn, cfg):
  phases = layoutPhases(cfg)                  # §4
  for e in turn.events:
    e.window = motionWindow(e.type, phases[e.wave])   # {launch, impact}

  # 6a coincident impacts
  for (target, wave), hits in groupBy(turn.events, key=(target, wave)):
    if hits.length >= 2:
      conv = max(h.window.impact for h in hits)
      for h in hits: h.window.impact = conv          # retime travel to land at conv

  # 6b / 6c deaths
  for u in turn.units where u.diesThisTurn:
    u.deathHitFrame  = lethalImpactFrame(u)          # converged frame in practice
    lastAct          = max(e.window.impact for e in outgoing(u, turn)) ?? u.deathHitFrame
    u.dissolveStart  = max(u.deathHitFrame, lastAct, phases.SETTLE.start)

  return { phases, events: turn.events, units: turn.units }
```

## 7. Event / unit schema expected by playback

If the resolver doesn't already emit these, add them to the emit (values unchanged):

```
ResolvedEvent {
  id; attacker: unitId; target: unitId;
  type: 'artillery' | 'ranged' | 'melee';   # → wave + motion style
  wave: 'A' | 'B';
  amount: number;                            # damage dealt
  isCounter: boolean;
}
Unit (start-of-turn snapshot) {
  id; side: 'red'|'blue'; kind;
  pos: {x,y};                                # start-of-turn tile centre
  hpStart; hpEnd;
  diesThisTurn: boolean;
}
```

## 8. Animation primitives (reusable, time-parameterised by progress `p ∈ [0,1]`)

- **Ballistic arc** — quadratic bézier, control point lobbed above the midpoint; dashed trail;
  dust + ring burst on impact; biggest shake of the set.
- **Ranged tracer** — straight line, faint full-line guide + crawling round with a gradient
  speed-streak tail; sharp impact spark.
- **Melee stab** — short dash from attacker toward target (~0.5 reach) + flash; fast.
- **Impact burst** — expanding ring (+ debris for artillery), 0→~300 ms, alpha out.
- **Recoil** — target nudges away from source ~4 px over impact±150 ms, returns.
- **Damage number** — arc-rise + fade ~850 ms, size ∝ magnitude; **category-coloured**:
  damage-taken (ink), counter (grey), **kill (gold)**. Combined coincident hits → one number.
- **Dissolve** — DOOMED desaturate/smoke → collapse + fade over ~420 ms in SETTLE.
- **Overlay** — spotlight desaturation, dilation vignette, resaturation.

## 9. Suggested module layout (keep the pure-fn separation)

```
/resolution/
  player.js        # orchestrator: play(), pause(), seek(t), skip(); owns rAF + transport
  timeline.js      # pure: buildTimeline(resolvedTurn, cfg) -> {phases, events, units}
  config.js        # durations (§10), easings, palette refs
  draw/
    projectiles.js # arc, tracer, stab
    impacts.js     # bursts, recoil, damage numbers
    units.js       # alive / DOOMED / dissolve states + radar badge untouched
    overlay.js     # spotlight, dilation vignette, resaturate
  audio.js         # optional, §11
```
`player.render(t)` must be a pure read of timeline + `t`. Transport (play/seek/skip) only
varies which `t` is passed.

## 10. Config defaults

```
SPOTLIGHT=350  HOLD=200  WAVE_A=2800  INTERLUDE=250  WAVE_B=1400  SETTLE=900
WAVE_A_TRACER_IMPACT=0.80   WAVE_A_SHELL_IMPACT=0.88
WAVE_B_COUNTER_OFFSET=75ms
DILATION_DESAT=0.22         POSTHUMOUS=on (rule, not user-facing)
```
Expose `WAVE_A`, `WAVE_B`, and a global `speedMultiplier` for fast-forward.

## 11. Stretch — audio (cheap, high legibility)

WebAudio synth, zero assets, created on first user gesture (the resolve trigger). The ear
sequences time better than the eye parses space, so even simple cues turn the splat into a
readable rhythm: distinct tones for sniper-fire, artillery launch, impact, and a separate
**kill** tone. Per-hit ticks during WAVE A reinforce the dilation *without* a visual timer.
Gate behind a toggle; off by default.

## 12. Acceptance criteria

1. **Resolve order visible:** no close-combat impact ever plays before *all* artillery/ranged
   impacts have landed.
2. **Posthumous reads correctly:** a unit killed by ranged in WAVE A still visibly delivers its
   committed WAVE B attack, then dissolves in SETTLE. It never renders as an actively-fighting
   unit at HP 0 — it shows the DOOMED state with a death glyph instead.
3. **Coincident impacts:** any target hit ≥2× in a wave takes all those hits on one frame.
4. **Mutual kill:** opposing projectiles in the same wave visibly cross, land together, both
   units fall together in SETTLE.
5. **Pure playback:** scrubbing to any `t` shows a correct, stable frame; skip jumps to final
   state instantly; nothing in playback mutates game state.
6. **No clock/timer iconography** anywhere; radar badges untouched. Dilation conveyed by
   motion + vignette + desaturation only.
7. Defaults: `WAVE_A = 2800 ms`, `WAVE_B = 1400 ms`; tempo contrast (A ≈ 2×B) preserved.
8. Damage numbers category-coloured; kills gold.
9. Existing Brumachlys look preserved (paper/pastel, red/blue, JetBrains Mono); no build step.
