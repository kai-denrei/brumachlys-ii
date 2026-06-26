// @vitest-environment jsdom
// VICTORY DASHBOARD — viz primitives: Sparkline (single + dual series, graceful
// 1-2 point handling) and BarHistogram (faction-colored rects with unit-glyph +
// count labels). Pure presentational; SVG output only, accessible via
// aria-label / <title>.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { factionColor } from '../../src/ui/skin/palette';
import { BarHistogram, Sparkline } from '../../src/ui/skin/charts';

afterEach(cleanup);

describe('Sparkline (victory dashboard)', () => {
  it('renders a single polyline for a multi-point series', () => {
    const { container } = render(
      <Sparkline series={[{ points: [1, 3, 2, 5, 4], color: '#abc' }]} ariaLabel="test arc" />,
    );
    const polylines = container.querySelectorAll('polyline');
    expect(polylines.length).toBe(1);
    // 5 points → 5 coordinate pairs
    const pts = polylines[0]!.getAttribute('points')!.trim().split(/\s+/);
    expect(pts.length).toBe(5);
    expect(polylines[0]!.getAttribute('stroke')).toBe('#abc');
  });

  it('renders TWO polylines for a dual series in the given colors', () => {
    const a = factionColor(0);
    const b = factionColor(1);
    const { container } = render(
      <Sparkline
        series={[
          { points: [5, 6, 7], color: a },
          { points: [2, 1, 4], color: b },
        ]}
        ariaLabel="damage arc"
      />,
    );
    const polylines = container.querySelectorAll('polyline');
    expect(polylines.length).toBe(2);
    expect(polylines[0]!.getAttribute('stroke')).toBe(a);
    expect(polylines[1]!.getAttribute('stroke')).toBe(b);
  });

  it('exposes an accessible label (aria-label or <title>) describing the series', () => {
    const { container } = render(
      <Sparkline series={[{ points: [1, 2, 3], color: '#000' }]} ariaLabel="kills per round" />,
    );
    const svg = container.querySelector('svg')!;
    const labelled =
      svg.getAttribute('aria-label') === 'kills per round' ||
      svg.querySelector('title')?.textContent === 'kills per round';
    expect(labelled).toBe(true);
  });

  it('renders gracefully for a single point (a dot, no polyline crash)', () => {
    const { container } = render(
      <Sparkline series={[{ points: [7], color: '#123' }]} ariaLabel="one" />,
    );
    // No 1-point polyline (degenerate); a dot stands in instead.
    expect(container.querySelectorAll('polyline').length).toBe(0);
    expect(container.querySelectorAll('circle').length).toBe(1);
  });

  it('renders two dots for a 2-point series (still draws a connecting line)', () => {
    const { container } = render(
      <Sparkline series={[{ points: [3, 8], color: '#123' }]} ariaLabel="two" />,
    );
    // 2 points draw a polyline AND endpoint dots so a tiny series stays visible.
    const polylines = container.querySelectorAll('polyline');
    expect(polylines.length).toBe(1);
    expect(polylines[0]!.getAttribute('points')!.trim().split(/\s+/).length).toBe(2);
    expect(container.querySelectorAll('circle').length).toBeGreaterThanOrEqual(2);
  });

  it('renders nothing meaningful for an empty series (no crash, no polyline)', () => {
    const { container } = render(<Sparkline series={[{ points: [], color: '#000' }]} ariaLabel="empty" />);
    expect(container.querySelectorAll('polyline').length).toBe(0);
  });
});

describe('BarHistogram (victory dashboard)', () => {
  it('renders one rect per bar in the given faction colors with count labels', () => {
    const a = factionColor(0);
    const b = factionColor(1);
    const { container, getAllByText } = render(
      <BarHistogram
        bars={[
          { type: 'sniper', faction: 0, count: 1, color: a, label: 'sniper' },
          { type: 'tank', faction: 1, count: 3, color: b, label: 'tank' },
          { type: 'infantry', faction: 1, count: 2, color: b, label: 'infantry' },
        ]}
        ariaLabel="casualties by type"
      />,
    );
    const rects = container.querySelectorAll('rect.bar-rect');
    expect(rects.length).toBe(3);
    expect(rects[0]!.getAttribute('fill')).toBe(a);
    expect(rects[1]!.getAttribute('fill')).toBe(b);
    // count labels present
    expect(getAllByText('3').length).toBeGreaterThanOrEqual(1);
    // unit glyphs present (one per bar)
    expect(container.querySelectorAll('[data-icon]').length).toBe(3);
  });

  it('scales bar height to the max count (tallest bar reaches full height)', () => {
    const { container } = render(
      <BarHistogram
        bars={[
          { type: 'a', faction: 0, count: 1, color: '#111', label: 'a' },
          { type: 'b', faction: 0, count: 4, color: '#111', label: 'b' },
        ]}
        ariaLabel="scaled"
      />,
    );
    const rects = [...container.querySelectorAll('rect.bar-rect')];
    const h = rects.map((r) => Number(r.getAttribute('height')));
    // the count-4 bar must be taller than the count-1 bar
    expect(h[1]!).toBeGreaterThan(h[0]!);
  });

  it('renders nothing (null) when there are no bars', () => {
    const { container } = render(<BarHistogram bars={[]} ariaLabel="none" />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
