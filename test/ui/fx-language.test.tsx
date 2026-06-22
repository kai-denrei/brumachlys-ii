// @vitest-environment jsdom
// v0.6 Ask 7 — the animation language (skin/ReplayFx): impact flash + recoil,
// the destruction verb (fragments + smoke; enemy celebration vs own muted
// loss), and the claim verb (pulse → paint-fill sweep → flag, consumed token
// dissolving into it). Markup-level: timing/easing live in CSS, but the
// structure each verb needs must exist and stay fog-honest.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Board as BoardGraph, Cell, CellId, Vec2 } from '../../src/board/types';
import type { FactionId, UnitInstance } from '../../src/core/types';
import { Board } from '../../src/ui/Board';
import { ReplayFx, UnitRenderer, type ReplayFxData } from '../../src/ui/skin';

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
  return { cells, seed: 0, donorMapId: 'fx-lang-test' };
}

function unit(id: string, faction: FactionId, cell: CellId, type = 'infantry'): UnitInstance {
  return { id, type, faction, cell, count: 10, stance: 'aggressive', attackedFrom: [] };
}

const toScreen = (p: readonly [number, number]): [number, number] => [p[0] * 100, -p[1] * 100];

const emptyFx = (): ReplayFxData => ({
  arcs: [],
  floaters: [],
  bursts: [],
  kills: [],
});

function renderFx(
  fx: Partial<ReplayFxData>,
  board = rowBoard(6),
  renderMode: 'icon' | 'anim' | 'watercolor' = 'icon',
) {
  return render(
    <svg>
      <ReplayFx
        board={board}
        toScreen={toScreen}
        tokenSize={40}
        fx={{ ...emptyFx(), ...fx }}
        player={0}
        renderMode={renderMode}
      />
    </svg>,
  );
}

describe('impact verb (flash + recoil)', () => {
  it('a surviving-defender strike renders a hit flash at the defender cell', () => {
    const { container } = renderFx({
      impacts: [{ attackerId: 'a', attackerCell: 0, defenderId: 'e', defenderCell: 2 }],
    });
    const flash = container.querySelector('.fx-hit-flash')!;
    expect(flash).not.toBeNull();
    expect(flash.getAttribute('fill')).toBe('#fff');
    expect(container.querySelector('.fx-hit')!.getAttribute('transform')).toContain('250'); // cell 2 center x
  });

  it('UnitRenderer recoil: inner .fx-recoil group with the lunge vector vars', () => {
    const { container } = render(
      <svg>
        <UnitRenderer
          unit={unit('a', 0, 0)}
          x={50}
          y={50}
          size={40}
          recoil={{ dx: -6, dy: 0 }}
          recoilKey={3}
        />
      </svg>,
    );
    const recoil = container.querySelector<SVGGElement>('.fx-recoil')!;
    expect(recoil).not.toBeNull();
    expect(recoil.style.getPropertyValue('--rdx')).toBe('-6px');
    // the animated group carries NO transform attribute (P9 rule) — the
    // positioning translate stays on the outer token group.
    expect(recoil.getAttribute('transform')).toBeNull();
    expect(recoil.closest('.unit-token')!.getAttribute('transform')).toContain('50');
  });

  it('mist strikes (attacker withheld) flash without any recoil leak — Board side', () => {
    const board = rowBoard(6);
    const { container } = render(
      <Board
        board={board}
        units={[unit('own', 0, 1)]}
        interactive={false}
        replayFx={{
          key: 1,
          fx: {
            ...emptyFx(),
            impacts: [
              { attackerId: null, attackerCell: null, defenderId: 'own', defenderCell: 1 },
            ],
          },
        }}
      />,
    );
    expect(container.querySelector('.fx-hit-flash')).not.toBeNull();
    expect(container.querySelector('.fx-recoil')).toBeNull(); // no source revealed
  });
});

