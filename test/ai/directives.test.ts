// v0.6 group directives (src/ai/directives.ts) — posture plans for the
// player's whole faction. Pinned here:
//   • determinism — same view → byte-identical orders, all three directives;
//   • fairness — orders independent of hidden enemy positions;
//   • all-units coverage — every own unit receives a stance order (the
//     posture), and moves are ordinary Order[] (overriding is the UI's job);
//   • posture sanity — forward-deploy advances (and personnel prefer capture
//     targets in conquest), tactical-retreat strictly decreases mean
//     distance-to-own-anchor when possible and is defensive, fortify never
//     moves more than one cell and artillery keeps its range lines;
//   • speed — well under 10 ms for 8 units on a donor board.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { generateBoard } from '../../src/board/donor';
import { graphDistance } from '../../src/board/geometry';
import type { Board, CellId, TerrainKey } from '../../src/board/types';
import type { Order } from '../../src/core/orders';
import { createRng } from '../../src/core/rng';
import { newGame } from '../../src/core/setup';
import type { FactionId, GameState, UnitInstance } from '../../src/core/types';
import { loadScenarios, loadUnits } from '../../src/io/data-loader';
import { parseWeewarMap, toDonorMap } from '../../src/io/weewar-xml';
import { buildFactionView } from '../../src/ai/view';
import { planDirective } from '../../src/ai/directives';
import type { GroupDirective } from '../../src/ai/directives';
import { lineBoard, makeUnit } from '../core/synthetic';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAPS_DIR = resolve(__dirname, '../../data/maps');
const types = loadUnits();
const standard = loadScenarios()['standard']!;
const DIRECTIVES: GroupDirective[] = ['forward-deploy', 'tactical-retreat', 'fortify'];

