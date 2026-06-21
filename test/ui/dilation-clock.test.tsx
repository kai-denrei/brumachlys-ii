// @vitest-environment jsdom
// R3 (DILATION) — the render half: the analog dilation clock + the cooling
// vignette are SCREEN-ANCHORED HUD overlays present ONLY during WAVE A. The
// clock fades in/out at the wave edges (fade envelope), its single gold hand
// sweeps LESS THAN one rotation across the window, and it is NEVER drawn inside
// a unit-token group and NEVER reuses the unit-radar ring/badge geometry
// (addendum hard rule). Released (inactive) → both overlays gone.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { DilationClock, DilationVignette } from '../../src/ui/skin/DilationOverlay';
import { DILATION_HAND_TURNS } from '../../src/state/replay';

afterEach(cleanup);

describe('R3 DilationClock — WAVE A HUD overlay', () => {
  it('renders only when active; nothing when inactive', () => {
    const off = render(<DilationClock active={false} progress={0.5} turns={0.45} fade={1} />);
    expect(off.container.querySelector('.dilation-clock')).toBeNull();
    cleanup();
    const on = render(<DilationClock active progress={0.5} turns={0.45} fade={1} />);
    expect(on.container.querySelector('.dilation-clock')).not.toBeNull();
  });

  it('is screen-anchored chrome (a fixed HUD element, NOT inside any board SVG group)', () => {
    const { container } = render(<DilationClock active progress={0.2} turns={0.18} fade={0.8} />);
    const root = container.querySelector('.dilation-clock') as HTMLElement;
    expect(root).not.toBeNull();
    // HUD chrome anchor — not a board-cells / board-units group, not a unit token.
    expect(root.closest('.board-units')).toBeNull();
    expect(root.closest('.unit-token')).toBeNull();
    expect(root.closest('[data-unit-id]')).toBeNull();
  });

  it('NEVER reuses unit-radar geometry/classes', () => {
    const { container } = render(<DilationClock active progress={0.5} turns={0.45} fade={1} />);
    expect(container.querySelector('.unit-radar')).toBeNull();
    expect(container.querySelector('.unit-radar-ring')).toBeNull();
    expect(container.querySelector('.radar-overlay')).toBeNull();
    // and it carries no unit-token / radar data hooks
    expect(container.querySelector('[data-unit-id]')).toBeNull();
  });

  it('has 12 tick marks and a single gold hand on a dark face', () => {
    const { container } = render(<DilationClock active progress={0.5} turns={0.45} fade={1} />);
    expect(container.querySelectorAll('.dilation-clock-tick').length).toBe(12);
    expect(container.querySelectorAll('.dilation-clock-hand').length).toBe(1);
  });

  it('the hand rotation maps from turns and is < one full rotation', () => {
    const { container } = render(<DilationClock active progress={1} turns={DILATION_HAND_TURNS} fade={1} />);
    const hand = container.querySelector('.dilation-clock-hand') as SVGElement;
    const deg = Number(hand.getAttribute('data-deg'));
    expect(deg).toBeCloseTo(DILATION_HAND_TURNS * 360, 5);
    expect(deg).toBeLessThan(360);
  });

  it('the fade envelope drives the overlay opacity', () => {
    const { container } = render(<DilationClock active progress={0.05} turns={0.045} fade={0.3} />);
    const root = container.querySelector('.dilation-clock') as HTMLElement;
    expect(Number(root.style.opacity)).toBeCloseTo(0.3, 5);
  });
});

describe('R3 DilationVignette — WAVE A cooling overlay', () => {
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
