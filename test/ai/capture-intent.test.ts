// §B.7 — explicit unit test for the planner's capture-order emission.
//
// The implementation is in src/ai/planner-greedy.ts (~line 1231-1239):
// when in conquest mode, a personnel unit whose round ends on a capturable
// base (not owned by the AI faction) emits { kind: 'capture', unitId }.
//
// These tests assert that directly rather than relying on the indirect
// outcome-based acceptance suite.

import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng';
import type { GameState, UnitInstance } from '../../src/core/types';
import type { Board, CellId } from '../../src/board/types';
import { loadUnits } from '../../src/io/data-loader';
import { buildFactionView } from '../../src/ai/view';
import { planRound } from '../../src/ai/planner';
import { greedyPlanner, createGreedyPlanner } from '../../src/ai/planner-greedy';
import { lineBoard, makeUnit } from '../core/synthetic';

const types = loadUnits();

/** Build a minimal conquest GameState with `bases` populated. */
function makeConquestState(board: Board, units: UnitInstance[], bases: Record<CellId, 0 | 1 | null>): GameState {
  return {
    round: 1,
    phase: 'planning',
    board,
    units: Object.fromEntries(units.map((u) => [u.id, u])),
    pendingOrders: { 0: [], 1: [] },
    rngSeed: 1,
    log: [],
    mode: 'conquest',
    bases,
    credits: { 0: 200, 1: 200 },
    baseless: { 0: 0, 1: 0 },
    roundLimit: null,
  };
}

