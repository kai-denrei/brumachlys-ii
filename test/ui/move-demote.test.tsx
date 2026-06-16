// @vitest-environment jsdom
// Once a unit's MOVE is decided its start-cell token shrinks to a quarter and
// tucks into the polygon corner facing its first step — freeing the cell center
// (so an occupied base stays tappable to build on) and making "still needs an
// order" read at a glance. Symmetric with the idle pulse (which marks the
// UN-ordered units); the two are mutually exclusive per unit. Pure placement is
// demoteSlot (geometry — seats the SQUARE token fully inside the cell, never
// spilling into a neighbour), the Board wires it under the same gates as the
// pulse and renders the demoted token glyph-only (minimal).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { Board as BoardGraph, Cell, CellId } from '../../src/board/types';
import type { UnitInstance } from '../../src/core/types';
import { useAppStore } from '../../src/state/store';
import { Board, DEMOTE_SCALE, demoteSlot } from '../../src/ui/Board';

afterEach(cleanup);

// --- geometry helpers (test-local, independent of the implementation) --------

type P = [number, number];

function distToEdges(p: P, poly: P[]): number {
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const len2 = abx * abx + aby * aby || 1e-12;
    let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t));
    if (d < min) min = d;
  }
  return min;
}

function inPolygon(p: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]![0];
    const yi = poly[i]![1];
    const xj = poly[j]![0];
    const yj = poly[j]![1];
    const hit = yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

/** The demoted SQUARE token's corner reach — what must clear every edge. */
const halfCorner = (tokenSize: number, scale = DEMOTE_SCALE) => ((tokenSize * scale) / 2) * Math.SQRT2;

// --- pure geometry: demoteSlot ----------------------------------------------

describe('demoteSlot (pure)', () => {
  const diamond: P[] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];

  it('seats the token toward the corner facing the step, fully inside the cell', () => {
    const slot = demoteSlot(diamond, [10, 0], 1); // step points +x
    expect(slot.scale).toBe(DEMOTE_SCALE);
    expect(slot.y).toBeCloseTo(0, 6); // on the +x axis, toward the [1,0] corner
    expect(slot.x).toBeGreaterThan(0);
    expect(slot.x).toBeLessThan(1);
    // contract: the whole square token clears every edge — no spill
    expect(inPolygon([slot.x, slot.y], diamond)).toBe(true);
    expect(distToEdges([slot.x, slot.y], diamond)).toBeGreaterThanOrEqual(halfCorner(1) - 1e-6);
  });

  it('picks the opposite corner for the opposite step direction', () => {
    const up = demoteSlot(diamond, [0, 10], 1);
    expect(up.x).toBeCloseTo(0, 6);
    expect(up.y).toBeGreaterThan(0);
    const down = demoteSlot(diamond, [0, -10], 1);
    expect(down.y).toBeLessThan(0);
    expect(down.y).toBeCloseTo(-up.y, 6); // symmetric
  });

  it('IRREGULAR cell (sharp corners): the square still clears every edge', () => {
    // a skewed, non-axis quad — the class the diamond/square fixtures cannot
    // exercise; a radial-only inset would let the square poke past a sharp edge.
    const skew: P[] = [
      [0, 0],
      [3, 0.2],
      [2.6, 2],
      [0.3, 1.5],
    ];
    for (const step of [
      [10, 0],
      [0, 10],
      [-10, 1],
      [3, -10],
      [8, 8],
    ] as P[]) {
      const s = demoteSlot(skew, step, 0.5);
      const p: P = [s.x, s.y];
      expect(inPolygon(p, skew)).toBe(true);
      expect(distToEdges(p, skew)).toBeGreaterThanOrEqual(halfCorner(0.5) - 1e-6);
    }
  });

  it('a token bigger than the cell falls back to the centroid (best effort)', () => {
    const slot = demoteSlot(diamond, [10, 0], 10); // huge token vs a unit diamond
    expect(slot.x).toBeCloseTo(0, 6); // centroid of the diamond
    expect(slot.y).toBeCloseTo(0, 6);
  });

  it('a degenerate (zero-length) step centres on the centroid', () => {
    const slot = demoteSlot(diamond, [0, 0], 1);
    expect(slot.x).toBeCloseTo(0, 6);
    expect(slot.y).toBeCloseTo(0, 6);
    expect(slot.scale).toBe(DEMOTE_SCALE);
  });
});

// --- Board integration -------------------------------------------------------

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
    [0, mk(0, 0, 0, [1])],
    [1, mk(1, 1, 0, [0, 2])],
    [2, mk(2, 2, 0, [1])],
  ]);
  return { cells, seed: 7, donorMapId: 'test', placementAnchors: [0, 2] };
}

