// @vitest-environment jsdom
// Stage 3 (combat-readability sequencing §4/§6/§7/§8) — the RENDERING half:
//   A. FOCAL SPOTLIGHT — a per-beat activeCells set passed as the Board
//      spotlight dims everything else (non-active cells/units → 'dim').
//   B. SEQUENCED-BEAT FX — ReplayFx plays each beat's projectiles in ITS window
//      (the beat's start as the launch delay, its dur as the animation window),
//      not all at once.
//   C/§6. DOTTED + CLIPPED TRACER — the tracer guide is a dotted line a→b, and
//      the whole FX layer is clipped to the board frame (no off-frame laser).
//   D/§7. CAPTURE CALLOUT FITS — the longest capture term ("All your Bases Are
//      Belong To Us!") stays within the frame bounds at an edge cell.
//   E/§8. ARTILLERY ARC — a higher lob control point + a longer flight than a
//      short-distance ranged tracer's window.
// Determinism + fog honesty are covered by the pure activeCellsAt tests
// (replay-timing) — here we assert the markup each rendered behavior needs.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Board as BoardGraph, Cell, CellId, Vec2 } from '../../src/board/types';
import type { UnitInstance } from '../../src/core/types';
import { Board } from '../../src/ui/Board';
import { ReplayFx, type ReplayFxData } from '../../src/ui/skin';
import type { Projectile } from '../../src/state/replay-timing';
import { activeCellsAt, layoutBeats } from '../../src/state/replay-timing';

afterEach(cleanup);

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
  return { cells, seed: 0, donorMapId: 'seq-render-test', placementAnchors: [0, n - 1] };
}

const toScreen = (p: readonly [number, number]): [number, number] => [p[0] * 100, -p[1] * 100];

const emptyFx = (): ReplayFxData => ({ arcs: [], floaters: [], bursts: [], kills: [] });

function renderFx(fx: Partial<ReplayFxData>, board = rowBoard(8)) {
  return render(
    <svg>
      <ReplayFx
        board={board}
        toScreen={toScreen}
        tokenSize={40}
        fx={{ ...emptyFx(), ...fx }}
        player={0}
        clipId="board-fx-clip"
        frameBounds={{ x: 0, y: -100, width: 800, height: 100 }}
      />
    </svg>,
  );
}

function unit(id: string, faction: 0 | 1, cell: CellId, type = 'tank'): UnitInstance {
  return { id, type, faction, cell, count: 10, stance: 'aggressive', attackedFrom: [] };
}

const proj = (over: Partial<Projectile>): Projectile => ({
  kind: 'tracer',
  from: 0,
  to: 2,
  faction: 0,
  impact: 0.8,
  delay: 0,
  ...over,
});

// ----------------------------------------------------------------------------
// A. FOCAL SPOTLIGHT — non-active cells/units dim under a per-beat set
// ----------------------------------------------------------------------------
describe('§4 focal spotlight — a per-beat activeCells set dims everything else', () => {
  const cellSpot = (c: HTMLElement, id: CellId) =>
    c.querySelector(`[data-cell-id="${id}"]`)?.getAttribute('data-spotlight') ?? null;

  it('only the beat-1 active cells are lit; the rest are dimmed', () => {
    // beat-1 exchange is cells 0↔1; cells 2..5 are NOT in the beat.
    const board = rowBoard(6);
    const { container } = render(
      <Board
        board={board}
        units={[unit('a', 0, 0), unit('d', 1, 1), unit('idle', 0, 4)]}
        interactive={false}
        spotlight={{ active: true, combatants: { cells: new Set([0, 1]), units: new Set() } }}
      />,
    );
    expect(cellSpot(container, 0)).toBe('lit');
    expect(cellSpot(container, 1)).toBe('lit');
    expect(cellSpot(container, 2)).toBe('dim');
    expect(cellSpot(container, 4)).toBe('dim');
    // a unit standing on a non-active cell dims; one on an active cell lights
    const unitSpot = (id: string) =>
      container.querySelector(`[data-unit-id="${id}"]`)?.getAttribute('data-spotlight') ?? null;
    expect(unitSpot('a')).toBe('lit');
    expect(unitSpot('d')).toBe('lit');
    expect(unitSpot('idle')).toBe('dim');
  });

  it('a DIFFERENT beat lights a DIFFERENT cell set (the spotlight follows the beat)', () => {
    // activeCellsAt picks the containing beat — the source of the per-beat set.
    const { beats } = layoutBeats(
      [
        { activeCells: [0, 1], projectiles: [], band: 'ranged' },
        { activeCells: [4, 5], projectiles: [], band: 'ranged' },
      ],
      1.6,
    );
    const beat1 = activeCellsAt(beats, beats[0]!.start + 1);
    const beat2 = activeCellsAt(beats, beats[1]!.start + 1);
    expect(beat1).toEqual([0, 1]);
    expect(beat2).toEqual([4, 5]);
    // between the two beats (the inter-beat gap) → no active cells (restore)
    const gapT = beats[0]!.start + beats[0]!.dur + 1;
    expect(activeCellsAt(beats, gapT)).toEqual([]);
  });
});

