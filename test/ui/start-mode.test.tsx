// @vitest-environment jsdom
// E3 — start screen mode select: Conquest default / Skirmish; the round-limit
// segment is conquest-only (off / 40 / 60 / 80) and writes the store.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useAppStore } from '../../src/state/store';
import { StartScreen } from '../../src/ui/StartScreen';

afterEach(cleanup);

describe('StartScreen mode select (E3)', () => {
  beforeEach(() => {
    useAppStore.setState({ screen: 'start', mode: 'conquest', roundLimit: null });
  });

  it('shows both modes with Conquest selected by default + the round-limit row', () => {
    const { getByTestId } = render(<StartScreen />);
    const select = getByTestId('mode-select');
    const conquest = select.querySelector('[data-mode="conquest"]')!;
    const skirmish = select.querySelector('[data-mode="skirmish"]')!;
    expect(conquest.className).toContain('mode-card-selected');
    expect(skirmish.className).not.toContain('mode-card-selected');
    const limits = getByTestId('round-limit-select');
    expect([...limits.querySelectorAll('.limit-option')].map((b) => b.textContent)).toEqual([
      'off',
      '40',
      '60',
      '80',
    ]);
    expect(limits.querySelector('[data-limit="null"]')!.className).toContain(
      'limit-option-selected',
    );
  });

  it('selecting Skirmish hides the round-limit row and writes the store', () => {
    const { getByTestId, queryByTestId } = render(<StartScreen />);
    fireEvent.click(getByTestId('mode-select').querySelector('[data-mode="skirmish"]')!);
    expect(useAppStore.getState().mode).toBe('skirmish');
    expect(queryByTestId('round-limit-select')).toBeNull();
  });

  it('picking a limit writes the store; off = null', () => {
    const { getByTestId } = render(<StartScreen />);
    fireEvent.click(getByTestId('round-limit-select').querySelector('[data-limit="60"]')!);
    expect(useAppStore.getState().roundLimit).toBe(60);
    fireEvent.click(getByTestId('round-limit-select').querySelector('[data-limit="null"]')!);
    expect(useAppStore.getState().roundLimit).toBeNull();
  });
});
