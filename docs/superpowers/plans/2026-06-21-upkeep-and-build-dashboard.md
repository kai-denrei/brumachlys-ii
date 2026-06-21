# Upkeep & Build Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-turn upkeep credit sink (conquest only) and replace the on-map "+" production card with a full BUILD economy-dashboard modal that surfaces income/upkeep/net.

**Architecture:** Upkeep is a pure-core change in the resolver's Phase E (income → upkeep → buys, clamp at zero), with a shared pure helper (`src/core/economy.ts`) reused by the UI for projections. A new `upkeep` ResolutionEvent ticks the replay credit feed. The BUILD dashboard is a UI-only change on top of the existing buy plumbing (`store.buys` / `validateBuy`), reusing two newly-extracted primitives (`board-projection`, `UnitPicker`). No order-type or buy-validation change.

**Tech Stack:** TypeScript, React 18, Zustand 5, Vite, Vitest, jsdom, Testing Library.

## Global Constraints

- **Purity (spec §0):** `src/board`, `src/core`, `src/ai` must be pure — no `Math.random`, `Date.now`, argless `new Date()`, `document.`, `window.`, `localStorage`, or imports from `ui/`/`state/`. `npm test` runs `scripts/check-purity.mjs` first. `src/core/economy.ts` is pure.
- **Mode-gating:** all upkeep logic lives inside the resolver's `const conquest = state.mode === 'conquest'` branch. **Skirmish `GameState` shape and all existing skirmish tests must stay bit-identical / untouched-green.**
- **Determinism:** upkeep is pure integer arithmetic over units in the existing deterministic iteration; no RNG.
- **Upkeep formula (verbatim):** `unitUpkeep = Math.round(unitType.cost × upkeepRate × count)`; `upkeepRate` default `0.01`, `0` disables. Clamp credits at zero (never negative).
- **Copy rule (RulesModal):** laconic, telegraphic, **deliberately hyphen free** — en dashes for ranges, U+2212 (`−`) for minus. Enforced by `test/ui/rules-modal.test.tsx`.
- **Mobile-first:** the board is the screen; the dashboard is a full-screen scrollable modal (RulesModal family).
- **Credit symbol:** `◈` (U+25C8).
- **Commit cadence:** commit after each task. Author is already `Kai Denrei` (do not change). End commit messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Run tests:** `npm test` (purity + full vitest). Single file: `npx vitest run test/path/file.test.ts`.

---

## File Structure

**Phase 1 — upkeep core (pure):**
- Create `src/core/economy.ts` — pure upkeep math + rate accessor.
- Modify `src/board/types.ts:45` — add optional `upkeepRate` to `economy`.
- Modify `src/core/types.ts` — add `upkeep` ResolutionEvent variant.
- Modify `src/core/resolver.ts` (Phase E income loop, ~663–668) — apply upkeep.
- Modify `src/state/replay.ts` (after income handler, ~985) — tick credits on own upkeep.
- Test: `test/core/economy.test.ts` (new), `test/core/upkeep.test.ts` (new).

**Phase 2 — upkeep UI surface:**
- Modify `src/ui/TopBar.tsx` — extend `CreditsHud` type.
- Modify `src/ui/HudCluster.tsx` — net/turn line; make credits row open the dashboard.
- Modify `src/App.tsx` — compute upkeep/net into `creditsHud`.
- Modify `src/ui/RulesModal.tsx` — Upkeep section + round-summary line.
- Test: `test/ui/hud-displays.test.tsx`, `test/ui/rules-modal.test.tsx`.

**Phase 3 — extractions (refactor, behavior-preserving):**
- Create `src/ui/skin/board-projection.ts` — generalized `projectBoard`.
- Modify `src/ui/RulesModal.tsx` — consume `projectBoard`.
- Create `src/ui/UnitPicker.tsx` — extracted roster grid + affordability.
- Test: `test/ui/board-projection.test.ts` (new); `rules-modal.test.tsx` stays green.

**Phase 4 — BUILD dashboard modal:**
- Create `src/ui/BuildDashboard.tsx` — the modal (4 sections).
- Modify `src/ui/styles.css` — `.build-dashboard*` classes.
- Test: `test/ui/build-dashboard.test.tsx` (new).

**Phase 5 — entry rewiring + retire BuildSheet:**
- Modify `src/ui/skin/EffectRenderer.tsx` — relabel pip `+ → B`.
- Modify `src/App.tsx` — route HUD widget + B pip + ghost/dock to dashboard; revert cell-tap; render `BuildDashboard`; remove `BuildSheet`.
- Delete `src/ui/BuildSheet.tsx`; migrate `test/ui/build-sheet.test.tsx`.

**Phase 6 — verification + adversarial review.**

---

## PHASE 1 — Upkeep core

### Task 1.1: Pure upkeep helper (`src/core/economy.ts`)

**Files:**
- Create: `src/core/economy.ts`
- Modify: `src/board/types.ts:45`
- Test: `test/core/economy.test.ts`

**Interfaces:**
- Consumes: `UnitType` (`src/core/types`), `UnitInstance`, `FactionId`, `Board`.
- Produces:
  - `DEFAULT_UPKEEP_RATE = 0.01`
  - `upkeepRateOf(board: Board): number`
  - `unitUpkeep(unitType: UnitType, count: number, rate: number): number`
  - `factionUpkeep(units: Iterable<UnitInstance>, faction: FactionId, unitTypes: Readonly<Record<string, UnitType>>, rate: number): number`

- [ ] **Step 1: Add the optional rate field to the board economy type.**

