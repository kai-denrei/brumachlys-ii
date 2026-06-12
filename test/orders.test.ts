// validateOrder + order-queue logic (P7, spec §2.3/§2.4/§9.2-§9.3).
// Placement note: this is core coverage, but it lives at test/ root instead
// of test/core/ because the P4 resolver agent owned test/core/ concurrently
// with P7. Self-contained board builders for the same reason (no synthetic.ts
// import).

import { describe, expect, it } from 'vitest';
import type { Board, Cell, CellId, TerrainKey, Vec2 } from '../src/board/types';
import type { FactionId, UnitInstance, UnitType } from '../src/core/types';
import {
  findConvergences,
  flattenOrders,
  orderedUnitIds,
  plannedEndCell,
  queueOrder,
  removeOrder,
  validateOrder,
  type Order,
  type OrderContext,
  type OrderQueues,
  type UnitOrders,
} from '../src/core/orders';
import { loadUnits } from '../src/io/data-loader';

// --- fixtures -----------------------------------------------------------------

function board(specs: { center: Vec2; terrain?: TerrainKey }[], edges: [CellId, CellId][]): Board {
  const cells = new Map<CellId, Cell>();
  specs.forEach((spec, id) => {
    cells.set(id, {
      id,
      center: spec.center,
      polygon: [spec.center, spec.center, spec.center],
      neighbors: [],
      terrain: spec.terrain ?? 'plains',
    });
  });
  for (const [a, b] of edges) {
    cells.get(a)!.neighbors.push(b);
    cells.get(b)!.neighbors.push(a);
  }
  for (const c of cells.values()) c.neighbors.sort((x, y) => x - y);
  return { cells, seed: 0, donorMapId: 'p7-test' };
}

/** Line of n plains cells: 0—1—2—…—(n-1). */
function lineBoard(n: number, terrains: Partial<Record<number, TerrainKey>> = {}): Board {
  const specs = Array.from({ length: n }, (_, i) => ({
    center: [i, 0] as Vec2,
    terrain: terrains[i] ?? ('plains' as TerrainKey),
  }));
  const edges: [CellId, CellId][] = [];
  for (let i = 0; i + 1 < n; i++) edges.push([i, i + 1]);
  return board(specs, edges);
}

function unit(
  id: string,
  faction: FactionId,
  cell: CellId,
  type = 'infantry',
  over: Partial<UnitInstance> = {},
): UnitInstance {
  return { id, type, faction, cell, count: 10, stance: 'aggressive', attackedFrom: [], ...over };
}

const TYPES = loadUnits();

function ctx(
  b: Board,
  units: UnitInstance[],
  over: Partial<OrderContext> = {},
): OrderContext {
  return {
    board: b,
    units,
    unitTypes: TYPES,
    visible: new Set(b.cells.keys()), // default: everything visible
    ...over,
  };
}

const move = (unitId: string, path: CellId[]): Order => ({ kind: 'move', unitId, path });
const attack = (unitId: string, targetCell: CellId): Order => ({ kind: 'attack', unitId, targetCell });
const stance = (unitId: string, s: UnitInstance['stance']): Order => ({ kind: 'stance', unitId, stance: s });

function reasonOf(r: ReturnType<typeof validateOrder>): string | null {
  return r.ok ? null : r.reason;
}

// --- validateOrder: unit existence ----------------------------------------------

describe('validateOrder — unit lookup', () => {
  const b = lineBoard(3);

  it('rejects orders for unknown units', () => {
    expect(reasonOf(validateOrder(ctx(b, []), move('ghost', [1])))).toBe('unknown-unit');
  });

  it('rejects orders for dead units', () => {
    const u = unit('a', 0, 0, 'infantry', { count: 0 });
    expect(reasonOf(validateOrder(ctx(b, [u]), move('a', [1])))).toBe('dead-unit');
  });
});

// --- validateOrder: move (§2.3/§2.5 planning side) -------------------------------

