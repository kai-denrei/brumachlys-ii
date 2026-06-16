// @vitest-environment jsdom
// Infantry renders as an animated sprite token when `sprite` is on (the board
// passes the "anim" store flag); off → the flat glyph. Faction is shown by tint
// (native blue for faction 1, blue→red filter for faction 0). The sprite CLIP
// follows the `motion` prop: idle ambient / move (run·roll) / fire (a shoot).
// Minimal contexts and non-infantry types keep the squircle glyph.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Board as BoardGraph, Cell, CellId } from '../../src/board/types';
import type { UnitInstance } from '../../src/core/types';
import { useAppStore } from '../../src/state/store';
import { Board } from '../../src/ui/Board';
import { UnitRenderer, type Motion, type ReplayFxData } from '../../src/ui/skin';

afterEach(cleanup);

function unit(over: Partial<UnitInstance> = {}): UnitInstance {
  return {
    id: 'u1',
    type: 'infantry',
    faction: 1,
    cell: 0,
    count: 10,
    stance: 'aggressive',
    attackedFrom: [],
    ...over,
  };
}

function renderToken(u: UnitInstance, opts: { sprite?: boolean; minimal?: boolean; motion?: Motion } = {}) {
  return render(
    <svg>
      <UnitRenderer
        unit={u}
        x={0}
        y={0}
        size={40}
        sprite={opts.sprite ?? true}
        minimal={opts.minimal ?? false}
        motion={opts.motion ?? 'idle'}
      />
    </svg>,
  );
}

const clipOf = (c: HTMLElement) => c.querySelector('.unit-sprite image')?.getAttribute('data-sprite-clip');

describe('UnitSprite (infantry)', () => {
  it('sprite on → animated <image>, no squircle, count pip + tap target kept', () => {
    const { container } = renderToken(unit());
    const img = container.querySelector('.unit-sprite image');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('href')).toMatch(/\.png/);
    expect(container.querySelector('.unit-body')).toBeNull();
    expect(container.querySelector('.unit-sprite .unit-hit')).not.toBeNull(); // tappable
    expect(container.querySelector('.unit-count')).not.toBeNull();
  });

  it('sprite OFF (the "anim" toggle) → the flat glyph, no sprite', () => {
    const { container } = renderToken(unit(), { sprite: false });
    expect(container.querySelector('.unit-sprite')).toBeNull();
    expect(container.querySelector('.unit-body')).not.toBeNull();
  });

  it('faction 0 gets the blue→red filter; faction 1 stays native blue', () => {
    const red = renderToken(unit({ faction: 0 })).container.querySelector('.unit-sprite image')!;
    expect(red.getAttribute('style') ?? '').toContain('sprite-red');
    const blue = renderToken(unit({ faction: 1 })).container.querySelector('.unit-sprite image')!;
    expect(blue.getAttribute('style') ?? '').not.toContain('sprite-red');
  });

  it('the clip follows motion: idle→ambient, move→run/roll, fire→a shoot', () => {
    expect(['idle', 'sitting', 'sittingRecharge']).toContain(clipOf(renderToken(unit(), { motion: 'idle' }).container));
    expect(['run', 'roll']).toContain(clipOf(renderToken(unit(), { motion: 'move' }).container));
    expect(['standShoot', 'sitShoot', 'lieShoot']).toContain(
      clipOf(renderToken(unit(), { motion: 'fire' }).container),
    );
  });

  it('minimal infantry keeps the cheap glyph (chips / demoted tokens)', () => {
    expect(renderToken(unit(), { minimal: true }).container.querySelector('.unit-sprite')).toBeNull();
  });

  it('non-infantry units keep the squircle body (no sprite)', () => {
    const { container } = renderToken(unit({ type: 'tank' }));
    expect(container.querySelector('.unit-sprite')).toBeNull();
    expect(container.querySelector('.unit-body')).not.toBeNull();
  });
});

// --- Board wires motion from the replay frame -------------------------------

function makeBoard(): BoardGraph {
  const sq = (cx: number, cy: number): [number, number][] => [
    [cx - 0.4, cy - 0.4],
    [cx + 0.4, cy - 0.4],
    [cx + 0.4, cy + 0.4],
    [cx - 0.4, cy + 0.4],
  ];
  const mk = (id: CellId, cx: number, cy: number, nb: CellId[]): Cell => ({
    id,
    center: [cx, cy],
    polygon: sq(cx, cy),
    neighbors: nb,
    terrain: 'plains',
  });
  const cells = new Map<CellId, Cell>([
    [0, mk(0, 0, 0, [1])],
    [1, mk(1, 1, 0, [0])],
  ]);
  return { cells, seed: 7, donorMapId: 'test', placementAnchors: [0, 1] };
}

const EMPTY_FX: ReplayFxData = { arcs: [], floaters: [], bursts: [], kills: [] };
const clipFor = (c: HTMLElement, id: string) =>
  c.querySelector(`[data-unit-id="${id}"] .unit-sprite image`)?.getAttribute('data-sprite-clip');

describe('infantry sprite motion (Board, from the replay frame)', () => {
  beforeEach(() => useAppStore.setState({ screen: 'battle', uiPhase: 'replay', spritesOn: true }));

  it('FIRES (a shoot clip) when its cell is an arc source this frame', () => {
    const fx: ReplayFxData = { ...EMPTY_FX, arcs: [{ from: 0, to: 1, faction: 0 }] };
    const { container } = render(
      <Board board={makeBoard()} units={[unit({ id: 'a', faction: 0, cell: 0 })]} replayFx={{ key: 1, fx }} />,
    );
    expect(['standShoot', 'sitShoot', 'lieShoot']).toContain(clipFor(container, 'a'));
  });

  it('MOVES (run/roll) when its cell changes between frames', () => {
    const board = makeBoard();
    const { container, rerender } = render(
      <Board board={board} units={[unit({ id: 'a', faction: 0, cell: 0 })]} replayFx={{ key: 1, fx: EMPTY_FX }} />,
    );
    rerender(
      <Board board={board} units={[unit({ id: 'a', faction: 0, cell: 1 })]} replayFx={{ key: 2, fx: EMPTY_FX }} />,
    );
    expect(['run', 'roll']).toContain(clipFor(container, 'a'));
  });

  it('IDLES during planning (no replayFx) — at rest it never runs or shoots', () => {
    useAppStore.setState({ uiPhase: 'planning' });
    const { container } = render(
      <Board board={makeBoard()} units={[unit({ id: 'a', faction: 0, cell: 0 })]} />,
    );
    expect(['idle', 'sitting', 'sittingRecharge']).toContain(clipFor(container, 'a'));
  });
});
