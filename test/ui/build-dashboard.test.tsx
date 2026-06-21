// @vitest-environment jsdom
// Phase 4 Task 4.1 — BuildDashboard: the full-screen economy modal. Four
// sections top → bottom: A economy summary (credits/income/upkeep/net/
// committed), B mini-map (one tinted node per base), C per-base production
// list (one row per PLAYER-owned base, ascending, with the reused UnitPicker),
// D army roster (counts + upkeep by type). Affordability mirrors validateBuy:
// available = credits − committedElsewhere(base). Occupancy = a living unit on
// the base cell → the will-not-spawn warning (picker stays usable).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { Board, Cell, CellId, Vec2 } from '../../src/board/types';
import type { FactionId, UnitInstance } from '../../src/core/types';
import type { BuyQueues } from '../../src/core/orders';
import { loadUnits } from '../../src/io/data-loader';
import { factionUpkeep } from '../../src/core/economy';
import { factionColor } from '../../src/ui/skin/palette';
import { PLAYER_FACTION } from '../../src/state/store';
import { BuildDashboard } from '../../src/ui/BuildDashboard';

afterEach(cleanup);
const types = loadUnits();
const RATE = 0.01;

// A small board with real square polygons (mini-map needs non-degenerate cells)
// and three base cells: 0 (player), 2 (player), 4 (enemy). The rest are plains.
function dashBoard(): Board {
  const cells = new Map<CellId, Cell>();
  const n = 6;
  const baseCells = new Set([0, 2, 4]);
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
      terrain: baseCells.has(i) ? 'base' : 'plains',
    });
  }
  return { cells, seed: 0, donorMapId: 'dash-test' };
}

const bases: Readonly<Record<CellId, FactionId | null>> = { 0: 0, 2: 0, 4: 1 };

const u = (
  id: string,
  faction: FactionId,
  cell: CellId,
  type = 'infantry',
  count = 10,
): UnitInstance => ({ id, type, faction, cell, count, stance: 'aggressive', attackedFrom: [] });

function dash(over: Partial<Parameters<typeof BuildDashboard>[0]> = {}) {
  const units: Record<string, UnitInstance> = {
    pi: u('pi', 0, 5, 'infantry', 10), // player infantry on a non-base cell
    pr: u('pr', 0, 9, 'ranger', 10), // off-board cell, fine for roster math
    ei: u('ei', 1, 4, 'infantry', 10), // enemy
  };
  const props: Parameters<typeof BuildDashboard>[0] = {
    board: dashBoard(),
    bases,
    units,
    unitTypes: types,
    credits: 250,
    income: 200,
    upkeepRate: RATE,
    buys: {} as BuyQueues,
    focusBase: null,
    onQueue: () => {},
    onRemove: () => {},
    onClose: () => {},
    ...over,
  };
  return render(<BuildDashboard {...props} />);
}

describe('BuildDashboard — A economy summary', () => {
  it('net equals income − factionUpkeep(player units)', () => {
    const units: Record<string, UnitInstance> = {
      pi: u('pi', 0, 5, 'infantry', 10),
      pr: u('pr', 0, 9, 'ranger', 10),
      ei: u('ei', 1, 4, 'infantry', 10),
    };
    const { getByTestId } = dash({ units });
    const expectedUpkeep = factionUpkeep(Object.values(units), PLAYER_FACTION, types, RATE);
    // infantry 10 → round(75*0.01*10)=8 ; ranger 10 → round(150*0.01*10)=15 ⇒ 23
    expect(expectedUpkeep).toBe(23);
    const net = 200 - expectedUpkeep; // 177
    const summary = getByTestId('econ-summary');
    expect(summary.textContent).toContain(String(expectedUpkeep)); // upkeep 23
    expect(summary.textContent).toContain(String(net)); // net 177
  });

  it('a negative net uses the typographic minus U+2212, never an ASCII hyphen', () => {
    // huge army, no income → net is sharply negative.
    const units: Record<string, UnitInstance> = {
      a: u('a', 0, 5, 'heavytank', 10),
      b: u('b', 0, 9, 'heavytank', 10),
    };
    const { getByTestId } = dash({ units, income: 0 });
    const net = getByTestId('econ-net');
    expect(net.textContent).toContain('−'); // U+2212
    expect(net.textContent).not.toMatch(/-\d/); // no ASCII hyphen-minus before a digit
  });
});