describe('validateOrder — move', () => {
  it('accepts a legal in-budget path', () => {
    const b = lineBoard(5);
    const u = unit('a', 0, 0); // infantry: movement 9, plains cost 3 → 3 cells
    expect(validateOrder(ctx(b, [u]), move('a', [1, 2, 3])).ok).toBe(true);
  });

  it('rejects an empty path', () => {
    const b = lineBoard(3);
    const u = unit('a', 0, 0);
    expect(reasonOf(validateOrder(ctx(b, [u]), move('a', [])))).toBe('empty-path');
  });

  it('rejects non-adjacent steps and unknown cells', () => {
    const b = lineBoard(4);
    const u = unit('a', 0, 0);
    expect(reasonOf(validateOrder(ctx(b, [u]), move('a', [2])))).toBe('broken-path');
    expect(reasonOf(validateOrder(ctx(b, [u]), move('a', [99])))).toBe('broken-path');
  });

  it('rejects impassable terrain (water; mountains for vehicles)', () => {
    const b = lineBoard(3, { 1: 'water' });
    const u = unit('a', 0, 0);
    expect(reasonOf(validateOrder(ctx(b, [u]), move('a', [1])))).toBe('impassable');

    const m = lineBoard(3, { 1: 'mountains' });
    const tank = unit('t', 0, 0, 'tank');
    expect(reasonOf(validateOrder(ctx(m, [tank]), move('t', [1])))).toBe('impassable');
    // personnel may climb
    const inf = unit('i', 0, 0, 'infantry');
    expect(validateOrder(ctx(m, [inf]), move('i', [1])).ok).toBe(true);
  });

  it('rejects paths over the movement budget (terrain-cost weighted)', () => {
    // infantry movement 9; plains 3 ×4 steps = 12 > 9
    const b = lineBoard(6);
    const u = unit('a', 0, 0);
    expect(reasonOf(validateOrder(ctx(b, [u]), move('a', [1, 2, 3, 4])))).toBe('over-budget');
    // swamp 6 + swamp 6 = 12 > 9 even at 2 steps
    const s = lineBoard(4, { 1: 'swamp', 2: 'swamp' });
    expect(reasonOf(validateOrder(ctx(s, [u]), move('a', [1, 2])))).toBe('over-budget');
  });

  it('allows passing THROUGH a friendly but not ENDING on one (§2.5)', () => {
    const b = lineBoard(4);
    const a = unit('a', 0, 0);
    const friend = unit('f', 0, 1);
    expect(validateOrder(ctx(b, [a, friend]), move('a', [1, 2])).ok).toBe(true);
    expect(reasonOf(validateOrder(ctx(b, [a, friend]), move('a', [1])))).toBe('ends-on-friendly');
  });

  it('rejects a path THROUGH a visible enemy, allows it as a charge destination', () => {
    const b = lineBoard(4);
    const a = unit('a', 0, 0);
    const enemy = unit('e', 1, 1);
    expect(reasonOf(validateOrder(ctx(b, [a, enemy]), move('a', [1, 2])))).toBe('through-enemy');
    expect(validateOrder(ctx(b, [a, enemy]), move('a', [1])).ok).toBe(true); // charge
  });

  it('ignores units the faction cannot see (fog ignores only units)', () => {
    // Hidden enemy on cell 1: NOT in ctx.units (the caller filters), so the
    // path validates — the resolver handles the surprise contact (§2.5).
    const b = lineBoard(4);
    const a = unit('a', 0, 0);
    const visible = new Set<CellId>([0, 3]); // terrain still known everywhere
    expect(validateOrder(ctx(b, [a], { visible }), move('a', [1, 2])).ok).toBe(true);
  });
});

// --- validateOrder: vacancy moves (v1.1 Feature B, planning side) ----------------

describe('validateOrder — move onto a vacating friendly cell (v1.1)', () => {
  const b = lineBoard(4);
  const a = unit('a', 0, 0);
  const friend = unit('f', 0, 1);

  it('allows ending on a friendly cell when the occupant has a queued move elsewhere', () => {
    const allQueued: OrderQueues = {
      f: { move: { kind: 'move', unitId: 'f', path: [2] } },
    };
    expect(validateOrder(ctx(b, [a, friend], { allQueued }), move('a', [1])).ok).toBe(true);
  });

  it('still rejects when the occupant has NO queued move', () => {
    expect(reasonOf(validateOrder(ctx(b, [a, friend], { allQueued: {} }), move('a', [1])))).toBe(
      'ends-on-friendly',
    );
  });

  it("still rejects when the occupant's queued move loops back to its own cell", () => {
    const allQueued: OrderQueues = {
      f: { move: { kind: 'move', unitId: 'f', path: [2, 1] } }, // ends where it started
    };
    expect(reasonOf(validateOrder(ctx(b, [a, friend], { allQueued }), move('a', [1])))).toBe(
      'ends-on-friendly',
    );
  });

  it('omitting allQueued keeps strict §2.5 behavior', () => {
    expect(reasonOf(validateOrder(ctx(b, [a, friend]), move('a', [1])))).toBe('ends-on-friendly');
  });

  it('mid-path friendlies remain pass-through regardless of their queues', () => {
    const allQueued: OrderQueues = {};
    expect(validateOrder(ctx(b, [a, friend], { allQueued }), move('a', [1, 2])).ok).toBe(true);
  });
});

