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

function renderFx(fx: Partial<ReplayFxData>, board = rowBoard(6)) {
  return render(
    <svg>
      <ReplayFx
        board={board}
        toScreen={toScreen}
        tokenSize={40}
        fx={{ ...emptyFx(), ...fx }}
        player={0}
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
});
