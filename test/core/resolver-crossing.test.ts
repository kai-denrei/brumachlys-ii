// Forced-crossing combat (addendum 2026-06-21). When two ENEMY movers' intended
// trails share a cell this turn — even at different moments (pass-by/swap) —
// both are HALTED on the interception cell and fight a to-the-death Phase A.5
// brawl there. Implemented as a movement pre-pass over intended paths that
// truncates both crossers to end on the shared cell; the existing Phase A walk
// then stops them there and the existing brawl resolves the clash.
//
// Covers: pass-by on a shared cell → halt + brawl; head-on swap; multi-way
// convergence; friendly overlap does NOT fight; precedence (a normal
// charge/surprise-contact still resolves where applicable); the fixpoint
// terminates deterministically; and the documented short-fall approximation
// (a crosser that can't reach the interception cell never arrives, so its
// partner halts alone with no brawl).

import { describe, expect, test } from 'vitest';
import { resolveRound } from '../../src/core/resolver';
import { weewar } from '../../src/core/combat/weewar';
import { loadUnits } from '../../src/io/data-loader';
import type { Order } from '../../src/core/orders';
import type { GameState, ResolutionEvent, UnitInstance } from '../../src/core/types';
import type { Board, CellId, Vec2 } from '../../src/board/types';
import { lineBoard, syntheticBoard, makeUnit } from './synthetic';

const types = loadUnits();

function makeState(board: Board, units: UnitInstance[], round = 1): GameState {
  return {
    round,
    phase: 'planning',
    board,
    units: Object.fromEntries(units.map((u) => [u.id, u])),
    pendingOrders: { 0: [], 1: [] },
    rngSeed: 7,
    log: [],
  };
}

function resolve(board: Board, state: GameState, o0: Order[] = [], o1: Order[] = []) {
  return resolveRound(board, state, { 0: o0, 1: o1 }, types, weewar);
}

const ofType = <T extends ResolutionEvent['type']>(events: ResolutionEvent[], type: T) =>
  events.filter((e): e is Extract<ResolutionEvent, { type: T }> => e.type === type);

const plainsLine = (n: number): Board => lineBoard(Array(n).fill('plains'));

// ── Pass-by crossing: two enemies whose paths share a cell at different moments ─

describe('crossing — pass-by (different-moment trail overlap)', () => {
  test('two enemies crossing a shared cell halt there and brawl to the death', () => {
    // Y-shaped board so two enemies' paths share the hub cell 2 without ever
    // being head-on. Cells: 0—1—2—3—4 lane, plus 5—2 and 2—6 branches.
    //   A (faction 0) at 0 plans 0→1→2→3 (passes hub 2)
    //   B (faction 1) at 5 plans 5→2→6     (passes hub 2)
    // Their trails share cell 2 → both must halt on 2 and brawl.
    const board = syntheticBoard(
      [
        { center: [0, 0] }, // 0
        { center: [1, 0] }, // 1
        { center: [2, 0] }, // 2 hub
        { center: [3, 0] }, // 3
        { center: [2, 1] }, // 4  (5 sits here, branches into hub)
        { center: [2, -1] }, // 5? placeholder
        { center: [3, 1] }, // 6
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [4, 2], // branch from 4 into the hub
        [2, 6], // hub out to 6
      ],
    );
    // A walks 0→1→2(→3); B (on cell 4) walks 4→2(→6). Shared cell: 2.
    const state = makeState(board, [makeUnit('A', 0, 0, 'infantry'), makeUnit('B', 1, 4, 'infantry')]);
    const { state: s, events } = resolve(
      board,
      state,
      [{ kind: 'move', unitId: 'A', path: [1, 2, 3] }],
      [{ kind: 'move', unitId: 'B', path: [2, 6] }],
    );

    // Both halt on the interception cell 2 (or die there).
    const pi = ofType(events, 'path-interrupted');
    expect(pi.map((e) => e.cell)).toEqual([2, 2]);
    expect(pi.map((e) => e.unitId).sort()).toEqual(['A', 'B']);
    // Each names the enemy it crossed.
    const byUnit = Object.fromEntries(pi.map((e) => [e.unitId, e.crossedWithId]));
    expect(byUnit['A']).toBe('B');
    expect(byUnit['B']).toBe('A');

    // A brawl ran at cell 2 to the death (1v1 infantry → mutual annihilation).
    const brawls = ofType(events, 'brawl-exchange').filter((b) => b.cell === 2);
    expect(brawls.length).toBeGreaterThan(0);
    // Neither glided past to its destination.
    expect(s.units['A']?.cell).not.toBe(3);
    expect(s.units['B']?.cell).not.toBe(6);
  });

  test('survivor stays on the interception cell (its move ended there)', () => {
    // A tank vs infantry: the tank wins the brawl and must REMAIN on the
    // crossing cell, not continue to its planned destination.
    const board = syntheticBoard(
      [
        { center: [0, 0] }, // 0 (A tank)
        { center: [1, 0] }, // 1
        { center: [2, 0] }, // 2 hub
        { center: [3, 0] }, // 3 (A's dest)
        { center: [2, 1] }, // 4 (B infantry)
        { center: [3, 1] }, // 5 (B's dest)
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [4, 2],
        [2, 5],
      ],
    );
    const state = makeState(board, [makeUnit('A', 0, 0, 'tank'), makeUnit('B', 1, 4, 'infantry', 1)]);
    const { state: s, events } = resolve(
      board,
      state,
      [{ kind: 'move', unitId: 'A', path: [1, 2, 3] }],
      [{ kind: 'move', unitId: 'B', path: [2, 5] }],
    );
    expect(ofType(events, 'path-interrupted').map((e) => e.cell)).toEqual([2, 2]);
    expect(ofType(events, 'kill').map((k) => k.unitId)).toContain('B');
    expect(s.units['A']!.cell).toBe(2); // survivor halts on the crossing cell
    expect(s.units['B']).toBeUndefined();
  });
});

