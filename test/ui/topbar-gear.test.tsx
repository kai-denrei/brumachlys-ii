// @vitest-environment jsdom
// TopBar gear (⚙) menu — the game-settings menu. An APPEARANCE section holds
// the unit-skin picker (three options Icons / Animated / Watercolor, an
// aria-checked menuitemradio set driving setUnitRenderMode), and a DEBUG/TEST
// section holds the Full Auto (P1 bot) toggle (menuitemcheckbox → fullAuto). The
// active skin is highlighted (aria-checked); the menu is keyboard dismissible
// (Escape).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useAppStore } from '../../src/state/store';
import { TopBar } from '../../src/ui/TopBar';

afterEach(cleanup);
beforeEach(() => {
  // Reset to the default skin before each test; clear any persisted choice.
  try {
    localStorage.removeItem('brumachlys.unitRenderMode');
  } catch {
    /* jsdom storage may be absent in some envs */
  }
  useAppStore.setState({ unitRenderMode: 'icon', fullAuto: false });
});

const openMenu = (getByLabelText: (t: string) => HTMLElement) => {
  fireEvent.click(getByLabelText('game settings'));
};

describe('TopBar gear menu', () => {
  it('the gear button toggles a menu with the three skin options', () => {
    const { getByLabelText, getByRole, queryByRole } = render(<TopBar phase="planning" />);
    // closed by default
    expect(queryByRole('menu')).toBeNull();
    openMenu(getByLabelText);
    const menu = getByRole('menu');
    expect(menu).not.toBeNull();
    const items = menu.querySelectorAll('[role="menuitemradio"]');
    expect(items.length).toBe(3);
    expect([...items].map((i) => i.textContent)).toEqual(['Icons', 'Animated', 'Watercolor']);
  });

  it('selecting "Watercolor" sets the store mode and persists it', () => {
    const { getByLabelText } = render(<TopBar phase="planning" />);
    openMenu(getByLabelText);
    fireEvent.click(getByLabelText('Watercolor'));
    expect(useAppStore.getState().unitRenderMode).toBe('watercolor');
    expect(localStorage.getItem('brumachlys.unitRenderMode')).toBe('watercolor');
  });

  it('selecting "Animated" then "Icons" tracks the store each time', () => {
    const { getByLabelText } = render(<TopBar phase="planning" />);
    openMenu(getByLabelText);
    fireEvent.click(getByLabelText('Animated'));
    expect(useAppStore.getState().unitRenderMode).toBe('anim');

    openMenu(getByLabelText);
    fireEvent.click(getByLabelText('Icons'));
    expect(useAppStore.getState().unitRenderMode).toBe('icon');
  });

  it('the active mode is highlighted (aria-checked) in the menu', () => {
    useAppStore.setState({ unitRenderMode: 'watercolor' });
    const { getByLabelText } = render(<TopBar phase="planning" />);
    openMenu(getByLabelText);
    expect(getByLabelText('Watercolor').getAttribute('aria-checked')).toBe('true');
    expect(getByLabelText('Icons').getAttribute('aria-checked')).toBe('false');
    expect(getByLabelText('Animated').getAttribute('aria-checked')).toBe('false');
  });

  it('Escape closes the menu', () => {
    const { getByLabelText, queryByRole } = render(<TopBar phase="planning" />);
    openMenu(getByLabelText);
    expect(queryByRole('menu')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryByRole('menu')).toBeNull();
  });

  it('the gear button is keyboard-discoverable with an accessible label + aria-haspopup', () => {
    const { getByLabelText } = render(<TopBar phase="planning" />);
    const gear = getByLabelText('game settings');
    expect(gear.getAttribute('aria-haspopup')).toBe('menu');
    expect(gear.getAttribute('aria-expanded')).toBe('false');
    openMenu(getByLabelText);
    expect(getByLabelText('game settings').getAttribute('aria-expanded')).toBe('true');
  });

  it('the DEBUG section exposes a Full Auto (P1 bot) checkbox bound to store.fullAuto', () => {
    const { getByLabelText, getByRole } = render(<TopBar phase="planning" />);
    openMenu(getByLabelText);
    const menu = getByRole('menu');
    // appearance radios are unaffected by the new section
    expect(menu.querySelectorAll('[role="menuitemradio"]').length).toBe(3);
    const check = getByLabelText('Full Auto (P1 bot)');
    expect(check.getAttribute('role')).toBe('menuitemcheckbox');
    expect(check.getAttribute('aria-checked')).toBe('false');
    // toggling drives the store, and the menu STAYS open (state visible)
    fireEvent.click(check);
    expect(useAppStore.getState().fullAuto).toBe(true);
    expect(getByRole('menu')).not.toBeNull();
    expect(getByLabelText('Full Auto (P1 bot)').getAttribute('aria-checked')).toBe('true');
    // toggling again flips it back off
    fireEvent.click(getByLabelText('Full Auto (P1 bot)'));
    expect(useAppStore.getState().fullAuto).toBe(false);
  });

  it('the menu carries a separator and section labels (Appearance / Debug)', () => {
    const { getByLabelText, getByRole } = render(<TopBar phase="planning" />);
    openMenu(getByLabelText);
    const menu = getByRole('menu');
    expect(menu.querySelectorAll('[role="separator"]').length).toBe(1);
    const labels = [...menu.querySelectorAll('.top-bar-gear-section-label')].map(
      (l) => l.textContent,
    );
    expect(labels).toEqual(['Appearance', 'Debug / Test']);
  });
});