In `src/board/types.ts`, change line 45:
```ts
  /** E2 (addendum §B.3): donor economy values; fallback 100/100 applied at
   * generation when the donor XML omits them (≤ 0 treated as absent).
   * `upkeepRate` (upkeep addendum §1): per-turn maintenance, fraction of unit
   * cost per count-point. Absent ⇒ DEFAULT_UPKEEP_RATE (0.01); 0 disables. */
  economy?: { initialCredits: number; perBaseCredits: number; upkeepRate?: number };
```

- [ ] **Step 2: Write the failing test** — `test/core/economy.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { unitUpkeep, factionUpkeep, upkeepRateOf, DEFAULT_UPKEEP_RATE } from '../../src/core/economy';
import { loadUnits } from '../../src/io/data-loader';
import type { UnitInstance } from '../../src/core/types';
import type { Board } from '../../src/board/types';

const types = loadUnits();
const u = (type: string, count: number, faction: 0 | 1 = 0): UnitInstance => ({
  id: `${type}-${count}-${faction}`, type, faction, cell: 0, count,
  stance: 'aggressive', attackedFrom: [],
});

describe('unitUpkeep', () => {
  it('is 1% of cost per count-point, rounded (full infantry 75 → 8)', () => {
    expect(unitUpkeep(types.infantry, 10, 0.01)).toBe(8); // round(7.5)
  });
  it('caps at 10% of cost at full strength (heavytank 600 → 60)', () => {
    expect(unitUpkeep(types.heavytank, 10, 0.01)).toBe(60);
  });
  it('scales down with count (infantry at count 4 → round(3.0)=3)', () => {
    expect(unitUpkeep(types.infantry, 4, 0.01)).toBe(3);
  });
  it('a 1-count cheap unit still rounds to ~1 (round(0.75)=1)', () => {
    expect(unitUpkeep(types.infantry, 1, 0.01)).toBe(1);
  });
  it('rate 0 disables (0 for any unit)', () => {
    expect(unitUpkeep(types.heavytank, 10, 0)).toBe(0);
  });
});

describe('factionUpkeep', () => {
  it('sums only the named faction’s living units', () => {
    const units = [u('infantry', 10, 0), u('tank', 10, 0), u('infantry', 10, 1)];
    // f0: round(0.75*10)=8 + round(3*10)=30 = 38 ; tank cost 300 → 0.01*10*300=30
    expect(factionUpkeep(units, 0, types, 0.01)).toBe(8 + 30);
    expect(factionUpkeep(units, 1, types, 0.01)).toBe(8);
  });
  it('ignores count-0 (dead) units', () => {
    const units = [u('infantry', 0, 0), u('tank', 10, 0)];
    expect(factionUpkeep(units, 0, types, 0.01)).toBe(30);
  });
});

describe('upkeepRateOf', () => {
  const board = (economy?: Board['economy']): Board =>
    ({ economy } as unknown as Board);
  it('defaults to 0.01 when absent', () => {
    expect(upkeepRateOf(board(undefined))).toBe(DEFAULT_UPKEEP_RATE);
    expect(upkeepRateOf(board({ initialCredits: 100, perBaseCredits: 100 }))).toBe(0.01);
  });
  it('honors an explicit rate including 0', () => {
    expect(upkeepRateOf(board({ initialCredits: 100, perBaseCredits: 100, upkeepRate: 0 }))).toBe(0);
    expect(upkeepRateOf(board({ initialCredits: 100, perBaseCredits: 100, upkeepRate: 0.05 }))).toBe(0.05);
  });
});
```

- [ ] **Step 3: Run test, verify it fails** — `npx vitest run test/core/economy.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement** `src/core/economy.ts`:
```ts
// economy.ts — pure conquest economy math (upkeep addendum §1). No state, no
// RNG, no DOM. Shared by the resolver (Phase E debit) and the UI (net-income
// projection) so both compute upkeep identically.

import type { UnitInstance, UnitType, FactionId } from './types';
import type { Board } from '../board/types';

/** Default per-turn upkeep: 1% of unit cost per count-point, capping at 10% of
 *  cost at full strength (count 10). Absent board rate ⇒ this; 0 disables. */
export const DEFAULT_UPKEEP_RATE = 0.01;

/** Resolve the board's upkeep rate, applying the default when unset. 0 is a
 *  valid explicit value (disables upkeep) and is preserved. */
export function upkeepRateOf(board: Board): number {
  const r = board.economy?.upkeepRate;
  return r === undefined ? DEFAULT_UPKEEP_RATE : r;
}

/** One unit's per-turn upkeep: round(cost × rate × count). */
export function unitUpkeep(unitType: UnitType, count: number, rate: number): number {
  return Math.round(unitType.cost * rate * count);
}

/** Total upkeep for one faction's LIVING units (count > 0). */
export function factionUpkeep(
  units: Iterable<UnitInstance>,
  faction: FactionId,
  unitTypes: Readonly<Record<string, UnitType>>,
  rate: number,
): number {
  let sum = 0;
  for (const u of units) {
    if (u.faction !== faction || u.count <= 0) continue;
    const ut = unitTypes[u.type];
    if (ut) sum += unitUpkeep(ut, u.count, rate);
  }
  return sum;
}
```

- [ ] **Step 5: Run test, verify pass** — `npx vitest run test/core/economy.test.ts` → PASS.
- [ ] **Step 6: Run purity** — `node scripts/check-purity.mjs` → no violations.
- [ ] **Step 7: Commit** — `git add src/core/economy.ts src/board/types.ts test/core/economy.test.ts && git commit -m "feat(core): pure upkeep helper + board economy upkeepRate field"`

---

### Task 1.2: `upkeep` ResolutionEvent type

**Files:**
- Modify: `src/core/types.ts` (ResolutionEvent union, after the `income` variant ~189)

**Interfaces:**
- Produces: `{ type: 'upkeep'; faction: FactionId; units: number; amount: number; creditsAfter: number }` member of `ResolutionEvent`.

- [ ] **Step 1: Add the variant.** In `src/core/types.ts`, immediately after the `income` event object (the variant ending `creditsAfter: number; }` around line 189), insert:
```ts
  | {
      type: 'upkeep'; // Phase E — per faction, after income, before buys (upkeep §3)
      faction: FactionId;
      units: number; // living units that drew upkeep
      amount: number; // total drawn AFTER clamp (the actual debit, ≤ pre-clamp sum)
      creditsAfter: number;
    }
