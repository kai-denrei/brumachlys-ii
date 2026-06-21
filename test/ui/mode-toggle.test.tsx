// @vitest-environment jsdom
// Phase 7 Task 7.2 — ModeToggle: a persistent two-state segmented control that
// flips between Map (board / move troops) and Economy (build dashboard). Each
// segment is a real <button> with an aria-label and aria-pressed reflecting the
// active mode; tapping the inactive segment calls onSelect with that mode.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ModeToggle } from '../../src/ui/ModeToggle';

afterEach(cleanup);

describe('ModeToggle', () => {
  it('renders both segments inside the mode-toggle control', () => {
    const { getByTestId, getByLabelText } = render(
      <ModeToggle mode="map" onSelect={() => {}} />,
    );
    const toggle = getByTestId('mode-toggle');
    expect(toggle).toBeTruthy();
    expect(getByLabelText('move troops')).toBeTruthy();
    expect(getByLabelText('build economy')).toBeTruthy();
  });

  it('reflects the active mode via aria-pressed (map active)', () => {
    const { getByLabelText } = render(<ModeToggle mode="map" onSelect={() => {}} />);
    expect(getByLabelText('move troops').getAttribute('aria-pressed')).toBe('true');
    expect(getByLabelText('build economy').getAttribute('aria-pressed')).toBe('false');
  });

  it('reflects the active mode via aria-pressed (economy active)', () => {
    const { getByLabelText } = render(<ModeToggle mode="economy" onSelect={() => {}} />);
    expect(getByLabelText('build economy').getAttribute('aria-pressed')).toBe('true');
    expect(getByLabelText('move troops').getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking the inactive segment calls onSelect with that mode', () => {
    const onSelect = vi.fn();
    const { getByLabelText } = render(<ModeToggle mode="map" onSelect={onSelect} />);
    fireEvent.click(getByLabelText('build economy'));
    expect(onSelect).toHaveBeenCalledWith('economy');
  });

  it('clicking the inactive segment from economy calls onSelect("map")', () => {
    const onSelect = vi.fn();
    const { getByLabelText } = render(<ModeToggle mode="economy" onSelect={onSelect} />);
    fireEvent.click(getByLabelText('move troops'));
    expect(onSelect).toHaveBeenCalledWith('map');
  });
});