// --- validateOrder: attack (§2.3/§2.4 + planned end position) --------------------

describe('validateOrder — attack', () => {
  it('accepts a visible enemy in range', () => {
    const b = lineBoard(3);
    const a = unit('a', 0, 0);
    const e = unit('e', 1, 1);
    expect(validateOrder(ctx(b, [a, e]), attack('a', 1)).ok).toBe(true);
  });

  it('rejects targets outside the faction vision (target-not-visible)', () => {
    const b = lineBoard(3);
    const a = unit('a', 0, 0);
    const e = unit('e', 1, 1);
    const visible = new Set<CellId>([0]);
    expect(reasonOf(validateOrder(ctx(b, [a, e], { visible }), attack('a', 1)))).toBe(
      'target-not-visible',
    );
  });

  it('rejects empty or friendly target cells (no-target)', () => {
    const b = lineBoard(3);
    const a = unit('a', 0, 0);
    const f = unit('f', 0, 1);
    expect(reasonOf(validateOrder(ctx(b, [a, f]), attack('a', 2)))).toBe('no-target');
    expect(reasonOf(validateOrder(ctx(b, [a, f]), attack('a', 1)))).toBe('no-target');
  });

  it('enforces max range and artillery MIN range', () => {
    const b = lineBoard(6);
    const inf = unit('a', 0, 0); // range 1–1
    const far = unit('e', 1, 2);
    expect(reasonOf(validateOrder(ctx(b, [inf, far]), attack('a', 2)))).toBe('out-of-range');

    const arty = unit('g', 0, 0, 'artillery'); // range 2–4
    const adjacent = unit('e2', 1, 1);
    const inRange = unit('e3', 1, 4);
    const all = [arty, adjacent, inRange];
    expect(reasonOf(validateOrder(ctx(b, all), attack('g', 1)))).toBe('out-of-range'); // < min
    expect(validateOrder(ctx(b, all), attack('g', 4)).ok).toBe(true);
    const tooFar = unit('e4', 1, 5);
    expect(reasonOf(validateOrder(ctx(b, [...all, tooFar]), attack('g', 5)))).toBe('out-of-range');
  });

  it('measures range from the PLANNED end position when a move is queued', () => {
    const b = lineBoard(6);
    const arty = unit('g', 0, 0, 'artillery');
    const e1 = unit('e1', 1, 1); // adjacent to current cell
    const e5 = unit('e5', 1, 5); // distance 5 from current cell
    const queuedMove: UnitOrders = { move: { kind: 'move', unitId: 'g', path: [1, 2] } };
    expect(plannedEndCell(arty, queuedMove)).toBe(2);

    const all = [arty, e1, e5];
    // From planned end (cell 2): e5 at distance 3 → valid (was 5 → invalid).
    expect(reasonOf(validateOrder(ctx(b, all), attack('g', 5)))).toBe('out-of-range');
    expect(validateOrder(ctx(b, all, { queued: queuedMove }), attack('g', 5)).ok).toBe(true);
    // The inverse: valid from the current cell, INVALID from the planned end
    // (a queued retreat takes the target out of sniper range — the order must
    // be rejected so the player can't queue a guaranteed fizzle).
    const sniper = unit('s', 0, 4, 'sniper'); // range 1–2
    const e2 = unit('e2', 1, 2);
    const retreat: UnitOrders = { move: { kind: 'move', unitId: 's', path: [5] } };
    expect(validateOrder(ctx(b, [sniper, e2]), attack('s', 2)).ok).toBe(true); // dist 2
    expect(reasonOf(validateOrder(ctx(b, [sniper, e2], { queued: retreat }), attack('s', 2)))).toBe(
      'out-of-range', // dist 3 after the move
    );
  });

  it('hold-fire blocks explicit attacks: current stance, queued stance, and queued override', () => {
    const b = lineBoard(3);
    const e = unit('e', 1, 1);

    // current stance hold-fire, nothing queued → blocked
    const holding = unit('a', 0, 0, 'infantry', { stance: 'hold-fire' });
    expect(reasonOf(validateOrder(ctx(b, [holding, e]), attack('a', 1)))).toBe(
      'hold-fire-blocks-attack',
    );

    // queued hold-fire overrides an aggressive current stance → blocked
    const aggressive = unit('a', 0, 0);
    const queuedHold: UnitOrders = { stance: { kind: 'stance', unitId: 'a', stance: 'hold-fire' } };
    expect(
      reasonOf(validateOrder(ctx(b, [aggressive, e], { queued: queuedHold }), attack('a', 1))),
    ).toBe('hold-fire-blocks-attack');

    // queued aggressive overrides a hold-fire current stance → allowed
    const queuedAggro: UnitOrders = { stance: { kind: 'stance', unitId: 'a', stance: 'aggressive' } };
    expect(validateOrder(ctx(b, [holding, e], { queued: queuedAggro }), attack('a', 1)).ok).toBe(true);
  });

  it('rejects attacks the unit type cannot damage (attackStrengths 0)', () => {
    const b = lineBoard(3);
    const noAntiArmor: UnitType = {
      ...TYPES['infantry']!,
      key: 'pacifist',
      attackStrengths: { personnel: 6, armored: 0, naval: 0, air: 0 },
    };
    const types = { ...TYPES, pacifist: noAntiArmor };
    const a = unit('a', 0, 0, 'pacifist');
    const tank = unit('e', 1, 1, 'tank');
    expect(
      reasonOf(validateOrder({ ...ctx(b, [a, tank]), unitTypes: types }, attack('a', 1))),
    ).toBe('cannot-damage');
  });
});

