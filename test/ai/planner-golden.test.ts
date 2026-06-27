// AI9 — byte-identity GOLDEN MASTER for the greedy planner's output.
//
// Why this exists (the P7 AI gate): acceptance.test.ts pins the planner with a
// PROPERTY bar (greedy beats do-nothing on ≥2/3 seeds) + a coarse determinism
// check (same seed → identical FINAL state). Neither pins the planner's actual
// per-round ORDER stream. So an internal refactor (P7 AI7 planUnit / scorer
// decompose, AI1/AI3 dedupes) could silently shift a tie-break / target choice
// and still pass. This file is the missing byte-level companion: it records the
// COMPLETE order output and fails loudly on any drift.
//
// Discipline (plan §Risk Register "no reseed", deban "reseed-masking" guard):
// the goldens are committed fixtures asserted by EXACT string match. A real
// behavior change shows as a precise diff. Regeneration is DELIBERATE — run
// `GEN_GOLDEN=1 npx vitest run test/ai/planner-golden.test.ts` and REVIEW the
// git diff. NEVER regenerate to dodge a refactor: a Phase-7 structural change
// must leave these byte-identical. If one moves, the refactor changed behavior.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { generateBoard } from '../../src/board/donor';
import type { Order } from '../../src/core/orders';
import { weewar } from '../../src/core/combat/weewar';
import { resolveRound } from '../../src/core/resolver';
import { createRng } from '../../src/core/rng';
import { newGame } from '../../src/core/setup';
import type { GameState, UnitInstance } from '../../src/core/types';
import { loadScenarios, loadUnits } from '../../src/io/data-loader';
import { parseWeewarMap, toDonorMap } from '../../src/io/weewar-xml';
import { buildFactionView } from '../../src/ai/view';
import type { KnownBases } from '../../src/ai/view';
import { planRound } from '../../src/ai/planner';
import type { ConquestPlan } from '../../src/ai/planner';
import { greedyPlanner, createGreedyPlanner } from '../../src/ai/planner-greedy';
import { doNothingPlanner } from '../../src/ai/planner-donothing';
import { syntheticBoard } from '../core/synthetic';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAPS_DIR = resolve(__dirname, '../../data/maps');
const FIX_DIR = resolve(__dirname, '__fixtures__');
const DONOR_ID = '53316'; // Valley Road — the §13.6 acceptance donor
const REGEN = !!process.env.GEN_GOLDEN;

const types = loadUnits();
const standard = loadScenarios()['standard']!;

