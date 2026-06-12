# Brumachlys II — Conquest Addendum (v2 scope)

> Extends `2026-06-12-brumachlys-ii-design.md`. Operator-approved 2026-06-12 after v1
> playtesting validated the core combat loop. Two changes: **discovery fog** (all modes)
> and **Conquest mode** (economy + bases). All hard rules of the base spec stay in force.

---

## A. Discovery fog (E1 — all game modes)

Terrain is no longer public knowledge. Three tiers, per faction:

| tier | meaning | rendering (player) |
|---|---|---|
| `dark` | never seen | near-black (`#2A2622` fill at ~0.92 over the cell; no terrain detail, no texture) |
| `memory` | seen before, not currently watched | terrain visible but greyed: desaturate ~0.55, white wash 0.35; NO units shown |
| `live` | inside current vision union | normal (existing rendering) |

Rules:
- `GameState.discovered: Record<FactionId, Set<CellId>>` — accumulates, never shrinks.
  Updated whenever vision is computed (round start, each replay frame for the player).
- Initial discovery: own starting cells' vision union (and own bases' vision 2).
- **Replay**: discovery accrues frame-by-frame as own units move (the fog feed already
  recomputes vision per event — extend it to emit tier changes so cells visibly ignite
  from dark → live during playback).
- **Planning into the dark**: move orders may target dark/memory cells. Reachability and
  cost preview assume optimistic plains cost (3) for `dark` cells; `memory` cells use
  their remembered true terrain. The resolver re-paths against truth and truncates
  (existing `path-truncated` machinery, reason `'invalid-step'` for impassable surprise).
  The reachable overlay therefore never leaks unscouted terrain.
- Attack orders still require live-visible targets (unchanged).
- **Start-screen previews become silhouettes** (cell mesh in paper tones, no terrain
  tint) — full-terrain previews would defeat discovery.
- **AI asymmetry (recorded decision)**: the AI keeps full-map terrain knowledge ("the
  local force knows the land"). Unit fog stays fully symmetric. Revisit post-Conquest.
- The skirmish log and casualty panel inherit honesty automatically (fog-feed sourced).

## B. Conquest mode (E2–E4)

Mode select on the start screen: **Skirmish** (current game: mirror armies, no economy,
annihilation, 40-round draw — the tuned-AI mode, unchanged) and **Conquest** (default).

### B.1 Bases & ownership
- Donor base tiles become functional: `GameState.bases: Record<CellId, FactionId | null>`
  seeded from donor `startFaction` (factions ≥2 → neutral). Neutral = "empty base spots".
- Base cells render with owner tint (live/memory tiers only; dark hides them).
- Vision: owned bases contribute vision 2 to their faction's union.

### B.2 Capture
- Personnel units only (sniper/ranger/infantry/grenadier). A personnel unit that ENDS the
  round on a base cell not owned by its faction flips it immediately (Phase B.5, after
  combat — dead units don't capture). Vehicles never capture.
- Capture event in the log/replay ("Ranger raises the colors").

### B.3 Economy
- Credits per faction. Initial + per-base income from the donor XML
  (`initialCredits`, `perBaseCredits`); fallback 100/100 if absent. Income accrues at
  round end (Phase E) per base owned at that moment.
- Unit costs in `data/units.json` (new `cost` field): infantry 75, ranger 150,
  humvee 150, grenadier 150, sniper 200, tank 300, artillery 400, heavytank 600.

### B.4 Production
- A `buy` order: `{ kind: 'buy'; baseCell: CellId; unitTypeKey: string }`, committed
  blind during planning like all orders. Max one buy per owned base per round; total
  committed cost ≤ current credits (validated at entry, re-checked at resolution — a
  base lost mid-round refunds nothing, the buy just fails with an event).
- Spawn at **Phase E (round end)** on the base cell if vacant of any unit (else the buy
  fails, credits refunded, logged). The unit acts next round.
- **Player messaging is mandatory and explicit**: queued buy shows as a ghost token + a
  pill on the base ("Sniper purchased — arrives at round end"); the order list shows it;
  the replay shows the spawn materializing; the skirmish log logs it (own buys always;
  enemy spawns only if the base is live-visible).

### B.5 Win / loss (Conquest)
1. **Insta-win**: enemy has zero units AND zero bases.
2. **Base collapse**: a faction holding zero bases for 3 consecutive round-ends loses
   (grace counter visible to that player: "3 rounds to retake a base").
3. **Round limit**: none by default; optional limit selectable at battle start (off / 40
   / 60 / 80). If set and reached: most bases wins, then most total unit count, then draw.
- Operator accepts the attrition-stalemate risk; meta to be observed, tuned later.

### B.6 Starting forces (Conquest)
- From the donor XML: mapped `startUnit` entries where present; else default
  [infantry, infantry, ranger] per faction, placed by the existing placeForce from the
  faction's first base. Bases per donor. (Skirmish keeps mirror-8 armies untouched.)

### B.7 AI (E4)
- Greedy planner extension for Conquest: buy logic (spend down credits each round:
  prefer counter-composition vs known enemy, else cost-efficient mix; personnel ratio
  floor for capture capacity), capture objectives (neutral/enemy bases as advance
  targets, weighted by distance and threat), defend-base impulse when own base
  threatened. Same fairness (FactionView gains credits/bases/known-base-ownership).
- Skirmish acceptance suite stays untouched-green. New Conquest acceptance: greedy
  beats do-nothing on 3 seeds (do-nothing buys nothing); greedy-vs-greedy on Valley
  Road reaches a decisive end (win condition 1 or 2) within 80 rounds on 2 of 3 seeds.

## C. Build order

- **E1** discovery fog (core fog/state + skin tiers + replay ignition + silhouette
  previews). All existing tests adapted; new tier tests.
- **E2** economy core (bases, credits, buy orders, capture, Phase E, win modes, mode
  select state, scenario plumbing). Pure-core heavy; resolver+setup change. Skirmish
  path bit-identical (mode-gated; existing resolver tests must not change).
- **E3** economy UI (credits HUD, build sheet on owned base, buy messaging per B.4,
  base ownership tints, capture FX, grace-counter warning, mode select screen, rules
  modal new sections — keep the no-hyphen constraint).
- **E4** AI Conquest (B.7) + acceptance.

Each phase: tests green, build clean, PM visual review, deban sync, push.

*End of addendum.*
