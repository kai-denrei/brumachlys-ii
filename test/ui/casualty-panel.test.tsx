// @vitest-environment jsdom
// v1.3 Tweak C — casualty recap panel: collapses to nothing when empty, two
// compact icon rows (yours / enemy-destroyed) rendered through the same skin
// renderer, repeats repeat the icon (chess style).

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { CasualtyPanel } from '../../src/ui/CasualtyPanel';
import { loadUnits } from '../../src/io/data-loader';

afterEach(cleanup);

const types = loadUnits();

describe('CasualtyPanel', () => {
  it('renders nothing while both rows are empty', () => {
    const { container } = render(<CasualtyPanel casualties={[]} unitTypes={types} />);
    expect(container.firstChild).toBeNull();
  });

  it('splits casualties into own-fallen and enemy-destroyed rows, in order', () => {
    const { container } = render(
      <CasualtyPanel
        casualties={[
          { type: 'sniper', faction: 0 },
          { type: 'tank', faction: 1 },
          { type: 'infantry', faction: 0 },
          { type: 'tank', faction: 1 }, // duplicate type → repeated icon
        ]}
        unitTypes={types}
      />,
    );
    const rows = container.querySelectorAll('.casualty-row');
    expect(rows.length).toBe(2);
    // row 1 = your fallen (faction 0), order of death
    const own = rows[0]!.querySelectorAll('[data-unit-type]');
    expect([...own].map((el) => el.getAttribute('data-unit-type'))).toEqual([
      'sniper',
      'infantry',
    ]);
    // row 2 = enemy units you destroyed — chess-style repeats
    const enemy = rows[1]!.querySelectorAll('[data-unit-type]');
    expect([...enemy].map((el) => el.getAttribute('data-unit-type'))).toEqual(['tank', 'tank']);
    expect(rows[0]!.getAttribute('aria-label')).toContain('your fallen');
    expect(rows[1]!.getAttribute('aria-label')).toContain('enemy');
  });

  it('shows only the non-empty row', () => {
    const { container } = render(
      <CasualtyPanel casualties={[{ type: 'tank', faction: 1 }]} unitTypes={types} />,
    );
    const rows = container.querySelectorAll('.casualty-row');
    expect(rows.length).toBe(1);
    expect(rows[0]!.getAttribute('aria-label')).toContain('enemy');
  });
});