// ----------------------------------------------------------------------------
// B. SEQUENCED-BEAT FX — each beat's projectiles play in its own window
// ----------------------------------------------------------------------------
describe('§3/B sequenced-beat FX — projectiles play one beat at a time', () => {
  it('beat K projectiles launch at beat K start (--proj-delay) over beat K dur (--proj-dur)', () => {
    const { beats } = layoutBeats(
      [
        { activeCells: [0, 2], projectiles: [proj({ from: 0, to: 2 })], band: 'ranged' },
        { activeCells: [4, 6], projectiles: [proj({ from: 4, to: 6 })], band: 'ranged' },
      ],
      1.0,
    );
    const { container } = renderFx({ beats });
    const tracers = [...container.querySelectorAll<SVGGElement>('.fx-tracer')];
    expect(tracers.length).toBe(2);
    const delays = tracers.map((t) => t.style.getPropertyValue('--proj-delay'));
    // beat 0 launches at start 0; beat 1 launches LATER (its start > 0) — they
    // are sequenced, not a simultaneous burst.
    expect(delays[0]).toBe('0ms');
    expect(parseFloat(delays[1]!)).toBeGreaterThan(0);
    expect(parseFloat(delays[1]!)).toBeCloseTo(beats[1]!.start, 3);
    // the animation window is the beat's own dur (sequencing scales it)
    for (let i = 0; i < tracers.length; i++) {
      expect(tracers[i]!.style.getPropertyValue('--proj-dur')).toBe(`${beats[i]!.dur}ms`);
    }
  });

  it('the flat projectiles path is unchanged when no beats are given', () => {
    const { container } = renderFx({ projectiles: [proj({ from: 0, to: 2 })] });
    expect(container.querySelectorAll('.fx-tracer').length).toBe(1);
  });
});

// ----------------------------------------------------------------------------
// C/§6. CONTAINED + CLIPPED TRACER
// ----------------------------------------------------------------------------
describe('§6 contained tracer — no full-line guide + the FX layer clipped to frame', () => {
  it('the tracer renders NO full-line guide (removed — the crawl conveys the shot)', () => {
    const board = rowBoard(8);
    const { container } = renderFx({ projectiles: [proj({ kind: 'tracer', from: 0, to: 6 })] }, board);
    const tracer = container.querySelector('.fx-tracer')!;
    expect(tracer).not.toBeNull();
    // no board-spanning guide line; the crawling round + spark remain
    expect(container.querySelector('.fx-tracer-guide')).toBeNull();
    expect(tracer.querySelector('.fx-tracer-round')).not.toBeNull();
    expect(tracer.querySelector('.fx-tracer-spark')).not.toBeNull();
  });

  it('the whole replay-FX layer is CLIPPED to the board frame', () => {
    const { container } = renderFx({ projectiles: [proj({ from: 0, to: 6 })] });
    const layer = container.querySelector('.board-replay-fx')!;
    expect(layer.getAttribute('clip-path')).toBe('url(#board-fx-clip)');
  });

  it('the board defines a board-frame clipPath matching the viewBox bbox', () => {
    const board = rowBoard(6);
    const { container } = render(
      <Board board={board} units={[]} interactive={false} replayFx={{ key: 0, fx: emptyFx() }} />,
    );
    const clip = container.querySelector('#board-fx-clip rect');
    expect(clip).not.toBeNull();
    expect(Number(clip!.getAttribute('width'))).toBeGreaterThan(0);
    // the rendered FX group is clipped to it
    expect(container.querySelector('.board-replay-fx')!.getAttribute('clip-path')).toBe(
      'url(#board-fx-clip)',
    );
  });

  it('an ALIGNED / long shot is contained: no guide line, travel ends at the target, layer clipped', () => {
    // same-level long shot from cell 0 to cell 7 (the worst "laser to the edge" case)
    const board = rowBoard(8);
    const { container } = renderFx({ projectiles: [proj({ kind: 'tracer', from: 0, to: 7 })] }, board);
    expect(container.querySelector('.fx-tracer-guide')).toBeNull(); // no board-spanning line
    const a = toScreen(board.cells.get(0)!.center);
    const b = toScreen(board.cells.get(7)!.center);
    // the crawling round travels exactly a→b (reaches cell 7, never past the edge)
    const round = container.querySelector<SVGGElement>('.fx-tracer-round')!;
    expect(round.style.getPropertyValue('--tx')).toBe(`${b[0] - a[0]}px`);
    expect(container.querySelector('.board-replay-fx')!.getAttribute('clip-path')).toBe(
      'url(#board-fx-clip)',
    );
  });
});

