// v1.1 Feature B — vacancy moves (move onto a tile being vacated).
// Resolver Phase A: a unit may END on a cell whose friendly occupant has a
// still-pending move elsewhere (vacancy promise). End-of-Phase-A invariant:
// max one same-faction unit per cell; broken promises bounce the incoming
// unit back along its own resolved path (reason 'vacancy-failed').
//
// Covers: basic vacancy entry, chains (A→B's cell while B→C's cell), swaps
// (A↔B), broken-promise bounce, bounce cascades with origin fallback,
// double-promise contention, loop-move (no vacancy), and determinism /
// shuffle-invariance of the whole behavior.

import { describe, expect, test } from 'vitest';
import { resolveRound } from '../../src/core/resolver';
import { weewar } from '../../src/core/combat/weewar';
import { loadUnits } from '../../src/io/data-loader';
import type { Order } from '../../src/core/orders';
import type { GameState, ResolutionEvent, UnitInstance } from '../../src/core/types';
import type { Board } from '../../src/board/types';
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

describe('vacancy promise — entry', () => {
  test('higher-init mover ENTERS the cell a lower-init friendly is vacating', () => {
    const board = plainsLine(4);
    // humvee (init 12) moves first, onto the infantry's (init 8) cell while
    // the infantry's own move to cell 2 is still pending — vacancy promise.
    const state = makeState(board, [makeUnit('h', 0, 0, 'humvee'), makeUnit('i', 0, 1, 'infantry')]);
    const { state: s, events } = resolve(board, state, [
      { kind: 'move', unitId: 'h', path: [1] },
      { kind: 'move', unitId: 'i', path: [2] },
    ]);
    expect(s.units['h']!.cell).toBe(1);
    expect(s.units['i']!.cell).toBe(2);
    expect(ofType(events, 'path-truncated')).toHaveLength(0);
    expect(ofType(events, 'move').map((m) => m.unitId)).toEqual(['h', 'i']);
  });

  test('no promise without a pending move: occupant ordered nothing → back up as before', () => {
    const board = plainsLine(4);
    const state = makeState(board, [makeUnit('h', 0, 0, 'humvee'), makeUnit('i', 0, 1, 'infantry')]);
    const { state: s, events } = resolve(board, state, [{ kind: 'move', unitId: 'h', path: [1] }]);
    expect(s.units['h']!.cell).toBe(0);
    expect(ofType(events, 'path-truncated')).toEqual([
      { type: 'path-truncated', unitId: 'h', planned: 1, actual: 0, reason: 'friendly-occupied' },
    ]);
  });

  test('loop move (path returning home) is NOT a vacancy — destination unchanged', () => {
    // The occupant's queued move ends on its own cell: dest === its cell, so
    // the incoming unit gets no promise and backs up.
    const board = syntheticBoard(
      [{ center: [0, 0] }, { center: [1, 0] }, { center: [1, 1] }, { center: [0, 1] }],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
      ],
    );
    const state = makeState(board, [makeUnit('h', 0, 0, 'humvee'), makeUnit('i', 0, 1, 'infantry')]);
    const { state: s, events } = resolve(board, state, [
      { kind: 'move', unitId: 'h', path: [1] },
      { kind: 'move', unitId: 'i', path: [2, 1] }, // loop: ends where it started
    ]);
    expect(s.units['h']!.cell).toBe(0);
    expect(
      ofType(events, 'path-truncated').filter((e) => e.unitId === 'h')[0],
    ).toMatchObject({ reason: 'friendly-occupied' });
  });

  test('truncated walks never gamble on a promise (stop cell friendly → back up)', () => {
    // a (infantry, budget 9 = 3 plains) is ordered 4 steps; budget truncation
    // stops it on cell 3 where a friendly with a pending move sits → backs up.
    const board = plainsLine(6);
    const state = makeState(board, [
      makeUnit('a', 0, 0, 'infantry'),
      makeUnit('f', 0, 3, 'infantry'),
    ]);
    const { state: s, events } = resolve(board, state, [
      { kind: 'move', unitId: 'a', path: [1, 2, 3, 4] },
      { kind: 'move', unitId: 'f', path: [4] },
    ]);
    // f's own move may or may not run first (FNV tie) — but a must never be
    // left standing on f's cell at the end of the phase.
    expect(s.units['a']!.cell).not.toBe(s.units['f']!.cell);
    expect(ofType(events, 'path-truncated').some((e) => e.unitId === 'a')).toBe(true);
  });
});

