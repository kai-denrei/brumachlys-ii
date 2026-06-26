# Brumachlys II — Upkeep & Build Dashboard Addendum

> Extends `2026-06-12-conquest-addendum.md` (and through it the base design spec).
> Operator-approved 2026-06-21. Two **linked** changes shipped in one pass:
> 1. **Upkeep** (§1–§10) — a per-turn maintenance cost on every unit, to cap
>    infinite camping and runaway build-up. Conquest mode only.
> 2. **BUILD economy dashboard modal** (§11) — production moves off the on-map
>    "+" into a full economy-planning modal that surfaces the upkeep/net numbers
>    upkeep makes necessary. The two are linked: the dashboard is where a player
>    reads and acts on upkeep.
>
> All hard rules of the base spec and the conquest addendum stay in force.

---

## 0. Motivation

Conquest income (`addendum §B.3`) is pure accumulation: credits only ever grow,
and the sole sink is buying units. Nothing stops a faction from camping and
stockpiling an unbounded army. Upkeep introduces a recurring credit sink tied to
army size, so the sustainable army self-caps at the territory a faction can hold.

**Design intent — a soft growth ceiling, not a culling force.** Upkeep gates
*production*; it never removes units already on the board (see §4). The natural
equilibrium is *max sustainable army value ≈ income ÷ upkeep rate ≈ bases held* —
more ground supports a larger army; lose ground and you can no longer afford to
replace losses.

## 1. Formula & data model

- **Per-unit upkeep** (pure, deterministic):
  `upkeep(u) = Math.round(unitType.cost × upkeepRate × u.count)`
  - `upkeepRate` default **0.01** → 1% of build cost per count-point. A unit's
    `count` is 1..10, so upkeep ranges 1%..10% of cost and caps at 10% at full
    strength. Damaged/understrength squads cost proportionally less, tying upkeep
    into combat attrition and the veterancy heal.
  - Worked examples at full strength (count 10): infantry `round(75×0.01×10)=8`;
    ranger/humvee/grenadier `round(150×0.01×10)=15`; tank `30`; heavytank `60`.
  - Rounding is per unit (`Math.round`), then summed per faction. A 1-count
    infantry rounds to `round(0.75)=1`, so any living unit costs at least ~1.
- **Config:** new optional field `board.economy.upkeepRate`, alongside the
  existing `initialCredits` / `perBaseCredits`. Absent ⇒ default `0.01`. Setting
  it to `0` disables upkeep entirely — a per-scenario kill-switch with no separate
  boolean flag.
- **No new fields on `UnitInstance`.** Upkeep is derived from `unitType.cost` and
  `u.count` on demand; nothing is persisted on the unit.
- **Conquest-only.** All logic lives inside the existing `if (conquest)` branch of
  the resolver. The skirmish `GameState` shape and resolver path stay
  bit-identical (base spec §0 hard rule).

## 2. Phase E ordering (round end, `src/core/resolver.ts`)

Strict deterministic sequence, faction 0 then 1 (extends `addendum §B.3/§B.4`):

1. **Income** (unchanged): `credits[f] += ownedBases(f) × perBaseCredits`.
2. **Upkeep** (new): `credits[f] = Math.max(0, credits[f] − Σ upkeep(u))` over
   `f`'s living units. **Clamp at zero** — credits never go negative; next round's
   income is fully available again. No lingering debt.
3. **Buys** (unchanged): spend remaining credits to spawn recruits.

**Income before upkeep** so savings + fresh income absorb the bill before
clamping. **Buys after upkeep** means a recruit bought this round pays no upkeep
until the *next* round end — the ordering gives that exemption for free, no
special-casing.

Determinism: upkeep is pure integer arithmetic over units in the existing
deterministic iteration; no RNG, no `Date.now`. Purity check (`check-purity.mjs`)
stays green.

## 3. Resolution event

New `ResolutionEvent` variant (in `src/core/types.ts`):

```ts
| {
    type: 'upkeep'; // Phase E — drawn per faction, after income, before buys
    faction: FactionId;
    units: number;   // count of living units that drew upkeep
    amount: number;  // total drawn (post-clamp: the actual debit, ≤ pre-clamp sum)
    creditsAfter: number;
  }
```

- Emitted once per faction per round (even when `amount` is 0, for a stable feed),
  immediately after that faction's `income` event.
- **`amount` is the actual debit after clamping** — if upkeep would exceed the
  balance, `amount` equals the credits drained to zero, not the uncapped sum. (UI
  can still show the uncapped liability via §5; the event records what was paid.)
- **Blind, like income and buys.** A faction sees its own upkeep; enemy upkeep
  surfaces only through the existing fog feed rules (`addendum §A`, §B.4). The
  skirmish log and casualty panel inherit honesty automatically (fog-feed sourced).
