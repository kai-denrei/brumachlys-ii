// @vitest-environment jsdom
// v1.2 tweak 2 — the rules modal behind the TopBar "i": opens/closes, pulls
// the units table from data/units.json at runtime (no drift), renders the
// real icon art through the skin, and keeps its copy strictly hyphen free
// (en dashes for ranges and a typographic minus are the only dash glyphs).

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import unitsJson from '../../data/units.json';
import { TopBar } from '../../src/ui/TopBar';
import { RulesModal, fmtRange } from '../../src/ui/RulesModal';

afterEach(cleanup);

describe('TopBar "i" affordance', () => {
  it('opens the rules modal and closes it again', () => {
    const { baseElement, getByLabelText } = render(<TopBar round={3} phase="planning" />);
    expect(baseElement.querySelector('[data-testid="rules-modal"]')).toBeNull();
    fireEvent.click(getByLabelText('how to play'));
    expect(baseElement.querySelector('[data-testid="rules-modal"]')).not.toBeNull();
    fireEvent.click(getByLabelText('close rules'));
    expect(baseElement.querySelector('[data-testid="rules-modal"]')).toBeNull();
  });
});

describe('RulesModal', () => {
  it('units table has one row per roster type, numbers straight from units.json', () => {
    const { baseElement } = render(<RulesModal onClose={() => {}} />);
    const rows = baseElement.querySelectorAll('[data-testid="rules-units-table"] tbody tr');
    const types = Object.values(unitsJson);
    expect(rows.length).toBe(types.length); // 8
    // initiative-descending order; spot-check the sniper row end to end
    const sniper = [...rows].find((r) => r.textContent!.includes('Sniper'))!;
    const cells = [...sniper.querySelectorAll('td')].slice(1).map((c) => c.textContent);
    expect(cells).toEqual(['Sniper', '13', '4', '1–2', '4', '9', '2']);
    // every row carries the skin's icon art (not a per-site glyph)
    expect(
      baseElement.querySelectorAll('[data-testid="rules-units-table"] .unit-glyph').length,
    ).toBe(types.length);
  });

  it('terrain table marks impassables and shows class costs', () => {
    const { baseElement } = render(<RulesModal onClose={() => {}} />);
    const rows = [...baseElement.querySelectorAll('[data-testid="rules-terrain-table"] tbody tr')];
    expect(rows.length).toBe(6);
    const row = (name: string) =>
      [...rows.find((r) => r.textContent!.startsWith(name))!.querySelectorAll('td')].map(
        (c) => c.textContent,
      );
    expect(row('Mountains')).toEqual(['Mountains', '6', '+2/+2', '—', '—']);
    expect(row('Water')).toEqual(['Water', '—', '—', '—', '—']);
    expect(row('Woods')).toEqual(['Woods', '4', '0/+2', '6', '0/0']);
  });

  it('copy contains no hyphen anywhere (en dash ranges allowed)', () => {
    const { baseElement } = render(<RulesModal onClose={() => {}} />);
    const text = baseElement.querySelector('[data-testid="rules-modal"]')!.textContent!;
    expect(text).not.toContain('-'); // U+002D
    expect(text).toContain('2–4'); // artillery range, en dash
    expect(text).toContain('gang up');
    expect(text).toContain('hold fire');
  });

  it('E3: covers conquest — bases, credits, production, both win conditions', () => {
    const { baseElement } = render(<RulesModal onClose={() => {}} />);
    const headings = [...baseElement.querySelectorAll('.rules-h')].map((h) => h.textContent);
    expect(headings).toContain('Bases');
    expect(headings).toContain('Credits');
    expect(headings).toContain('Production');
    const text = baseElement.querySelector('[data-testid="rules-modal"]')!.textContent!;
    expect(text).toContain('raises the colors');
    expect(text).toContain('Vehicles never capture');
    expect(text).toContain('Credits are spent only when the recruit arrives');
    expect(text).toContain('Skirmish');
    expect(text).toContain('Conquest');
    expect(text).toContain('zero bases for 3 round ends');
  });

  it('fmtRange collapses when min equals max', () => {
    expect(fmtRange(1, 1)).toBe('1');
    expect(fmtRange(2, 4)).toBe('2–4');
    expect(fmtRange(2, 4)).not.toContain('-');
  });
});
