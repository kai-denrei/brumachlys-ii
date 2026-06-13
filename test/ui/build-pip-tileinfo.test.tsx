// @vitest-environment jsdom
// v0.7 Item 1 — owned-base build pips (BuildPips overlay): a tappable "＋" pip
// on every owned base, queued bases read a check; the tap fires onBuild with
// the base cell. v0.7 Item 2 — InfoSheet tier behavior: dark cells read
// "unscouted" with NO terrain leak; memory/live show terrain; base status line.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { Board as BoardGraph, Cell, CellId, Vec2 } from '../../src/board/types';
import { loadUnits } from '../../src/io/data-loader';
import { BuildPips } from '../../src/ui/skin';
import { InfoSheet } from '../../src/ui/Sheets';

afterEach(cleanup);
const types = loadUnits();

function rowBoard(n: number): BoardGraph {
  const cells = new Map<CellId, Cell>();
  for (let i = 0; i < n; i++) {
    const poly: Vec2[] = [
      [i, 0],
      [i + 1, 0],
      [i + 1, 1],
      [i, 1],
    ];
    cells.set(i, {
      id: i,
      center: [i + 0.5, 0.5],
      polygon: poly,
      neighbors: [i - 1, i + 1].filter((j) => j >= 0 && j < n),
      terrain: i === 0 ? 'base' : 'plains',
    });
  }
  return { cells, seed: 0, donorMapId: 'pip-test' };
}

const toScreen = (p: readonly [number, number]): [number, number] => [p[0] * 100, -p[1] * 100];

describe('BuildPips (v0.7 Item 1)', () => {
  const board = rowBoard(4);

  it('renders a pip per owned base and fires onBuild on tap', () => {
    const onBuild = vi.fn();
    const { container } = render(
      <svg>
        <BuildPips
          board={board}
          toScreen={toScreen}
          tokenSize={40}
          pips={[{ baseCell: 0 }]}
          onBuild={onBuild}
        />
      </svg>,
    );
    const pip = container.querySelector('[data-build-pip="0"]')!;
    expect(pip).toBeTruthy();
    fireEvent.click(pip);
    expect(onBuild).toHaveBeenCalledWith(0);
  });

  it('a queued base reads the queued (check) variant', () => {
    const { container } = render(
      <svg>
        <BuildPips
          board={board}
          toScreen={toScreen}
          tokenSize={40}
          pips={[{ baseCell: 0, queued: true }]}
        />
      </svg>,
    );
    expect(container.querySelector('.build-pip-queued')).toBeTruthy();
  });
});

describe('InfoSheet tier behavior (v0.7 Item 2)', () => {
  const board = rowBoard(4);
  const plains = board.cells.get(1)!;
  const base = board.cells.get(0)!;

  it('dark cell shows "unscouted" and leaks NO terrain', () => {
    const { baseElement } = render(
      <InfoSheet cell={plains} tier="dark" unitTypes={types} onClose={() => {}} />,
    );
    expect(baseElement.textContent).toContain('unscouted');
    expect(baseElement.querySelector('.terrain-table')).toBeNull();
    expect(baseElement.textContent).not.toContain('Plains');
  });

  it('live cell shows the terrain table', () => {
    const { baseElement } = render(
      <InfoSheet cell={plains} tier="live" unitTypes={types} onClose={() => {}} />,
    );
    expect(baseElement.textContent).toContain('Plains');
    expect(baseElement.querySelector('.terrain-table')).toBeTruthy();
  });

  it('memory cell marks the title "(remembered)"', () => {
    const { baseElement } = render(
      <InfoSheet cell={plains} tier="memory" unitTypes={types} onClose={() => {}} />,
    );
    expect(baseElement.textContent).toContain('remembered');
  });

  it('a base cell surfaces its ownership status line', () => {
    const yours = render(
      <InfoSheet cell={base} tier="live" baseStatus="yours" unitTypes={types} onClose={() => {}} />,
    );
    expect(yours.baseElement.querySelector('[data-base-status="yours"]')).toBeTruthy();
    cleanup();
    const camp = render(
      <InfoSheet cell={base} tier="live" baseStatus="camp" unitTypes={types} onClose={() => {}} />,
    );
    expect(camp.baseElement.textContent).toContain('camp');
  });
});