- `upkeepRate = 0` still emits the event with `amount: 0` (mode stays uniform; the
  feed never branches on whether upkeep is enabled).

## 4. Win / loss interaction

**None, by construction.** Clamp-at-zero never removes a unit or reduces `count`,
so upkeep cannot trigger annihilation, mutual-annihilation, or base-collapse
(`addendum §B.5`). It only gates production. The §B.5 checks are untouched.

This is the deliberate consequence of the chosen debt model: upkeep is a ceiling
on *growth*, and combat remains the only thing that removes units. (A future
revision could revisit a lethal model — starvation attrition or forced disband —
but it is explicitly out of scope here; see §8.)

## 5. UI / messaging (E3 surface)

Mandatory-explicit-messaging (`addendum §B.4`) extends to upkeep — a player must
see the cost before committing buys, or production becomes a trap.

- **Credits HUD** shows projected **net** for the coming round end:
  `income − upkeep` (e.g. `+100 −31 = +69`), using the typographic minus
  (U+2212) consistent with the existing economy UI.
- **Build sheet** on an owned base reflects projected post-upkeep credits, so a
  buy that would fail at resolution on a net-negative turn is visible *before*
  commit. (The resolver still re-checks and fails with the existing
  `spawn-failed` / `no-credits` event as the backstop — `addendum §B.4`.)
- **Optional:** per-unit upkeep shown in the unit inspector.

### Rules modal (the "i") — required for this slice

`src/ui/RulesModal.tsx`. House style is laconic, telegraphic, **deliberately
hyphen free** (en dashes for ranges, U+2212 for minus) — enforced by a test. Two
edits:

1. **Round-summary line** (currently `Income · Spawns`, Conquest only) becomes
   `Income · Upkeep · Spawns`: "each owned base pays credits, then each unit draws
   upkeep, then queued recruits appear."
2. **New `Upkeep` section**, placed after `Credits` and before `Production`, in
   the hyphen-free house style. Intended copy (final wording tuned at
   implementation, but must stay hyphen free and telegraphic):
   > Each unit draws pay at round end: a hundredth of its build cost per soldier
   > still standing. A full squad costs a tenth of its price; a thinned squad
   > costs less. Upkeep follows income and never drives you below zero. When your
   > army outpaces your income, nothing is left to recruit. Forces grow only as
   > fast as the ground that feeds them.

## 6. AI (E4)

The greedy Conquest planner (`addendum §B.7`) must stop spending credits down to
zero blindly: it reserves for upkeep and reasons about **net** income (avoid
buying into a sustained negative). Folded into the existing E4 buy-logic work — no
separate phase. Fairness unchanged (FactionView already exposes credits).

## 7. Config / affordability sanity-check

Default starting forces `[infantry, infantry, ranger]` at full strength draw
`8 + 8 + 15 = 31` upkeep/round; one base at the fallback `perBaseCredits 100`
yields net **+69**/round. Sustainable from turn 1 with defaults — the critical
"opening must not bleed" check passes. Equilibrium army value scales with bases
held, as intended.

## 8. Non-goals (explicit, out of scope here)

- **Lethal insolvency** (starvation attrition, forced disband, negative debt).
  Rejected for this slice in favor of clamp-at-zero. May be revisited later.
- **A simplified onboarding tutorial** explaining all game mechanics (upkeep
  included). Planned as separate future work — its own spec → plan → build cycle.
  Recorded here so it is not lost; not built in this slice.

## 9. Testing

- **New pure-core tests** (`src/core`): upkeep arithmetic (rounding edges,
  count-scaling, `upkeepRate = 0` disable), Phase E ordering (income→upkeep→buys,
  new-recruits-exempt, clamp-at-zero never goes negative), `upkeep` event emission
  shape + per-faction blindness through the fog feed.
- **Existing conquest economy fixtures** that assert end-of-round `credits` will
  change (upkeep now debits) and must be updated to expect the post-upkeep
  balances and the new `upkeep` events.
- **Existing skirmish tests must stay untouched-green** — the guardrail proving
  the conquest mode-gate holds and the pre-E2 shape is preserved.
- **Rules modal test** (hyphen-free copy) must include the new section.

## 10. Build order

Single focused slice (upkeep is small and self-contained):

1. Core: `upkeepRate` config plumbing, `upkeep` event type, Phase E debit, tests.
2. UI: HUD net display, build-sheet projection, rules-modal section + round line.
3. AI: net-income reserve in the greedy buy logic (can trail core if E4 not yet
   landed; gate behind whatever E4 state exists).
4. Each step: tests green, purity green, build clean, PM visual review, deban
   sync, push.

---

## 11. BUILD economy dashboard modal

### 11.0 Motivation