// ----------------------------------------------------------------------------
// D/§7. CAPTURE CALLOUT FITS THE FRAME (longest term, edge cell)
// ----------------------------------------------------------------------------
describe('§7 capture callout fits the frame — longest term at an edge', () => {
  const LONG = 'All your Bases Are Belong To Us!';

  function calloutBox(container: HTMLElement) {
    const co = container.querySelector('.fx-callout')!;
    const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(co.getAttribute('transform') ?? '');
    const cx = parseFloat(m![1]!);
    const cy = parseFloat(m![2]!);
    const rect = co.querySelector('.fx-callout-rise rect')!;
    const w = Number(rect.getAttribute('width'));
    const h = Number(rect.getAttribute('height'));
    return { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2, w };
  }

  it('the longest capture term stays inside the frame bounds at an EDGE cell', () => {
    const board = rowBoard(8); // cell 0 sits at the left edge
    const bounds = { x: 0, y: -100, width: 800, height: 100 };
    const { container } = render(
      <svg>
        <ReplayFx
          board={board}
          toScreen={toScreen}
          tokenSize={40}
          fx={{ ...emptyFx(), callouts: [{ cell: 0, text: LONG, kind: 'captured' }] }}
          player={0}
          frameBounds={bounds}
        />
      </svg>,
    );
    const box = calloutBox(container);
    // fully on-screen on every edge
    expect(box.left).toBeGreaterThanOrEqual(bounds.x - 0.5);
    expect(box.right).toBeLessThanOrEqual(bounds.x + bounds.width + 0.5);
    expect(box.top).toBeGreaterThanOrEqual(bounds.y - 0.5);
    expect(box.bottom).toBeLessThanOrEqual(bounds.y + bounds.height + 0.5);
    // and the box itself fits within the frame width (the font was scaled down)
    expect(box.w).toBeLessThanOrEqual(bounds.width);
  });

  it('the long term is shrunk to fit when wider than the frame', () => {
    const board = rowBoard(8);
    const narrow = { x: 0, y: -100, width: 360, height: 100 };
    const { container } = render(
      <svg>
        <ReplayFx
          board={board}
          toScreen={toScreen}
          tokenSize={40}
          fx={{ ...emptyFx(), callouts: [{ cell: 4, text: LONG, kind: 'captured' }] }}
          player={0}
          frameBounds={narrow}
        />
      </svg>,
    );
    const rect = container.querySelector('.fx-callout-rise rect')!;
    expect(Number(rect.getAttribute('width'))).toBeLessThanOrEqual(narrow.width);
  });
});

// ----------------------------------------------------------------------------
// E/§8. ARTILLERY ARC — higher control point + longer flight
// ----------------------------------------------------------------------------
describe('§8 artillery arc — higher lob control point + longer flight than ranged', () => {
  function controlY(d: string): number {
    // "M ax ay Q cx cy bx by" — the control point is the (cx, cy) after Q.
    const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    // M(0,1) Q(2,3) end(4,5) → cy is index 3
    return nums[3]!;
  }

  it('the shell control point is well ABOVE the endpoints (a high parabola)', () => {
    const board = rowBoard(8);
    const { container } = renderFx({ projectiles: [proj({ kind: 'shell', from: 1, to: 5, impact: 0.88 })] }, board);
    const trail = container.querySelector('.fx-shell-trail')!;
    const d = trail.getAttribute('d')!;
    const cy = controlY(d);
    const a = toScreen(board.cells.get(1)!.center);
    const b = toScreen(board.cells.get(5)!.center);
    const apexAboveMid = Math.min(a[1], b[1]) - cy; // screen y-down: smaller y = higher
    // the lob clears the endpoints by more than a full token height (≈40) —
    // a tall, natural parabola, not a flat skim.
    expect(apexAboveMid).toBeGreaterThan(40);
  });

  it('the shell SMIL flight dur is LONGER than a ranged tracer window of the same beat', () => {
    // ranged beat base 900ms vs artillery 1200ms → at the same depth the shell
    // window is longer; the shell rides it via animateMotion (dur === beat.dur).
    const ranged = layoutBeats([{ activeCells: [0, 2], projectiles: [proj({ kind: 'tracer', from: 0, to: 2 })], band: 'ranged' }], 1.6);
    const arty = layoutBeats([{ activeCells: [0, 5], projectiles: [proj({ kind: 'shell', from: 0, to: 5, impact: 0.88 })], band: 'artillery' }], 1.6);
    const { container } = renderFx({ beats: arty.beats });
    const motion = container.querySelector('.fx-shell-round animateMotion')!;
    const shellDurMs = parseFloat(motion.getAttribute('dur') ?? '0');
    expect(shellDurMs).toBeCloseTo(arty.beats[0]!.dur, 3);
    expect(arty.beats[0]!.dur).toBeGreaterThan(ranged.beats[0]!.dur); // longer flight
    // the shell lands LATE within its flight (keyTimes hold→0.88)
    expect(motion.getAttribute('keyTimes')).toContain('0.88');
  });
});