```

- [ ] **Step 2: Verify it compiles** — `npx tsc -b --noEmit` (or `npm run build` later) → no type errors. (No standalone test; exercised in Task 1.3.)
- [ ] **Step 3: Commit** — `git add src/core/types.ts && git commit -m "feat(core): add upkeep ResolutionEvent variant"`

---

### Task 1.3: Phase E upkeep debit (resolver)

**Files:**
- Modify: `src/core/resolver.ts` — the income loop (~663–668)
- Test: `test/core/upkeep.test.ts`

**Interfaces:**
- Consumes: `upkeepRateOf`, `unitUpkeep` from `src/core/economy`; existing `alive()` helper (living units, count > 0); existing `credits`, `events`, `board`, `unitTypes`.
- Produces: `upkeep` events in the round log; mutated `credits` (clamped at 0).

**Ordering contract:** per faction, push `income` then `upkeep`, then (after the loop) resolve buys. New recruits spawn after this loop, so they pay no upkeep their first round.

- [ ] **Step 1: Write the failing test** — `test/core/upkeep.test.ts`. Use the existing synthetic conquest helpers if present (`test/core/synthetic.ts`); otherwise build a minimal conquest `GameState`. Skeleton:
```ts
import { describe, it, expect } from 'vitest';
import { resolveRound } from '../../src/core/resolver';
import { loadUnits } from '../../src/io/data-loader';
import { weewarModel } from '../../src/core/combat';
import type { ResolutionEvent } from '../../src/core/types';
// NOTE: reuse the conquest fixture builder used by test/core/conquest.test.ts
// (import the same helper). Build a 2-base conquest state, faction 0 owning one
// base with credits set so the cases below are exercised.

const types = loadUnits();
const upkeepEvents = (log: ResolutionEvent[], f: 0 | 1) =>
  log.filter((e): e is Extract<ResolutionEvent, { type: 'upkeep' }> => e.type === 'upkeep' && e.faction === f);

describe('Phase E upkeep', () => {
  it('debits round(cost×rate×count) per living unit, after income', () => {
    // f0 owns 1 base (income +100), has one full infantry (upkeep 8) and starts
    // with 0 credits → after income 100, after upkeep 92.
    // ... build state, resolve, assert ...
    // const { events } = resolveRound(board, state, orders, types, weewarModel, buys);
    // const up = upkeepEvents(events, 0)[0];
    // expect(up.amount).toBe(8); expect(up.creditsAfter).toBe(92); expect(up.units).toBe(1);
  });

  it('clamps at zero — never negative when upkeep exceeds credits', () => {
    // f0 income 0 + savings 5, upkeep due 8 → paid 5, creditsAfter 0.
    // expect(up.amount).toBe(5); expect(up.creditsAfter).toBe(0);
  });

  it('a unit BOUGHT this round pays no upkeep this round', () => {
    // f0 buys an infantry that spawns at Phase E; the upkeep event (emitted
    // before the spawn) must NOT include the new unit.
    // expect(up.units).toBe(<pre-existing living count>);
  });

  it('upkeepRate 0 disables: amount 0, event still emitted', () => {
    // board.economy.upkeepRate = 0 → up.amount === 0, up still present.
  });

  it('skirmish emits no upkeep events (mode-gated)', () => {
    // resolve a skirmish state → events.every(e => e.type !== 'upkeep').
  });
});
```
(Fill the fixture bodies using the same construction as `test/core/conquest.test.ts` — read it first for the exact helper names.)

- [ ] **Step 2: Run test, verify it fails** — `npx vitest run test/core/upkeep.test.ts` → FAIL.

- [ ] **Step 3: Implement.** In `src/core/resolver.ts`, add the import at the top with the other core imports:
```ts
import { upkeepRateOf, unitUpkeep } from './economy';
```
Then replace the income loop (currently ~663–668):
```ts
    // Income accrues per base owned at this moment (post-capture).
    for (const faction of [0, 1] as const) {
      const owned = ownedBases(faction);
      const amount = owned * perBase;
      credits[faction] += amount;
      events.push({ type: 'income', faction, bases: owned, amount, creditsAfter: credits[faction] });
    }
```
with income **then** upkeep, per faction (upkeep addendum §2/§3):
```ts
    // Income accrues per base owned at this moment (post-capture), then upkeep
    // is drawn on the faction's LIVING units (clamped at zero — never negative).
    // New recruits spawn AFTER this loop, so they pay no upkeep this round.
    const upkeepRate = upkeepRateOf(board);
    for (const faction of [0, 1] as const) {
      const owned = ownedBases(faction);
      const income = owned * perBase;
      credits[faction] += income;
      events.push({ type: 'income', faction, bases: owned, amount: income, creditsAfter: credits[faction] });

      const living = alive().filter((u) => u.faction === faction);
      let due = 0;
      for (const u of living) due += unitUpkeep(unitTypes[u.type]!, u.count, upkeepRate);
      const paid = Math.min(credits[faction], due);
      credits[faction] -= paid;
      events.push({ type: 'upkeep', faction, units: living.length, amount: paid, creditsAfter: credits[faction] });
    }