beforeAll(() => {
  // Donor XMLs carry unmapped air/naval start units → expected parser warnings.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// Stable, readable serialization (pretty for legible git diffs on drift).
const canon = (x: unknown): string => JSON.stringify(x, null, 2);

/** Assert `actual` matches the committed golden, or (re)write it under GEN_GOLDEN.
 *  Missing fixture without GEN_GOLDEN is a hard failure (never a silent pass). */
function assertGolden(name: string, actual: unknown): void {
  const path = join(FIX_DIR, `${name}.json`);
  const serialized = canon(actual);
  if (REGEN) {
    mkdirSync(FIX_DIR, { recursive: true });
    writeFileSync(path, serialized + '\n');
    return;
  }
  if (!existsSync(path)) {
    throw new Error(
      `golden fixture missing: ${path}\n` +
        `  → create with: GEN_GOLDEN=1 npx vitest run test/ai/planner-golden.test.ts, then REVIEW the diff`,
    );
  }
  // Normalize CRLF so a Windows checkout (autocrlf) can't spuriously fail; the
  // serialized side is always LF (JSON.stringify). .gitattributes also pins LF.
  const expected = readFileSync(path, 'utf-8').replace(/\r\n/g, '\n').trimEnd();
  expect(serialized).toBe(expected);
}

// Mechanical guard for the no-reseed rule: regeneration must never run in CI, so
// a drift can never be silently re-baselined by an automated job. Local devs may
// set GEN_GOLDEN deliberately and REVIEW the resulting git diff.
describe('golden discipline', () => {
  it('never regenerates in CI (no silent re-baseline)', () => {
    expect(Boolean(process.env.CI && REGEN)).toBe(false);
  });
});

// ── Full-game goldens (broad: opening → advance → contact → combat → endgame).
// Mirrors acceptance.test.ts playGame EXACTLY (greedy=0 vs do-nothing=1, per-round
// rng built identically) so faction 0's recorded orders are byte-identical to what
// the §13.6 acceptance bar drives. NOTE: greedy.planOrders takes `_rng` (UNUSED —
// it is deterministic via fnv1a32 tie-keys, not the rng) and do-nothing issues [];
// the rng is reproduced only to keep the harness a faithful clone of acceptance.

type RoundRec = { round: number; orders: Order[] };

function playGameGolden(seed: number): {
  rounds: RoundRec[];
  finalRound: number;
  outcome: GameState['outcome'];
  survivors: { f0: number; f1: number };
} {
  const donor = toDonorMap(parseWeewarMap(readFileSync(join(MAPS_DIR, `${DONOR_ID}.xml`), 'utf-8')));
  const board = generateBoard(donor, seed);
  let state = newGame(board, standard.forces, types, seed);
  const rounds: RoundRec[] = [];

  while (!state.outcome) {
    const view0 = buildFactionView(board, state, 0, types);
    const view1 = buildFactionView(board, state, 1, types);
    const rng = createRng((seed * 1000 + state.round) >>> 0 || 1);
    const o0 = greedyPlanner.planOrders(view0, rng);
    const o1 = doNothingPlanner.planOrders(view1, rng);
    rounds.push({ round: state.round, orders: o0 });
    ({ state } = resolveRound(board, state, { 0: o0, 1: o1 }, types, weewar));
  }

  const live = Object.values(state.units).filter((u) => u.count > 0);
  return {
    rounds,
    finalRound: state.round,
    outcome: state.outcome,
    survivors: {
      f0: live.filter((u) => u.faction === 0).length,
      f1: live.filter((u) => u.faction === 1).length,
    },
  };
}

describe('greedy planner — full-game byte-identity goldens (AI9; companion to §13.6 acceptance)', () => {
  for (const seed of [16, 31, 38]) {
    it(`seed ${seed}: per-round orders + outcome are byte-identical to the golden`, () => {
      const g = playGameGolden(seed);
      // The golden must pin SUBSTANTIVE behavior, not a vacuous empty stream.
      expect(g.rounds.length).toBeGreaterThan(3);
      const all = g.rounds.flatMap((r) => r.orders);
      expect(all.length).toBeGreaterThan(0);
      expect(all.some((o) => o.kind === 'attack')).toBe(true);
      assertGolden(`planner-fullgame-${seed}`, g);
    });
  }
});

// ── Mirror golden (greedy vs greedy): the ONLY vector with a MANEUVERING enemy,
// so it exercises enemy-reactive scoring (crossing / threat-from-a-moving-foe) and
// real defensive stance under live threat — paths the do-nothing games leave cold.
// Records BOTH factions' per-round orders.

type MirrorRec = { round: number; o0: Order[]; o1: Order[] };

function playMirrorGolden(seed: number): {
  rounds: MirrorRec[];
  finalRound: number;
  outcome: GameState['outcome'];
  survivors: { f0: number; f1: number };
} {
  const donor = toDonorMap(parseWeewarMap(readFileSync(join(MAPS_DIR, `${DONOR_ID}.xml`), 'utf-8')));
  const board = generateBoard(donor, seed);
  let state = newGame(board, standard.forces, types, seed);
  const rounds: MirrorRec[] = [];

  while (!state.outcome) {
    const view0 = buildFactionView(board, state, 0, types);
    const view1 = buildFactionView(board, state, 1, types);
    const rng = createRng((seed * 1000 + state.round) >>> 0 || 1);
    const o0 = greedyPlanner.planOrders(view0, rng);
    const o1 = greedyPlanner.planOrders(view1, rng);
    rounds.push({ round: state.round, o0, o1 });
    ({ state } = resolveRound(board, state, { 0: o0, 1: o1 }, types, weewar));
  }

  const live = Object.values(state.units).filter((u) => u.count > 0);
  return {
    rounds,
    finalRound: state.round,
    outcome: state.outcome,
    survivors: {
      f0: live.filter((u) => u.faction === 0).length,
      f1: live.filter((u) => u.faction === 1).length,
    },
  };
}

describe('greedy planner — mirror (moving-enemy) golden (AI9; enemy-reactive + defensive scoring)', () => {
  it('seed 16: greedy-vs-greedy per-round orders + outcome are byte-identical', () => {
    const g = playMirrorGolden(16);
    expect(g.rounds.length).toBeGreaterThan(3);
    const all = g.rounds.flatMap((r) => [...r.o0, ...r.o1]);
    expect(all.some((o) => o.kind === 'attack')).toBe(true);
    // the enemy genuinely maneuvers (not a passive do-nothing) — the property
    // that distinguishes this vector from the full-game goldens.
    expect(g.rounds.some((r) => r.o1.length > 0)).toBe(true);
    // defensive stance under live threat — the scorer path the do-nothing
    // games leave cold; this vector exists to gate it.
    expect(all.some((o) => o.kind === 'stance' && o.stance === 'defensive')).toBe(true);
    assertGolden('planner-mirror-16', g);
  });
});

// ── Conquest golden (greedy vs do-nothing, WITH buys): closes the conquest-blind
// gap. planUnit / the per-candidate scorer is SHARED across modes, so a refactor
// that perturbs it must not move conquest output either. Reimplements the
// conquest-harness loop (belief threading via `known`) to capture per-round
// {orders, buys} — the planner's full conquest output, including the buy stream.

type ConquestRec = { round: number; p0: ConquestPlan; p1: ConquestPlan };

function playConquestGolden(seed: number): {
  rounds: ConquestRec[];
  finalRound: number;
  outcome: GameState['outcome'];
  bases: GameState['bases'];
  credits: GameState['credits'];
  survivors: { f0: number; f1: number };
} {
  const donor = toDonorMap(parseWeewarMap(readFileSync(join(MAPS_DIR, `${DONOR_ID}.xml`), 'utf-8')));
  const board = generateBoard(donor, seed);
  let state = newGame(board, standard.forces, types, seed, 'conquest');
  const rounds: ConquestRec[] = [];
  const known: [KnownBases | undefined, KnownBases | undefined] = [undefined, undefined];
  const MAX_ROUNDS = 120;

  while (!state.outcome && state.round <= MAX_ROUNDS) {
    const v0 = buildFactionView(board, state, 0, types, known[0]);
    const v1 = buildFactionView(board, state, 1, types, known[1]);
    known[0] = v0.conquest!.bases;
    known[1] = v1.conquest!.bases;
    const rng = createRng((seed * 1000 + state.round) >>> 0 || 1);
    const p0 = planRound(greedyPlanner, v0, rng);
    const p1 = planRound(doNothingPlanner, v1, rng);
    rounds.push({ round: state.round, p0, p1 });
    ({ state } = resolveRound(
      board,
      state,
      { 0: p0.orders, 1: p1.orders },
      types,
      weewar,
      { 0: p0.buys, 1: p1.buys },
    ));
  }

  const live = Object.values(state.units).filter((u) => u.count > 0);
  return {
    rounds,
    finalRound: state.round,
    outcome: state.outcome,
    bases: state.bases,
    credits: state.credits,
    survivors: {
      f0: live.filter((u) => u.faction === 0).length,
      f1: live.filter((u) => u.faction === 1).length,
    },
  };
}

describe('greedy planner — conquest golden (AI9; shared scorer + buy stream)', () => {
  it('seed 7: per-round {orders, buys} + final econ are byte-identical', () => {
    const g = playConquestGolden(7);
    expect(g.rounds.length).toBeGreaterThan(3);
    const allOrders = g.rounds.flatMap((r) => r.p0.orders);
    expect(allOrders.some((o) => o.kind === 'attack')).toBe(true);
    // conquest-only planner paths: greedy buys (planConquestBuys) and plans
    // base captures — neither is reachable in skirmish, so this vector gates them.
    expect(g.rounds.some((r) => r.p0.buys.length > 0)).toBe(true);
    expect(allOrders.some((o) => o.kind === 'capture')).toBe(true);
    assertGolden('planner-conquest-7', g);
  });
});

// ── Synthetic contact golden (precise: isolates the scorer / tie-break with no
// resolver in the loop). The focus-fire board from planner.test.ts asserts only
// two targetCell fields; this pins the FULL order set so any drift in the other
// units' move/attack/stance choices is caught too.

function stateOn(board: ReturnType<typeof syntheticBoard>, units: UnitInstance[]): GameState {
  const map: Record<string, UnitInstance> = {};
  for (const u of units) map[u.id] = u;
  return { round: 1, phase: 'planning', board, units: map, pendingOrders: { 0: [], 1: [] }, rngSeed: 1, log: [] };
}

const synthUnit = (
  id: string,
  faction: 0 | 1,
  cell: number,
  type: string,
  count: number,
): UnitInstance => ({ id, type, faction, cell, count, stance: 'aggressive', attackedFrom: [] });

describe('greedy planner — synthetic contact golden (AI9; isolates the scorer)', () => {
  it('focus-fire board: the full order set is byte-identical to the golden', () => {
    // Geometry per planner.test.ts: X(1)—water(4)—art(0)—water(5)—Y(2)—gre(3),
    // plus spotter(6)—water(7)—art(0). Five units in immediate contact.
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
    const units = [
      synthUnit('art0', 0, 0, 'artillery', 6),
      synthUnit('spot0', 0, 6, 'sniper', 1),
      synthUnit('gre0', 0, 3, 'grenadier', 10),
      synthUnit('X', 1, 1, 'humvee', 10),
      synthUnit('Y', 1, 2, 'tank', 10),
    ];
    const view = buildFactionView(board, stateOn(board, units), 0, types);
    const orders = planner.planOrders(view, createRng(1));
    expect(orders.length).toBeGreaterThan(0);
    expect(orders.some((o) => o.kind === 'attack')).toBe(true);
    assertGolden('planner-synth-focusfire', orders);
  });
});
