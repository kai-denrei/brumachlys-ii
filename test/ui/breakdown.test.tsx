// @vitest-environment jsdom
// §9.4 breakdown modal: renders every formula term from a fixture event —
// A + Ta − D − Td + B → p → damage, gang-up contributions itemized by class,
// and the fire-from-the-mist attacker withholding.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AttackBreakdown } from '../../src/core/types';
import type { Strike, TimelineSlot } from '../../src/state/replay';
import { BreakdownModal } from '../../src/ui/Replay';
import { loadUnits } from '../../src/io/data-loader';

const types = loadUnits();

const breakdown: AttackBreakdown = {
  A: 5,
  Ta: 1,
  D: 6,
  Td: 2,
  B: 3,
  vet: 0,
  p: 0.55,
  damage: 3,
  gangUp: {
    total: 3,
    contributions: [
      { entry: { cell: 9, ranged: false }, cls: 'opposite', weight: 3 },
    ],
  },
};

const strike = (over: Partial<Strike> = {}): Strike => ({
  kind: 'attack',
  attackerId: 'pt',
  attackerType: 'tank',
  attackerCell: 3,
  attackerFaction: 0,
  defenderId: 'ei',
  defenderType: 'infantry',
  defenderCell: 4,
  defenderFaction: 1,
  damage: 3,
  fromMist: false,
  breakdown,
  ...over,
});

const slot = (strikes: Strike[]): TimelineSlot => ({
  kind: 'volley',
  actorType: 'tank',
  actorFaction: 0,
  strikes,
});

describe('BreakdownModal (§9.4)', () => {
  afterEach(cleanup);

  it('renders every term of A + Ta − D − Td + B → p → damage', () => {
    render(<BreakdownModal slot={slot([strike()])} unitTypes={types} onClose={() => {}} />);

    // term labels
    expect(screen.getByText('attack strength')).toBeTruthy();
    expect(screen.getByText('terrain attack bonus')).toBeTruthy();
    expect(screen.getByText('defender armor')).toBeTruthy();
    expect(screen.getByText('terrain armor bonus')).toBeTruthy();
    expect(screen.getByText('gang-up bonus')).toBeTruthy();
    // term values
    expect(screen.getByText('5')).toBeTruthy(); // A
    expect(screen.getByText('+1')).toBeTruthy(); // Ta
    expect(screen.getByText('−6')).toBeTruthy(); // D
    expect(screen.getByText('−2')).toBeTruthy(); // Td
    // B and its itemization by class
    expect(screen.getAllByText('+3').length).toBeGreaterThanOrEqual(2); // B row + contribution
    expect(screen.getByText('↳ opposite')).toBeTruthy();
    // p and damage
    expect(screen.getByText('0.55')).toBeTruthy();
    expect(screen.getByText(/0\.5 \+ 0\.05/)).toBeTruthy();
    expect(screen.getByText('damage')).toBeTruthy();
    // unit names resolve through the registry
    expect(screen.getByText('Tank')).toBeTruthy();
    expect(screen.getByText('Infantry')).toBeTruthy();
  });

  it('renders both halves of a volley (attack + counter)', () => {
    const counter = strike({
      kind: 'counter',
      attackerId: 'ei',
      attackerType: 'infantry',
      attackerCell: 4,
      attackerFaction: 1,
      defenderId: 'pt',
      defenderType: 'tank',
      defenderCell: 3,
      defenderFaction: 0,
      breakdown: { ...breakdown, B: 0, gangUp: { total: 0, contributions: [] } },
    });
    render(
      <BreakdownModal slot={slot([strike(), counter])} unitTypes={types} onClose={() => {}} />,
    );
    expect(screen.getByText('Attack')).toBeTruthy();
    expect(screen.getByText('Counter-attack')).toBeTruthy();
  });

  it('withholds the attacker for fire-from-the-mist strikes', () => {
    const mist = strike({
      fromMist: true,
      attackerId: null,
      attackerType: null,
      attackerCell: null,
      attackerFaction: null,
    });
    render(<BreakdownModal slot={slot([mist])} unitTypes={types} onClose={() => {}} />);
    expect(screen.getByText('from the mist')).toBeTruthy();
    expect(screen.queryByText('Tank')).toBeNull(); // no attacker name leaks
  });
});
