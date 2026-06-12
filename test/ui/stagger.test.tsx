// @vitest-environment jsdom
// v1.3 Tweak A — co-located token stagger: deterministic within-cell layout
// (2 = diagonal pair, 3+ = ring, 0.8 scale), slot assignment stable across
// frames regardless of input order, and the Board render wiring (offsets +
// scale ride the token transform so the 0.25s transition animates them).

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Board as BoardGraph, Cell, CellId } from '../../src/board/types';
import type { UnitInstance } from '../../src/core/types';
import { Board, staggerLayout } from '../../src/ui/Board';

afterEach(cleanup);

describe('staggerLayout (pure)', () => {
  it('a lone unit stays centered at full size', () => {
    const m = staggerLayout(['a'], 100);
    expect(m.get('a')).toEqual({ dx: 0, dy: 0, scale: 1 });
  });

  it('two units split up-left / down-right at 0.8 scale', () => {
    const m = staggerLayout(['a', 'b'], 100);
    const slots = [m.get('a')!, m.get('b')!];
    // one token up-left (negative diagonal), the other down-right — mirrored
    const ul = slots.find((s) => s.dx < 0)!;
    const dr = slots.find((s) => s.dx > 0)!;
    expect(ul.dx).toBeCloseTo(-30);
    expect(ul.dy).toBeCloseTo(-30);
    expect(dr.dx).toBeCloseTo(30);
    expect(dr.dy).toBeCloseTo(30);
    expect(ul.scale).toBe(0.8);
    expect(dr.scale).toBe(0.8);
  });

  it('3+ units take distinct ring positions at equal radius', () => {
    const m = staggerLayout(['a', 'b', 'c'], 100);
    const keys = new Set<string>();
    for (const s of m.values()) {
      expect(Math.hypot(s.dx, s.dy)).toBeCloseTo(42);
      expect(s.scale).toBe(0.8);
      keys.add(`${s.dx.toFixed(3)},${s.dy.toFixed(3)}`);
    }
    expect(keys.size).toBe(3); // no two share a position
  });

  it('assignment is deterministic in the SET of ids — input order is irrelevant', () => {
    const a = staggerLayout(['u7', 'u3', 'u9'], 80);
    const b = staggerLayout(['u9', 'u7', 'u3'], 80);
    for (const id of ['u3', 'u7', 'u9']) {
      expect(a.get(id)).toEqual(b.get(id)); // tokens never swap between frames
    }
  });
});

/** Tiny synthetic 2×2 board (y-up world coords) — same shape as board.test. */
function makeBoard(): BoardGraph {
  const square = (cx: number, cy: number): [number, number][] => [
    [cx - 0.4, cy - 0.4],
    [cx + 0.4, cy - 0.4],
    [cx + 0.4, cy + 0.4],
    [cx - 0.4, cy + 0.4],
  ];
  const mk = (id: CellId, cx: number, cy: number, neighbors: CellId[]): Cell => ({
    id,
    center: [cx, cy],
    polygon: square(cx, cy),
    neighbors,
    terrain: 'plains',
  });
  const cells = new Map<CellId, Cell>([
    [0, mk(0, 0, 0, [1, 2])],
    [1, mk(1, 1, 0, [0, 3])],
    [2, mk(2, 0, 1, [0, 3])],
    [3, mk(3, 1, 1, [1, 2])],
  ]);
  return { cells, seed: 7, donorMapId: 'test', placementAnchors: [0, 3] };
}

function makeUnit(over: Partial<UnitInstance>): UnitInstance {
  return {
    id: 'u',
    type: 'infantry',
    faction: 0,
    cell: 0,
    count: 10,
    stance: 'aggressive',
    attackedFrom: [],
    ...over,
  };
}

describe('Board — co-located token stagger', () => {
  it('two tokens on one cell render offset and shrunk; a lone token does not', () => {
    const units = [
      makeUnit({ id: 'a', cell: 0 }),
      makeUnit({ id: 'b', cell: 0, faction: 1 }),
      makeUnit({ id: 'c', cell: 3 }),
    ];
    const { container } = render(<Board board={makeBoard()} units={units} />);
    const tf = (id: string) =>
      container.querySelector(`[data-unit-id="${id}"]`)!.getAttribute('transform')!;
    expect(tf('a')).toContain('scale(0.8)');
    expect(tf('b')).toContain('scale(0.8)');
    expect(tf('a')).not.toBe(tf('b')); // different corners
    expect(tf('c')).not.toContain('scale'); // lone token untouched
  });

  it('stagger positions are stable when the same pair re-renders (no corner swap)', () => {
    const units = [makeUnit({ id: 'a', cell: 0 }), makeUnit({ id: 'b', cell: 0, faction: 1 })];
    const first = render(<Board board={makeBoard()} units={units} />);
    const tfA = first.container.querySelector('[data-unit-id="a"]')!.getAttribute('transform');
    cleanup();
    const again = render(<Board board={makeBoard()} units={[...units].reverse()} />);
    expect(again.container.querySelector('[data-unit-id="a"]')!.getAttribute('transform')).toBe(
      tfA,
    );
  });
});
