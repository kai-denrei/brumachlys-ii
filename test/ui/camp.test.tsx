// @vitest-environment jsdom
// v0.6 Ask 3 — neutral camp tiles: an UNOWNED base in conquest renders as a
// camp (tent/palisade motif, sand ink, NO flag, slightly desaturated fill);
// owned bases keep the flag pip + faction tint. The Board derives camp-ness
// from the bases record (owner null = neutral — donor E2 contract); skirmish
// (no record) keeps the legacy proximity-tinted pips. Memory tier: camp
// desat applies AFTER the memory desat, same ordering rule as the tint.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Board as BoardGraph, Cell, CellId, Vec2 } from '../../src/board/types';
import { Board } from '../../src/ui/Board';
import {
  CAMP_DESATURATION,
  CellRenderer,
  MEMORY_DESATURATION,
  PALETTE,
  desaturate,
} from '../../src/ui/skin';

afterEach(cleanup);

const toScreen = (p: readonly [number, number]): [number, number] => [p[0] * 100, -p[1] * 100];

function makeCell(terrain: Cell['terrain'], id = 3): Cell {
  return {
    id,
    center: [0.5, 0.5],
    polygon: [
      [0.2, 0.2],
      [0.8, 0.2],
      [0.9, 0.6],
      [0.5, 0.9],
      [0.1, 0.6],
    ],
    neighbors: [],
    terrain,
  };
}

function rowBoard(n: number, baseAt: CellId[]): BoardGraph {
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
      terrain: baseAt.includes(i) ? 'base' : 'plains',
    });
  }
  return { cells, seed: 0, donorMapId: 'camp-test', placementAnchors: [0, n - 1] };
}

describe('CellRenderer — camp tier (Ask 3)', () => {
  it('camp: tent motif, NO flag, desaturated sand fill', () => {
    const { container } = render(
      <svg>
        <CellRenderer cell={makeCell('base')} toScreen={toScreen} camp />
      </svg>,
    );
    expect(container.querySelector('.cell-camp')).not.toBeNull();
    expect(container.querySelector('.camp-pip')).not.toBeNull();
    expect(container.querySelector('.base-pip')).toBeNull(); // no flag
    expect(container.querySelector('.cell > path')!.getAttribute('fill')).toBe(
      desaturate(PALETTE.base, CAMP_DESATURATION),
    );
  });

  it('owned base is untouched: flag pip, faction tint, no camp class', () => {
    const { container } = render(
      <svg>
        <CellRenderer cell={makeCell('base')} toScreen={toScreen} baseTintFaction={0} camp={false} />
      </svg>,
    );
    expect(container.querySelector('.cell-camp')).toBeNull();
    expect(container.querySelector('.camp-pip')).toBeNull();
    expect(container.querySelector('.base-pip')).not.toBeNull();
  });

  it('memory camp: camp desat applies AFTER the memory desat (ordering pinned)', () => {
    const { container } = render(
      <svg>
        <CellRenderer cell={makeCell('base')} toScreen={toScreen} tier="memory" camp />
      </svg>,
    );
    expect(container.querySelector('.cell > path')!.getAttribute('fill')).toBe(
      desaturate(desaturate(PALETTE.base, MEMORY_DESATURATION), CAMP_DESATURATION),
    );
  });

  it('dark tier still hides camps entirely (no motif leaks through the dark)', () => {
    const { container } = render(
      <svg>
        <CellRenderer cell={makeCell('base')} toScreen={toScreen} tier="dark" camp />
      </svg>,
    );
    expect(container.querySelector('.camp-pip')).toBeNull();
    expect(container.querySelector('.cell > path')!.getAttribute('fill')).toBe(PALETTE.paper);
  });
});

describe('Board — camp derivation from the bases record', () => {
  it('conquest: owner null → camp; owned → flag pip; skirmish keeps legacy pips', () => {
    const board = rowBoard(4, [1, 3]);
    const conquest = render(
      <Board board={board} bases={{ 1: 0, 3: null }} interactive={false} />,
    );
    const cell1 = conquest.container.querySelector('[data-cell-id="1"]')!;
    const cell3 = conquest.container.querySelector('[data-cell-id="3"]')!;
    expect(cell1.querySelector('.base-pip')).not.toBeNull();
    expect(cell1.classList.contains('cell-camp')).toBe(false);
    expect(cell3.classList.contains('cell-camp')).toBe(true);
    expect(cell3.querySelector('.camp-pip')).not.toBeNull();
    expect(cell3.querySelector('.base-pip')).toBeNull();
    conquest.unmount();

    const skirmish = render(<Board board={board} interactive={false} />);
    expect(skirmish.container.querySelector('.cell-camp')).toBeNull();
    expect(skirmish.container.querySelectorAll('.base-pip').length).toBe(2);
  });
});