```
(Verify `alive()` is in scope here — it is used a few lines below at the win/loss check. If it is defined later in the function, hoist nothing; it is a `const alive = () => …` declared earlier in `resolveRound`.)

- [ ] **Step 4: Run test, verify pass** — `npx vitest run test/core/upkeep.test.ts` → PASS.
- [ ] **Step 5: Run the full core suite** — `npx vitest run test/core` → existing **conquest** economy tests (`conquest.test.ts`, `buy-orders.test.ts`, `resolver.test.ts`, `win-precedence.test.ts`) may now fail on credit assertions. Update each to expect post-upkeep balances + the new `upkeep` events. **Skirmish tests must remain unchanged** — if any skirmish test changes, the mode-gate is wrong; fix the gate, not the test.
- [ ] **Step 6: Purity** — `node scripts/check-purity.mjs` → clean.
- [ ] **Step 7: Commit** — `git add src/core/resolver.ts test/core && git commit -m "feat(core): Phase E upkeep debit (income → upkeep → buys, clamp at zero)"`

---

### Task 1.4: Replay credit feed ticks on own upkeep

**Files:**
- Modify: `src/state/replay.ts` — add an `upkeep` handler after the `income` handler (~985)
- Test: `test/ui/replay-conquest.test.ts` (extend)

**Interfaces:**
- Consumes: the `upkeep` event; existing `cq.credits`, `vision()`, `frames`, `log`, `INCOME_MS`, `renderUnits`, `fogFields`, `emptyFx` helpers in the same scope.

- [ ] **Step 1: Write the failing test** — in `test/ui/replay-conquest.test.ts`, add a case: a conquest round where the player has a unit drawing upkeep ends with `frame.credits` reduced by the upkeep amount, and the skirmish log shows an `upkeep −N` segment. (Mirror the existing income assertion in that file.)
- [ ] **Step 2: Run, verify fail** — `npx vitest run test/ui/replay-conquest.test.ts` → FAIL.
- [ ] **Step 3: Implement.** In `src/state/replay.ts`, directly after the `income` handler block (the one ending `i++; continue; }` near line 985), add:
```ts
    if (ev.type === 'upkeep') {
      // Own upkeep only: the HUD ticks down, the log notes it. Enemy upkeep has
      // no witnessable cell — enemy credits stay secret (mirrors income).
      if (cq && ev.faction === player) {
        cq.credits = ev.creditsAfter;
        if (ev.amount > 0) {
          const vis = vision();
          frames.push({
            duration: INCOME_MS,
            slot: -1,
            units: renderUnits(vis),
            ...fogFields(vis),
            ...emptyFx(),
          });
          log.push({
            atFrame: frames.length - 1,
            segs: [
              { t: 'upkeep ' },
              { t: `−${ev.amount}`, f: player },
              { t: ` · ◈ ${ev.creditsAfter}` },
            ],
          });
        }
      }
      i++;
      continue;
    }
```
(Use the U+2212 minus `−`, not a hyphen.)
- [ ] **Step 4: Run, verify pass** — `npx vitest run test/ui/replay-conquest.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/state/replay.ts test/ui/replay-conquest.test.ts && git commit -m "feat(replay): tick credit feed on own upkeep, log the draw"`

---

## PHASE 2 — Upkeep UI surface

### Task 2.1: HUD net-income line + tappable credits row

**Files:**
- Modify: `src/ui/TopBar.tsx` (CreditsHud type, ~8–12)
- Modify: `src/ui/HudCluster.tsx`
- Modify: `src/App.tsx` (creditsHud assembly ~1087–1100; pass an open-dashboard callback)
- Test: `test/ui/hud-displays.test.tsx`

**Interfaces:**
- Produces: `CreditsHud = { value: number; committed?: number; income?: number; upkeep?: number; net?: number }`.
- `HudCluster` gains prop `onOpenBuild?: () => void`.

- [ ] **Step 1: Write the failing test** — in `test/ui/hud-displays.test.tsx`, render `HudCluster` with `credits={{ value: 250, income: 100, upkeep: 31, net: 69 }}` and assert the net line shows `+69/turn` (and that income 100 / upkeep 31 are present, using U+2212 for the minus). Add a case: clicking the credits row calls `onOpenBuild`.
- [ ] **Step 2: Run, verify fail** — `npx vitest run test/ui/hud-displays.test.tsx` → FAIL.
- [ ] **Step 3a: Extend the type** in `src/ui/TopBar.tsx`:
```ts
export type CreditsHud = {
  value: number;
  committed?: number;
  income?: number;
  /** Conquest planning: per-turn upkeep and net (income − upkeep). */
  upkeep?: number;
  net?: number;
};
```
- [ ] **Step 3b: Update `HudCluster`** — make the credits row a button when `onOpenBuild` is given, and show the net line in planning. Replace the income/committed conditional (lines 46–52) with:
```tsx
          {credits.net !== undefined ? (
            <span
              className="credits-net"
              aria-label={`net ${credits.net} per turn (income ${credits.income ?? 0}, upkeep ${credits.upkeep ?? 0})`}
            >
              {credits.net >= 0 ? '+' : '−'}{Math.abs(credits.net)}/turn
              <span className="credits-net-detail"> (+{credits.income ?? 0} −{credits.upkeep ?? 0})</span>
            </span>
          ) : credits.income ? (
            <span className="credits-income" aria-label={`plus ${credits.income} per turn`}>
              +{credits.income}/turn
            </span>
          ) : credits.committed ? (
            <span className="credits-committed"> − {credits.committed} committed</span>
          ) : null}
