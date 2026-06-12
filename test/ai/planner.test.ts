// §13.6 unit-level tests for the greedy planner and FactionView:
//   • same FactionView + seed → identical orders (planner determinism);
//   • fairness probe — the view contains no unit outside the AI's vision
//     union, and planned orders are INDEPENDENT of hidden enemy positions;
//   • focus-fire shifts target (an ally's planned attack pulls a later
//     unit onto the same target);
//   • defensive stance under threat when no attack is available;
//   • vehicle placed on a mountain (a cell outside its own reachable set):
//     stay-put is still a candidate — it attacks without moving.
//
// Full-game acceptance (greedy beats do-nothing on 3 seeds) lives in
// acceptance.test.ts.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { generateBoard } from '../../src/board/donor';
import type { Board } from '../../src/board/types';
import type { Order } from '../../src/core/orders';
import { createRng } from '../../src/core/rng';
import { newGame } from '../../src/core/setup';
import type { GameState, UnitInstance } from '../../src/core/types';
import { loadScenarios, loadUnits } from '../../src/io/data-loader';
import { parseWeewarMap, toDonorMap } from '../../src/io/weewar-xml';
import { buildFactionView } from '../../src/ai/view';
import { createGreedyPlanner, greedyPlanner } from '../../src/ai/planner-greedy';
import { lineBoard, syntheticBoard, makeUnit } from '../core/synthetic';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAPS_DIR = resolve(__dirname, '../../data/maps');
const types = loadUnits();
const standard = loadScenarios()['standard']!;