function unit(id: string, faction: 0 | 1, cell: CellId): UnitInstance {
  return { id, type: 'infantry', faction, cell, count: 10, stance: 'aggressive', attackedFrom: [] };
}

const board = makeBoard();
const units = [unit('own1', 0, 0), unit('own2', 0, 1), unit('foe', 1, 2)];

function tokenEl(container: HTMLElement, id: string): Element {
  return container.querySelector(`[data-unit-id="${id}"]`)!;
}
function demotedIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-unit-id]')]
    .filter((el) => (el.getAttribute('transform') ?? '').includes(`scale(${DEMOTE_SCALE})`))
    .map((el) => el.getAttribute('data-unit-id')!);
}

describe('move demote (Board)', () => {
  beforeEach(() => {
    useAppStore.setState({ screen: 'battle', uiPhase: 'planning', orders: {} });
  });

  it('a decided move shrinks the token to 1/4 and renders it glyph-only (minimal)', () => {
    useAppStore.setState({
      orders: { own1: { move: { kind: 'move', unitId: 'own1', path: [1] } } },
    });
    const { container } = render(<Board board={board} units={units} />);
    expect(demotedIds(container)).toEqual(['own1']);
    // demoted = glyph-only: the count pip (non-minimal chrome) is dropped...
    expect(tokenEl(container, 'own1').querySelector('.unit-count')).toBeNull();
    // ...while an un-ordered unit keeps its full token (count pip present)
    expect(tokenEl(container, 'own2').querySelector('.unit-count')).not.toBeNull();
    expect(tokenEl(container, 'own2').getAttribute('transform')).not.toContain(
      `scale(${DEMOTE_SCALE})`,
    );
  });

  it('a non-move order (stance only) does NOT demote — only moves have a direction', () => {
    useAppStore.setState({
      orders: { own1: { stance: { kind: 'stance', unitId: 'own1', stance: 'defensive' } } },
    });
    const { container } = render(<Board board={board} units={units} />);
    expect(demotedIds(container)).toEqual([]);
  });

  it('a merely-selected moved unit STILL demotes (selection persists past commit)', () => {
    // commitPendingMove keeps the unit selected, so exempting selection would
    // hide the demote until the player tapped away — the unit demotes anyway.
    useAppStore.setState({
      orders: { own1: { move: { kind: 'move', unitId: 'own1', path: [1] } } },
    });
    const { container } = render(<Board board={board} units={units} selectedUnitId="own1" />);
    expect(demotedIds(container)).toEqual(['own1']);
  });

  it('the unit being ACTIVELY proposed is exempt (full-size while commanded)', () => {
    useAppStore.setState({
      orders: { own1: { move: { kind: 'move', unitId: 'own1', path: [1] } } },
    });
    const proposal = { unit: units[0]!, movePath: [1] as const, dest: 1 };
    const { container } = render(
      <Board board={board} units={units} selectedUnitId="own1" proposal={proposal} />,
    );
    expect(demotedIds(container)).toEqual([]);
  });

  it('queueing a move mid-render demotes that token instantly', () => {
    const { container } = render(<Board board={board} units={units} />);
    expect(demotedIds(container)).toEqual([]);
    act(() =>
      useAppStore.setState({
        orders: { own2: { move: { kind: 'move', unitId: 'own2', path: [2] } } },
      }),
    );
    expect(demotedIds(container)).toEqual(['own2']);
  });

  it('never demotes during replay, on silhouettes, or non-interactive previews', () => {
    useAppStore.setState({
      orders: { own1: { move: { kind: 'move', unitId: 'own1', path: [1] } } },
    });
    const fx = { key: 0, fx: { arcs: [], floaters: [], bursts: [], kills: [] } };
    const replay = render(<Board board={board} units={units} replayFx={fx} />);
    expect(demotedIds(replay.container)).toEqual([]);

    const silhouette = render(<Board board={board} units={units} silhouette />);
    expect(demotedIds(silhouette.container)).toEqual([]);

    const still = render(<Board board={board} units={units} interactive={false} />);
    expect(demotedIds(still.container)).toEqual([]);
  });

  it('never demotes enemy tokens (own faction only)', () => {
    useAppStore.setState({
      orders: { foe: { move: { kind: 'move', unitId: 'foe', path: [1] } } },
    });
    const { container } = render(<Board board={board} units={units} />);
    expect(demotedIds(container)).toEqual([]);
  });
});