describe('BuildDashboard — C per-base production list', () => {
  it('renders one row per PLAYER-owned base, ascending by cell id', () => {
    const { getByTestId } = dash();
    const rows = [...getByTestId('base-list').querySelectorAll('[data-base-row]')];
    expect(rows.map((r) => Number(r.getAttribute('data-base-row')))).toEqual([0, 2]); // not 4 (enemy)
  });

  it('flags an occupied base with the will-not-spawn warning (no ASCII hyphen)', () => {
    // a living player unit on base cell 0 → occupied.
    const units: Record<string, UnitInstance> = {
      onbase: u('onbase', 0, 0, 'infantry', 10),
      pr: u('pr', 0, 9, 'ranger', 10),
    };
    const { getByTestId } = dash({ units });
    const row0 = getByTestId('base-list').querySelector('[data-base-row="0"]')!;
    expect(row0.textContent).toContain('will not spawn');
    expect(row0.textContent).not.toContain('won-t'); // sanity: no stray hyphen artifacts
    // base 2 is vacant
    const row2 = getByTestId('base-list').querySelector('[data-base-row="2"]')!;
    expect(row2.textContent!.toLowerCase()).toContain('vacant');
  });

  it('picking a unit in a row calls onQueue(baseCell, key); cancel calls onRemove(baseCell)', () => {
    const onQueue = vi.fn();
    const onRemove = vi.fn();
    // A cheap committed buy on base 2 keeps base 0's budget ample for a ranger.
    const buys: BuyQueues = { 2: { kind: 'buy', baseCell: 2, unitTypeKey: 'infantry' } };
    const { getByTestId } = dash({ onQueue, onRemove, buys, credits: 400 });
    // queue on base 0 (vacant, no buy yet): pick a ranger in its picker.
    const row0 = getByTestId('base-list').querySelector('[data-base-row="0"]')!;
    fireEvent.click(row0.querySelector('[data-build-type="ranger"]')!);
    expect(onQueue).toHaveBeenCalledWith(0, 'ranger');
    // cancel the queued buy on base 2.
    const row2 = getByTestId('base-list').querySelector('[data-base-row="2"]')!;
    fireEvent.click(row2.querySelector('[data-base-cancel]')!);
    expect(onRemove).toHaveBeenCalledWith(2);
  });

  it('a row picker gates affordability by available = credits − committedElsewhere', () => {
    // credits 250; a 200-cost buy committed on base 2 → base 0 has only 50 left,
    // so a ranger (150) is locked there but a heavytank (600) row on base 2 stays
    // open for its already-queued unit. Use a cheap committed buy to keep it
    // deterministic: tank (300) > 250 would be invalid, so commit a humvee (150).
    const buys: BuyQueues = { 2: { kind: 'buy', baseCell: 2, unitTypeKey: 'humvee' } };
    const { getByTestId } = dash({ credits: 250, buys });
    const row0 = getByTestId('base-list').querySelector('[data-base-row="0"]')!;
    // available on base 0 = 250 − 150 = 100 → infantry(75) ok, ranger(150) locked.
    const inf = row0.querySelector('[data-build-type="infantry"]') as HTMLButtonElement;
    const ranger = row0.querySelector('[data-build-type="ranger"]') as HTMLButtonElement;
    expect(inf.disabled).toBe(false);
    expect(ranger.disabled).toBe(true);
  });
});