beforeAll(() => {
  // Donor XMLs carry unmapped air/naval start units → expected parser warnings.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function stateOn(board: Board, units: UnitInstance[], round = 1): GameState {
  const map: Record<string, UnitInstance> = {};
  for (const u of units) map[u.id] = u;
  return {
    round,
    phase: 'planning',
    board,
    units: map,
    pendingOrders: { 0: [], 1: [] },
    rngSeed: 1,
    log: [],
  };
}

describe('greedy planner — §13.6 unit vectors', () => {
  it('same FactionView + seed → identical orders (determinism)', () => {
    const donor = toDonorMap(parseWeewarMap(readFileSync(join(MAPS_DIR, '53316.xml'), 'utf-8')));
    const board = generateBoard(donor, 7);
    const state = newGame(board, standard.forces, types, 7);
    const view = buildFactionView(board, state, 0, types);
    const a = greedyPlanner.planOrders(view, createRng(42));
    const b = greedyPlanner.planOrders(view, createRng(42));
    expect(a.length).toBeGreaterThan(0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('fairness probe: the view contains no unit outside the vision union', () => {
    const donor = toDonorMap(parseWeewarMap(readFileSync(join(MAPS_DIR, '53316.xml'), 'utf-8')));
    const board = generateBoard(donor, 7);
    const state = newGame(board, standard.forces, types, 7);
    for (const faction of [0, 1] as const) {
      const view = buildFactionView(board, state, faction, types);
      for (const e of view.enemies) {
        expect(view.visible.has(e.cell)).toBe(true);
        expect(e.faction).not.toBe(faction);
      }
      // Round 1, armies at opposite anchors: nothing should be visible.
      expect(view.enemies).toEqual([]);
      // ...but army-size arithmetic (public knowledge) is present.
      expect(view.enemyTotal).toBe(8);
      expect(view.enemyDead).toBe(0);
    }
  });

  it('fairness probe: orders are independent of hidden enemy positions', () => {
    // 13 plains cells in a line; our infantry (vision 2) at 0; the enemy is
    // far outside vision in both variants — only its hidden cell differs.
    const terrains = Array.from({ length: 13 }, () => 'plains' as const);
    const board = lineBoard(terrains);
    const ours = makeUnit('inf0', 0, 0, 'infantry');
    const variantA = stateOn(board, [ours, makeUnit('enemy', 1, 10, 'infantry')]);
    const variantB = stateOn(board, [ours, makeUnit('enemy', 1, 12, 'infantry')]);
    const viewA = buildFactionView(board, variantA, 0, types);
    const viewB = buildFactionView(board, variantB, 0, types);
    expect(viewA.enemies).toEqual([]);
    expect(viewB.enemies).toEqual([]);
    const a = greedyPlanner.planOrders(viewA, createRng(7));
    const b = greedyPlanner.planOrders(viewB, createRng(7));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('focus-fire shifts target: an ally already attacking Y pulls the artillery onto Y', () => {
    // Geometry (edges):  X(1)—water(4)—art(0)—water(5)—Y(2)—gre(3),
    // plus spotter(6)—water(7)—art(0). Artillery (range 2–4, init 4 —
    // plans LAST) is boxed by water: its only candidate cell is 0, from
    // which BOTH tanks are at hop distance 2. The grenadier is adjacent to
    // Y only. The sniper spotter is sealed behind water out of its range 2
    // (it exists to keep X and Y inside the faction's vision union).
    const board = syntheticBoard(
      [
        { center: [0, 0] },
        { center: [-2, 0] },
        { center: [2, 0] },
        { center: [3, 0] },
        { center: [-1, 0], terrain: 'water' },
        { center: [1, 0], terrain: 'water' },
        { center: [0, 2] },
        { center: [0, 1], terrain: 'water' },
      ],
      [
        [1, 4],
        [4, 0],
        [0, 5],
        [5, 2],
        [2, 3],
        [6, 7],
        [7, 0],
      ],
    );
    const planner = createGreedyPlanner({ focusFire: 5 });
    const X = makeUnit('X', 1, 1, 'humvee', 10);
    const Y = makeUnit('Y', 1, 2, 'tank', 10);
    const art = makeUnit('art0', 0, 0, 'artillery', 6);
    const spotter = makeUnit('spot0', 0, 6, 'sniper', 1);
    const gre = makeUnit('gre0', 0, 3, 'grenadier', 10);

    // Control: no ally commits onto Y → the artillery prefers X (lower
    // armor → strictly more damage; neither can counter at distance 2).
    const alone = buildFactionView(board, stateOn(board, [art, spotter, X, Y]), 0, types);
    const controlOrders = planner.planOrders(alone, createRng(1));
    const controlAttack = controlOrders.find(
      (o): o is Extract<Order, { kind: 'attack' }> => o.kind === 'attack' && o.unitId === 'art0',
    );
    expect(controlAttack?.targetCell).toBe(1);

    // With the grenadier (init 7 — plans first) committed onto Y, focus
    // fire shifts the artillery onto Y.
    const together = buildFactionView(board, stateOn(board, [art, spotter, gre, X, Y]), 0, types);
    const orders = planner.planOrders(together, createRng(1));
    const greAttack = orders.find(
      (o): o is Extract<Order, { kind: 'attack' }> => o.kind === 'attack' && o.unitId === 'gre0',
    );
    const artAttack = orders.find(
      (o): o is Extract<Order, { kind: 'attack' }> => o.kind === 'attack' && o.unitId === 'art0',
    );
    expect(greAttack?.targetCell).toBe(2);
    expect(artAttack?.targetCell).toBe(2);
  });

  it('defensive stance under threat when no attack is available', () => {
    // Artillery (min range 2) boxed in with an enemy tank ADJACENT: inside
    // its dead zone, nowhere to move, threatened → stance flips defensive.
    const board = lineBoard(['plains', 'plains']);
    const art = makeUnit('art0', 0, 0, 'artillery', 6);
    const tank = makeUnit('tan1', 1, 1, 'tank', 10);
    const view = buildFactionView(board, stateOn(board, [art, tank]), 0, types);
    const orders = greedyPlanner.planOrders(view, createRng(1));
    expect(orders).toEqual([{ kind: 'stance', unitId: 'art0', stance: 'defensive' }]);
  });

  it('vehicle on a mountain (outside its own reachable set): stays put and still attacks', () => {
    // placeForce can drop a tank on a mountain — it may leave but never
    // re-enter. Here BOTH cells are mountains, so its reachable set is
    // empty; stay-put must still be a candidate, from which it attacks.
    const board = syntheticBoard(
      [
        { center: [0, 0], terrain: 'mountains' },
        { center: [1, 0], terrain: 'mountains' },
      ],
      [[0, 1]],
    );
    const tank = makeUnit('tan0', 0, 0, 'tank', 10);
    const target = makeUnit('inf1', 1, 1, 'infantry', 2);
    const view = buildFactionView(board, stateOn(board, [tank, target]), 0, types);
    const orders = greedyPlanner.planOrders(view, createRng(1));
    expect(orders.filter((o) => o.kind === 'move')).toEqual([]);
    const attack = orders.find(
      (o): o is Extract<Order, { kind: 'attack' }> => o.kind === 'attack' && o.unitId === 'tan0',
    );
    expect(attack?.targetCell).toBe(1);
  });
});
