// Dijkstra over the board graph — ported from v1 test/pathing.test.ts with
// hex strips swapped for synthetic boards and unit-occupancy rules expressed
// through the canStopAt / canPassThrough callbacks (the P4 resolver supplies
// the real policy). Costs are tenths from data/units.json (spec §6.2).

import { describe, expect, test } from 'vitest';
import {
  FRICTION_PER_ENEMY,
  IMPASSABLE,
  enemyFrictionAt,
  findPath,
  movementCostsFor,
  reachableCells,
} from '../../src/core/pathing';
import { loadUnits } from '../../src/io/data-loader';
import { lineBoard, syntheticBoard } from './synthetic';

const units = loadUnits();
const INF = movementCostsFor(units.infantry!);
const TNK = movementCostsFor(units.tank!);
const HUM = movementCostsFor(units.humvee!);

// 4 plains cells in a line: 0—1—2—3. Plains cost 3.
const STRIP = lineBoard(['plains', 'plains', 'plains', 'plains']);

describe('findPath — basics', () => {
  test('from === to returns empty path with cost 0', () => {
    expect(findPath(STRIP, INF, 0, 0)).toEqual({ path: [], totalCost: 0 });
  });

  test('one step on plains costs 3 (tenths)', () => {
    expect(findPath(STRIP, INF, 0, 1)).toEqual({ path: [1], totalCost: 3 });
  });

  test('infantry walks 3 plains cells (budget 9 tenths = 3 plains)', () => {
    const r = findPath(STRIP, INF, 0, 3, { budget: units.infantry!.movement });
    expect(r).toEqual({ path: [1, 2, 3], totalCost: 9 });
  });

  test('exceeding the movement budget returns null', () => {
    const long = lineBoard(['plains', 'plains', 'plains', 'plains', 'plains']);
    expect(findPath(long, INF, 0, 4, { budget: 9 })).toBeNull(); // cost 12 > 9
  });

  test('unknown cell ids return null', () => {
    expect(findPath(STRIP, INF, 0, 99)).toBeNull();
    expect(findPath(STRIP, INF, 99, 0)).toBeNull();
  });

  test('no budget option → cost-only search succeeds at any distance', () => {
    const long = lineBoard(Array(8).fill('plains'));
    expect(findPath(long, INF, 0, 7)?.totalCost).toBe(21);
  });
});

describe('findPath — terrain costs honored', () => {
  test('Dijkstra prefers the cheaper of two equal-hop routes', () => {
    // 0 → {1 woods (4) | 2 plains (3)} → 3.
    const m = syntheticBoard(
      [
        { center: [0, 0], terrain: 'plains' },
        { center: [1, 1], terrain: 'woods' },
        { center: [1, -1], terrain: 'plains' },
        { center: [2, 0], terrain: 'plains' },
      ],
      [
        [0, 1],
        [1, 3],
        [0, 2],
        [2, 3],
      ],
    );
    expect(findPath(m, INF, 0, 3)).toEqual({ path: [2, 3], totalCost: 6 });
  });

  test('detours around expensive terrain when cheaper overall', () => {
    // Direct: 0—1(swamp 6)—2(plains 3) = 9 for infantry... make it longer:
    // swamp 6 + 3 = 9 vs detour 0—3—4—2 = 3+3+3 = 9 ties; use mountains (6)?
    // Force a real win: two swamps direct (12) vs three plains detour (9).
    const m = syntheticBoard(
      [
        { center: [0, 0], terrain: 'plains' }, // 0
        { center: [1, 0], terrain: 'swamp' }, // 1
        { center: [2, 0], terrain: 'swamp' }, // 2
        { center: [3, 0], terrain: 'plains' }, // 3
        { center: [0.5, 1], terrain: 'plains' }, // 4
        { center: [1.5, 1], terrain: 'plains' }, // 5
        { center: [2.5, 1], terrain: 'plains' }, // 6
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [0, 4],
        [4, 5],
        [5, 6],
        [6, 3],
      ],
    );
    const r = findPath(m, INF, 0, 3);
    expect(r).toEqual({ path: [4, 5, 6, 3], totalCost: 12 });
  });
});

