// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { CountFlap } from '../../src/ui/skin/CountFlap';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const txt = (c: HTMLElement) => c.querySelector('text')?.textContent;

describe('CountFlap', () => {
  it('holds the OLD count until the impact, then folds DOWN to the new count', () => {
    vi.useFakeTimers();
    const { container } = render(
      <svg>
        <CountFlap fromCount={8} toCount={5} flipAtMs={880} pipR={10} />
      </svg>,
    );
    // before the impact lands → still the pre-hit value
    expect(txt(container)).toBe('8');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(txt(container)).toBe('8');
    // well past the impact + the full step cascade → settled on the new value
    act(() => {
      vi.advanceTimersByTime(880 + 3000);
    });
    expect(txt(container)).toBe('5');
  });

  it('animates the flipped-in card but not the held card', () => {
    vi.useFakeTimers();
    const { container } = render(
      <svg>
        <CountFlap fromCount={6} toCount={5} flipAtMs={100} pipR={10} />
      </svg>,
    );
    // held value: no flap animation class
    expect(container.querySelector('text')?.getAttribute('class')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(100 + 3000);
    });
    const settled = container.querySelector('text');
    expect(settled?.textContent).toBe('5');
    expect(settled?.getAttribute('class')).toContain('count-flap-card');
  });

  it('snaps straight to the new count under prefers-reduced-motion (no hold)', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('reduce'),
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      onchange: null,
      dispatchEvent: () => false,
    }));
    const { container } = render(
      <svg>
        <CountFlap fromCount={8} toCount={5} flipAtMs={880} pipR={10} />
      </svg>,
    );
    expect(txt(container)).toBe('5');
  });

  it('grades the colour by the CURRENTLY shown value (held high, settled low)', () => {
    vi.useFakeTimers();
    const { container } = render(
      <svg>
        <CountFlap fromCount={8} toCount={4} flipAtMs={50} pipR={10} />
      </svg>,
    );
    // 8 → black/ink while held
    expect(container.querySelector('text')?.getAttribute('fill')).toBe('#1a1a1a');
    act(() => {
      vi.advanceTimersByTime(50 + 3000);
    });
    // 4 → red once settled
    expect(container.querySelector('text')?.getAttribute('fill')).toBe('#dc2626');
  });
});
