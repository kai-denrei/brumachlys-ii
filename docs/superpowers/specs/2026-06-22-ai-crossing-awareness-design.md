# Brumachlys II — AI Crossing-Awareness Addendum

> Extends the forced-crossing-combat addendum (`2026-06-21-forced-crossing-combat-design.md`)
> and §B.7 AI. Operator-approved 2026-06-22. The greedy planner becomes aware of the
> forced-crossing rule: it **avoids** lethal crossings and **seeks** favorable ones, using a
> simple path-intersection check. Pure / deterministic (`src/ai` is purity-gated). Skirmish +
> conquest.

---

## 0. Motivation

The forced-crossing rule halts two enemies whose paths share a cell and brawls them to the
death. The greedy planner is currently blind to it: it picks a destination, computes one path,
and may route straight into a clash it loses (or miss one it would win). This addendum gives the
planner a cheap, deterministic heuristic to factor crossings into move scoring.

## 1. Shared helper (DRY)

Extract the path-intersection logic the resolver pre-pass already uses into a pure, exported
helper so the resolver and the AI share one definition:

- New in `src/core/pathing.ts` (or `src/core/paths.ts`):
  - `pathsShareCell(a: readonly CellId[], b: readonly CellId[]): boolean`
  - `firstSharedCell(a: readonly CellId[], b: readonly CellId[]): CellId | null`
    — first cell of `a` (in order) that also appears in `b`.
- Refactor the resolver's crossing pre-pass to consume these (behavior unchanged; the existing
  10 crossing tests must stay green).

## 2. Planner integration (`src/ai/planner-greedy.ts`)

Slot in **after** the per-unit best-candidate is chosen (~line 1198, before `findPath`):

1. Compute the unit's intended path to `best.cell` (the same `findPath` it already calls).
2. For each **visible** enemy (FactionView only — fog-honest), estimate its likely path with a
   simple, documented heuristic:
   - **Already-committed enemies** are not known (factions plan independently), so estimate:
     the enemy's shortest path toward its nearest visible target (own unit / threatened base),
     capped at its movement budget; plus the trivial stay-put trail `[enemyCell]`.
   - This is an **approximation** (we do not truly know enemy intent) — documented as such.
3. If the unit's path and the estimated enemy path **share a cell** (`pathsShareCell`),
   `simulateBrawl` (the planner's existing helper, exact `battleExchange` model) at the
   `firstSharedCell` terrain to judge the clash:
   - **Favorable** (we survive, they die) → add a small **seek bonus** to the candidate score.
   - **Unfavorable** (we die) → large **avoid penalty** (effectively rerouting/holding).
   - **Mutual/attrition** → minor adjustment.
4. Re-rank candidates with the adjusted scores; emit the move for the new best.

Weights live in `data/ai.json` (new `crossingSeek` / `crossingAvoid` entries); start
conservative and tune on the acceptance seeds.

## 3. Determinism, purity, performance

- Pure: no RNG/Date/DOM; tie-breaks via existing numeric scores + FNV. Set-based intersection
  is O(path length) per pair.
- Budget: keep `planOrders` within its existing ~0.5 ms median / <2 ms max. Estimate enemy
  paths once per enemy per round (cache), not per candidate-cell.

## 4. Testing & re-baseline

- Unit tests for `pathsShareCell` / `firstSharedCell`; resolver crossing tests stay green after
  the refactor.
- New AI tests: the planner avoids a clearly-losing crossing (routes around / holds) and takes a
  clearly-winning one; determinism (same seed → identical orders) and the perf budget hold.
- **Re-baseline** `test/ai/acceptance.test.ts` if round/survivor counts shift; greedy must still
  beat do-nothing on ≥2/3 seeds and greedy-vs-greedy stay decisive. Update expected outcomes to
  the new reality; do not weaken the assertions.

## 5. Non-goals

- Perfect enemy-intent prediction (this is a heuristic estimate).
- Multi-unit crossing choreography or coordinated pincers — single-unit local decisions only.
- Any resolver rule change.

*End of addendum.*