describe('BuildDashboard — B mini-map', () => {
  it('renders a [data-base] node per base, tinted by owner', () => {
    const { getByTestId } = dash();
    const map = getByTestId('build-minimap');
    const nodes = [...map.querySelectorAll('[data-base]')];
    expect(nodes.map((n) => Number(n.getAttribute('data-base'))).sort((a, b) => a - b)).toEqual([
      0, 2, 4,
    ]);
    // owned bases carry a fill blended toward the owner color; the SVG fill is
    // present and not the neutral grey for the enemy base.
    const enemyNode = map.querySelector('[data-base="4"]')!;
    const playerNode = map.querySelector('[data-base="0"]')!;
    expect(enemyNode.getAttribute('fill')).toBeTruthy();
    expect(playerNode.getAttribute('fill')).toBeTruthy();
    // the two owners produce distinct tints.
    expect(playerNode.getAttribute('fill')).not.toBe(enemyNode.getAttribute('fill'));
    // sanity: the palette helpers are the tint source.
    expect(factionColor(0)).not.toBe(factionColor(1));
  });

  it('labels every base cell with its id (Task 7.1 — map ↔ list correlation)', () => {
    const { getByTestId } = dash();
    const map = getByTestId('build-minimap');
    const texts = [...map.querySelectorAll('text')].map((t) => t.textContent?.trim());
    // every base id (player 0, 2 and enemy 4) gets a numeric label on the map.
    for (const id of [0, 2, 4]) {
      expect(texts).toContain(String(id));
    }
  });

  it('keeps two-digit base ids legible (a 71 base still gets its own label)', () => {
    // a base on cell 71 with a polygon so projectBoard has something to place.
    const board = dashBoard();
    board.cells.set(71, {
      id: 71,
      center: [71.5, 0.5],
      polygon: [
        [71, 0],
        [72, 0],
        [72, 1],
        [71, 1],
      ],
      neighbors: [],
      terrain: 'base',
    });
    const { getByTestId } = dash({ board, bases: { ...bases, 71: 0 } });
    const map = getByTestId('build-minimap');
    const texts = [...map.querySelectorAll('text')].map((t) => t.textContent?.trim());
    expect(texts).toContain('71');
  });
});

describe('BuildDashboard — focusBase', () => {
  it('marks the focused base row data-focused="true"', () => {
    const { getByTestId } = dash({ focusBase: 2 });
    const list = getByTestId('base-list');
    const focused = list.querySelector('[data-focused="true"]')!;
    expect(focused.getAttribute('data-base-row')).toBe('2');
    // the non-focused row is not marked.
    const row0 = list.querySelector('[data-base-row="0"]')!;
    expect(row0.getAttribute('data-focused')).not.toBe('true');
  });
});

describe('BuildDashboard — D army roster', () => {
  it('counts player units by type with each type’s upkeep contribution', () => {
    const units: Record<string, UnitInstance> = {
      a: u('a', 0, 5, 'infantry', 10),
      b: u('b', 0, 6, 'infantry', 10),
      c: u('c', 0, 7, 'ranger', 10),
      ei: u('ei', 1, 4, 'infantry', 10), // enemy excluded
    };
    const { getByTestId } = dash({ units });
    const roster = getByTestId('army-roster');
    // two infantry, one ranger for the player.
    expect(roster.textContent).toContain('Infantry');
    expect(roster.textContent).toContain('Ranger');
    // total upkeep footer = 8+8+15 = 31.
    const total = factionUpkeep(Object.values(units), PLAYER_FACTION, types, RATE);
    expect(total).toBe(31);
    expect(roster.textContent).toContain(String(total));
  });
});

describe('BuildDashboard — header + close', () => {
  it('shows the credit glyph with current credits and closes via the X', () => {
    const onClose = vi.fn();
    const { getByLabelText, container } = dash({ credits: 250, onClose });
    expect(container.textContent).toContain('◈');
    expect(container.textContent).toContain('250');
    fireEvent.click(getByLabelText(/close/i));
    expect(onClose).toHaveBeenCalled();
  });
});