// ── Head-on swap (the classic A↔B exchange) ───────────────────────────────────

describe('crossing — head-on swap', () => {
  test('A→B-origin and B→A-origin cross on the midpoint cell and brawl', () => {
    // Odd-length lane so the swap shares the exact middle cell. 0—1—2—3—4.
    //   A (faction 0) at 0 → 1,2,3,4
    //   B (faction 1) at 4 → 3,2,1,0
    // Shared cells {1,2,3}; the interception is the FIRST shared cell in the
    // higher-init unit's trail order.
    const board = plainsLine(5);
    // Use rangers (budget high enough to traverse), faction 0 = A, faction 1 = B.
    const state = makeState(board, [makeUnit('A', 0, 0, 'ranger'), makeUnit('B', 1, 4, 'ranger')]);
    const { state: s, events } = resolve(
      board,
      state,
      [{ kind: 'move', unitId: 'A', path: [1, 2, 3, 4] }],
      [{ kind: 'move', unitId: 'B', path: [3, 2, 1, 0] }],
    );
    const pi = ofType(events, 'path-interrupted');
    expect(pi).toHaveLength(2);
    // Both interrupted on the same cell.
    expect(pi[0]!.cell).toBe(pi[1]!.cell);
    // A brawl ran on that cell.
    const cell = pi[0]!.cell;
    expect(ofType(events, 'brawl-exchange').some((b) => b.cell === cell)).toBe(true);
    // No glide-through: neither reached its far destination.
    expect(s.units['A']?.cell).not.toBe(4);
    expect(s.units['B']?.cell).not.toBe(0);
  });
});

// ── Multi-way convergence ──────────────────────────────────────────────────────