describe('vacancy promise — chains and swaps', () => {
  test('chain: A→B cell, B→C cell, C→onward — all three land', () => {
    const board = plainsLine(5);
    const state = makeState(board, [
      makeUnit('a', 0, 0, 'infantry'),
      makeUnit('b', 0, 1, 'infantry'),
      makeUnit('c', 0, 2, 'infantry'),
    ]);
    const { state: s, events } = resolve(board, state, [
      { kind: 'move', unitId: 'a', path: [1] },
      { kind: 'move', unitId: 'b', path: [2] },
      { kind: 'move', unitId: 'c', path: [3] },
    ]);
    expect(s.units['a']!.cell).toBe(1);
    expect(s.units['b']!.cell).toBe(2);
    expect(s.units['c']!.cell).toBe(3);
    expect(ofType(events, 'path-truncated')).toHaveLength(0);
  });

  test('swap: A↔B exchange cells', () => {
    const board = plainsLine(3);
    const state = makeState(board, [
      makeUnit('a', 0, 0, 'infantry'),
      makeUnit('b', 0, 1, 'infantry'),
    ]);
    const { state: s, events } = resolve(board, state, [
      { kind: 'move', unitId: 'a', path: [1] },
      { kind: 'move', unitId: 'b', path: [0] },
    ]);
    expect(s.units['a']!.cell).toBe(1);
    expect(s.units['b']!.cell).toBe(0);
    expect(ofType(events, 'path-truncated')).toHaveLength(0);
  });

  test('mixed-faction independence: AI faction sees no behavior change', () => {
    // Player chain on one side; AI unit moving normally on the other. The
    // settlement only groups SAME-faction units.
    const board = plainsLine(8);
    const state = makeState(board, [
      makeUnit('a', 0, 0, 'infantry'),
      makeUnit('b', 0, 1, 'infantry'),
      makeUnit('e', 1, 7, 'infantry'),
    ]);
    const { state: s } = resolve(
      board,
      state,
      [
        { kind: 'move', unitId: 'a', path: [1] },
        { kind: 'move', unitId: 'b', path: [2] },
      ],
      [{ kind: 'move', unitId: 'e', path: [6] }],
    );
    expect(s.units['a']!.cell).toBe(1);
    expect(s.units['b']!.cell).toBe(2);
    expect(s.units['e']!.cell).toBe(6);
  });
});

describe('broken promise — bounce', () => {
  // Line 0—1—2—3 with 3 = mountains: the tank's pending move [3] fails at
  // execution (impassable), so it STAYS — breaking the promise it gave.
  function brokenPromise() {
    const board = lineBoard(['plains', 'plains', 'plains', 'mountains']);
    const units = [makeUnit('a', 0, 0, 'infantry'), makeUnit('t', 0, 2, 'tank')];
    const o0: Order[] = [
      { kind: 'move', unitId: 'a', path: [1, 2] }, // onto the tank's cell
      { kind: 'move', unitId: 't', path: [3] }, // will fail: mountains
    ];
    return { board, units, o0 };
  }

  test('incoming unit bounces back along its own path to the first free cell', () => {
    const { board, units, o0 } = brokenPromise();
    const { state: s, events } = resolve(board, makeState(board, units), o0);
    expect(s.units['t']!.cell).toBe(2); // the occupant stayed (its move failed)
    expect(s.units['a']!.cell).toBe(1); // bounced back one cell

    // The bounce is an ordinary move event (walks back in the replay) plus a
    // 'vacancy-failed' truncation.
    const moves = ofType(events, 'move').filter((m) => m.unitId === 'a');
    expect(moves).toEqual([
      { type: 'move', unitId: 'a', from: 0, to: 2, pathTaken: [1, 2] },
      { type: 'move', unitId: 'a', from: 2, to: 1, pathTaken: [1] },
    ]);
    expect(ofType(events, 'path-truncated')).toEqual(
      expect.arrayContaining([
        { type: 'path-truncated', unitId: 'a', planned: 2, actual: 1, reason: 'vacancy-failed' },
        { type: 'path-truncated', unitId: 't', planned: 3, actual: 2, reason: 'invalid-step' },
      ]),
    );
  });

  test('bounce cascade: backfilled path forces origin fallback, displacing the backfiller', () => {
    // Board: line 0—1—2—3 plus leaf 4 on 0 and leaf 5 on 1. 3 = mountains.
    //   a: 0 → [1,2] (promised onto tank's cell; tank fails → bounce)
    //   d: 5 → [1]   (backfills a's path cell 1)
    //   e: 4 → [0]   (backfills a's origin)
    // a's bounce finds 1 occupied (d) and falls back to origin 0 even though
    // e is there → cascade: a keeps its origin, e bounces home to 4.
    const board = syntheticBoard(
      [
        { center: [0, 0] }, // 0
        { center: [1, 0] }, // 1
        { center: [2, 0] }, // 2
        { center: [3, 0], terrain: 'mountains' }, // 3
        { center: [0, 1] }, // 4
        { center: [1, 1] }, // 5
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [0, 4],
        [1, 5],
      ],
    );
    const units = [
      makeUnit('a', 0, 0, 'infantry'),
      makeUnit('t', 0, 2, 'tank'),
      makeUnit('d', 0, 5, 'infantry'),
      makeUnit('e', 0, 4, 'infantry'),
    ];
    const o0: Order[] = [
      { kind: 'move', unitId: 'a', path: [1, 2] },
      { kind: 'move', unitId: 't', path: [3] },
      { kind: 'move', unitId: 'd', path: [1] },
      { kind: 'move', unitId: 'e', path: [0] },
    ];
    const { state: s, events } = resolve(board, makeState(board, units), o0);
    expect(s.units['t']!.cell).toBe(2);
    expect(s.units['d']!.cell).toBe(1);
    expect(s.units['a']!.cell).toBe(0); // bounced all the way home
    expect(s.units['e']!.cell).toBe(4); // cascade: displaced back to its origin
    const vf = ofType(events, 'path-truncated').filter((e) => e.reason === 'vacancy-failed');
    expect(vf.map((e) => e.unitId).sort()).toEqual(['a', 'e']);
    // End-of-phase invariant: every unit on its own cell.
    const cells = Object.values(s.units).map((u) => u.cell);
    expect(new Set(cells).size).toBe(cells.length);
  });

  test('two units promised into the same vacating cell: exactly one gets it', () => {
    // Star: 1 is the hub; 0, 2, 9 are leaves. f vacates the hub; a and c both
    // try to take it. One enters, the other backs home (friendly-occupied).
    const board = syntheticBoard(
      [{ center: [0, 0] }, { center: [1, 0] }, { center: [2, 0] }, { center: [1, 1] }],
      [
        [0, 1],
        [1, 2],
        [1, 3],
      ],
    );
    const units = [
      makeUnit('a', 0, 0, 'infantry'),
      makeUnit('c', 0, 2, 'infantry'),
      makeUnit('f', 0, 1, 'infantry'),
    ];
    const o0: Order[] = [
      { kind: 'move', unitId: 'a', path: [1] },
      { kind: 'move', unitId: 'c', path: [1] },
      { kind: 'move', unitId: 'f', path: [3] },
    ];
    const { state: s, events } = resolve(board, makeState(board, units), o0);
    expect(s.units['f']!.cell).toBe(3);
    const winners = ['a', 'c'].filter((id) => s.units[id]!.cell === 1);
    expect(winners).toHaveLength(1);
    const loser = winners[0] === 'a' ? 'c' : 'a';
    expect(s.units[loser]!.cell).toBe(loser === 'a' ? 0 : 2); // stayed home
    expect(
      ofType(events, 'path-truncated').filter((e) => e.unitId === loser)[0],
    ).toMatchObject({ reason: 'friendly-occupied' });
    const cells = Object.values(s.units).map((u) => u.cell);
    expect(new Set(cells).size).toBe(cells.length);
  });
});

