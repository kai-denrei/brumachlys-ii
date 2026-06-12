// @vitest-environment jsdom
// EffectRenderer / Board Layer-2 smoke (§9.3): ghost trails, ghost tokens,
// attack arcs + sword markers, convergence class, ghost tap; plus the §9.2
// vision-edge contour and stance popover, and the §9.5 long-press wiring.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { Board as BoardGraph, Cell, CellId, Vec2 } from '../../src/board/types';
import type { FactionId, UnitInstance } from '../../src/core/types';
import { Board } from '../../src/ui/Board';
import { EffectRenderer, visionEdgeSegments, type GhostOrder } from '../../src/ui/skin';

afterEach(cleanup);

/** Row of unit squares SHARING edge vertices (vision-edge matching needs
 * exact shared coordinates, like real dual cells). */
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
      terrain: 'plains',
    });
  }
  return { cells, seed: 0, donorMapId: 'fx-test' };
}

function unit(id: string, faction: FactionId, cell: CellId, type = 'infantry'): UnitInstance {
  return { id, type, faction, cell, count: 10, stance: 'aggressive', attackedFrom: [] };
}

const toScreen = (p: readonly [number, number]): [number, number] => [p[0] * 100, -p[1] * 100];

describe('EffectRenderer (ghost layer, §9.3)', () => {
  const board = rowBoard(6);

  it('renders a dotted trail and a translucent ghost token for a queued move', () => {
    const ghosts: GhostOrder[] = [{ unit: unit('a', 0, 0), movePath: [1, 2] }];
    const { container } = render(
      <svg>
        <EffectRenderer board={board} toScreen={toScreen} tokenSize={40} ghosts={ghosts} />
      </svg>,
    );
    const trail = container.querySelector('.ghost-trail')!;
    expect(trail).not.toBeNull();
    expect(trail.getAttribute('stroke-dasharray')).toBeTruthy(); // dotted
    expect(trail.getAttribute('stroke')).toBe('#E8806B'); // faction A color
    expect(trail.getAttribute('points')!.split(' ')).toHaveLength(3); // start + 2 path cells
    const token = container.querySelector('.ghost-token')!;
    expect(token).not.toBeNull();
    expect(Number(token.getAttribute('opacity'))).toBeLessThan(1); // translucent
  });

  it('renders a thin arc + sword marker for a queued attack, from the planned end position', () => {
    const ghosts: GhostOrder[] = [
      { unit: unit('a', 0, 0), movePath: [1], attackTarget: 3, attackFrom: 1 },
    ];
    const { container } = render(
      <svg>
        <EffectRenderer board={board} toScreen={toScreen} tokenSize={40} ghosts={ghosts} />
      </svg>,
    );
    const arc = container.querySelector('.attack-arc')!;
    expect(arc).not.toBeNull();
    expect(arc.getAttribute('d')).toMatch(/^M150 -50 Q/); // starts at cell 1's center, curved
    expect(container.querySelector('.attack-marker .icon-sword')).not.toBeNull();
  });

  it('flags converging ghosts with the amber-flash class', () => {
    const ghosts: GhostOrder[] = [
      { unit: unit('a', 0, 0), movePath: [1, 2], converging: true },
      { unit: unit('b', 0, 4), movePath: [3, 2], converging: true },
      { unit: unit('c', 0, 5), movePath: [4], converging: false },
    ];
    const { container } = render(
      <svg>
        <EffectRenderer board={board} toScreen={toScreen} tokenSize={40} ghosts={ghosts} />
      </svg>,
    );
    expect(container.querySelectorAll('.ghost-converging')).toHaveLength(2);
    expect(container.querySelectorAll('.ghost-move')).toHaveLength(3);
  });

  it('tapping a ghost token reports the unit id', () => {
    const onGhostTap = vi.fn();
    const ghosts: GhostOrder[] = [{ unit: unit('a', 0, 0), movePath: [1] }];
    const { container } = render(
      <svg>
        <EffectRenderer
          board={board}
          toScreen={toScreen}
          tokenSize={40}
          ghosts={ghosts}
          onGhostTap={onGhostTap}
        />
      </svg>,
    );
    fireEvent.click(container.querySelector('.ghost-token')!);
    expect(onGhostTap).toHaveBeenCalledWith('a');
  });
});

