// Angle-based gang-up — spec §5.3 classification, §13.3 vectors.
// Synthetic board: defender at the origin (cell 0), melee attackers on the
// unit circle at known bearings, and a 3-cell chain providing a ranged
// attacker at graphDistance 3.

import { describe, expect, test } from 'vitest';
import {
  GANGUP_WEIGHT,
  classifyPriorAttack,
  gangUpBonus,
  gangUpBreakdown,
  makeAttackedFromEntry,
} from '../../src/core/combat/gangup';
import type { AttackedFromEntry } from '../../src/core/types';
import type { Vec2 } from '../../src/board/types';
import { syntheticBoard } from './synthetic';

const at = (deg: number): Vec2 => [
  Math.cos((deg * Math.PI) / 180),
  Math.sin((deg * Math.PI) / 180),
];

// ids: 0 defender | 1 bearing 0° | 2 bearing 170° | 3 bearing 90° | 4 bearing 30°
//      5,6,7 chain south (graphDistance 1,2,3)
//      8..11 classification-boundary cells at bearings 59°, 61°, 134°, 136°
const board = syntheticBoard(
  [
    { center: [0, 0] }, // 0 defender
    { center: at(0) }, // 1
    { center: at(170) }, // 2
    { center: at(90) }, // 3
    { center: at(30) }, // 4
    { center: [0, -1] }, // 5
    { center: [0, -2] }, // 6
    { center: [0, -3] }, // 7 — ranged attacker, graphDistance 3
    { center: at(59) }, // 8
    { center: at(61) }, // 9
    { center: at(134) }, // 10
    { center: at(136) }, // 11
  ],
  [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [0, 5],
    [5, 6],
    [6, 7],
    [0, 8],
    [0, 9],
    [0, 10],
    [0, 11],
  ],
);

const D = 0;
const melee = (cell: number): AttackedFromEntry => ({ cell, ranged: false });

describe('makeAttackedFromEntry — ranged fixed at fire time (graphDistance > 1)', () => {
  test('adjacent attacker → ranged false', () => {
    expect(makeAttackedFromEntry(board, D, 1)).toEqual({ cell: 1, ranged: false });
  });

  test('graphDistance 2 → ranged true', () => {
    expect(makeAttackedFromEntry(board, D, 6)).toEqual({ cell: 6, ranged: true });
  });

  test('graphDistance 3 → ranged true', () => {
    expect(makeAttackedFromEntry(board, D, 7)).toEqual({ cell: 7, ranged: true });
  });
});

describe('§13.3 attack sequence', () => {
  test('attack 1 (bearing 0°, no priors) → B=0', () => {
    expect(gangUpBonus(board, D, 1, [])).toBe(0);
  });

  test('attack 2 from bearing 170° → prior at 0° classified opposite, B=3', () => {
    const priors = [makeAttackedFromEntry(board, D, 1)];
    expect(gangUpBonus(board, D, 2, priors)).toBe(3);
  });

  test('attack 3 from bearing 90° → priors at θ=90° and θ=80°, both flanking, B=4', () => {
    const priors = [makeAttackedFromEntry(board, D, 1), makeAttackedFromEntry(board, D, 2)];
    expect(gangUpBonus(board, D, 3, priors)).toBe(4);
  });

  test('ranged prior (graphDistance 3) → +1 regardless of bearing', () => {
    const priors = [makeAttackedFromEntry(board, D, 7)]; // ranged: true
    // Bearing 270° vs current 90° would be θ=180 (opposite +3) if melee:
    expect(gangUpBonus(board, D, 3, priors)).toBe(1);
    // and vs current 170° (θ=100, flanking +2 if melee):
    expect(gangUpBonus(board, D, 2, priors)).toBe(1);
    expect(classifyPriorAttack(board, D, 3, priors[0]!)).toBe('ranged');
  });
});

describe('angle class boundaries (θ<60 +1; 60≤θ<135 +2; θ≥135 +3)', () => {
  const prior0 = melee(1); // bearing 0°

  test('θ = 30° → adjacent (+1)', () => {
    expect(classifyPriorAttack(board, D, 4, prior0)).toBe('adjacent');
  });

  test('θ = 59° → adjacent; θ = 61° → flanking', () => {
    expect(classifyPriorAttack(board, D, 8, prior0)).toBe('adjacent');
    expect(classifyPriorAttack(board, D, 9, prior0)).toBe('flanking');
  });

  test('θ = 134° → flanking; θ = 136° → opposite', () => {
    expect(classifyPriorAttack(board, D, 10, prior0)).toBe('flanking');
    expect(classifyPriorAttack(board, D, 11, prior0)).toBe('opposite');
  });

  test('weights: ranged/adjacent +1, flanking +2, opposite +3', () => {
    expect(GANGUP_WEIGHT).toEqual({ ranged: 1, adjacent: 1, flanking: 2, opposite: 3 });
  });
});

describe('gangUpBreakdown — itemized for the §9.4 breakdown modal', () => {
  test('mixed priors itemize and sum: ranged + opposite + flanking = 6', () => {
    const priors = [
      { cell: 7, ranged: true }, // +1
      melee(2), // θ(170°, 0°) = 170 → opposite +3 (current at bearing 0°)
      melee(3), // θ(90°, 0°) = 90 → flanking +2
    ];
    const b = gangUpBreakdown(board, D, 1, priors);
    expect(b.total).toBe(6);
    expect(b.contributions.map((c) => c.cls)).toEqual(['ranged', 'opposite', 'flanking']);
    expect(b.contributions.map((c) => c.weight)).toEqual([1, 3, 2]);
  });

  test('does not mutate the priors array (counter-attacks never accumulate —', () => {
    // the accumulator only grows when the resolver calls makeAttackedFromEntry
    // for a REAL attack; nothing in core/combat appends to it.
    const priors = [melee(1), { cell: 7, ranged: true }];
    const snapshot = JSON.parse(JSON.stringify(priors));
    gangUpBonus(board, D, 3, priors);
    gangUpBreakdown(board, D, 3, priors);
    expect(priors).toEqual(snapshot);
  });
});