describe('crossing — multi-way convergence', () => {
  test('three mixed-faction movers converging on one cell all halt and brawl', () => {
    // Star hub 0; leaves 1,2,3. Two faction-0 units and one faction-1 unit all
    // plan THROUGH the hub. Faction 1 crosses both faction-0 units → all halt on
    // the hub; the existing brawl resolves the both-factions cell. (Same-faction
    // surplus that cannot share the hub backs up one cell on its own trail.)
    const board = syntheticBoard(
      [
        { center: [0, 0] }, // 0 hub
        { center: [1, 0] }, // 1
        { center: [-1, 0] }, // 2
        { center: [0, 1] }, // 3
        { center: [2, 0] }, // 4 (1's far dest)
        { center: [-2, 0] }, // 5 (2's far dest)
        { center: [0, 2] }, // 6 (3's far dest)
      ],
      [
        [0, 1],
        [0, 2],
        [0, 3],
        [1, 4],
        [2, 5],
        [3, 6],
      ],
    );
    const state = makeState(board, [
      makeUnit('A', 0, 1, 'infantry'),
      makeUnit('C', 0, 2, 'infantry'),
      makeUnit('E', 1, 3, 'infantry'),
    ]);
    const { events } = resolve(
      board,
      state,
      [
        { kind: 'move', unitId: 'A', path: [0, 4] },
        { kind: 'move', unitId: 'C', path: [0, 5] },
      ],
      [{ kind: 'move', unitId: 'E', path: [0, 6] }],
    );
    // The enemy E is interrupted at the hub; at least one faction-0 unit too.
    const pi = ofType(events, 'path-interrupted');
    expect(pi.some((e) => e.unitId === 'E' && e.cell === 0)).toBe(true);
    // A both-factions brawl resolved at the hub.
    expect(ofType(events, 'brawl-exchange').some((b) => b.cell === 0)).toBe(true);
  });
});

// ── Friendly overlap never fights ─────────────────────────────────────────────

describe('crossing — friendly overlap does NOT fight', () => {
  test('two friendly movers whose trails overlap pass through (no interruption)', () => {
    // Both faction 0. A: 0→1→2→3, F: 3→2→1→0 — trails overlap on {1,2} but they
    // are the same faction, so NO crossing interception fires (vacancy/friendly
    // rules apply instead).
    const board = plainsLine(4);
    const state = makeState(board, [makeUnit('A', 0, 0, 'ranger'), makeUnit('F', 0, 3, 'ranger')]);
    const { events } = resolve(board, state, [
      { kind: 'move', unitId: 'A', path: [1, 2, 3] },
      { kind: 'move', unitId: 'F', path: [2, 1, 0] },
    ]);
    expect(ofType(events, 'path-interrupted')).toHaveLength(0);
    expect(ofType(events, 'brawl-exchange')).toHaveLength(0);
  });
});

// ── Precedence: existing surprise-contact / charge still resolve ──────────────

describe('crossing — precedence with existing contact rules', () => {
  test('a stationary enemy mid-path still triggers surprise-contact, not a crossing', () => {
    // B is STATIONARY (no move order). A walks toward it. The existing
    // surprise-contact rule must fire (stop one short), NOT a crossing (which is
    // only for two MOVING enemies).
    const board = plainsLine(5);
    const state = makeState(board, [makeUnit('A', 0, 0, 'ranger'), makeUnit('B', 1, 2, 'sniper')]);
    const { state: s, events } = resolve(
      board,
      state,
      [
        { kind: 'stance', unitId: 'A', stance: 'hold-fire' },
        { kind: 'move', unitId: 'A', path: [1, 2, 3] },
      ],
      [{ kind: 'stance', unitId: 'B', stance: 'hold-fire' }],
    );
    expect(ofType(events, 'path-interrupted')).toHaveLength(0);
    expect(ofType(events, 'path-truncated')).toEqual([
      { type: 'path-truncated', unitId: 'A', planned: 3, actual: 1, reason: 'enemy-contact' },
    ]);
    expect(s.units['A']!.cell).toBe(1);
  });
});

// ── Short-fall approximation: crosser can't reach → partner halts alone ───────

