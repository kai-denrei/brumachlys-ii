# Brumachlys II — Forced Crossing Combat Addendum

> Extends `2026-06-12-brumachlys-ii-design.md` (resolver §2). Operator-approved
> 2026-06-21. One change: when two enemy units' paths **cross** during movement,
> both are interrupted and fight a **to-the-death brawl** at the crossing. Applies
> to **all modes** (this is a core combat rule, not an economy feature). Pure /
> deterministic core; no RNG.

---

## 0. Motivation & the gap

The resolver already forces combat on direct contact (§2 movement rules):
- **Enemy mid-path → surprise contact:** the mover stops one cell short
  (`enemy-contact`); you cannot walk through an occupied enemy cell.
- **Enemy on the final cell → charge:** the move completes into it and a
  **Phase A.5 same-cell brawl** runs `battleExchange` until one side is at 0.
- **Enemy friction:** adjacent enemies slow (can truncate) a move.

What is *not* handled is the **pass-by / swap**: two enemies whose paths overlap
but who never occupy the same cell at the same instant — e.g. A walks X→M→Z while
B walks W→M→V; A passes M first (empty), B passes M later (A already gone). They
visibly "cross" at M yet glide past with no fight. This addendum closes that gap.

## 1. The rule

- **Crossing (trigger):** two **enemy** units whose **traversed paths share at
  least one cell** this turn (the operator's chosen definition — includes
  different-moment pass-through, not just head-on swaps).
- **Interception:** both crossers are **halted on the shared cell** and fight a
  **to-the-death brawl** there.
- **Survivor:** stays on the crossing cell (its move is interrupted — it does not
  continue to its destination). Otherwise normal: Phase B auto-attack/defense and
  end-of-round bookkeeping apply, exactly like any brawl survivor.
- **Messaging:** a short **"path interrupted!"** sign at the crossing (replay FX +
  a new event), plus the normal brawl FX/log for the fight itself.
- **Scope:** all modes (skirmish + conquest). Not mode-gated.

## 2. Reuse — minimal new combat code

Halting both crossers on the shared cell makes the clash a **standard Phase A.5
same-cell brawl**, which already runs `battleExchange(higherInit, lowerInit)`
until one faction is gone — terrain bonuses for both, gang-up accumulator entries,
the min-damage floor, and mutual-death all handled. **The only new logic is
detection + halt + the sign.** No new combat math.

## 3. Implementation — Approach A (pre-pass on intended paths)

A pre-pass over move orders, run **before** the existing Phase A walk, so the
normal walk naturally stops crossers at the crossing (their path now ends there)
and the existing brawl resolves it. Least invasive; preserves the existing
friction/surprise-contact semantics for every non-crossing move.

1. **Intended trails.** For each mover, build its intended trail
   `[origin, ...order.path]` (terrain/passability re-validated, optimistic on
   fog as today). Stationary units are not movers and are handled by the existing
   surprise-contact/charge rules, not here.
2. **Detect crossings.** For each pair of **enemy** movers whose trail cell-sets
   intersect, record the pair and its shared cells.
3. **Interception cell.** For a crossing pair, the interception cell is the first
   shared cell in the **higher-initiative** unit's trail order (initiative is the
   resolver's existing §2.2 tiebreak: init desc, then FNV of `unitId+":"+round`).
4. **Truncate.** Truncate **both** movers' `order.path` to end at the interception
   cell (each halts there) and tag both as crossing-interrupted at that cell.
5. **Fixpoint.** Truncating one path can dissolve another pair's crossing (a unit
   no longer reaches a later shared cell). Re-detect after each round of
   truncations and iterate to a stable set — reusing the iterate-to-stable
   discipline the existing **vacancy settlement** (§A-end) already uses. Bounded:
   every truncation strictly shortens a path.
6. **Run Phase A unchanged** with the truncated paths. Crossers stop on the
   interception cell → both factions present there → **Phase A.5 brawl** resolves
   to the death.
7. **Emit** a `path-interrupted` event per interrupted mover (§5) so the replay
   shows the sign; the brawl emits its normal `brawl-exchange` / `kill` events.