Production today is an on-map "+" pip that opens a cramped anchored card
(`BuildSheet.tsx`). The pip layer already renders *above* unit tokens
(`Board.tsx:1317–1327` over `EffectRenderer.tsx:245–322`), so occupancy is not
actually the blocker — the blocker is that there is no place to *plan the
economy*. Upkeep makes economy a per-turn planning activity (income vs upkeep vs
net vs committed), so production graduates from a one-tap affordance into a
dashboard. The on-map entry stays, but re-routes to the dashboard.

### 11.1 Entry points (two, one modal)

1. **HUD economy widget** (`HudCluster.tsx:38–54`, the ◈ cluster) becomes
   tappable → opens the modal at the **economy overview** (no base focused).
2. **"B" pip per owned base** — the existing build pip, relabeled `+ → B`
   (`EffectRenderer.tsx` BuildPips). It already sits above the unit layer, so a
   unit standing on the base never swallows the tap. Opens the modal **scrolled
   to that base's row**.
3. **Base *cell* taps no longer open build.** `App.tsx onCellTap` (the
   `844–850` and `892–897` branches) reverts to info/selection. The standalone
   anchored `BuildSheet` card is **retired**. The old BuyGhost-tap and dock
   buy-chip tap (`App.tsx:1234, 1311`) re-route to the modal focused on that base.

### 11.2 The modal — full-screen scrollable sheet

`SheetShell` family (`Sheets.tsx`), mobile-first, same sheet styling as
`RulesModal`. Sections top → bottom:

- **A · Economy summary.** ◈ credits on hand · income/turn (`bases ×
  perBaseCredits`) · upkeep/turn (Σ, from §1's shared helper) · **net/turn**
  (income − upkeep, U+2212 minus) · committed this round (Σ queued buys) +
  credits-after-commit. The planning headline.
- **B · Mini-map.** Small SVG via the extracted `projectCells` helper (§11.4),
  every base tinted by ownership (`palette.factionColor`/`mix`), queued-buy
  badged, occupied marked. Tapping a base scrolls to its row. Read-only overview
  + navigation.
- **C · Per-base production list.** One row per owned base: location label,
  occupant ("vacant" / unit token / "occupied — won't spawn"), queued buy (unit
  + cost) with change/cancel, and a build action that opens the **reused unit
  picker** (§11.4) scoped to that base, gated by the same affordability rule
  (`available = credits − committedElsewhere`).
- **D · Army roster summary.** Counts by unit type + total upkeep across the
  player's army, to judge expansion headroom.

### 11.3 Data & state — nothing new in core

Everything is already available: `game.credits[PLAYER]`, `ownedBaseCount ×
perBaseCredits`, the §1 upkeep helper over the player's units,
`game.bases` (ownership) + `board.bases` (positions), `store.buys`
(`Record<CellId, BuyOrder>`). Buy create/validate reuses `tryQueueBuy` /
`removeBuyOrder` / `validateBuy` unchanged. **One buy per base stays.** This is a
UI + state-presentation change on top of existing buy plumbing — no resolver or
order-type change.

### 11.4 Reuse / targeted refactor (no reinvention)

- **Extract** `projectCells` from `RulesModal.tsx:54–82` into
  `src/ui/skin/board-projection.ts`, generalized over any `Board`; `RulesModal`
  switches to it (must stay green).
- **Extract** the unit-picker grid + affordability logic from `BuildSheet.tsx`
  into a reusable `<UnitPicker>` consumed by the modal's per-base build action.
- Reuse `SheetShell`, `.sheet-scrim`, `.build-grid`, `UnitRenderer`
  (`minimal`), and the `palette.ts` tint helpers.

### 11.5 Testing

- Modal opens from the HUD widget and from a base "B" pip (focused on that base).
- Per-base buy set / change / cancel through the modal writes `store.buys` and
  reflects in ghosts/dock as today.
- Economy-summary math (income, upkeep, net, committed) matches the resolver and
  the §1 helper.
- Mini-map renders each base with the correct ownership tint; occupied bases are
  flagged.
- `board-projection` extraction keeps `RulesModal` rendering identical (its
  existing test stays green).
- Existing `BuildSheet` tests migrate onto the modal; the retired card has no
  orphan references.

### 11.6 Non-goals (this section)

No core/resolution change; no multi-buy-per-base; no enemy-economy view; the
onboarding tutorial (§8) stays deferred.

### 11.7 Build order

After §10 (upkeep) lands: (1) extract `board-projection` + `UnitPicker`
(refactors, tests stay green); (2) build the dashboard modal with all four
sections against existing buy state; (3) re-wire entry points (HUD widget, B pip
relabel + route, cell-tap revert, ghost/dock re-route) and retire `BuildSheet`;
(4) tests green, purity green, build clean, visual review, deban sync, push.

*End of addendum.*