describe('findPath — impassable terrain (spec §6.2)', () => {
  test('tank cannot enter mountains', () => {
    const m = lineBoard(['plains', 'mountains']);
    expect(findPath(m, TNK, 0, 1)).toBeNull();
  });

  test('infantry CAN enter mountains (cost 6)', () => {
    const m = lineBoard(['plains', 'mountains']);
    expect(findPath(m, INF, 0, 1)).toEqual({ path: [1], totalCost: 6 });
  });

  test('water blocks everyone — no route across a 1-wide channel', () => {
    const m = lineBoard(['plains', 'water', 'plains']);
    expect(findPath(m, INF, 0, 2)).toBeNull();
    expect(findPath(m, TNK, 0, 2)).toBeNull();
  });

  test('IMPASSABLE threshold is 99', () => {
    expect(IMPASSABLE).toBe(99);
    expect(INF.water).toBeGreaterThanOrEqual(IMPASSABLE);
    expect(TNK.mountains).toBeGreaterThanOrEqual(IMPASSABLE);
  });
});

describe('findPath — occupancy callbacks (resolver policy, spec §2.5)', () => {
  // Friendly on cell 1: traversable, not a destination.
  const friendlyAt1 = { canStopAt: (c: number) => c !== 1 };
  // Enemy on cell 1: a valid destination (charge) but blocks traversal past.
  const enemyAt1 = { canPassThrough: (c: number) => c !== 1 };

  test('pass-through friendly is allowed', () => {
    expect(findPath(STRIP, INF, 0, 2, friendlyAt1)).toEqual({ path: [1, 2], totalCost: 6 });
  });

  test('cannot land on a friendly-occupied cell', () => {
    expect(findPath(STRIP, INF, 0, 1, friendlyAt1)).toBeNull();
  });

  test('CAN land on an enemy cell (charge → Phase A.5 brawl)', () => {
    expect(findPath(STRIP, INF, 0, 1, enemyAt1)).toEqual({ path: [1], totalCost: 3 });
  });

  test('cannot path PAST an enemy cell', () => {
    expect(findPath(STRIP, INF, 0, 2, enemyAt1)).toBeNull();
  });
});

describe('findPath — determinism', () => {
  test('identical inputs → identical results (repeat 3×)', () => {
    const m = syntheticBoard(
      [
        { center: [0, 0] },
        { center: [1, 1] },
        { center: [1, -1] },
        { center: [2, 0] },
      ],
      [
        [0, 1],
        [1, 3],
        [0, 2],
        [2, 3],
      ],
    );
    const first = findPath(m, INF, 0, 3);
    expect(findPath(m, INF, 0, 3)).toEqual(first);
    expect(findPath(m, INF, 0, 3)).toEqual(first);
    // Equal-cost tie (both routes plains): lowest-id route wins deterministically.
    expect(first).toEqual({ path: [1, 3], totalCost: 6 });
  });
});

describe('reachableCells', () => {
  test('budget in tenths: infantry (9) on a plains line reaches 3 cells', () => {
    const long = lineBoard(Array(6).fill('plains'));
    const r = reachableCells(long, INF, 0, 9);
    expect([...r.entries()]).toEqual([
      [1, 3],
      [2, 6],
      [3, 9],
    ]);
  });

  test('humvee (15) reaches 5 plains cells', () => {
    const long = lineBoard(Array(8).fill('plains'));
    const r = reachableCells(long, HUM, 0, units.humvee!.movement);
    expect(r.size).toBe(5);
    expect(r.get(5)).toBe(15);
  });

  test('excludes the origin cell', () => {
    const r = reachableCells(STRIP, INF, 0, 9);
    expect(r.has(0)).toBe(false);
  });

  test('terrain costs shrink reach: woods line, infantry reaches 2 cells (4+4=8 ≤ 9)', () => {
    const woods = lineBoard(['plains', 'woods', 'woods', 'woods']);
    const r = reachableCells(woods, INF, 0, 9);
    expect([...r.entries()]).toEqual([
      [1, 4],
      [2, 8],
    ]);
  });

  test('friendly cells are traversed but stripped from destinations', () => {
    const r = reachableCells(STRIP, INF, 0, 9, { canStopAt: (c) => c !== 1 });
    expect(r.has(1)).toBe(false);
    expect(r.get(2)).toBe(6); // reached THROUGH the friendly cell
  });

  test('enemy cells are destinations but block expansion past', () => {
    const r = reachableCells(STRIP, INF, 0, 9, { canPassThrough: (c) => c !== 1 });
    expect([...r.entries()]).toEqual([[1, 3]]); // charge in, nothing beyond
  });

  test('impassable cells never appear', () => {
    const m = lineBoard(['plains', 'water', 'plains']);
    const r = reachableCells(m, INF, 0, 99);
    expect(r.size).toBe(0);
  });

  test('deterministic: identical inputs → identical entry order', () => {
    const long = lineBoard(Array(6).fill('plains'));
    const a = [...reachableCells(long, INF, 0, 9).entries()];
    const b = [...reachableCells(long, INF, 0, 9).entries()];
    expect(a).toEqual(b);
  });
});

