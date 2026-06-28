// @vitest-environment jsdom
// R4 (PROJECTILE + ATTACK MOTION primitives) — the renderer half. ReplayFx now
// draws crawling TRACERS, arcing SHELLS, and melee STABS from frame.projectiles,
// REPLACING the instant FlashArc. Asserts the markup each primitive needs (the
// CSS animation timing/easing lives in styles.css). Reduced-motion degradation
// is enforced in CSS (animation:none on the moving parts), so the markup is the
// same — these tests cover structure + the crossfire delay var.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Board as BoardGraph, Cell, CellId, Vec2 } from '../../src/board/types';
import { ReplayFx, type ReplayFxData } from '../../src/ui/skin';
import type { Projectile } from '../../src/state/replay-timing';
import { WAVE_B_COUNTER_OFFSET } from '../../src/state/replay-timing';

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
  return { cells, seed: 0, donorMapId: 'r4-fx-test' };
}

const toScreen = (p: readonly [number, number]): [number, number] => [p[0] * 100, -p[1] * 100];

const emptyFx = (): ReplayFxData => ({ arcs: [], floaters: [], bursts: [], kills: [] });

function renderFx(fx: Partial<ReplayFxData>, board = rowBoard(8)) {
  return render(
    <svg>
      <ReplayFx board={board} toScreen={toScreen} tokenSize={40} fx={{ ...emptyFx(), ...fx }} player={0} />
    </svg>,
  );
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

describe('R4 ReplayFx — ranged tracer (crawling, not an instant line)', () => {
  it('renders the crawling tracer primitive (crawling round + streak + spark, NO full-line guide)', () => {
    const { container } = renderFx({ projectiles: [proj({ kind: 'tracer' })] });
    const tracer = container.querySelector('.fx-tracer')!;
    expect(tracer).not.toBeNull();
    // the full-length dotted guide was REMOVED — for a long same-row shot it read
    // as a board-spanning "laser"; the crawl + spark convey the shot instead.
    expect(tracer.querySelector('.fx-tracer-guide')).toBeNull();
    // the crawling round (the animated element carries the travel vector vars)
    const round = tracer.querySelector<SVGGElement>('.fx-tracer-round')!;
    expect(round).not.toBeNull();
    expect(round.style.getPropertyValue('--tx')).not.toBe('');
    // a speed-streak tail + a sharp impact spark
    expect(tracer.querySelector('.fx-tracer-streak')).not.toBeNull();
    expect(tracer.querySelector('.fx-tracer-spark')).not.toBeNull();
    // the charge glint near the start
    expect(tracer.querySelector('.fx-tracer-charge')).not.toBeNull();
  });

  it('a frame with projectiles does NOT also draw the instant FlashArc', () => {
    const { container } = renderFx({
      arcs: [{ from: 0, to: 2, faction: 0 }],
      projectiles: [proj({ kind: 'tracer' })],
    });
    expect(container.querySelector('.fx-arc')).toBeNull(); // replaced by the tracer
    expect(container.querySelector('.fx-tracer')).not.toBeNull();
  });

  it('with NO projectiles, the legacy instant FlashArc still renders', () => {
    const { container } = renderFx({ arcs: [{ from: 0, to: 2, faction: 0 }] });
    expect(container.querySelector('.fx-arc')).not.toBeNull();
    expect(container.querySelector('.fx-tracer')).toBeNull();
  });
});

describe('R4 ReplayFx — tracer GEOMETRY (attacker → defender, right length)', () => {
  // The shot geometry MUST run attacker→defender: the streak originates at the
  // shooter and the round travels exactly center(to) − center(from) — bounded,
  // never a runaway off-board line. (The old full-line guide that asserted this
  // was removed; the crawl carries the same vector.)
  it('the tracer travel vector equals center(to) − center(from) (bounded a→b)', () => {
    const board = rowBoard(8);
    const { container } = renderFx({ projectiles: [proj({ kind: 'tracer', from: 0, to: 2 })] }, board);
    const aExp = toScreen(board.cells.get(0)!.center);
    const bExp = toScreen(board.cells.get(2)!.center);
    // the crawling round carries the travel vector as CSS vars --tx / --ty
    const round = container.querySelector<SVGGElement>('.fx-tracer-round')!;
    expect(round).not.toBeNull();
    expect(round.style.getPropertyValue('--tx')).toBe(`${bExp[0] - aExp[0]}px`);
    expect(round.style.getPropertyValue('--ty')).toBe(`${bExp[1] - aExp[1]}px`);
    // the speed-streak's leading end is AT the shooter (center(from))
    const streak = container.querySelector<SVGLineElement>('.fx-tracer-streak')!;
    expect(Number(streak.getAttribute('x2'))).toBeCloseTo(aExp[0], 6);
    expect(Number(streak.getAttribute('y2'))).toBeCloseTo(aExp[1], 6);
    // travel distance ≈ the attacker→defender distance (two cells = 200), bounded
    const len = Math.hypot(bExp[0] - aExp[0], bExp[1] - aExp[1]);
    expect(len).toBeCloseTo(200, 6);
  });

  // REGRESSION (this bug): the impact spark animates `transform: scale(...)` in
  // CSS, and a CSS transform animation REPLACES an SVG `transform` presentation
  // attribute. So the positioning translate to the IMPACT point (b) MUST live on
  // an OUTER group, separate from the element carrying the animated class — else
  // the scale clobbers the translate and the spark snaps to the layer origin,
  // drawing a stray mark far from the defender (the reported off-board artifact).
  it('the impact spark translate is on an OUTER group, not on the animated element', () => {
    const board = rowBoard(8);
    const { container } = renderFx({ projectiles: [proj({ kind: 'tracer', from: 0, to: 2 })] }, board);
    const spark = container.querySelector<SVGGElement>('.fx-tracer-spark')!;
    expect(spark).not.toBeNull();
    // The animated element itself must NOT carry the positioning translate
    // (a CSS scale animation would override it).
    expect(spark.getAttribute('transform')).toBeNull();
    // Its parent (or an ancestor up to the tracer root) carries the translate to b.
    const bExp = toScreen(board.cells.get(2)!.center);
    let node: Element | null = spark.parentElement;
    let found: { x: number; y: number } | null = null;
    while (node && !node.classList.contains('fx-tracer')) {
      const t = node.getAttribute('transform');
      const m = t && /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(t);
      if (m) { found = { x: Number(m[1]), y: Number(m[2]) }; break; }
      node = node.parentElement;
    }
    expect(found).not.toBeNull();
    expect(found!.x).toBeCloseTo(bExp[0], 6);
    expect(found!.y).toBeCloseTo(bExp[1], 6);
  });

  it('the stab flash translate is likewise on an OUTER group (same clobber guard)', () => {
    const board = rowBoard(8);
    const { container } = renderFx({ projectiles: [proj({ kind: 'stab', from: 5, to: 6 })] }, board);
    const flash = container.querySelector<SVGGElement>('.fx-stab-flash')!;
    expect(flash).not.toBeNull();
    expect(flash.getAttribute('transform')).toBeNull(); // animated element: no translate
    const bExp = toScreen(board.cells.get(6)!.center);
    const parent = flash.parentElement!;
    const t = parent.getAttribute('transform');
    const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(t ?? '')!;
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeCloseTo(bExp[0], 6);
    expect(Number(m[2])).toBeCloseTo(bExp[1], 6);
  });
});

describe('R4 ReplayFx — artillery shell (arc + dashed trail + dust/ring)', () => {
  it('renders the arcing shell with a dashed trail and an impact ring + dust', () => {
    const { container } = renderFx({ projectiles: [proj({ kind: 'shell', impact: 0.88 })] });
    const shell = container.querySelector('.fx-shell')!;
    expect(shell).not.toBeNull();
    // the parabola trail is DASHED (a quadratic Q path)
    const trail = shell.querySelector('.fx-shell-trail')!;
    expect(trail).not.toBeNull();
    expect(trail.getAttribute('stroke-dasharray')).not.toBeNull();
    expect(trail.getAttribute('d')).toMatch(/Q/); // quadratic bézier (lobbed arc)
    // the shell rides the SAME parabola — via SVG SMIL <animateMotion>, NOT a CSS
    // offset-path. (offset-path on an SVG <g> in a transformed board group does
    // NOT translate the element along absolute path coords — the round stayed
    // pinned at the layer origin and rendered as a stray colored dot off toward
    // the board edge; live-confirmed. animateMotion is SVG-native and composes
    // with the parent view transform.) The motion path MUST equal the trail's d
    // so the shell follows the real attacker→target arc and lands ON the target.
    const round = shell.querySelector<SVGGElement>('.fx-shell-round')!;
    const motion = round.querySelector('animateMotion')!;
    expect(motion).not.toBeNull();
    expect(motion.getAttribute('path')).toBe(trail.getAttribute('d'));
    // and it must NOT fall back to the broken offset-path mechanism
    expect(round.style.getPropertyValue('--shell-path')).toBe('');
    expect(round.style.offsetPath ?? '').toBe('');
    // dust + expanding ring burst on impact
    expect(shell.querySelector('.fx-shell-ring')).not.toBeNull();
    expect(shell.querySelectorAll('.fx-shell-dust').length).toBeGreaterThan(0);
  });

  it('starts the shell motion mount-relative (begin="indefinite"), not document-time', () => {
    // Regression: SMIL begin="<delay>ms" is DOCUMENT-time relative. Because Board
    // remounts this FX group every frame, on a 2nd+ combat frame the begin time is
    // already past and fill="freeze" snapped the round to the landing point — the
    // shell never flew (only the mount-relative CSS dashed trail animated, so it
    // read as "arc shown, no shell"). The fix arms the motion via beginElement()
    // on mount, so begin MUST be "indefinite" (a literal ms value would regress).
    const { container } = renderFx({ projectiles: [proj({ kind: 'shell', impact: 0.88, delay: 120 })] });
    const motion = container.querySelector('.fx-shell-round animateMotion')!;
    expect(motion.getAttribute('begin')).toBe('indefinite');
    expect(motion.getAttribute('begin')).not.toMatch(/ms/);
  });

  it('the shell motion lands exactly on the defender cell (endpoint = center(to)), not a stray far point', () => {
    // Regression for the live-captured artifact: trail a→b length ~178px but the
    // moving shell-round rendered ~470px away near the board edge (offset-path
    // failed in the SVG board group). The motion path must START at center(from)
    // and END at center(to) so the round flies the real vector and lands on the
    // target, never off toward the edge.
    const board = rowBoard(8);
    const { container } = renderFx({ projectiles: [proj({ kind: 'shell', from: 1, to: 5, impact: 0.88 })] }, board);
    const trail = container.querySelector('.fx-shell-trail')!;
    const d = trail.getAttribute('d')!;
    // path is "M ax ay Q cx cy bx by" in screen coords (toScreen).
    const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const [ax, ay] = [nums[0], nums[1]];
    const [bx, by] = [nums[nums.length - 2], nums[nums.length - 1]];
    const aWant = toScreen(board.cells.get(1)!.center);
    const bWant = toScreen(board.cells.get(5)!.center);
    expect([ax, ay]).toEqual([aWant[0], aWant[1]]);
    expect([bx, by]).toEqual([bWant[0], bWant[1]]);
    // the SMIL motion rides this exact path → its endpoint is the target cell.
    const motion = container.querySelector('.fx-shell-round animateMotion')!;
    expect(motion.getAttribute('path')).toBe(d);
  });
});

describe('R4 ReplayFx — melee stab (short dash + flash)', () => {
  it('renders the stab dash toward the target + a flash', () => {
    const { container } = renderFx({ projectiles: [proj({ kind: 'stab', from: 5, to: 6, impact: 0.5 })] });
    const stab = container.querySelector<SVGGElement>('.fx-stab')!;
    expect(stab).not.toBeNull();
    const dash = stab.querySelector<SVGGElement>('.fx-stab-dash')!;
    expect(dash).not.toBeNull();
    expect(stab.querySelector('.fx-stab-flash')).not.toBeNull();
    // the dash carries the ~0.5-reach travel vector
    expect(stab.style.getPropertyValue('--tx')).not.toBe('');
  });

  // REGRESSION (2026-06-28 operator bug A): a forced-crossing BRAWL puts both
  // units on ONE tile, so the stab is same-cell (from === to → a === b, len 0).
  // The dash normalized its direction by `len || 1` = 1 instead of the nudge
  // length, drawing a line of ~tokenSize²·0.42 (~600 px) — a horizontal "laser"
  // to the board edge. A same-cell clash has no dash direction: render only the
  // impact cross (operator call), never a runaway dash.
  it('a SAME-CELL stab (brawl) draws the impact cross, never a board-spanning dash', () => {
    const board = rowBoard(8);
    const { container } = renderFx({ projectiles: [proj({ kind: 'stab', from: 5, to: 5 })] }, board);
    // the white x/X impact cross still reads the clash
    expect(container.querySelector('.fx-stab-flash')).not.toBeNull();
    // the dash, if present at all, must be a SHORT stab — never the runaway line.
    const dash = container.querySelector<SVGLineElement>('.fx-stab-dash line');
    if (dash) {
      const dxLine = Math.abs(Number(dash.getAttribute('x2')) - Number(dash.getAttribute('x1')));
      const dyLine = Math.abs(Number(dash.getAttribute('y2')) - Number(dash.getAttribute('y1')));
      expect(dxLine).toBeLessThanOrEqual(40); // ≤ tokenSize; the bug drew ~672
      expect(dyLine).toBeLessThanOrEqual(40);
    }
  });

  it('a counter stab carries the ~75 ms crossfire delay var', () => {
    const { container } = renderFx({
      projectiles: [
        proj({ kind: 'stab', from: 5, to: 6, delay: 0 }),
        proj({ kind: 'stab', from: 6, to: 5, delay: WAVE_B_COUNTER_OFFSET }),
      ],
    });
    const stabs = [...container.querySelectorAll<SVGGElement>('.fx-stab')];
    expect(stabs.length).toBe(2);
    const delays = stabs.map((s) => s.style.getPropertyValue('--proj-delay')).sort();
    expect(delays).toEqual(['0ms', '75ms']);
  });
});

describe('R4 ReplayFx — multiple WAVE_A projectiles co-animate (shared envelope)', () => {
  it('five tracers all render with delay 0 (no per-unit sequencing)', () => {
    const projectiles: Projectile[] = [0, 2, 4, 6, 8].map((from) =>
      proj({ kind: 'tracer', from, to: from + 1, faction: 0, delay: 0, impact: 0.8 }),
    );
    const { container } = renderFx({ projectiles }, rowBoard(12));
    const tracers = [...container.querySelectorAll<SVGGElement>('.fx-tracer')];
    expect(tracers.length).toBe(5);
    // shared envelope: every tracer carries delay 0 (they fly together)
    for (const t of tracers) {
      const d = t.style.getPropertyValue('--proj-delay');
      expect(d === '' || d === '0ms').toBe(true);
    }
  });
});
