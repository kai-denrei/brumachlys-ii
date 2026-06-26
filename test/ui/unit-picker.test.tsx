// @vitest-environment jsdom
// Phase 3 Task 3.2 — UnitPicker: the roster grid + affordability + focused
// stat row lifted out of the retired build card, with the card chrome/anchor/
// scrim dropped.
// A plain block the parent lays out: roster sorted cost asc (ties initiative
// desc), cells disabled when cost > available (unless queued), onPick on tap,
// and a demoted i/a/r/v/p/h/m row that follows the focused (hovered) unit.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import unitsJson from '../../data/units.json';
import { loadUnits } from '../../src/io/data-loader';
import { UnitPicker } from '../../src/ui/UnitPicker';

afterEach(cleanup);
const types = loadUnits();

function picker(over: Partial<Parameters<typeof UnitPicker>[0]> = {}) {
  return render(
    <UnitPicker unitTypes={types} available={200} onPick={() => {}} {...over} />,
  );
}

describe('UnitPicker', () => {
  it('lists all 8 units in a grid with icon, name, and cost', () => {
    const { baseElement } = picker();
    const cells = baseElement.querySelectorAll('.build-row');
    expect(cells.length).toBe(Object.keys(unitsJson).length); // 8
    expect(baseElement.querySelectorAll('.build-cell .unit-glyph').length).toBe(cells.length);
  });

  it('cells whose cost exceeds available are disabled', () => {
    const { baseElement } = picker({ available: 200 });
    const cell = (name: string) =>
      [...baseElement.querySelectorAll('.build-row')].find((r) =>
        r.textContent!.includes(name),
      ) as HTMLButtonElement;
    expect(cell('Infantry').disabled).toBe(false); // 75
    expect(cell('Ranger').disabled).toBe(false); // 150
    expect(cell('Heavy Tank').disabled).toBe(true); // 600
  });

  it('a queued cell stays enabled even when its cost exceeds available', () => {
    const { baseElement } = picker({ available: 0, queuedKey: 'heavytank' });
    const cell = [...baseElement.querySelectorAll('.build-row')].find((r) =>
      r.textContent!.includes('Heavy Tank'),
    ) as HTMLButtonElement;
    expect(cell.disabled).toBe(false);
    expect(cell.className).toContain('build-row-queued');
  });

  it('clicking an affordable cell calls onPick with its key', () => {
    const onPick = vi.fn();
    const { baseElement } = picker({ onPick });
    fireEvent.click(baseElement.querySelector('[data-build-type="ranger"]')!);
    expect(onPick).toHaveBeenCalledWith('ranger');
  });

  it('the focused stat row updates on pointer enter', () => {
    const { baseElement, getByTestId } = picker();
    const sniperCell = baseElement.querySelector('[data-build-type="sniper"]')!;
    fireEvent.pointerEnter(sniperCell);
    const stat = getByTestId('build-stat-row');
    expect(stat.textContent).toContain('i:13 a:4 r:1–2 v:4 p:9 h:2 m:6');
    expect(stat.textContent).toContain('Sniper');
  });
});