describe('destruction verb (crumble / shrink / smoke-puff)', () => {
  it('enemy death: spark + wobbling token + 4 fragments + smoke + celebration pop', () => {
    const { container } = renderFx({ kills: [unit('e', 1, 3, 'tank')] });
    const death = container.querySelector('.fx-death')!;
    expect(death.classList.contains('fx-death-enemy')).toBe(true);
    expect(death.querySelector('.fx-death-spark')).not.toBeNull();
    expect(death.querySelector('.fx-death-token .unit-token')).not.toBeNull();
    expect(death.querySelectorAll('.fx-death-frag').length).toBe(4); // 3–5 vector fragments
    expect(death.querySelectorAll('.fx-death-smoke').length).toBe(3);
    // the tiny radial celebration burst, in the PLAYER's color
    const cheer = death.querySelector('.fx-death-cheer line')!;
    expect(cheer).not.toBeNull();
    expect(cheer.getAttribute('stroke')).toBe('#E8806B');
    expect(death.querySelector('.fx-death-outline')).toBeNull();
  });

  it('own death: same skeleton, dimming outline, NO celebration', () => {
    const { container } = renderFx({ kills: [unit('mine', 0, 2)] });
    const death = container.querySelector('.fx-death')!;
    expect(death.classList.contains('fx-death-own')).toBe(true);
    expect(death.querySelectorAll('.fx-death-frag').length).toBe(4);
    expect(death.querySelector('.fx-death-outline')).not.toBeNull();
    expect(death.querySelector('.fx-death-cheer')).toBeNull();
  });

  it('fragments carry deterministic CSS-var trajectories (no randomness in render)', () => {
    const a = renderFx({ kills: [unit('e', 1, 3)] });
    const varsOf = (c: HTMLElement | Element) =>
      [...c.querySelectorAll<SVGGElement>('.fx-death-frag')].map(
        (g) => g.style.getPropertyValue('--fdx') + g.style.getPropertyValue('--fdy'),
      );
    const first = varsOf(a.container);
    a.unmount();
    const b = renderFx({ kills: [unit('e', 1, 3)] });
    expect(varsOf(b.container)).toEqual(first);
    expect(new Set(first).size).toBe(4); // four distinct directions
  });
});

describe('damage-number categories (R5: colour by category, size ∝ magnitude)', () => {
  // R5: a damage floater is coloured by its category — taken = INK, counter =
  // GREY, kill = GOLD (var(--gold)) — and its number scales with the hit
  // magnitude (bounded). A mist (fire-from-the-mist) floater keeps its fog-grey
  // treatment regardless of category (fog honesty: the attacker never leaks).
  const INK = '#4a443a';
  const GREY = '#8d8675';
  const GOLD = 'var(--gold)';
  const MIST_FILL = '#5d5648';

  const fl = (over: Partial<ReplayFxData['floaters'][number]> = {}) => ({
    id: 'f0',
    cell: 2,
    text: '−5',
    mist: false,
    slot: 0,
    category: 'taken' as const,
    ...over,
  });
  const pillFill = (c: HTMLElement) =>
    c.querySelector('.fx-floater-pill rect[rx]')!.getAttribute('fill');
  const fontSize = (c: HTMLElement) =>
    Number(c.querySelector('.fx-floater-pill text')!.getAttribute('font-size'));

  it('a damage-taken floater is INK', () => {
    const { container } = renderFx({ floaters: [fl({ category: 'taken' })] });
    expect(pillFill(container)).toBe(INK);
  });

  it('a counter floater is GREY', () => {
    const { container } = renderFx({ floaters: [fl({ category: 'counter' })] });
    expect(pillFill(container)).toBe(GREY);
  });

  it('a kill floater is GOLD (var(--gold))', () => {
    const { container } = renderFx({ floaters: [fl({ category: 'kill' })] });
    expect(pillFill(container)).toBe(GOLD);
  });

  it('size scales with magnitude — a bigger hit gets a bigger number, bounded', () => {
    const small = renderFx({ floaters: [fl({ text: '−1' })] });
    const big = renderFx({ floaters: [fl({ text: '−12' })] });
    const huge = renderFx({ floaters: [fl({ text: '−99' })] });
    const sSmall = fontSize(small.container);
    const sBig = fontSize(big.container);
    const sHuge = fontSize(huge.container);
    expect(sBig).toBeGreaterThan(sSmall); // magnitude drives size
    // bounded: a huge hit never blows past a sane ceiling (≤ ~1.4× the base)
    expect(sHuge).toBeLessThanOrEqual(sSmall * 1.6);
    expect(sHuge).toBeGreaterThanOrEqual(sBig); // monotonic, then clamps
  });

  it('a category floater still rides the arc-rise + fade motion', () => {
    const { container } = renderFx({ floaters: [fl({ category: 'kill' })] });
    expect(container.querySelector('.fx-floater-rise')).not.toBeNull();
  });

  it('a MIST kill floater keeps fog-grey (fog honesty wins over kill-gold)', () => {
    const { container } = renderFx({
      floaters: [fl({ mist: true, category: 'kill' })],
    });
    // fog secrecy: the mist treatment is preserved — NOT gold.
    expect(pillFill(container)).toBe(MIST_FILL);
    expect(pillFill(container)).not.toBe(GOLD);
    // and the impact ring (mist marker) is present, no source arc
    expect(container.querySelector('.fx-impact')).not.toBeNull();
  });
});

