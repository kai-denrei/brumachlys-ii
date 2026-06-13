// v0.7 — selectable AI archetypes. Pins the registry CONTRACT the UI consumes
// (shape, default, hyphen-free blurbs), proves every archetype is a FUNCTIONAL
// opponent (beats do-nothing decisively in conquest on 2 seeds), proves the
// archetypes are BEHAVIORALLY DISTINCT (swarm buys overwhelmingly infantry
// while marksman buys ranged), and that each is deterministic. The existing
// acceptance suites pin `balanced` == the tuned default separately.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { generateBoard } from '../../src/board/donor';
import type { Board } from '../../src/board/types';
import { weewar } from '../../src/core/combat/weewar';
import { resolveRound } from '../../src/core/resolver';
import { createRng } from '../../src/core/rng';
import { newGame } from '../../src/core/setup';
import type { GameState } from '../../src/core/types';
import { loadScenarios, loadUnits } from '../../src/io/data-loader';
import { parseWeewarMap, toDonorMap } from '../../src/io/weewar-xml';
import { buildFactionView } from '../../src/ai/view';
import type { KnownBases } from '../../src/ai/view';
import { planRound } from '../../src/ai/planner';
import { doNothingPlanner } from '../../src/ai/planner-donothing';
import { greedyPlanner } from '../../src/ai/planner-greedy';
import { ARCHETYPES, DEFAULT_ARCHETYPE, archetype } from '../../src/ai/archetypes';
import type { ArchetypeKey } from '../../src/ai/archetypes';
import { playConquest } from './conquest-harness';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAPS_DIR = resolve(__dirname, '../../data/maps');
const DONOR_ID = '53316'; // Valley Road
const SEEDS = [7, 11];

const types = loadUnits();
const standard = loadScenarios()['standard']!;

beforeAll(() => {
  // Donor XMLs carry unmapped air/naval start units → expected parser warnings.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function valleyRoad(seed: number): Board {
  const donor = toDonorMap(parseWeewarMap(readFileSync(join(MAPS_DIR, `${DONOR_ID}.xml`), 'utf-8')));
  return generateBoard(donor, seed);
}

const KEYS: ArchetypeKey[] = ['balanced', 'vanguard', 'swarm', 'marksman', 'warden'];

// ── Registry shape (the UI seam) ────────────────────────────────────────────
describe('archetype registry — the UI contract', () => {
  it('exposes every declared key exactly once', () => {
    expect(ARCHETYPES.map((a) => a.key).sort()).toEqual([...KEYS].sort());
    expect(ARCHETYPES.length).toBe(KEYS.length);
  });

  it('default archetype is balanced and resolves', () => {
    expect(DEFAULT_ARCHETYPE).toBe('balanced');
    expect(archetype(DEFAULT_ARCHETYPE).key).toBe('balanced');
  });

  it('balanced wraps the exact tuned default planner', () => {
    expect(archetype('balanced').planner).toBe(greedyPlanner);
  });

  it('every entry has a label, a conquest-capable planner, and a hyphen-free blurb', () => {
    for (const a of ARCHETYPES) {
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.blurb.length).toBeGreaterThan(0);
      expect(a.blurb).not.toContain('-'); // rules-modal copy convention
      expect(typeof a.planner.planConquest).toBe('function');
    }
  });

  it('archetype() throws on an unknown key', () => {
    // @ts-expect-error — deliberately off-contract.
    expect(() => archetype('nope')).toThrow();
  });
});

// ── Functional opponents: each beats do-nothing decisively ──────────────────
function vsDoNothing(key: ArchetypeKey, seed: number) {
  const board = valleyRoad(seed);
  const state = newGame(board, standard.forces, types, seed, 'conquest');
  return playConquest(board, state, [archetype(key).planner, doNothingPlanner], types, seed, 80);
}

describe('every archetype is a functional conquest opponent (vs do-nothing)', () => {
  for (const key of KEYS) {
    it(`${key} beats do-nothing decisively on ${SEEDS.length} seeds`, () => {
      for (const seed of SEEDS) {
        const r = vsDoNothing(key, seed);
        expect(r.state.outcome, `${key} seed ${seed} had no outcome`).toBeDefined();
        expect(r.state.outcome!.winner).toBe(0);
        expect(['conquest', 'base-collapse']).toContain(r.state.outcome!.reason);
      }
    });
  }
});

// ── Distinctness: collect a faction's buys over several rounds ───────────────
// Drive a real conquest game (archetype vs do-nothing) and tally faction 0's
// buy orders by armor/range class across the opening rounds. Credits accrue
// and are spent each round, so a few rounds give a representative sample.
function collectBuys(key: ArchetypeKey, seed: number, rounds: number): string[] {
  const board = valleyRoad(seed);
  let state: GameState = newGame(board, standard.forces, types, seed, 'conquest');
  const planner = archetype(key).planner;
  const known: [KnownBases | undefined, KnownBases | undefined] = [undefined, undefined];
  const bought: string[] = [];
  for (let i = 0; i < rounds && !state.outcome; i++) {
    const v0 = buildFactionView(board, state, 0, types, known[0]);
    const v1 = buildFactionView(board, state, 1, types, known[1]);
    known[0] = v0.conquest!.bases;
    known[1] = v1.conquest!.bases;
    const rng = createRng((seed * 1000 + state.round) >>> 0 || 1);
    const p0 = planRound(planner, v0, rng);
    const p1 = planRound(doNothingPlanner, v1, rng);
    for (const b of p0.buys) bought.push(b.unitTypeKey);
    ({ state } = resolveRound(
      board,
      state,
      { 0: p0.orders, 1: p1.orders },
      types,
      weewar,
      { 0: p0.buys, 1: p1.buys },
    ));
  }
  return bought;
}

const RANGED = new Set(['sniper', 'artillery']);

describe('archetypes are behaviorally distinct (buy composition)', () => {
  it('swarm buys overwhelmingly infantry; marksman buys ranged', () => {
    // Sample over enough rounds for the economy to spend its income stream.
    const swarmBuys = SEEDS.flatMap((s) => collectBuys('swarm', s, 16));
    const marksmanBuys = SEEDS.flatMap((s) => collectBuys('marksman', s, 16));

    expect(swarmBuys.length).toBeGreaterThan(0);
    expect(marksmanBuys.length).toBeGreaterThan(0);

    const swarmInfantry = swarmBuys.filter((k) => k === 'infantry').length;
    expect(swarmInfantry / swarmBuys.length).toBeGreaterThan(0.9); // basically all

    const marksmanRanged = marksmanBuys.filter((k) => RANGED.has(k)).length;
    expect(marksmanRanged).toBeGreaterThanOrEqual(1); // at least one ranged buy
    // And distinct from swarm: marksman is materially LESS infantry-pure.
    const marksmanInfantry = marksmanBuys.filter((k) => k === 'infantry').length;
    expect(marksmanInfantry / marksmanBuys.length).toBeLessThan(
      swarmInfantry / swarmBuys.length,
    );
  });
});

// ── Determinism per archetype ───────────────────────────────────────────────
describe('every archetype plays deterministically', () => {
  const snap = (r: ReturnType<typeof vsDoNothing>) =>
    JSON.stringify({
      units: r.state.units,
      bases: r.state.bases,
      credits: r.state.credits,
      outcome: r.state.outcome ?? null,
      round: r.state.round,
    });
  for (const key of KEYS) {
    it(`${key} — same seed → identical final state`, () => {
      expect(snap(vsDoNothing(key, 7))).toBe(snap(vsDoNothing(key, 7)));
    });
  }
});
