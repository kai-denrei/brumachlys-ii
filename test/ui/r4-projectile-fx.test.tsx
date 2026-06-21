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
  it('renders the crawling tracer primitive (guide + crawling round + spark)', () => {
    const { container } = renderFx({ projectiles: [proj({ kind: 'tracer' })] });
    const tracer = container.querySelector('.fx-tracer')!;
    expect(tracer).not.toBeNull();
    // a faint full-line guide
    expect(tracer.querySelector('.fx-tracer-guide')).not.toBeNull();
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
    // the shell rides the same parabola via an offset-path CSS var
    const round = shell.querySelector<SVGGElement>('.fx-shell-round')!;
    expect(round.style.getPropertyValue('--shell-path')).toMatch(/path\(/);
    // dust + expanding ring burst on impact
    expect(shell.querySelector('.fx-shell-ring')).not.toBeNull();
    expect(shell.querySelectorAll('.fx-shell-dust').length).toBeGreaterThan(0);
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
