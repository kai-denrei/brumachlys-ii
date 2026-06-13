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
import { greedyPlanner } from '../../src/ai/planner-greedy';
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
});
