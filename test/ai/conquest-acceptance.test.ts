// E4 conquest acceptance (addendum §B.7), on bundled donor 53316 (Valley
// Road — 12 base sites, 1 owned per faction, 10 neutral; 200 starting
// credits, 100/base income; default [infantry, infantry, ranger] forces):
//   (a) greedy (with buys) beats do-nothing-with-no-buys on 3 seeds,
//       DECISIVELY — win reason 'conquest' or 'base-collapse';
//   (b) greedy-vs-greedy reaches a decisive end within 80 rounds on ≥2 of
//       the 3 seeds {7, 11, 13} (a stall on the third is logged, not forced);
//   (d) determinism — same seed → identical final state;
//   (e) planning stays under the ~50 ms per-faction-round budget (measured
//       and reported, with the board's cell count).
// Fairness probes (c) live in conquest-planner.test.ts.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { generateBoard } from '../../src/board/donor';
import type { Board } from '../../src/board/types';
import { newGame } from '../../src/core/setup';
import { loadScenarios, loadUnits } from '../../src/io/data-loader';
import { parseWeewarMap, toDonorMap } from '../../src/io/weewar-xml';
import { greedyPlanner } from '../../src/ai/planner-greedy';
import { doNothingPlanner } from '../../src/ai/planner-donothing';
import { playConquest } from './conquest-harness';
import type { ConquestReport } from './conquest-harness';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAPS_DIR = resolve(__dirname, '../../data/maps');
const DONOR_ID = '53316'; // Valley Road
const SEEDS = [7, 11, 13];

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

function play(seed: number, vsGreedy: boolean, maxRounds: number): ConquestReport {
  const board = valleyRoad(seed);
  const state = newGame(board, standard.forces, types, seed, 'conquest');
  return playConquest(
    board,
    state,
    [greedyPlanner, vsGreedy ? greedyPlanner : doNothingPlanner],
    types,
    seed,
    maxRounds,
  );
}

describe(`conquest acceptance — donor ${DONOR_ID} (§B.7)`, () => {
  const allPlanTimes: number[] = [];

  // (a) greedy beats do-nothing-with-no-buys, decisively, on 3 seeds.
  for (const seed of SEEDS) {
    it(`seed ${seed}: greedy beats do-nothing decisively (conquest / base-collapse)`, () => {
      const r = play(seed, false, 120);
      allPlanTimes.push(...r.planTimesMs);
      expect(r.state.outcome).toBeDefined();
      expect(r.state.outcome!.winner).toBe(0);
      expect(['conquest', 'base-collapse']).toContain(r.state.outcome!.reason);
      console.log(
        `[conquest] seed ${seed} vs do-nothing: ${r.state.outcome!.reason} in ${r.rounds} rounds, ` +
          `bases ${r.baseCounts[0]}-${r.baseCounts[1]}, units ${r.unitCounts[0]}-${r.unitCounts[1]}`,
      );
    });
  }

  // (b) greedy-vs-greedy: decisive within 80 rounds on ≥2 of 3 seeds.
  it('greedy vs greedy reaches a decisive end within 80 rounds on ≥2 of 3 seeds', () => {
    let decisive = 0;
    for (const seed of SEEDS) {
      const r = play(seed, true, 80);
      allPlanTimes.push(...r.planTimesMs);
      const o = r.state.outcome;
      const isDecisive =
        o !== undefined && o.winner !== null && (o.reason === 'conquest' || o.reason === 'base-collapse');
      if (isDecisive) decisive++;
      console.log(
        `[conquest] seed ${seed} greedy mirror: ` +
          (o
            ? `${o.reason} (winner ${o.winner}) in ${r.rounds} rounds`
            : `STALLED at round cap (${r.rounds})`) +
          `, bases ${r.baseCounts[0]}-${r.baseCounts[1]}, units ${r.unitCounts[0]}-${r.unitCounts[1]}`,
      );
    }
    expect(decisive).toBeGreaterThanOrEqual(2);
  });

  // (d) determinism: belief threading, planning, buys, resolution — all of it.
  it('full conquest game is deterministic: same seed → identical final state', () => {
    const a = play(7, true, 80);
    const b = play(7, true, 80);
    const snap = (r: ConquestReport) =>
      JSON.stringify({
        units: r.state.units,
        bases: r.state.bases,
        credits: r.state.credits,
        outcome: r.state.outcome ?? null,
        round: r.state.round,
      });
    expect(snap(a)).toBe(snap(b));
  });

  // (e) planning-time budget, measured on this board.
  it('conquest planning stays under the ~50 ms per-faction-round budget', () => {
    expect(allPlanTimes.length).toBeGreaterThan(0);
    const avg = allPlanTimes.reduce((x, y) => x + y, 0) / allPlanTimes.length;
    const max = Math.max(...allPlanTimes);
    const cells = valleyRoad(7).cells.size;
    console.log(
      `[conquest] planning over ${allPlanTimes.length} faction-rounds on ${cells} cells: ` +
        `avg ${avg.toFixed(2)} ms, max ${max.toFixed(2)} ms`,
    );
    expect(avg).toBeLessThan(50);
    expect(max).toBeLessThan(150); // generous CI guard, same as skirmish
  });
});
