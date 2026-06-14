// @vitest-environment jsdom
// v1.3 Tweak C — casualty recap panel: collapses to nothing when empty, two
// compact icon rows (yours / enemy-destroyed) rendered through the same skin
// renderer, repeats repeat the icon (chess style).
// v0.9 — expandable modal: clicking the panel opens CasualtyModal with bigger
// icons grouped by type, per-side credit value totals, and per-unit full stats
// (incl. cost). Modal closes via scrim click or ✕.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import { CasualtyPanel, CasualtyModal } from '../../src/ui/CasualtyPanel';
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

describe('CasualtyModal (v0.9)', () => {
  const casualties = [
    { type: 'infantry', faction: 0 as const },
    { type: 'infantry', faction: 0 as const },
    { type: 'sniper', faction: 0 as const },
    { type: 'tank', faction: 1 as const },
    { type: 'tank', faction: 1 as const },
    { type: 'tank', faction: 1 as const },
  ];

  it('clicking the panel opens the modal', () => {
    const { getByTestId } = render(<CasualtyPanel casualties={casualties} unitTypes={types} />);
    const panel = getByTestId('casualty-panel');
    expect(() => getByTestId('casualty-modal')).toThrow();
    fireEvent.click(panel);
    expect(getByTestId('casualty-modal')).toBeTruthy();
  });

  it('modal shows grouped casualties with counts', () => {
    const { getByTestId } = render(<CasualtyPanel casualties={casualties} unitTypes={types} />);
    fireEvent.click(getByTestId('casualty-panel'));
    // infantry ×2 grouped — button exists
    const infantryBtn = getByTestId('casualty-unit-btn-infantry');
    expect(infantryBtn).toBeTruthy();
    // count ×2 displayed
    expect(infantryBtn.textContent).toContain('×2');
    // tank ×3 grouped
    const tankBtn = getByTestId('casualty-unit-btn-tank');
    expect(tankBtn.textContent).toContain('×3');
  });

  it('modal shows per-side credit value totals', () => {
    const { getByTestId } = render(<CasualtyPanel casualties={casualties} unitTypes={types} />);
    fireEvent.click(getByTestId('casualty-panel'));
    // "your losses" section header should show non-zero value (infantry + sniper costs)
    const section = getByTestId('casualty-section-your-losses');
    const infantryCost = types['infantry']!.cost;
    const sniperCost = types['sniper']!.cost;
    const expectedValue = infantryCost * 2 + sniperCost;
    expect(section.textContent).toContain(`◈ ${expectedValue}`);
  });

  it('tapping a unit button shows its full stat card including cost', () => {
    const { getByTestId } = render(<CasualtyPanel casualties={casualties} unitTypes={types} />);
    fireEvent.click(getByTestId('casualty-panel'));
    // no detail card yet
    expect(() => getByTestId('casualty-detail-card')).toThrow();
    // tap infantry
    fireEvent.click(getByTestId('casualty-unit-btn-infantry'));
    const detail = getByTestId('casualty-detail-card');
    // detail card visible
    expect(detail).toBeTruthy();
    // must contain "cost" text (the UnitCard dt label)
    expect(detail.textContent).toContain('cost');
    // must contain the actual cost value
    const cost = types['infantry']!.cost;
    expect(detail.textContent).toContain(String(cost));
  });

  it('tapping the same unit again collapses the detail', () => {
    const { getByTestId } = render(<CasualtyPanel casualties={casualties} unitTypes={types} />);
    fireEvent.click(getByTestId('casualty-panel'));
    fireEvent.click(getByTestId('casualty-unit-btn-tank'));
    expect(getByTestId('casualty-detail-card')).toBeTruthy();
    fireEvent.click(getByTestId('casualty-unit-btn-tank'));
    expect(() => getByTestId('casualty-detail-card')).toThrow();
  });

  it('clicking the ✕ closes the modal', () => {
    const { getByTestId } = render(<CasualtyPanel casualties={casualties} unitTypes={types} />);
    fireEvent.click(getByTestId('casualty-panel'));
    expect(getByTestId('casualty-modal')).toBeTruthy();
    fireEvent.click(getByTestId('casualty-modal-close'));
    expect(() => getByTestId('casualty-modal')).toThrow();
  });

  it('clicking the scrim closes the modal', () => {
    const { getByTestId } = render(<CasualtyPanel casualties={casualties} unitTypes={types} />);
    fireEvent.click(getByTestId('casualty-panel'));
    expect(getByTestId('casualty-modal')).toBeTruthy();
    fireEvent.click(getByTestId('casualty-modal-scrim'));
    expect(() => getByTestId('casualty-modal')).toThrow();
  });

  it('modal shows "no casualties yet" when empty', () => {
    // The panel returns null when empty, so test the empty state via the
    // exported CasualtyModal component directly.
    const { getByText } = render(
      <CasualtyModal fallen={[]} destroyed={[]} unitTypes={types} onClose={() => {}} />,
    );
    expect(getByText('No casualties yet.')).toBeTruthy();
  });
});