describe('planner capture-order emission (§B.7)', () => {
  // ── positive: personnel already standing on a capturable base ───────────────
  it('emits capture order for a personnel unit standing on a neutral base', () => {
    // Board: 4 plains cells in a line.
    // Cells: 0(faction-0 base) — 1(plains) — 2(neutral base) — 3(plains)
    // Unit: faction-0 ranger sitting on cell 2 (the neutral base).
    // No enemy units; the ranger stays put and should capture.
    const terrains = ['base', 'plains', 'base', 'plains'] as const;
    const board = lineBoard([...terrains]);
    const rgr = makeUnit('rgr-0', 0, 2, 'ranger');
    const state = makeConquestState(board, [rgr], { 0: 0, 2: null });
    const view = buildFactionView(board, state, 0, types);
    const plan = planRound(greedyPlanner, view, createRng(7));

    const captureOrders = plan.orders.filter((o) => o.kind === 'capture');
    expect(captureOrders.some((o) => o.kind === 'capture' && o.unitId === 'rgr-0')).toBe(true);
  });

  it('emits capture order for a personnel unit moving onto an enemy base', () => {
    // Board: 5 plains in a line.
    // Cells: 0(faction-0 base) — 1(plains) — 2(plains) — 3(enemy base) — 4(plains)
    // Unit: faction-0 infantry at cell 2 (movement 5 — can reach cell 3 in one step).
    // No enemies in sight; planner should route the infantry to cell 3 and capture.
    const terrains = ['base', 'plains', 'plains', 'base', 'plains'] as const;
    const board = lineBoard([...terrains]);
    const inf = makeUnit('inf-0', 0, 2, 'infantry');
    const state = makeConquestState(board, [inf], { 0: 0, 3: 1 });
    const view = buildFactionView(board, state, 0, types);
    const plan = planRound(greedyPlanner, view, createRng(7));

    const captureOrders = plan.orders.filter((o) => o.kind === 'capture');
    expect(captureOrders.some((o) => o.kind === 'capture' && o.unitId === 'inf-0')).toBe(true);
  });

  // ── negative: personnel on the AI's OWN base must NOT get a capture order ───
  it('does NOT emit capture order for a personnel unit standing on its own base', () => {
    // Board: 3 plains in a line.
    // Cells: 0(faction-0 base) — 1(plains) — 2(neutral base)
    // Units: faction-0 ranger sitting on cell 0 (their OWN base).
    // The ranger stays put (no reachable capturable base in 0 hops, and
    // the score to move toward cell 2 is capped by distance — but regardless
    // of where the unit ends up, if it lands on its own cell 0 it must NOT
    // emit capture). We add a second infantry at cell 2 to keep the ranger home.
    const terrains = ['base', 'plains', 'base'] as const;
    const board = lineBoard([...terrains]);
    // Faction-0 ranger on own base (cell 0); another faction-0 infantry
    // heading for the neutral base so the ranger has nowhere useful to go.
    const rgr = makeUnit('rgr-home', 0, 0, 'ranger');
    const inf = makeUnit('inf-cap', 0, 2, 'infantry'); // already on neutral base
    const state = makeConquestState(board, [rgr, inf], { 0: 0, 2: null });
    const view = buildFactionView(board, state, 0, types);
    const plan = planRound(greedyPlanner, view, createRng(7));

    // The ranger is on the AI's OWN base — no capture order for it.
    const rgrCapture = plan.orders.find((o) => o.kind === 'capture' && o.unitId === 'rgr-home');
    expect(rgrCapture).toBeUndefined();

    // Sanity: the infantry on the neutral base DOES get a capture order.
    const infCapture = plan.orders.some((o) => o.kind === 'capture' && o.unitId === 'inf-cap');
    expect(infCapture).toBe(true);
  });

  // ── brawl-charge-onto-a-base (§B.7 chargeOurEnd branch) ─────────────────────
  //
  // When a personnel unit CHARGES (moves into an enemy-occupied cell), the
  // planner only emits a capture order if the brawl sim says the unit
  // survives (chargeOurEnd > 0). Two tests cover each branch.

  it('charge survives (ourEnd > 0) → capture order IS emitted', () => {
    // Board: 2 plains/base cells in a line.
    // Cells: 0(faction-0 base / plains) — 1(enemy base)
    // AI unit:   faction-0 ranger, count=8, at cell 0.
    // Enemy:     faction-1 infantry, count=1, at cell 1 (enemy base).
    //
    // Brawl sim (both on base terrain, ranger initiative 11 > infantry initiative 8
    // so ranger strikes first each tick):
    //   tick 1: ranger A=7,Ta=0 vs infantry D=6,Td=2(base) → p=0.5+0.05*(7-6-2)=0.45 → eng=1 → dmg=1
    //           infantry A=6,Ta=0 vs ranger D=5,Td=2(base) → p=0.5+0.05*(6-5-2)=0.45 → eng=1 → dmg=1
    //           → ourEnd=7, theirEnd=0  (enemy destroyed, ranger survives, loss=1 ≤ CHARGE_MAX_LOSS=7)
    //
    // The conquest capture bonus (captureBonusEff ≈ 10 at round 1, pressure=0)
    // minus unit-loss cost gives a strongly positive score, so the default
    // weights choose the charge.
    const board = lineBoard(['plains', 'base']);
    const ai = makeUnit('rgr-8', 0, 0, 'ranger', 8);
    const enemy = makeUnit('inf-1', 1, 1, 'infantry', 1);
    const state = makeConquestState(board, [ai, enemy], { 0: 0, 1: 1 });
    const view = buildFactionView(board, state, 0, types);
    const plan = planRound(greedyPlanner, view, createRng(7));

    // The planner should MOVE to the enemy base (charge) …
    const moveToBase = plan.orders.some(
      (o) => o.kind === 'move' && o.unitId === 'rgr-8' && o.path[o.path.length - 1] === 1,
    );
    expect(moveToBase).toBe(true);
    // … and then emit a capture order because the unit survives the brawl.
    const capture = plan.orders.some((o) => o.kind === 'capture' && o.unitId === 'rgr-8');
    expect(capture).toBe(true);
  });

  it('charge dies (ourEnd === 0) → capture order is NOT emitted', () => {
    // Board: 2 cells in a line.
    // Cells: 0(plains) — 1(enemy base)
    // AI unit:   faction-0 ranger, count=5, at cell 0.
    // Enemy:     faction-1 ranger, count=5, at cell 1 (enemy base).
    //
    // Brawl sim (equal type, same initiative 11 → oursHigher=true, rangers strike first):
    //   tick 1: ranger A=7,Ta=0 vs ranger D=5,Td=2(base) → p=0.5+0.05*(7-5-2)=0.5 → eng=5 → dmg=3
    //           (mutual, same exchange) → a=2, b=2
    //   tick 2: eng=2 → dmg=1 each → a=1, b=1
    //   tick 3: eng=1 → dmg=1 each → a=0, b=0  → mutual annihilation
    //   ourEnd=0, theirEnd=0, loss=5 ≤ CHARGE_MAX_LOSS=7  (the charge passes the filter)
    //
    // With default weights the CHARGE_DEATH_PENALTY=5 and no capture bonus
    // (survives=false → cqBonusAt returns 0) make the dying charge less
    // attractive than a ranged attack from stay-put: the ranged attack deals
    // 3 counts from cell 0 (distance 1) with the counter offset by the sunk
    // auto-fire exposure, whereas the charge value at default weights is
    //   value = 1.0*5 + 0.6*menace − 5 − 5 ≈ −3.2
    // which loses to the attack score. We use damageDealt=5.0 so that the
    // kill credit dominates:
    //   chargeValue = 5.0*5 + 0.6*3 − 5 − 5 = 16.8  (> ranged-attack score)
    // This directly exercises the branch-suppression guard without calibrating
    // the real weights.
    const highDmgPlanner = createGreedyPlanner({ damageDealt: 5.0 });
    const board = lineBoard(['plains', 'base']);
    const ai = makeUnit('rgr-die', 0, 0, 'ranger', 5);
    const enemy = makeUnit('rgr-enemy', 1, 1, 'ranger', 5);
    // No own base: bases = {1:1} only (no cell-0 base — plain start).
    const state = makeConquestState(board, [ai, enemy], { 1: 1 });
    const view = buildFactionView(board, state, 0, types);
    const plan = planRound(highDmgPlanner, view, createRng(7));

    // The planner must have chosen the charge (move to cell 1, enemy's base)
    // for the test to exercise the branch. With damageDealt=5.0 the charge
    // value of 16.8 far exceeds the ranged-attack score of ~11, so the
    // planner moves into the enemy cell (no separate attack order is emitted
    // — a charge move replaces the attack).
    const moveToBase = plan.orders.some(
      (o) => o.kind === 'move' && o.unitId === 'rgr-die' && o.path[o.path.length - 1] === 1,
    );
    expect(moveToBase).toBe(true);
    // The unit dies (ourEnd=0), so NO capture order should be emitted.
    const capture = plan.orders.find((o) => o.kind === 'capture' && o.unitId === 'rgr-die');
    expect(capture).toBeUndefined();
  });
});
