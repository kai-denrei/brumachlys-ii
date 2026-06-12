# Brumachlys II

> *brume* (fr. mist) + *achlys* (gr. Ἀχλύς, the death-mist of the Iliad)

A simultaneous-resolution tactical wargame on a procedurally generated organic board.
Both sides commit orders blind; a deterministic resolver plays them out in initiative
order. Fog of war makes second-guessing the opponent the core skill.

The board is not a grid: it's an irregular cell graph (Oskar Stålberg-style relaxed
quad-mesh dual), generated from classic **Weewar maps used as shape/terrain donors**
(bundled: vietFort, Puddles, Valley Road, 1v1 Showdown JMK, spooner hell — credit to
their original Weewar authors).

**Spec:** [`docs/superpowers/specs/2026-06-12-brumachlys-ii-design.md`](docs/superpowers/specs/2026-06-12-brumachlys-ii-design.md)
**Lineage:** [`BRUMACHLYS.md`](BRUMACHLYS.md) (v1 PoC spec, 2026-05) · [oskar-procedure](https://github.com/kai-denrei/oskar-procedure) (mesh kernel)

## How to play

Each round has three beats: **plan → commit → replay.**

- **Plan.** Tap one of your units: tinted cells are where it can move (stronger tint =
  more budget left), pulsing rings are what it can shoot, the faint contour is its
  vision. Tap a cell to queue a move, tap an enemy to attack it (or charge it if out of
  range). Queued orders show as ghosts — tap a ghost to edit or remove. Long-press any
  cell for terrain/unit info.
- **Stances.** The popover above a selected unit: **aggressive** (fires at will,
  counter-attacks), **defensive** (holds position, counter only), **hold fire** (stays
  silent — and stays hidden).
- **Commit.** Both armies' orders resolve simultaneously in initiative order. Units
  that end up on the same cell **brawl** until one side breaks.
- **Gang-up angles.** Attacks on a defender accumulate within the round: a second
  attack from the opposite side gets +3, flanking angles +2, adjacent ones +1, and
  ranged support +1 regardless of bearing — surround a unit and the math turns vicious.
  Tap any damage number or timeline slot to see the full term-by-term breakdown.
- **The mist.** You only see what your units see. Hidden enemies don't exist on your
  map; damage arriving from an unseen attacker shows the impact but never the source
  ("fire from the mist"), and the replay timeline won't even leak that something moved
  out there. The enemy AI plays under the same fog.

Win by destroying every enemy unit within 40 rounds.

## Controls

- **Tap** unit: select · cell: move · enemy: attack/charge · ghost: edit order
- **Long-press** any cell: terrain + unit info sheet
- **Drag / pinch / wheel** — pan & zoom (1:1 with your finger at any zoom)
- **Replay:** ⏸/▶, 1×/2×/≫ (skip), tap slots or damage pills for combat math. The
  camera follows the action; pan to look around (it backs off), tap **⌖** to hand it back
- **`?autopilot=greedy`** URL flag: the AI plays your side too — full-game demo to the banner

## Run

```bash
npm install
npm run dev        # localhost:5173
npm test           # purity check + vitest (353 tests)
npm run build      # type-check + production build
node scripts/bust.mjs   # bump the build-identity token (CI does this per deploy)
```

## Build identity

The top-left badge (three shape tiles + short token) and the favicon are derived from
the cache-bust token in `<meta name="cb">` — one glance tells you which build you're on.
The token re-bumps on every deploy.

## Status

**v1 (0.2.0)** — feature-complete per the spec's definition of done: full solo game
vs the greedy AI, fog-honest animated replay, five donor battlefields, mobile-first.
Parking lot (economy, naval/air rosters, hot-seat, PWA, …) lives in spec §16.
