// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { UnitRenderer } from '../../src/ui/skin';
import { makeUnit } from '../core/synthetic';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const pipText = (c: HTMLElement) => c.querySelector('.unit-count text')?.textContent;

describe('UnitRenderer HP flip wiring', () => {
  it('holds the OLD count in the pip while a flip is armed (before the impact)', () => {
    vi.useFakeTimers();
    const { container } = render(
      <svg>
        <UnitRenderer
          unit={makeUnit('d', 0, 2, 'infantry', 5)}
          x={0}
          y={0}
          size={24}
          flip={{ fromCount: 8, toCount: 5, flipAtMs: 880 }}
          flipKey={1}
        />
      </svg>,
    );
    expect(pipText(container)).toBe('8');
  });

  it('renders the static post-combat count when no flip is armed', () => {
    const { container } = render(
      <svg>
        <UnitRenderer unit={makeUnit('d', 0, 2, 'infantry', 7)} x={0} y={0} size={24} />
      </svg>,
    );
    expect(pipText(container)).toBe('7');
  });
});
