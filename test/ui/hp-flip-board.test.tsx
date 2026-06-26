// @vitest-environment jsdom
// Combat-readability §2 — the Board wiring half: a hit defender's count pip
// HOLDS its pre-hit count during a combat replay frame, then folds DOWN to the
// post-combat count after the witnessed shot lands. Pure timing/flip math is
// covered in hp-flip-timing; CountFlap stepping in count-flap; here we assert
// Board derives the flip from (impacts + beats + post-combat counts) and threads
// it to the right token.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { Board as BoardGraph, Cell, CellId } from '../../src/board/types';
import type { UnitInstance } from '../../src/core/types';
import type { ReplayFxData } from '../../src/ui/skin';
import type { Beat } from '../../src/state/replay-timing';
import { Board } from '../../src/ui/Board';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function makeBoard(): BoardGraph {
  const square = (cx: number, cy: number): [number, number][] => [
    [cx - 0.4, cy - 0.4],
    [cx + 0.4, cy - 0.4],
    [cx + 0.4, cy + 0.4],
    [cx - 0.4, cy + 0.4],
  ];
  const mk = (id: CellId, cx: number, cy: number, nb: CellId[]): Cell => ({
    id,
    center: [cx, cy],
    polygon: square(cx, cy),
    neighbors: nb,
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

const unit = (over: Partial<UnitInstance>): UnitInstance => ({
  id: 'u',
  type: 'tank',
  faction: 0,
  cell: 0,
  count: 10,
  stance: 'aggressive',
  attackedFrom: [],
  ...over,
});

// attacker on cell 0 shells defender on cell 2; defender survives at 5 (took 3).
const beats: Beat[] = [
  {
    start: 0,
    dur: 1000,
    activeCells: [0, 2],
    projectiles: [{ kind: 'shell', from: 0, to: 2, faction: 0, impact: 0.88, delay: 0 }],
  },
];

const fx: ReplayFxData = {
  arcs: [],
  floaters: [],
  bursts: [],
  kills: [],
  beats,
  impacts: [
    { attackerId: 'gun', attackerCell: 0, defenderId: 'def', defenderCell: 2, damage: 3 },
  ],
};

const pipOf = (c: HTMLElement, id: string) =>
  c.querySelector(`[data-unit-id="${id}"] .unit-count text`)?.textContent;

describe('Board HP flip wiring', () => {
  it('holds the pre-hit count on the hit defender, then folds to the post-combat count', () => {
    vi.useFakeTimers();
    const { container } = render(
      <Board
        board={makeBoard()}
        units={[unit({ id: 'gun', cell: 0 }), unit({ id: 'def', cell: 2, faction: 1, count: 5 })]}
        replayFx={{ key: 1, fx }}
      />,
    );
    // pre-impact: the defender still reads its OLD count (5 post + 3 damage = 8)
    expect(pipOf(container, 'def')).toBe('8');
    // attacker (no damage taken) reads its plain count
    expect(pipOf(container, 'gun')).toBe('10');
    // after the shell lands (0.88×1000=880ms) + the fold cascade → settled at 5
    act(() => {
      vi.advanceTimersByTime(880 + 3000);
    });
    expect(pipOf(container, 'def')).toBe('5');
  });
});