// --- validateOrder: stance (§2.4) -------------------------------------------------

describe('validateOrder — stance', () => {
  const b = lineBoard(3);
  const a = unit('a', 0, 0);

  it('every stance is valid by default', () => {
    for (const s of ['aggressive', 'defensive', 'hold-fire'] as const) {
      expect(validateOrder(ctx(b, [a]), stance('a', s)).ok).toBe(true);
    }
  });

  it('hold-fire is blocked while an explicit attack is queued (UI blocks entering one)', () => {
    const queued: UnitOrders = { attack: { kind: 'attack', unitId: 'a', targetCell: 1 } };
    expect(reasonOf(validateOrder(ctx(b, [a], { queued }), stance('a', 'hold-fire')))).toBe(
      'hold-fire-blocks-attack',
    );
    expect(validateOrder(ctx(b, [a], { queued }), stance('a', 'defensive')).ok).toBe(true);
  });
});

// --- queue logic --------------------------------------------------------------

describe('order queues', () => {
  const m1 = move('a', [1]);
  const m2 = move('a', [1, 2]);
  const at = attack('a', 2);
  const st = stance('a', 'defensive');

  it('queueOrder REPLACES same-kind orders (max one per kind is structural)', () => {
    let q: OrderQueues = {};
    q = queueOrder(q, m1);
    q = queueOrder(q, at);
    q = queueOrder(q, st);
    q = queueOrder(q, m2); // replaces m1
    expect(q['a']!.move).toEqual(m2);
    expect(q['a']!.attack).toEqual(at);
    expect(q['a']!.stance).toEqual(st);
    expect(flattenOrders(q)).toHaveLength(3);
  });

  it('removeOrder drops one kind; the unit entry disappears when empty', () => {
    let q: OrderQueues = queueOrder(queueOrder({}, m1), at);
    q = removeOrder(q, 'a', 'move');
    expect(q['a']!.move).toBeUndefined();
    expect(q['a']!.attack).toEqual(at);
    q = removeOrder(q, 'a', 'attack');
    expect(q['a']).toBeUndefined();
    expect(removeOrder(q, 'nobody', 'move')).toBe(q); // no-op keeps identity
  });

  it('orderedUnitIds counts units with ≥1 order (commit gate n/8)', () => {
    let q: OrderQueues = {};
    expect(orderedUnitIds(q).size).toBe(0);
    q = queueOrder(q, m1);
    q = queueOrder(q, stance('b', 'hold-fire'));
    expect([...orderedUnitIds(q)].sort()).toEqual(['a', 'b']);
  });

  it('flattenOrders is deterministic: unit ids ascending, stance→move→attack', () => {
    const q = queueOrder(
      queueOrder(queueOrder(queueOrder({}, attack('b', 3)), m1), stance('a', 'defensive')),
      move('b', [2]),
    );
    expect(flattenOrders(q)).toEqual([
      stance('a', 'defensive'),
      m1,
      move('b', [2]),
      attack('b', 3),
    ]);
  });

  it('findConvergences flags ≥2 friendly moves ending on one cell, ignores other factions', () => {
    const units = [unit('a', 0, 0), unit('b', 0, 4), unit('c', 1, 5), unit('d', 0, 3)];
    let q: OrderQueues = {};
    q = queueOrder(q, move('a', [1, 2]));
    q = queueOrder(q, move('b', [3, 2])); // same destination: cell 2
    q = queueOrder(q, move('c', [2])); // enemy converging — not the player's warning
    q = queueOrder(q, move('d', [4])); // lone mover
    const conv = findConvergences(q, units, 0);
    expect([...conv.keys()]).toEqual([2]);
    expect(conv.get(2)).toEqual(['a', 'b']);
  });
});