// ── v0.9 ENEMY FRICTION (movement friction near enemies) ──────────────────────

describe('enemyFrictionAt — counts adjacent enemies', () => {
  // A plus shape: cell 0 (center) adjacent to 1,2,3,4 (arms).
  //   1
  // 2 0 3
  //   4
  const plus = syntheticBoard(
    [
      { center: [0, 0] }, // 0 center
      { center: [0, 1] }, // 1 N
      { center: [-1, 0] }, // 2 W
      { center: [1, 0] }, // 3 E
      { center: [0, -1] }, // 4 S
    ],
    [
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
    ],
  );

  test('open terrain (no adjacent enemies) → 0', () => {
    expect(enemyFrictionAt(plus, 0, new Set())).toBe(0);
    expect(enemyFrictionAt(plus, 0, new Set([99]))).toBe(0); // unrelated cell
  });

  test('one adjacent enemy → FRICTION_PER_ENEMY', () => {
    expect(enemyFrictionAt(plus, 0, new Set([1]))).toBe(FRICTION_PER_ENEMY);
  });

  test('friction scales with the number of adjacent enemies', () => {
    expect(enemyFrictionAt(plus, 0, new Set([1, 3]))).toBe(2 * FRICTION_PER_ENEMY);
    expect(enemyFrictionAt(plus, 0, new Set([1, 2, 3, 4]))).toBe(4 * FRICTION_PER_ENEMY);
  });

  test('an enemy ON the cell (not adjacent) does not count', () => {
    // cell 0 is not a neighbor of itself.
    expect(enemyFrictionAt(plus, 0, new Set([0]))).toBe(0);
  });

  test('the default FRICTION_PER_ENEMY is the calibrated value (1 tenth)', () => {
    expect(FRICTION_PER_ENEMY).toBe(1);
  });
});

describe('findPath / reachableCells with extraCostAt (enemy friction)', () => {
  // 4 plains cells in a line: 0—1—2—3. Imagine an enemy adjacent to cell 2.
  const friction = (target: number) => (c: number) =>
    c === target ? FRICTION_PER_ENEMY : 0;

  test('extraCostAt omitted ⇒ behaviour is unchanged', () => {
    const r = reachableCells(STRIP, INF, 0, 9);
    expect([...r.entries()]).toEqual([
      [1, 3],
      [2, 6],
      [3, 9],
    ]);
  });

  test('entering a friction cell costs terrain + friction', () => {
    // step into cell 1 = plains 3 + friction 2 = 5.
    const r = findPath(STRIP, INF, 0, 1, { extraCostAt: friction(1) });
    expect(r).toEqual({ path: [1], totalCost: 3 + FRICTION_PER_ENEMY });
  });

  test('the STARTING cell never pays friction — only entered cells do', () => {
    // friction on cell 0 (the origin) must not be charged.
    const r = findPath(STRIP, INF, 0, 1, { extraCostAt: friction(0) });
    expect(r).toEqual({ path: [1], totalCost: 3 });
  });

  test('reachableCells SHRINKS near an enemy (one cell drops out of reach)', () => {
    // Budget 9. Plains-only reach is {1:3, 2:6, 3:9}. Put friction (+1) on cell
    // 1: now 1 costs 4, 2 costs 7, 3 costs 10 > 9 → cell 3 falls out of reach.
    const withFriction = reachableCells(STRIP, INF, 0, 9, { extraCostAt: friction(1) });
    expect([...withFriction.entries()]).toEqual([
      [1, 4],
      [2, 7],
    ]);
    // identical to baseline when extraCostAt is omitted.
    const baseline = reachableCells(STRIP, INF, 0, 9);
    expect([...baseline.keys()]).toContain(3);
  });

  test('friction can truncate a path that fits on open terrain', () => {
    // Open: 0→3 costs 9 (fits infantry). Friction on every entered cell adds
    // 1×3 = 3 → 12 > 9, so the full path is no longer reachable.
    const open = findPath(STRIP, INF, 0, 3, { budget: 9 });
    expect(open).toEqual({ path: [1, 2, 3], totalCost: 9 });
    const blocked = findPath(STRIP, INF, 0, 3, {
      budget: 9,
      extraCostAt: () => FRICTION_PER_ENEMY,
    });
    expect(blocked).toBeNull();
  });
});
