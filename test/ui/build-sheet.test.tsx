// @vitest-environment jsdom
// E3 — the build sheet (addendum §B.4): full roster with cost + stat line,
// affordability gating against credits − committed-elsewhere, queued
// highlight, queue/replace/remove callbacks.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import unitsJson from '../../data/units.json';
import { loadUnits } from '../../src/io/data-loader';
import { BuildSheet } from '../../src/ui/BuildSheet';

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

describe('BuildSheet', () => {
  it('lists the full roster with cost and the i/a/r/v/p/h/m stat line', () => {
    const { baseElement } = sheet();
    const rows = baseElement.querySelectorAll('.build-row');
    expect(rows.length).toBe(Object.keys(unitsJson).length); // 8
    const sniper = [...rows].find((r) => r.textContent!.includes('Sniper'))!;
    expect(sniper.textContent).toContain('◈ 200');
    // v0.6 Ask 4: m = raw movement budget (tenths) joins the vocabulary
    expect(sniper.textContent).toContain('i:13 a:4 r:1–2 v:4 p:9 h:2 m:6');
    // skin art on every row
    expect(baseElement.querySelectorAll('.build-row .unit-glyph').length).toBe(rows.length);
  });

  it('rows above the available budget are disabled (credits − committed elsewhere)', () => {
    const { baseElement } = sheet({ credits: 250, committedElsewhere: 150 }); // 100 available
    const row = (name: string) =>
      [...baseElement.querySelectorAll('.build-row')].find((r) =>
        r.textContent!.includes(name),
      ) as HTMLButtonElement;
    expect(row('Infantry').disabled).toBe(false); // 75
    expect(row('Ranger').disabled).toBe(true); // 150
    expect(row('Heavy Tank').disabled).toBe(true); // 600
    expect(baseElement.querySelector('[data-testid="build-available"]')!.textContent).toContain(
      '100',
    );
  });

  it('tapping an affordable row queues it; the queued row is highlighted and removes', () => {
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
    const queuedRow = second.baseElement.querySelector('[data-build-type="sniper"]')!;
    expect(queuedRow.className).toContain('build-row-queued');
    expect(queuedRow.textContent).toContain('queued');
    fireEvent.click(queuedRow); // tapping the queued row removes it
    expect(onRemove).toHaveBeenCalled();
    // and the explicit remove action exists
    expect(second.baseElement.textContent).toContain('remove Sniper order');
  });
});