```
And wrap the credits row so a tap opens the dashboard. Change the `<div className="credits-hud" …>` to:
```tsx
        <div
          className="credits-hud"
          data-testid="credits-hud"
          role={onOpenBuild ? 'button' : undefined}
          tabIndex={onOpenBuild ? 0 : undefined}
          onClick={onOpenBuild}
          aria-label={onOpenBuild ? 'open build dashboard' : undefined}
        >
```
Add `onOpenBuild` to the destructured props and signature:
```tsx
export function HudCluster({ round, credits, onOpenBuild }: {
  round: number;
  credits?: CreditsHud | null;
  onOpenBuild?: () => void;
}) {
```
- [ ] **Step 3c: Feed upkeep/net from `App.tsx`.** Add the import:
```ts
import { factionUpkeep, upkeepRateOf } from './core/economy';
```
In the creditsHud assembly (~1087–1100), compute upkeep + net for the planning branch:
```ts
  const income = conquest ? ownedBaseCount(PLAYER_FACTION) * perBaseCredits : 0;
  const upkeep = conquest && game?.units
    ? factionUpkeep(Object.values(game.units), PLAYER_FACTION, types, upkeepRateOf(board))
    : 0;
  const net = income - upkeep;

  const creditsHud: CreditsHud | null = conquest
    ? frame
      ? { value: frame.credits ?? game.credits?.[PLAYER_FACTION] ?? 0 }
      : { value: game.credits?.[PLAYER_FACTION] ?? 0, committed, income, upkeep, net }
    : null;
```
And pass the callback at the `<HudCluster …>` render (~1260): `onOpenBuild={() => openBuildDashboard(null)}` (the function arrives in Phase 5; until then wire it to the existing `openBuildSheet`-style opener or a no-op stub — final wiring is Task 5.2, so a temporary `() => openBuildSheet(firstOwnedBaseOrUndefined)` is acceptable here, but prefer landing 2.1 and 5.2 together if executing inline).
- [ ] **Step 3d: Style** — add to `src/ui/styles.css` near `.credits-income`:
```css
.credits-hud[role='button'] { cursor: pointer; }
.credits-net { font-size: 0.72rem; font-variant-numeric: tabular-nums; }
.credits-net-detail { opacity: 0.7; }
```
- [ ] **Step 4: Run, verify pass** — `npx vitest run test/ui/hud-displays.test.tsx` → PASS.
- [ ] **Step 5: Commit** — `git add src/ui/TopBar.tsx src/ui/HudCluster.tsx src/App.tsx src/ui/styles.css test/ui/hud-displays.test.tsx && git commit -m "feat(ui): HUD net-income line (income − upkeep) + tappable credits row"`

---

### Task 2.2: RulesModal — Upkeep section + round-summary line

**Files:**
- Modify: `src/ui/RulesModal.tsx` (round-summary ~291; new section after Credits ~456)
- Test: `test/ui/rules-modal.test.tsx`

- [ ] **Step 1: Write the failing test** — in `test/ui/rules-modal.test.tsx`, assert (a) a section titled `Upkeep` renders, (b) its copy contains the phrase "round end" and is hyphen free (reuse the file's existing hyphen-free assertion helper over the new text), (c) the round-summary item reads `Income · Upkeep · Spawns`.
- [ ] **Step 2: Run, verify fail** — `npx vitest run test/ui/rules-modal.test.tsx` → FAIL.
- [ ] **Step 3a: Round-summary line.** Replace the `<b>Income · Spawns</b> …` `<li>` (291–293) with:
```tsx
              <li>
                <b>Income · Upkeep · Spawns</b> (Conquest only) — each owned base pays
                credits, then each unit draws upkeep, then queued recruits appear.
              </li>
```
- [ ] **Step 3b: New section** — insert directly after the `Credits` `</Section>` (456) and before `Production`:
```tsx
          <Section title="Upkeep">
            <p>
              Each unit draws pay at round end: a hundredth of its build cost per
              soldier still standing, so a full squad costs a tenth of its price and a
              thinned squad costs less. Upkeep follows income and never drives your
              credits below zero. While your army outpaces your income there is nothing
              left to recruit. Forces grow only as far as the ground that feeds them.
            </p>
          </Section>
```
(Confirm the copy contains no `-` hyphen; "round end" is two words.)
- [ ] **Step 4: Run, verify pass** — `npx vitest run test/ui/rules-modal.test.tsx` → PASS.
- [ ] **Step 5: Commit** — `git add src/ui/RulesModal.tsx test/ui/rules-modal.test.tsx && git commit -m "docs(ui): rules modal Upkeep section + Income · Upkeep · Spawns line"`

---

## PHASE 3 — Extractions (behavior-preserving refactors)

### Task 3.1: Extract `projectBoard` to `src/ui/skin/board-projection.ts`

**Files:**
- Create: `src/ui/skin/board-projection.ts`
- Modify: `src/ui/RulesModal.tsx` (replace local `projectCells`, ~54–84)
- Test: `test/ui/board-projection.test.ts`

**Interfaces:**
- Produces: `projectBoard(board: Board, viewW?: number, viewH?: number, pad?: number): { pts: Map<CellId, [number, number][]>; toSvg: (p: Vec2) => [number, number] }` (defaults `240, 200, 6` to match RulesModal exactly).

- [ ] **Step 1: Write the failing test** — `test/ui/board-projection.test.ts`: generate a small board (`generateUniformBoard(42, 40)` from `../../src/board`), call `projectBoard(board)`, assert every cell id has a polygon in `pts`, and every projected point lies within `[0, 240] × [0, 200]` (inside the padded viewBox).
- [ ] **Step 2: Run, verify fail** → FAIL (module not found).
- [ ] **Step 3a: Implement** `src/ui/skin/board-projection.ts` — copy the body of the current `projectCells` (lines 58–81), generalized over a passed-in `board` and viewBox:
```ts
// board-projection.ts — project a Board's cell polygons into an SVG viewBox.
// Pure given its inputs. Extracted from RulesModal so the rules figure and the
// build-dashboard mini-map share one projection.
import type { Board, CellId, Vec2 } from '../../board/types';

export function projectBoard(
  board: Board,
  viewW = 240,
  viewH = 200,
  pad = 6,
): { pts: Map<CellId, [number, number][]>; toSvg: (p: Vec2) => [number, number] } {
  const cells = [...board.cells.values()];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cells) {
    for (const [x, y] of c.polygon) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const W = viewW - pad * 2, H = viewH - pad * 2;
  const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
  const s = Math.min(W / spanX, H / spanY);
  const offX = pad + (W - spanX * s) / 2;
  const offY = pad + (H - spanY * s) / 2;
  const toSvg = (p: Vec2): [number, number] => [offX + (p[0] - minX) * s, offY + (maxY - p[1]) * s];
  const pts = new Map<CellId, [number, number][]>();
  for (const c of cells) pts.set(c.id, c.polygon.map(toSvg));
  return { pts, toSvg };
}
```
- [ ] **Step 3b: Switch RulesModal** — remove the local `projectCells` (54–82) and replace line 84 with:
```ts
import { projectBoard } from './skin/board-projection';
// ...
const { pts: EXAMPLE_POLYS, toSvg: exampleToSvg } = projectBoard(exampleBoard);
```
- [ ] **Step 4: Run** — `npx vitest run test/ui/board-projection.test.ts test/ui/rules-modal.test.tsx` → both PASS (RulesModal unchanged behavior).
- [ ] **Step 5: Commit** — `git add src/ui/skin/board-projection.ts src/ui/RulesModal.tsx test/ui/board-projection.test.ts && git commit -m "refactor(ui): extract projectBoard for reuse by the build mini-map"`

---

### Task 3.2: Extract `<UnitPicker>` from BuildSheet

**Files:**
- Create: `src/ui/UnitPicker.tsx`
- Test: `test/ui/unit-picker.test.tsx`

**Interfaces:**
- Produces:
```ts
export function UnitPicker(props: {
  unitTypes: Readonly<Record<string, UnitType>>;
  available: number;            // credits − committedElsewhere
  queuedKey?: string;           // currently queued unit type on this base
  onPick: (unitTypeKey: string) => void;  // queue (or, if already queued, caller may treat as remove)
  onRemove?: () => void;
}): JSX.Element
```
Renders the `.build-grid` (roster sorted cost asc, ties by initiative desc), affordability gating identical to BuildSheet, the demoted `.build-stat-row` for the focused unit, and an optional remove action. **No anchor/positioning** — it is a plain block the dashboard lays out.

- [ ] **Step 1: Write the failing test** — `test/ui/unit-picker.test.tsx`: render with `available=200`; assert cells with `cost > 200` are `disabled`; clicking an affordable cell calls `onPick(key)`; the focused stat row updates on pointer enter.
- [ ] **Step 2: Run, verify fail** → FAIL.
- [ ] **Step 3: Implement** `src/ui/UnitPicker.tsx` by lifting BuildSheet's roster/`available`/focus logic and the `.build-grid` + `.build-stat-row` JSX (BuildSheet.tsx 91–171), dropping the card chrome, anchor, and scrim. Keep `cellUnit`, `fmtRange`, the `roster` sort, and the `focusKey` state. Signature per the interface above.
- [ ] **Step 4: Run, verify pass** → `npx vitest run test/ui/unit-picker.test.tsx` PASS.
- [ ] **Step 5: Commit** — `git add src/ui/UnitPicker.tsx test/ui/unit-picker.test.tsx && git commit -m "refactor(ui): extract UnitPicker (roster grid + affordability) from BuildSheet"`

---

## PHASE 4 — BUILD dashboard modal

### Task 4.1: `BuildDashboard` component

**Files:**
- Create: `src/ui/BuildDashboard.tsx`
- Modify: `src/ui/styles.css` (`.build-dashboard*`)
- Test: `test/ui/build-dashboard.test.tsx`

**Interfaces:**
- Consumes: `projectBoard`, `UnitPicker`, `factionUpkeep`/`unitUpkeep`/`upkeepRateOf` (for the per-row + roster numbers), `UnitRenderer`, `palette` tints, `validateBuy`-equivalent affordability (compute `available` exactly as BuildSheet did: `credits − committedElsewhere`).
- Produces:
```ts
export function BuildDashboard(props: {
  board: Board;
  bases: Readonly<Record<CellId, FactionId | null>>;
  units: Readonly<Record<string, UnitInstance>>;
  unitTypes: Readonly<Record<string, UnitType>>;
  credits: number;
  income: number;          // bases × perBase
  upkeepRate: number;
  buys: BuyQueues;
  focusBase?: CellId | null;
  onQueue: (baseCell: CellId, unitTypeKey: string) => void;
  onRemove: (baseCell: CellId) => void;
  onClose: () => void;
}): JSX.Element
```

**Layout (full-screen scrollable, `.sheet-scrim` + `.build-dashboard` modeled on RulesModal):**
- Header: title "Build" + `◈ {credits}` + close `✕` (`.sheet-close`).
- **A · Economy summary** (`data-testid="econ-summary"`): `◈ credits` · `income/turn` · `upkeep/turn` (`factionUpkeep(units, PLAYER_FACTION, unitTypes, upkeepRate)`) · **net** (`income − upkeep`, U+2212) · committed (`Σ cost of buys`) · credits-after-commit. Tabular-nums.
- **B · Mini-map** (`data-testid="build-minimap"`): an SVG `viewBox="0 0 240 200"` using `projectBoard(board)`. Draw every cell faint; overlay each base polygon tinted by ownership — `palette.factionColor(owner)` blended via `mix` for owned, neutral grey for `null`. Badge bases with a queued buy; mark occupied bases. `onClick` on a base scrolls its row into view (`ref` per row + `scrollIntoView`).
- **C · Per-base production list** (`data-testid="base-list"`): one `<section data-base-row={cell}>` per **player-owned** base, ascending by cell. Each row: label `Base {cell}`, occupancy (`vacant` / occupant unit token + name / `occupied — won't spawn` when a unit stands on it), the queued buy (unit + `◈ cost`) with a change/cancel affordance, and a build action that reveals `<UnitPicker available={credits − committedElsewhere(cell)} queuedKey={buys[cell]?.unitTypeKey} onPick={(k)=>onQueue(cell,k)} onRemove={()=>onRemove(cell)} />`. `committedElsewhere(cell) = Σ buys cost − (buys[cell] cost)`.
- **D · Army roster** (`data-testid="army-roster"`): counts by unit type across `units` for `PLAYER_FACTION`, each with its `unitUpkeep` contribution; total upkeep footer.

**Occupancy rule (matches resolver):** a base is "occupied" iff any living unit (`count > 0`) stands on its cell. Occupied bases show the warning and the picker's buys remain queue-able (resolver fails the spawn with refund) — but surface the warning so the player knows it won't spawn while occupied.

- [ ] **Step 1: Write failing tests** — `test/ui/build-dashboard.test.tsx`:
  - renders an economy summary whose net equals `income − factionUpkeep(...)`;
  - lists one row per owned base, ascending;
  - flags an occupied base with the "won't spawn" warning;
  - picking a unit in a row's picker calls `onQueue(baseCell, key)`; cancel calls `onRemove(baseCell)`;
  - the mini-map renders a `[data-base]` node per base with the owner's tint;
  - `focusBase` scrolls/marks that row (assert the row has a `data-focused="true"`).
- [ ] **Step 2: Run, verify fail** → FAIL.
- [ ] **Step 3: Implement** `src/ui/BuildDashboard.tsx` + the `.build-dashboard`, `.build-dash-econ`, `.build-dash-row`, `.build-minimap`, `.build-roster` CSS (model spacing/border-radius on `.rules-modal` / `.bottom-sheet`; reuse `.sheet-scrim`, `.sheet-close`, `.build-grid`). Use `PLAYER_FACTION` from `state/store`.
- [ ] **Step 4: Run, verify pass** → `npx vitest run test/ui/build-dashboard.test.tsx` PASS.
- [ ] **Step 5: Commit** — `git add src/ui/BuildDashboard.tsx src/ui/styles.css test/ui/build-dashboard.test.tsx && git commit -m "feat(ui): BUILD economy dashboard modal (summary, mini-map, per-base, roster)"`

---

## PHASE 5 — Entry rewiring + retire BuildSheet

### Task 5.1: Relabel the build pip `+ → B`

**Files:**
- Modify: `src/ui/skin/EffectRenderer.tsx` (BuildPips, the plus `<g>` 390–400)
- Test: `test/ui/build-pip-tileinfo.test.tsx` (adjust any assertion on the plus)

- [ ] **Step 1: Update the test** — if `build-pip-tileinfo.test.tsx` asserts the plus marker, change it to expect the `B` glyph (keep the `data-build-pip` and `aria-label="build at base N"` assertions). The queued state (check mark) is unchanged.
- [ ] **Step 2: Implement** — replace the plus `<g>…two lines…</g>` (390–400) with a centered `B`:
```tsx
              ) : (
                // "B" — open the build dashboard for this base
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={r * 1.15}
                  fontWeight={700}
                  fill={stroke}
                  pointerEvents="none"
                >
                  B
                </text>
              )}
```
- [ ] **Step 3: Run** — `npx vitest run test/ui/build-pip-tileinfo.test.tsx test/ui/effects.test.tsx` → PASS.
- [ ] **Step 4: Commit** — `git add src/ui/skin/EffectRenderer.tsx test/ui/build-pip-tileinfo.test.tsx && git commit -m "feat(ui): relabel base build pip + → B (routes to dashboard)"`

---

### Task 5.2: Route all entry points to the dashboard; retire BuildSheet

**Files:**
- Modify: `src/App.tsx` (sheet state, `openBuildSheet`→`openBuildDashboard`, `onCellTap` base branches, ghost/dock taps, HudCluster callback, BuildSheet→BuildDashboard render)
- Delete: `src/ui/BuildSheet.tsx`
- Test: migrate `test/ui/build-sheet.test.tsx` → assertions covered by `build-dashboard.test.tsx`; delete the obsolete file or repoint it.

- [ ] **Step 1: Sheet state + opener.** Change the build sheet variant to carry an optional focus base instead of an anchor:
  - Where `setSheet({ kind: 'build', baseCell, anchor })` types are defined, change to `{ kind: 'build'; focusBase: CellId | null }`.
  - Replace `openBuildSheet` (733–735):
```ts
  function openBuildDashboard(focusBase: CellId | null = null) {
    setSheet({ kind: 'build', focusBase });
  }
```
- [ ] **Step 2: Cell taps revert to info.** In `onCellTap`, both base branches that currently call `setSheet({ kind: 'build', baseCell: cellId })` (845–846 and 892–896) change to `openInfo(cellId)` (the InfoSheet already shows base status). Do **not** open build from a raw cell tap.
- [ ] **Step 3: Re-point pip / ghost / dock.** `onBuyGhostTap` (1234), `onBuildTap` (1236), `onBuyChipTap` (1311) → `(baseCell) => openBuildDashboard(baseCell)`.
- [ ] **Step 4: HUD callback.** `<HudCluster … onOpenBuild={() => openBuildDashboard(null)} />` (1260).
- [ ] **Step 5: Render the dashboard.** Replace the `<BuildSheet … />` block (1350–1366) with:
```tsx
        <BuildDashboard
          board={board}
          bases={game.bases ?? {}}
          units={game.units}
          unitTypes={types}
          credits={game.credits?.[PLAYER_FACTION] ?? 0}
          income={income}
          upkeepRate={upkeepRateOf(board)}
          buys={buys}
          focusBase={sheet.focusBase}
          onQueue={(baseCell, unitTypeKey) => tryQueueBuy({ kind: 'buy', baseCell, unitTypeKey })}
          onRemove={(baseCell) => removeBuyOrder(baseCell)}
          onClose={() => setSheet(null)}
        />
```
Update the import: remove `BuildSheet`, add `import { BuildDashboard } from './ui/BuildDashboard';`.
- [ ] **Step 6: Delete** `src/ui/BuildSheet.tsx`. Grep for stragglers: `grep -rn "BuildSheet\|anchorCardStyle" src test` → none remain (move `anchorCardStyle` tests, if any, are dropped with the card).
- [ ] **Step 7: Migrate tests.** Fold any unique `build-sheet.test.tsx` assertions into `build-dashboard.test.tsx`; delete `test/ui/build-sheet.test.tsx`.
- [ ] **Step 8: Run** — `npx vitest run test/ui` → PASS.
- [ ] **Step 9: Commit** — `git add -A && git commit -m "feat(ui): route HUD + B pip + ghost/dock to BuildDashboard; retire BuildSheet"`

---

## PHASE 6 — Verification & adversarial review

- [ ] **Step 1: Full suite** — `npm test` (purity + vitest) → all green. No skirmish test changed.
- [ ] **Step 2: Build** — `npm run build` → clean (tsc + vite).
- [ ] **Step 3: Manual / dev** — load `http://localhost:5173/`, start a Conquest battle: confirm the HUD net line, the B pip opens the dashboard, the dashboard shows summary/mini-map/per-base/roster, a buy queues + appears as a ghost, the rules modal Upkeep section reads correctly, a round resolves with the upkeep tick in the replay/log.
- [ ] **Step 4: Adversarial review** — run a review pass (paranoid-review / code-review) over the full diff: focus on (a) skirmish bit-identity, (b) clamp-at-zero never negative, (c) new-unit-exempt ordering, (d) replay credit-feed parity, (e) dashboard affordability matching `validateBuy`, (f) no orphan BuildSheet refs, (g) hyphen-free rules copy. Fix findings; re-run `npm test`.
- [ ] **Step 5: Bust + final commit** — `node scripts/bust.mjs` (build token), commit.

---

## Self-Review (plan vs spec)

- **Spec §1 (formula/config):** Task 1.1 (`unitUpkeep`, `upkeepRateOf`, `upkeepRate` field). ✓
- **§2 (Phase E ordering, clamp, new-unit-exempt):** Task 1.3. ✓
- **§3 (upkeep event, blind):** Task 1.2 (type) + 1.3 (emit) + 1.4 (replay own-only feed = blindness). ✓
- **§4 (no win interaction):** clamp-at-zero never removes units — Task 1.3 asserts non-negative; no resolver win change. ✓
- **§5 (HUD net + build-sheet projection + rules modal):** Tasks 2.1 (HUD), 4.1 (dashboard summary projection), 2.2 (rules). ✓
- **§6 (AI):** out of scope this pass (no E4 net-reserve here) — flagged; the AI greedy planner already runs, upkeep only reduces its credits via the resolver, so it cannot overspend its *current* credits (validateBuy still gates). Note for a follow-up: AI does not yet reserve for upkeep. ✓ (documented gap)
- **§7 (affordability sanity):** covered by the resolver tests + manual Step 3. ✓
- **§11.1 (entry points):** Tasks 5.1 (B pip), 5.2 (HUD widget + ghost/dock + cell-tap revert). ✓
- **§11.2 (modal sections A–D):** Task 4.1. ✓
- **§11.3 (no core/order change):** dashboard reuses `tryQueueBuy`/`removeBuyOrder`; one-buy-per-base preserved. ✓
- **§11.4 (reuse/refactor):** Tasks 3.1 (projectBoard), 3.2 (UnitPicker). ✓
- **§11.5 (tests):** Task 4.1 tests + 5.x migration. ✓

**Documented scope note:** Spec §6 (AI net-income reserve) is intentionally deferred — the existing planner cannot overspend current credits (validateBuy gate), so this pass is safe without it; a follow-up should teach the greedy planner to reserve for upkeep.