describe('vision edge (§9.2)', () => {
  it('finds the shared boundary segments of a cell set', () => {
    const board = rowBoard(4);
    const segs = visionEdgeSegments(board, new Set([0, 1]));
    // boundary between cell 1 (in) and cell 2 (out): the shared edge x=2
    expect(segs).toHaveLength(1);
    const [[ax, ay], [bx, by]] = segs[0]!;
    expect([ax, bx]).toEqual([2, 2]);
    expect([ay, by].sort()).toEqual([0, 1]);
  });
});

describe('Board integration (popover, ghosts, long-press)', () => {
  const board = rowBoard(6);
  const units = [unit('a', 0, 0), unit('e', 1, 3)];

  it('shows the 3-icon stance popover on the selected unit and reports picks', () => {
    const onPick = vi.fn();
    const { container } = render(
      <Board
        board={board}
        units={units}
        selectedUnitId="a"
        stancePopover={{ active: 'aggressive', holdFireDisabled: false, onPick }}
      />,
    );
    const options = container.querySelectorAll('.stance-option');
    expect(options).toHaveLength(3);
    expect(container.querySelector('.stance-aggressive.stance-active')).not.toBeNull();
    fireEvent.click(container.querySelector('.stance-defensive')!);
    expect(onPick).toHaveBeenCalledWith('defensive');
  });

  it('disables hold-fire in the popover when an attack is queued (§2.4)', () => {
    const onPick = vi.fn();
    const { container } = render(
      <Board
        board={board}
        units={units}
        selectedUnitId="a"
        stancePopover={{ active: 'aggressive', holdFireDisabled: true, onPick }}
      />,
    );
    const holdFire = container.querySelector('.stance-hold-fire')!;
    expect(holdFire.classList.contains('stance-disabled')).toBe(true);
    fireEvent.click(holdFire);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('renders the ghost layer between grain and units', () => {
    const ghosts: GhostOrder[] = [{ unit: units[0]!, movePath: [1] }];
    const { container } = render(<Board board={board} units={units} ghosts={ghosts} />);
    const layers = [...container.querySelectorAll('svg > g > *')].map((el) =>
      el.getAttribute('class'),
    );
    const grainIdx = layers.indexOf('board-grain');
    const fxIdx = layers.indexOf('board-effects');
    const unitsIdx = layers.indexOf('board-units');
    expect(grainIdx).toBeGreaterThanOrEqual(0);
    expect(fxIdx).toBeGreaterThan(grainIdx);
    expect(unitsIdx).toBeGreaterThan(fxIdx);
  });

  it('long-press on a cell fires onCellLongPress and suppresses the tap', () => {
    vi.useFakeTimers();
    // jsdom has no pointer-capture implementation
    (Element.prototype as any).setPointerCapture ??= () => {};
    const onCellLongPress = vi.fn();
    const onCellTap = vi.fn();
    const { container } = render(
      <Board
        board={board}
        units={units}
        onCellLongPress={onCellLongPress}
        onCellTap={onCellTap}
      />,
    );
    const svg = container.querySelector('svg')!;
    const cell = container.querySelector('[data-cell-id="2"] path')!;
    // dispatch on the cell so e.target resolves; it bubbles to the svg handler
    fireEvent.pointerDown(cell, { pointerId: 1, clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(600);
    expect(onCellLongPress).toHaveBeenCalledWith(2);
    fireEvent.pointerUp(svg, { pointerId: 1 });
    fireEvent.click(cell); // browser's synthetic click after release
    expect(onCellTap).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('a long-press on a unit token resolves to the unit cell', () => {
    vi.useFakeTimers();
    (Element.prototype as any).setPointerCapture ??= () => {};
    const onCellLongPress = vi.fn();
    const { container } = render(
      <Board board={board} units={units} onCellLongPress={onCellLongPress} />,
    );
    const token = container.querySelector('[data-unit-id="e"] rect')!;
    fireEvent.pointerDown(token, { pointerId: 1, clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(600);
    expect(onCellLongPress).toHaveBeenCalledWith(3); // unit e sits on cell 3
    vi.useRealTimers();
  });

  it('a pan beyond the slop cancels the long-press', () => {
    vi.useFakeTimers();
    (Element.prototype as any).setPointerCapture ??= () => {};
    const onCellLongPress = vi.fn();
    const { container } = render(
      <Board board={board} units={units} onCellLongPress={onCellLongPress} />,
    );
    const svg = container.querySelector('svg')!;
    const cell = container.querySelector('[data-cell-id="2"] path')!;
    fireEvent.pointerDown(cell, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 40, clientY: 10 }); // 30px > 8px slop
    vi.advanceTimersByTime(600);
    expect(onCellLongPress).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
