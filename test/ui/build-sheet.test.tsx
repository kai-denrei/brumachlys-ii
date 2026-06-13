// @vitest-environment jsdom
// E3 / v0.7 Item 3 — the build CARD (addendum §B.4, redesigned): a compact
// 4×2 grid of unit cells (icon + name + cost), affordability gating against
// credits − committed-elsewhere, queued highlight, a DEMOTED i/a/r/v/p/h/m stat
// row reflecting the focused unit, and queue/replace/remove callbacks. It pops
// up anchored over the tapped base instead of a full-width bottom sheet.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import unitsJson from '../../data/units.json';
import { loadUnits } from '../../src/io/data-loader';
import { BuildSheet, anchorCardStyle } from '../../src/ui/BuildSheet';

afterEach(cleanup);
const types = loadUnits();

function sheet(over: Partial<Parameters<typeof BuildSheet>[0]> = {}) {
  return render(
    <BuildSheet
      baseCell={7}
      unitTypes={types}
      credits={250}
      committedElsewhere={0}
      onQueue={() => {}}
      onRemove={() => {}}
      onClose={() => {}}
      {...over}
    />,
  );
}

describe('BuildSheet (v0.7 compact card)', () => {
  it('lists all 8 units in a grid with icon, name, and cost', () => {
    const { baseElement } = sheet();
    const cells = baseElement.querySelectorAll('.build-row');
    expect(cells.length).toBe(Object.keys(unitsJson).length); // 8
    const sniper = [...cells].find((r) => r.textContent!.includes('Sniper'))!;
    expect(sniper.textContent).toContain('◈ 200');
    // skin art on every cell
    expect(baseElement.querySelectorAll('.build-cell .unit-glyph').length).toBe(cells.length);
  });

  it('the demoted stat row carries the i/a/r/v/p/h/m line for the focused unit', () => {
    const { baseElement, getByTestId } = sheet();
    // focus a cell by hovering it
    const sniperCell = baseElement.querySelector('[data-build-type="sniper"]')!;
    fireEvent.pointerEnter(sniperCell);
    const stat = getByTestId('build-stat-row');
    // v0.6 Ask 4: m = raw movement budget (tenths) joins the vocabulary
    expect(stat.textContent).toContain('i:13 a:4 r:1–2 v:4 p:9 h:2 m:6');
    expect(stat.textContent).toContain('Sniper');
  });

  it('cells above the available budget are disabled (credits − committed elsewhere)', () => {
    const { baseElement } = sheet({ credits: 250, committedElsewhere: 150 }); // 100 available
    const cell = (name: string) =>
      [...baseElement.querySelectorAll('.build-row')].find((r) =>
        r.textContent!.includes(name),
      ) as HTMLButtonElement;
    expect(cell('Infantry').disabled).toBe(false); // 75
    expect(cell('Ranger').disabled).toBe(true); // 150
    expect(cell('Heavy Tank').disabled).toBe(true); // 600
    expect(baseElement.querySelector('[data-testid="build-available"]')!.textContent).toContain(
      '100',
    );
  });

  it('tapping an affordable cell queues it; the queued cell is highlighted and removes', () => {
    const onQueue = vi.fn();
    const onRemove = vi.fn();
    const { baseElement } = sheet({ onQueue, onRemove });
    fireEvent.click(baseElement.querySelector('[data-build-type="ranger"]')!);
    expect(onQueue).toHaveBeenCalledWith('ranger');

    cleanup();
    const second = sheet({
      onQueue,
      onRemove,
      queued: { kind: 'buy', baseCell: 7, unitTypeKey: 'sniper' },
    });
    const queuedCell = second.baseElement.querySelector('[data-build-type="sniper"]')!;
    expect(queuedCell.className).toContain('build-row-queued');
    expect(queuedCell.textContent).toContain('queued');
    fireEvent.click(queuedCell); // tapping the queued cell removes it
    expect(onRemove).toHaveBeenCalled();
    // and the explicit remove action exists
    expect(second.baseElement.textContent).toContain('remove Sniper order');
  });

  it('anchorCardStyle clamps over the tap point and flips above/below', () => {
    // tap low on screen → card sits ABOVE (translateY -100%)
    const low = anchorCardStyle({ x: 200, y: 700 }, 390, 844);
    expect(low.transform).toContain('-100%');
    // tap high → card sits BELOW
    const high = anchorCardStyle({ x: 200, y: 100 }, 390, 844);
    expect(high.transform).toBe('translate(-50%, 0)');
    // x clamped so a near-edge tap keeps the card on screen
    const edge = anchorCardStyle({ x: 5, y: 400 }, 390, 844);
    expect(Number(edge.left)).toBeGreaterThanOrEqual(150 + 8); // half width + margin
    // no anchor → centered
    const centered = anchorCardStyle(undefined, 390, 844);
    expect(centered.transform).toContain('-50%, -50%');
  });
});
