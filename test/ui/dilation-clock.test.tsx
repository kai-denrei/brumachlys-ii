// @vitest-environment jsdom
// Phase 2 (BULLET-TIME DILATION CLOCK) — the render half: the Swiss-railway
// clock is a fixed TOP-RIGHT canvas overlay, present through the replay, NEVER
// drawn inside a unit-token group and NEVER reusing unit-radar geometry. The
// DilationVignette (the kept R3 cooling chrome) renders only during WAVE A.
//
// The PURE hand/tick model lives in state/dilation-clock.ts (its own test); here
// we assert the component's STRUCTURE + placement (jsdom has no real canvas, so
// drawing is a no-op — the overlay element + canvas + reduced-motion path are
// what we verify).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { DilationVignette } from '../../src/ui/skin/DilationOverlay';
import { DilationClock } from '../../src/ui/skin/DilationClock';
import type { ReplayFrame } from '../../src/state/replay';
import type { Wave } from '../../src/state/replay-timing';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function frame(duration: number, wave?: Wave): ReplayFrame {
  return {
    duration,
    slot: wave ? 0 : -1,
    units: [],
    fog: new Set(),
    discovered: new Set(),
    ignite: [],
    arcs: [],
    floaters: [],
    bursts: [],
    kills: [],
    spawns: [],
    captures: [],
    promotions: [],
    trails: [],
    focus: [],
    ...(wave ? { wave, band: wave === 'A' ? 'ranged' : ('melee' as const) } : {}),
  };
}

/** move → WAVE_A → WAVE_B → settle. */
const FRAMES: ReplayFrame[] = [
  frame(200),
  frame(200),
  frame(500, 'A'),
  frame(500, 'A'),
  frame(300, 'B'),
  frame(900),
];

describe('Phase 2 DilationClock — Swiss-railway top-right canvas overlay', () => {
  it('renders the overlay element with a canvas', () => {
    const { container } = render(
      <DilationClock frames={FRAMES} frameIdx={0} speed={1} paused={false} />,
    );
    const root = container.querySelector('.dilation-clock') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.querySelector('canvas.dilation-clock-canvas')).not.toBeNull();
  });

  it('is screen-anchored HUD chrome — NOT inside a board/unit group, never radar', () => {
    const { container } = render(
      <DilationClock frames={FRAMES} frameIdx={2} speed={1} paused={false} />,
    );
    const root = container.querySelector('.dilation-clock') as HTMLElement;
    expect(root.closest('.board-units')).toBeNull();
    expect(root.closest('.unit-token')).toBeNull();
    expect(root.closest('[data-unit-id]')).toBeNull();
    expect(container.querySelector('.unit-radar')).toBeNull();
    expect(container.querySelector('.unit-radar-ring')).toBeNull();
    expect(container.querySelector('.radar-overlay')).toBeNull();
  });

  it('the R3 SVG clock is GONE — no SVG tick / hand / face geometry remains', () => {
    const { container } = render(
      <DilationClock frames={FRAMES} frameIdx={2} speed={1} paused={false} />,
    );
    expect(container.querySelector('.dilation-clock-tick')).toBeNull();
    expect(container.querySelector('.dilation-clock-hand')).toBeNull();
    expect(container.querySelector('.dilation-clock-face')).toBeNull();
    expect(container.querySelector('.dilation-clock-disc')).toBeNull();
    expect(container.querySelector('.dilation-clock-hub')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('drives the canvas with the PURE hand model (paints on a real 2d context)', () => {
    // jsdom canvas getContext returns null; stub a minimal 2d context so we can
    // assert the component actually paints (the hand model is exercised).
    const calls: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === 'canvas') return {};
          return (...args: unknown[]) => {
            calls.push(String(prop));
            void args;
          };
        },
      },
    ) as unknown as CanvasRenderingContext2D;
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(ctx as unknown as RenderingContext);
    // reduced-motion path paints exactly once (deterministic, no rAF) — perfect
    // for asserting a draw happened without a running loop.
    render(<DilationClock frames={FRAMES} frameIdx={3} speed={1} paused reducedMotion />);
    expect(spy).toHaveBeenCalledWith('2d');
    // a paint did real drawing work (arc/fill/stroke for the face + hand)
    expect(calls).toContain('arc');
    expect(calls).toContain('fill');
    expect(calls).toContain('stroke');
  });

  it('reduced-motion paints a single static frame (no rAF loop scheduled)', () => {
    const ctx = new Proxy(
      {},
      { get: (_t, prop) => (prop === 'canvas' ? {} : () => {}) },
    ) as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx as unknown as RenderingContext,
    );
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');
    render(<DilationClock frames={FRAMES} frameIdx={3} speed={1} paused={false} reducedMotion />);
    expect(raf).not.toHaveBeenCalled();
  });

  it('non-reduced-motion schedules a rAF loop', () => {
    const ctx = new Proxy(
      {},
      { get: (_t, prop) => (prop === 'canvas' ? {} : () => {}) },
    ) as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx as unknown as RenderingContext,
    );
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1 as never);
    render(<DilationClock frames={FRAMES} frameIdx={0} speed={1} paused={false} reducedMotion={false} />);
    expect(raf).toHaveBeenCalled();
  });
});

describe('R3 DilationVignette — WAVE A cooling overlay (kept)', () => {
  it('renders only when active', () => {
    const off = render(<DilationVignette active={false} progress={0.5} />);
    expect(off.container.querySelector('.dilation-vignette')).toBeNull();
    cleanup();
    const on = render(<DilationVignette active progress={0.5} />);
    expect(on.container.querySelector('.dilation-vignette')).not.toBeNull();
  });

  it('is screen-anchored chrome, never on a unit token', () => {
    const { container } = render(<DilationVignette active progress={0.5} />);
    const root = container.querySelector('.dilation-vignette') as HTMLElement;
    expect(root.closest('.unit-token')).toBeNull();
    expect(root.closest('[data-unit-id]')).toBeNull();
    expect(container.querySelector('.unit-radar')).toBeNull();
  });
});