beforeAll(() => {
  // Donor XMLs carry unmapped air/naval start units → expected parser warnings.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function donorBoard(seed: number): Board {
  const donor = toDonorMap(parseWeewarMap(readFileSync(join(MAPS_DIR, '53316.xml'), 'utf-8')));
  return generateBoard(donor, seed);
}

function stateOn(board: Board, units: UnitInstance[], round = 1): GameState {
  return {
    round,
    phase: 'planning',
    board,
    units: Object.fromEntries(units.map((u) => [u.id, u])),
    pendingOrders: { 0: [], 1: [] },
    rngSeed: 1,
    log: [],
  };
}

function conquestStateOn(
  board: Board,
  units: UnitInstance[],
  bases: Record<CellId, FactionId | null>,
): GameState {
  return {
    ...stateOn(board, units),
    mode: 'conquest',
    bases,
    credits: { 0: 100, 1: 100 },
    baseless: { 0: 0, 1: 0 },
    roundLimit: null,
  };
}

const moves = (orders: Order[]) =>
  orders.filter((o): o is Extract<Order, { kind: 'move' }> => o.kind === 'move');
const stances = (orders: Order[]) =>
  orders.filter((o): o is Extract<Order, { kind: 'stance' }> => o.kind === 'stance');

/** Planned end cell per unit: move destination, else current cell. */
function endCells(view: { own: UnitInstance[] }, orders: Order[]): Map<string, CellId> {
  const ends = new Map<string, CellId>();
  for (const u of view.own) ends.set(u.id, u.cell);
  for (const m of moves(orders)) ends.set(m.unitId, m.path[m.path.length - 1]!);
  return ends;
}

describe('group directives (v0.6)', () => {
  it('determinism: same view → byte-identical orders, all directives, both modes', () => {
    const board = donorBoard(7);
    const skirmish = newGame(board, standard.forces, types, 7);
    const conquest = newGame(board, standard.forces, types, 7, 'conquest');
    for (const state of [skirmish, conquest]) {
      const view = buildFactionView(board, state, 0, types);
      for (const d of DIRECTIVES) {
        const a = planDirective(d, view, createRng(42));
        const b = planDirective(d, view, createRng(99)); // rng must not matter
        expect(a.length).toBeGreaterThan(0);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }
    }
  });

  it('fairness: orders are independent of hidden enemy positions', () => {
    const terrains = Array.from({ length: 13 }, () => 'plains' as const);
    const board = lineBoard(terrains);
    board.placementAnchors = [0, 12];
    const ours = [makeUnit('inf0', 0, 0, 'infantry'), makeUnit('rgr0', 0, 1, 'ranger')];
    const variantA = stateOn(board, [...ours, makeUnit('enemy', 1, 10, 'infantry')]);
    const variantB = stateOn(board, [...ours, makeUnit('enemy', 1, 12, 'infantry')]);
    const viewA = buildFactionView(board, variantA, 0, types);
    const viewB = buildFactionView(board, variantB, 0, types);
    expect(viewA.enemies).toEqual([]);
    expect(viewB.enemies).toEqual([]);
    for (const d of DIRECTIVES) {
      const a = planDirective(d, viewA, createRng(7));
      const b = planDirective(d, viewB, createRng(7));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('all-units coverage: every own unit receives a stance order (the posture)', () => {
    const board = donorBoard(7);
    const state = newGame(board, standard.forces, types, 7, 'conquest');
    const view = buildFactionView(board, state, 0, types);
    expect(view.own.length).toBeGreaterThan(0);
    const wantStance = { 'forward-deploy': 'aggressive', 'tactical-retreat': 'defensive', fortify: 'defensive' };
    for (const d of DIRECTIVES) {
      const orders = planDirective(d, view, createRng(1));
      const st = stances(orders);
      expect(new Set(st.map((o) => o.unitId))).toEqual(new Set(view.own.map((u) => u.id)));
      for (const o of st) expect(o.stance).toBe(wantStance[d]);
      // Max one move per unit, and only ordinary order kinds (no attacks —
      // forward-deploy is a movement posture; auto-attack handles contact).
      const mv = moves(orders);
      expect(new Set(mv.map((m) => m.unitId)).size).toBe(mv.length);
      expect(orders.every((o) => o.kind === 'move' || o.kind === 'stance')).toBe(true);
    }
  });

  it('forward-deploy advances toward enemy contact (skirmish: anchor when nothing visible)', () => {
    const terrains = Array.from({ length: 13 }, () => 'plains' as const);
    const board = lineBoard(terrains);
    board.placementAnchors = [0, 12];
    const state = stateOn(board, [
      makeUnit('inf0', 0, 0, 'infantry'),
      makeUnit('rgr0', 0, 1, 'ranger'),
      makeUnit('enemy', 1, 12, 'infantry'), // hidden — anchor is the target
    ]);
    const view = buildFactionView(board, state, 0, types);
    const orders = planDirective('forward-deploy', view, createRng(1));
    const ends = endCells(view, orders);
    for (const u of view.own) {
      const before = graphDistance(board, u.cell, 12);
      const after = graphDistance(board, ends.get(u.id)!, 12);
      expect(after).toBeLessThan(before); // every unit closes on the anchor
    }
  });

  it('forward-deploy (conquest): personnel head for the capturable base, not the enemy anchor', () => {
    // Line: own anchor side at 12, neutral base at 2 — BEHIND the infantry
    // at 6; the enemy anchor pulls the other way (cell 12 is f1's anchor).
    const terrains: TerrainKey[] = Array.from({ length: 13 }, () => 'plains');
    terrains[2] = 'base';
    const board = lineBoard(terrains);
    board.placementAnchors = [0, 12];
    const state = conquestStateOn(
      board,
      [makeUnit('inf0', 0, 6, 'infantry'), makeUnit('far', 1, 12, 'infantry')],
      { 2: null },
    );
    const view = buildFactionView(board, state, 0, types);
    expect(view.enemies).toEqual([]); // nothing visible — belief only
    const orders = planDirective('forward-deploy', view, createRng(1));
    const end = endCells(view, orders).get('inf0')!;
    expect(graphDistance(board, end, 2)).toBeLessThan(graphDistance(board, 6, 2));
  });

  it('tactical-retreat strictly decreases mean distance-to-own-anchor when possible, defensively', () => {
    const terrains = Array.from({ length: 13 }, () => 'plains' as const);
    const board = lineBoard(terrains);
    board.placementAnchors = [0, 12];
    const state = stateOn(board, [
      makeUnit('inf0', 0, 6, 'infantry'),
      makeUnit('rgr0', 0, 8, 'ranger'),
      makeUnit('enemy', 1, 9, 'infantry'), // visible to the ranger — a threat
    ]);
    const view = buildFactionView(board, state, 0, types);
    const orders = planDirective('tactical-retreat', view, createRng(1));
    const ends = endCells(view, orders);
    const meanBefore = (6 + 8) / 2;
    let meanAfter = 0;
    for (const u of view.own) meanAfter += graphDistance(board, ends.get(u.id)!, 0);
    meanAfter /= view.own.length;
    expect(meanAfter).toBeLessThan(meanBefore);
    // Away from known threats: nobody ends closer to the visible enemy.
    for (const u of view.own) {
      expect(graphDistance(board, ends.get(u.id)!, 9)).toBeGreaterThanOrEqual(
        graphDistance(board, u.cell, 9),
      );
    }
    for (const o of stances(orders)) expect(o.stance).toBe('defensive');
  });

  it('fortify never moves a unit more than one cell, and steps onto better armor when adjacent', () => {
    // Infantry on plains with woods (armor +2) adjacent: one-step fortify.
    const board = lineBoard(['plains', 'woods', 'plains', 'plains']);
    const state = stateOn(board, [
      makeUnit('inf0', 0, 0, 'infantry'),
      makeUnit('enemy', 1, 3, 'infantry'),
    ]);
    const view = buildFactionView(board, state, 0, types);
    const orders = planDirective('fortify', view, createRng(1));
    const mv = moves(orders);
    expect(mv).toHaveLength(1);
    expect(mv[0]!.path).toEqual([1]); // exactly one step, onto the woods
    // The donor-board sweep: no fortify move is ever longer than one step.
    const donor = donorBoard(7);
    const big = newGame(donor, standard.forces, types, 7, 'conquest');
    const bigView = buildFactionView(donor, big, 0, types);
    for (const m of moves(planDirective('fortify', bigView, createRng(1)))) {
      expect(m.path.length).toBe(1);
    }
  });

  it('fortify: artillery keeps its range lines (never steps into its own dead zone)', () => {
    // art at 2, visible enemy at 0 (a sniper spotter at 3 supplies vision —
    // artillery itself sees only 1); the tempting base cell (armor +1 for
    // artillery) at 1 would put the enemy at distance 1 < minRange 2 — veto.
    const board = lineBoard(['plains', 'base', 'plains', 'plains', 'plains']);
    const blocked = stateOn(board, [
      makeUnit('art0', 0, 2, 'artillery'),
      makeUnit('spot', 0, 3, 'sniper'),
      makeUnit('enemy', 1, 0, 'infantry'),
    ]);
    const viewBlocked = buildFactionView(board, blocked, 0, types);
    expect(viewBlocked.enemies).toHaveLength(1); // the threat IS known
    const ordersBlocked = planDirective('fortify', viewBlocked, createRng(1));
    expect(moves(ordersBlocked)).toEqual([]); // holds the line

    // Control: the same enemy far enough away (cell 4 — distance 3 from the
    // base cell) frees the move onto the armor bonus.
    const free = stateOn(board, [
      makeUnit('art0', 0, 2, 'artillery'),
      makeUnit('spot', 0, 3, 'sniper'), // sniper vision 4 keeps cell 4 visible
      makeUnit('enemy', 1, 4, 'infantry'),
    ]);
    const viewFree = buildFactionView(board, free, 0, types);
    const ordersFree = planDirective('fortify', viewFree, createRng(1));
    const mv = moves(ordersFree).filter((m) => m.unitId === 'art0');
    expect(mv).toHaveLength(1);
    expect(mv[0]!.path).toEqual([1]);
  });

  it('no two units plan onto the same destination (collision discipline)', () => {
    const board = donorBoard(7);
    const state = newGame(board, standard.forces, types, 7, 'conquest');
    for (const faction of [0, 1] as const) {
      const view = buildFactionView(board, state, faction, types);
      for (const d of DIRECTIVES) {
        const ends = endCells(view, planDirective(d, view, createRng(1)));
        expect(new Set(ends.values()).size).toBe(ends.size);
      }
    }
  });

  it('speed: <10 ms per directive for 8 units on a donor board', () => {
    const board = donorBoard(7);
    const state = newGame(board, standard.forces, types, 7); // skirmish: mirror-8
    const view = buildFactionView(board, state, 0, types);
    expect(view.own).toHaveLength(8);
    for (const d of DIRECTIVES) {
      let bestMs = Infinity;
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        planDirective(d, view, createRng(1));
        bestMs = Math.min(bestMs, performance.now() - t0);
      }
      expect(bestMs).toBeLessThan(10);
    }
  });
});
