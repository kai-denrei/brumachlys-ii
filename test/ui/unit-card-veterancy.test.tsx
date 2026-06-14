// @vitest-environment jsdom
// Veterancy display in UnitCard — rank · xp · kills rendered for veteran units.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { loadUnits } from '../../src/io/data-loader';
import { UnitCard } from '../../src/ui/Sheets';
import type { UnitInstance } from '../../src/core/types';

afterEach(cleanup);

const types = loadUnits();
const sniperType = types['sniper']!;

function makeVetUnit(overrides: Partial<UnitInstance> = {}): UnitInstance {
  return {
    id: 'test-unit',
    type: 'sniper',
    faction: 0,
    cell: 0,
    count: 9,
    stance: 'aggressive',
    attackedFrom: [],
    xp: 0,
    rank: 0,
    kills: 0,
    ...overrides,
  };
}

describe('UnitCard – veterancy display', () => {
  it('shows rank=0, xp=0, kills=0 for a fresh unit', () => {
    const unit = makeVetUnit();
    const { container } = render(<UnitCard unit={unit} unitType={sniperType} />);
    const vet = container.querySelector('.unit-card-veterancy');
    expect(vet).not.toBeNull();
    expect(vet!.textContent).toContain('xp 0');
    expect(vet!.textContent).toContain('kills 0');
  });

  it('shows rank stars, xp, and kill count for a veteran unit', () => {
    const unit = makeVetUnit({ rank: 2, xp: 200, kills: 5 });
    const { container } = render(<UnitCard unit={unit} unitType={sniperType} />);
    const vet = container.querySelector('.unit-card-veterancy');
    expect(vet).not.toBeNull();
    expect(vet!.textContent).toContain('★★');
    expect(vet!.textContent).toContain('xp 200');
    expect(vet!.textContent).toContain('kills 5');
  });

  it('handles missing kills/rank/xp fields (legacy fixture — all absent)', () => {
    // Legacy unit without the optional fields — must not crash.
    const unit: UnitInstance = {
      id: 'legacy',
      type: 'sniper',
      faction: 1,
      cell: 0,
      count: 10,
      stance: 'aggressive',
      attackedFrom: [],
    };
    const { container } = render(<UnitCard unit={unit} unitType={sniperType} />);
    const vet = container.querySelector('.unit-card-veterancy');
    expect(vet).not.toBeNull();
    expect(vet!.textContent).toContain('xp 0');
    expect(vet!.textContent).toContain('kills 0');
  });
});
