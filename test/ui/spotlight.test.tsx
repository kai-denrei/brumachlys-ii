// @vitest-environment jsdom
// R2 (SPOTLIGHT) — the render/state half: while a combat frame's spotlight is
// ACTIVE, non-combatant tiles + idle units carry the dimmed treatment and
// combatant tiles/units carry the lit (highlight-ring) treatment; once released
// (SETTLE / replay end) nothing is dimmed. The radar badges are untouched.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Board as BoardGraph, Cell, CellId } from '../../src/board/types';
import type { UnitInstance } from '../../src/core/types';
import { Board } from '../../src/ui/Board';

afterEach(cleanup);

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

function unit(over: Partial<UnitInstance>): UnitInstance {
  return {
    id: 'u',
    type: 'tank', // tank → flat glyph (no sprite), simplest token to assert on
    faction: 0,
    cell: 0,
    count: 10,
    stance: 'aggressive',
    attackedFrom: [],
    ...over,
  };
}

const cellEl = (c: HTMLElement, id: CellId) =>
  c.querySelector(`[data-cell-id="${id}"]`) as SVGGElement | null;
const unitEl = (c: HTMLElement, id: string) =>
  c.querySelector(`[data-unit-id="${id}"]`) as SVGGElement | null;

describe('R2 spotlight — Board render treatment', () => {
  // Cell 0 = a combatant (attacker), cell 3 = a non-combatant. Unit 'fighter'
  // is a combatant, unit 'idler' is not. The active spotlight should dim 3 and
  // 'idler', and light 0 and 'fighter'.
  const combatants = { cells: new Set<CellId>([0]), units: new Set<string>(['fighter']) };

  function renderActive(active: boolean) {
    return render(
      <Board
        board={makeBoard()}
        units={[unit({ id: 'fighter', cell: 0 }), unit({ id: 'idler', cell: 3, faction: 1 })]}
        spotlight={{ active, combatants }}
        // replayFx marks the replay branch (and suppresses planning-only chrome)
        replayFx={{ key: 1, fx: { arcs: [], floaters: [], bursts: [], kills: [] } }}
      />,
    );
  }

  it('ACTIVE: non-combatant tile + idle unit carry the dimmed treatment', () => {
    const { container } = renderActive(true);
    // cell 3 is a non-combatant → dimmed
    expect(cellEl(container, 3)!.classList.contains('cell-spotlight-dim')).toBe(true);
    expect(cellEl(container, 3)!.getAttribute('data-spotlight')).toBe('dim');
    // the idle unit → dimmed
    expect(unitEl(container, 'idler')!.classList.contains('unit-spotlight-dim')).toBe(true);
    expect(unitEl(container, 'idler')!.getAttribute('data-spotlight')).toBe('dim');
  });

  it('ACTIVE: combatant tile + unit stay full-colour and get a highlight ring', () => {
    const { container } = renderActive(true);
    // cell 0 is a combatant → lit, NOT dimmed
    expect(cellEl(container, 0)!.classList.contains('cell-spotlight-lit')).toBe(true);
    expect(cellEl(container, 0)!.classList.contains('cell-spotlight-dim')).toBe(false);
    expect(container.querySelector('.cell-spotlight-ring')).not.toBeNull();
    // the fighter → lit, with a unit highlight ring
    expect(unitEl(container, 'fighter')!.classList.contains('unit-spotlight-lit')).toBe(true);
    expect(unitEl(container, 'fighter')!.getAttribute('data-spotlight')).toBe('lit');
    expect(container.querySelector('.unit-spotlight-ring')).not.toBeNull();
  });

  it('RELEASED (SETTLE / end): NOTHING is dimmed or lit', () => {
    const { container } = renderActive(false);
    expect(container.querySelector('.cell-spotlight-dim')).toBeNull();
    expect(container.querySelector('.cell-spotlight-lit')).toBeNull();
    expect(container.querySelector('.unit-spotlight-dim')).toBeNull();
    expect(container.querySelector('.unit-spotlight-lit')).toBeNull();
    // no spotlight payload at all behaves the same
    const none = render(
      <Board
        board={makeBoard()}
        units={[unit({ id: 'fighter', cell: 0 })]}
        replayFx={{ key: 1, fx: { arcs: [], floaters: [], bursts: [], kills: [] } }}
      />,
    );
    expect(none.container.querySelector('.cell-spotlight-dim')).toBeNull();
  });

  it('a unit STANDING ON a combatant cell stays lit even if not itself in the unit set', () => {
    // 'standin' is not in combatants.units but sits on combatant cell 0.
    const { container } = render(
      <Board
        board={makeBoard()}
        units={[unit({ id: 'standin', cell: 0 })]}
        spotlight={{ active: true, combatants: { cells: new Set([0]), units: new Set() } }}
        replayFx={{ key: 1, fx: { arcs: [], floaters: [], bursts: [], kills: [] } }}
      />,
    );
    expect(unitEl(container, 'standin')!.getAttribute('data-spotlight')).toBe('lit');
  });

  // Bug 1 (fog-vs-spotlight): when the PLAYER's own unit fires BEYOND its own
  // vision, the strike is shown so the target cell joins combatants.cells (it is
  // 'lit'), yet that cell sits in the player's fog. The −damage floater is drawn
  // over it, but CellRenderer's dark branch returned early and painted it dark —
  // the witnessed impact read as "hidden behind the fog". A lit (witnessed-combat)
  // cell must escape fog darkening: show terrain + the lit ring, never the cover.
  it('ACTIVE: a witnessed-combat (lit) cell in DARK fog escapes darkening — terrain + ring, no dark-cover', () => {
    const { container } = render(
      <Board
        board={makeBoard()}
        units={[]}
        fog={new Set<CellId>([0])} // cell 0 fogged…
        discovered={new Set<CellId>()} // …and never seen → would be DARK tier
        spotlight={{ active: true, combatants: { cells: new Set<CellId>([0]), units: new Set<string>() } }}
        replayFx={{ key: 1, fx: { arcs: [], floaters: [], bursts: [], kills: [] } }}
      />,
    );
    const cell0 = cellEl(container, 0)!;
    expect(cell0.classList.contains('cell-spotlight-lit')).toBe(true);
    expect(cell0.classList.contains('cell-dark')).toBe(false);
    expect(cell0.querySelector('.dark-cover')).toBeNull();
    expect(container.querySelector('.cell-spotlight-ring')).not.toBeNull();
  });

  // The softer tier: a lit cell that is fogged-but-DISCOVERED (memory) should
  // read as live combat, not the desaturated/washed memory treatment.
  it('ACTIVE: a lit cell in MEMORY fog renders live (no memory wash) + ring', () => {
    const { container } = render(
      <Board
        board={makeBoard()}
        units={[]}
        fog={new Set<CellId>([0])}
        discovered={new Set<CellId>([0])} // fogged + discovered → MEMORY tier
        spotlight={{ active: true, combatants: { cells: new Set<CellId>([0]), units: new Set<string>() } }}
        replayFx={{ key: 1, fx: { arcs: [], floaters: [], bursts: [], kills: [] } }}
      />,
    );
    const cell0 = cellEl(container, 0)!;
    expect(cell0.classList.contains('cell-spotlight-lit')).toBe(true);
    expect(cell0.classList.contains('cell-memory')).toBe(false);
    expect(cell0.querySelector('.memory-wash')).toBeNull();
    expect(container.querySelector('.cell-spotlight-ring')).not.toBeNull();
  });

  it('radar badges untouched: a dimmed token is not given any radar treatment', () => {
    // The replay branch never passes onUnitRadarTap, so no radar pip renders —
    // assert the spotlight dim does not synthesize one (radar stays untouched).
    const { container } = renderActive(true);
    expect(container.querySelector('.unit-radar')).toBeNull();
  });
});