describe('vacancy — determinism & shuffle invariance', () => {
  function busyVacancy() {
    const board = syntheticBoard(
      [
        { center: [0, 0] }, // 0
        { center: [1, 0] }, // 1
        { center: [2, 0] }, // 2
        { center: [3, 0], terrain: 'mountains' }, // 3
        { center: [0, 1] }, // 4
        { center: [1, 1] }, // 5
        { center: [4, 0] }, // 6
        { center: [5, 0] }, // 7
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [0, 4],
        [1, 5],
        [3, 6],
        [6, 7],
      ],
    );
    const units = [
      makeUnit('a', 0, 0, 'infantry'),
      makeUnit('t', 0, 2, 'tank'),
      makeUnit('d', 0, 5, 'infantry'),
      makeUnit('e', 0, 4, 'infantry'),
      makeUnit('x', 1, 7, 'infantry'),
    ];
    const o0: Order[] = [
      { kind: 'move', unitId: 'a', path: [1, 2] },
      { kind: 'move', unitId: 't', path: [3] },
      { kind: 'move', unitId: 'd', path: [1] },
      { kind: 'move', unitId: 'e', path: [0] },
    ];
    const o1: Order[] = [{ kind: 'move', unitId: 'x', path: [6] }];
    return { board, units, o0, o1 };
  }

  test('same state + orders twice → identical JSON event logs', () => {
    const a = busyVacancy();
    const b = busyVacancy();
    const ra = resolve(a.board, makeState(a.board, a.units), a.o0, a.o1);
    const rb = resolve(b.board, makeState(b.board, b.units), b.o0, b.o1);
    expect(JSON.stringify(ra.events)).toBe(JSON.stringify(rb.events));
    expect(JSON.stringify(ra.state.units)).toBe(JSON.stringify(rb.state.units));
  });

  test('shuffled input order arrays → identical logs', () => {
    const a = busyVacancy();
    const b = busyVacancy();
    const ra = resolve(a.board, makeState(a.board, a.units), a.o0, a.o1);
    const rb = resolve(
      b.board,
      makeState(b.board, b.units),
      [...b.o0].reverse(),
      [...b.o1].reverse(),
    );
    expect(JSON.stringify(ra.events)).toBe(JSON.stringify(rb.events));
  });
});