describe('forced-crossing sign ("path interrupted!", addendum §5)', () => {
  it('renders a transient sign label at the crossing cell', () => {
    const { container } = renderFx({ signs: [{ cell: 2, text: 'path interrupted!' }] });
    const sign = container.querySelector('.fx-cross-sign')!;
    expect(sign).not.toBeNull();
    // The cell-2 center on this board projects to x=250 (toScreen scales ×100).
    expect(sign.getAttribute('transform')).toContain('250');
    // The hyphen-free announcement copy is present.
    const text = [...sign.querySelectorAll('text')].map((t) => t.textContent).join(' ');
    expect(text).toContain('path interrupted!');
  });

  it('renders one sign per crossing cell', () => {
    const { container } = renderFx({
      signs: [
        { cell: 1, text: 'path interrupted!' },
        { cell: 3, text: 'path interrupted!' },
      ],
    });
    expect(container.querySelectorAll('.fx-cross-sign').length).toBe(2);
  });

  it('no signs → nothing rendered (fog secrecy passes through)', () => {
    const { container } = renderFx({});
    expect(container.querySelector('.fx-cross-sign')).toBeNull();
  });
});

describe('claim verb (capture: pulse → paint-fill → flag; consumed dissolve)', () => {
  it('capture renders the tile pulse, the clipped fill sweep, flag + shimmer', () => {
    const { container } = renderFx({ captures: [{ cell: 2, to: 0 }] });
    const cap = container.querySelector('.fx-capture')!;
    expect(cap.querySelector('.fx-capture-pulse')).not.toBeNull();
    const sweep = cap.querySelector('.fx-capture-sweep')!;
    expect(sweep).not.toBeNull();
    expect(sweep.getAttribute('fill')).toBe('#E8806B'); // claimant color
    expect(sweep.closest('[clip-path]')).not.toBeNull(); // paint stays in the polygon
    expect(cap.querySelector('clipPath path')).not.toBeNull();
    expect(cap.querySelector('.fx-capture-flag')).not.toBeNull();
    expect(cap.querySelector('.fx-capture-shimmer')).not.toBeNull();
    expect(cap.querySelector('.fx-capture-consume')).toBeNull(); // nothing consumed
  });

  it('a CONSUMED capturing unit dissolves into the flag (its token in the consume group)', () => {
    const ranger = unit('pr', 0, 2, 'ranger');
    const { container } = renderFx({ captures: [{ cell: 2, to: 0, consumed: ranger }] });
    const consume = container.querySelector('.fx-capture-consume')!;
    expect(consume).not.toBeNull();
    expect(consume.querySelector('[data-unit-id="pr"]')).not.toBeNull();
  });

  // FLICKER FIX: the consumed token must dissolve IN THE ACTIVE SKIN. Before the
  // fix, CaptureFx rendered <UnitRenderer> with no renderMode, so a watercolor
  // unit became the flat ICON glyph for the capture frame — a "wrong image"
  // flashing over the watercolor capture. With renderMode threaded through, the
  // consumed token is the SAME watercolor <image> it was on the board.
  it('consumed token dissolves in the WATERCOLOR skin (no icon-glyph flash)', () => {
    const inf = unit('pr', 0, 2, 'infantry'); // f0 → coral painting
    const { container } = renderFx(
      { captures: [{ cell: 2, to: 0, consumed: inf }] },
      rowBoard(6),
      'watercolor',
    );
    const consume = container.querySelector('.fx-capture-consume')!;
    const img = consume.querySelector('.unit-watercolor image');
    expect(img).not.toBeNull(); // a watercolor painting, not the flat icon
    expect(img!.getAttribute('href') ?? '').toMatch(/f0-infantry/);
    // the flat squircle body must NOT appear in the consume group
    expect(consume.querySelector('.unit-body')).toBeNull();
  });

  it('a death token dissolves in the WATERCOLOR skin too (kills carry the skin)', () => {
    const inf = unit('e1', 1, 2, 'tank'); // f1 → blue painting
    const { container } = renderFx({ kills: [inf] }, rowBoard(6), 'watercolor');
    const death = container.querySelector('.fx-death-token')!;
    const img = death.querySelector('.unit-watercolor image');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('href') ?? '').toMatch(/f1-tank/);
  });
});
