// @vitest-environment jsdom
// TopBar gear (⚙) menu — the unit-appearance skin picker. Replaces the old
// binary "anim" toggle. The gear opens a small popover with three options
// (Icons / Animated / Watercolor); selecting one drives setUnitRenderMode in the
// store, the active one is highlighted (aria-checked), and the menu is keyboard
// dismissible (Escape).

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
  useAppStore.setState({ unitRenderMode: 'icon' });
});

const openMenu = (getByLabelText: (t: string) => HTMLElement) => {
  fireEvent.click(getByLabelText('unit appearance'));
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
    const gear = getByLabelText('unit appearance');
    expect(gear.getAttribute('aria-haspopup')).toBe('menu');
    expect(gear.getAttribute('aria-expanded')).toBe('false');
    openMenu(getByLabelText);
    expect(getByLabelText('unit appearance').getAttribute('aria-expanded')).toBe('true');
  });
});