describe('crossing — short-fall approximation', () => {
  test('a crosser that cannot reach the interception cell never arrives; partner halts alone, no brawl', () => {
    // A (infantry, budget 9 = 3 plains) and B (infantry) on a long lane.
    //   A at 0 plans 0→1→2→3→4→5 (far)
    //   B at 8 plans 8→7→6→5→4 (toward A)
    // Their intended trails share several cells; the interception cell is the
    // first shared cell in the higher-init trail. Whichever is the LOW-init
    // crosser may be budget-truncated short of that cell — then it never arrives
    // and its partner halts on the (truncated) cell alone with no brawl.
    //
    // To make this deterministic and unambiguous we place the interception so
    // that ONE crosser physically cannot reach it within its movement budget:
    // a long single lane where A's budget runs out before the shared cell that
    // B reaches.
    const board = plainsLine(12);
    // Infantry budget 9 → 3 plains steps. A from 0 reaches at most cell 3.
    // B (ranger, budget 15 → 5 steps) from 11 reaches at most cell 6.
    // Intended trails: A [1..6], B [10,9,8,7,6,5]. Shared on intended paths
    // includes cell 6 etc. The higher-init unit picks the interception cell;
    // whichever crosser can't reach it stops short → no brawl.
    const state = makeState(board, [makeUnit('A', 0, 0, 'infantry'), makeUnit('B', 1, 11, 'ranger')]);
    const { state: s, events } = resolve(
      board,
      state,
      [{ kind: 'move', unitId: 'A', path: [1, 2, 3, 4, 5, 6] }],
      [{ kind: 'move', unitId: 'B', path: [10, 9, 8, 7, 6, 5] }],
    );
    // Detection still tags both as interrupted (it works on intended paths)...
    expect(ofType(events, 'path-interrupted').length).toBeGreaterThan(0);
    // ...but because at least one crosser falls short of the interception cell,
    // no brawl runs and both survive (the partner made a harmless wasted stop).
    expect(ofType(events, 'brawl-exchange')).toHaveLength(0);
    expect(s.units['A']).toBeDefined();
    expect(s.units['B']).toBeDefined();
    // They are NOT on the same cell.
    expect(s.units['A']!.cell).not.toBe(s.units['B']!.cell);
  });
});

// ── Determinism & fixpoint termination ────────────────────────────────────────

describe('crossing — determinism & fixpoint', () => {
  function busyCrossing(): { board: Board; units: UnitInstance[]; o0: Order[]; o1: Order[] } {
    // A web where several enemy trails overlap, forcing the fixpoint to iterate
    // (truncating one pair dissolves/creates another's reachability).
    const specs: { center: Vec2 }[] = [];
    for (let i = 0; i < 7; i++) specs.push({ center: [i, 0] });
    const edges: [CellId, CellId][] = [];
    for (let i = 0; i + 1 < 7; i++) edges.push([i, i + 1]);
    const board = syntheticBoard(specs, edges);
    const units = [
      makeUnit('A', 0, 0, 'ranger'),
      makeUnit('C', 0, 1, 'ranger'),
      makeUnit('B', 1, 6, 'ranger'),
      makeUnit('D', 1, 5, 'ranger'),
    ];
    const o0: Order[] = [
      { kind: 'move', unitId: 'A', path: [1, 2, 3, 4, 5] },
      { kind: 'move', unitId: 'C', path: [2, 3, 4] },
    ];
    const o1: Order[] = [
      { kind: 'move', unitId: 'B', path: [5, 4, 3, 2, 1] },
      { kind: 'move', unitId: 'D', path: [4, 3, 2] },
    ];
    return { board, units, o0, o1 };
  }

  test('same state + orders twice → identical JSON event logs', () => {
    const a = busyCrossing();
    const b = busyCrossing();
    const ra = resolve(a.board, makeState(a.board, a.units), a.o0, a.o1);
    const rb = resolve(b.board, makeState(b.board, b.units), b.o0, b.o1);
    expect(JSON.stringify(ra.events)).toBe(JSON.stringify(rb.events));
    expect(JSON.stringify(ra.state.units)).toBe(JSON.stringify(rb.state.units));
  });

  test('shuffled input order arrays → identical logs (fixpoint order-stable)', () => {
    const a = busyCrossing();
    const b = busyCrossing();
    const ra = resolve(a.board, makeState(a.board, a.units), a.o0, a.o1);
    const rb = resolve(
      b.board,
      makeState(b.board, b.units),
      [...b.o0].reverse(),
      [...b.o1].reverse(),
    );
    expect(JSON.stringify(ra.events)).toBe(JSON.stringify(rb.events));
  });

  test('the pre-pass terminates (no infinite loop) on a dense crossing web', () => {
    const a = busyCrossing();
    // Simply completing without timing out proves the fixpoint is bounded.
    const { events } = resolve(a.board, makeState(a.board, a.units), a.o0, a.o1);
    expect(ofType(events, 'path-interrupted').length).toBeGreaterThan(0);
  });
});
