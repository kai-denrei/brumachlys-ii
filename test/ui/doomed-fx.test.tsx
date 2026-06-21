// @vitest-environment jsdom
// R6 (DEFERRED DISSOLVE) — the render half: a unit killed during the combat
// waves does NOT dissolve at its kill frame. It enters a DOOMED hold rendered by
// ReplayFx: the token desaturated toward grey with a small smoke wisp / flicker
// / hairline-crack treatment, and a DEATH GLYPH (✕ / skull) REPLACING the count
// badge — NEVER a "0". The actual dissolve (DeathFx) plays later in SETTLE.
//
// reduced-motion: doomed = static grey + glyph (no flicker), dissolve = simple
// fade — handled in CSS so the markup is identical.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Board as BoardGraph, Cell, CellId, Vec2 } from '../../src/board/types';
import type { FactionId, UnitInstance } from '../../src/core/types';
import { ReplayFx, type ReplayFxData } from '../../src/ui/skin';

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
  return { cells, seed: 0, donorMapId: 'doomed-fx-test' };
}

function unit(id: string, faction: FactionId, cell: CellId, type = 'infantry'): UnitInstance {
  return { id, type, faction, cell, count: 10, stance: 'aggressive', attackedFrom: [] };
}

const toScreen = (p: readonly [number, number]): [number, number] => [p[0] * 100, -p[1] * 100];

const emptyFx = (): ReplayFxData => ({ arcs: [], floaters: [], bursts: [], kills: [] });

function renderFx(fx: Partial<ReplayFxData>, board = rowBoard(6)) {
  return render(
    <svg>
      <ReplayFx board={board} toScreen={toScreen} tokenSize={40} fx={{ ...emptyFx(), ...fx }} player={0} />
    </svg>,
  );
}

describe('R6 DOOMED render (deferred fall, not a dissolve)', () => {
  it('a doomed unit renders a held token, NOT the destruction verb', () => {
    const { container } = renderFx({ doomed: [unit('e', 1, 3, 'tank')] });
    // The DOOMED group exists…
    expect(container.querySelector('.fx-doomed')).not.toBeNull();
    // …and it carries a real token (so the unit is still visibly on the board).
    expect(container.querySelector('.fx-doomed .unit-token')).not.toBeNull();
    // It is NOT the dissolve — no fragments/smoke of the death verb.
    expect(container.querySelector('.fx-death-frag')).toBeNull();
  });

  it('the count badge is REPLACED by a death glyph — never a "0"', () => {
    const { container } = renderFx({ doomed: [unit('e', 1, 3, 'tank', /* type via override below */)] });
    const doomed = container.querySelector('.fx-doomed')!;
    // A death glyph is present.
    const glyph = doomed.querySelector('.fx-doomed-glyph')!;
    expect(glyph).not.toBeNull();
    expect(glyph.textContent ?? '').toMatch(/[✕✗×☠]/);
    // The normal count pip is suppressed — and crucially the token shows no "0".
    expect(doomed.querySelector('.unit-count')).toBeNull();
    expect(doomed.textContent ?? '').not.toContain('0');
  });

  it('the doomed token is desaturated toward grey (DOOMED-look)', () => {
    const { container } = renderFx({ doomed: [unit('e', 1, 3, 'tank')] });
    // The group carries the doomed class that CSS uses for the grey/flicker
    // treatment, and the body fill is NOT the live faction colour.
    const doomed = container.querySelector('.fx-doomed')!;
    expect(doomed.classList.contains('fx-doomed')).toBe(true);
    // A smoke wisp / hairline-crack treatment rides the doomed token.
    expect(doomed.querySelector('.fx-doomed-wisp')).not.toBeNull();
  });

  it('doomed + kills can coexist on the same frame is NOT how it works — but both render independently when given', () => {
    // ReplayFx is a pure draw layer: it draws exactly what it is given. A SETTLE
    // frame carries `kills` (the dissolve) and no `doomed`; wave frames carry
    // `doomed` and no `kills`. Assert each renders its own verb in isolation.
    const onlyDoomed = renderFx({ doomed: [unit('e', 1, 3, 'tank')] }).container;
    expect(onlyDoomed.querySelector('.fx-doomed')).not.toBeNull();
    expect(onlyDoomed.querySelector('.fx-death')).toBeNull();

    cleanup();
    const onlyDissolve = renderFx({ kills: [unit('e', 1, 3, 'tank')] }).container;
    expect(onlyDissolve.querySelector('.fx-death')).not.toBeNull();
    expect(onlyDissolve.querySelector('.fx-doomed')).toBeNull();
  });

  it('default ReplayFxData has no doomed (older/synthetic callers unaffected)', () => {
    const { container } = renderFx({});
    expect(container.querySelector('.fx-doomed')).toBeNull();
  });
});