**Approximation (documented):** detection is on intended paths; if a crosser
actually falls short of the interception cell at execution (budget/terrain), it
simply never arrives and no brawl happens — its partner then halts on the cell
alone (a harmless wasted stop). Acceptable; noted, not a bug.

## 4. Edge cases & precedence

- **Precedence:** existing surprise-contact and charge fire as today; the crossing
  rule only adds the pass-by/swap case (two *moving* enemies whose transit cells
  overlap). A move that already collides via contact/charge is resolved by those
  rules.
- **Interception-cell pick:** first shared cell in the higher-init trail
  (deterministic, §3.3).
- **Multi-way:** 3+ mixed-faction movers converging on one contested cell → they
  all halt there and the existing brawl resolves a multi-unit, both-factions cell.
  Surplus **same-faction** units that cannot occupy the cell (the max-one-friendly-
  per-cell invariant) halt one cell short along their own trail (their own
  truncation, no fight unless they themselves cross an enemy).
- **Friendly overlaps never fight** — friendlies pass through one another as today;
  only opposite-faction trail overlaps trigger interception.
- **Determinism:** pairs processed in a fixed order (higher-init unit's §2.2 order,
  then cellId); fixpoint iteration is order-stable. Pure; no RNG, no Date/DOM.

## 5. Event & replay

New `ResolutionEvent` variant:

```ts
| {
    type: 'path-interrupted'; // movement pre-pass: a crossing forced a halt
    unitId: string;
    crossedWithId: string; // the enemy whose path it crossed
    cell: CellId;          // the interception cell (where the brawl will run)
  }
```

Replay: render the **"path interrupted!"** sign at `cell` when the event plays;
the ensuing brawl uses the existing `brawl-exchange`/`kill` FX. Fog: the sign and
brawl surface under the existing fog-feed rules (a crossing in the dark is not
shown to a player who cannot see the cell).

## 6. Ramifications (explicit)

- **Skirmish changes.** Because the rule is all-modes, the tuned skirmish game
  shifts. Existing movement/resolver tests that exercise pass-by movement will
  change, and the **skirmish AI acceptance suite must be re-run and re-baselined**
  (it is no longer guaranteed bit-identical). This is the largest cost of the
  feature and is accepted.
- **AI unaware (this cut).** The greedy planner does not yet avoid or seek
  crossings; it may route into lethal clashes. First cut leaves the planner as-is
  and updates the acceptance baselines to the new reality. Teaching the planner
  crossing-awareness is a **follow-up** (§7 non-goal).
- **Balance:** movement near enemies becomes much riskier (you cannot slip past) —
  the intended aggression lever. Stances are ignored in the clash, like all brawls.

## 7. Non-goals (this addendum)

- AI crossing-awareness (avoid/seek) — deferred to a follow-up.
- A mode toggle / battle-start option — out of scope; the rule is universal.
- Changing the brawl math, surprise-contact, charge, or friction rules.

## 8. Testing

- **New core tests** (`test/core`): pass-by crossing on a shared cell triggers a
  halt + to-the-death brawl; head-on swap; multi-way convergence; friendly
  overlap does NOT fight; precedence (a normal charge/surprise-contact still wins
  where applicable); the fixpoint terminates and is deterministic across seeds;
  the documented short-fall approximation (partner halts alone, no brawl).
- **`path-interrupted` event** emission + a replay/FX test for the sign and fog
  gating.
- **Re-baseline** the skirmish movement/resolver suites and the **AI acceptance
  suite** to the new behavior (skirmish is no longer bit-identical — update, do
  not suppress).
- Purity check stays green.

## 9. Build order

1. Core: `path-interrupted` event type; the crossing pre-pass (detect → interception
   cell → truncate → fixpoint) feeding the existing Phase A; tests.
2. Re-baseline existing skirmish/resolver tests + AI acceptance to the new rule.
3. Replay/UI: the "path interrupted!" sign FX (fog-gated) + test.
4. Each step: tests green, purity green, build clean, visual review, deban sync.

*End of addendum.*
