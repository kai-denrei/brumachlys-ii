// @vitest-environment jsdom
// v0.6 Ask 1/5 — the top-center primary CTA: COMMIT pill during planning
// (always enabled; a "Commit 0 moves?" confirm only at literally zero
// orders), CONTINUE during the round summary, the directive control beside
// it, and the dock reduced to chips only.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { Board, Cell, CellId, TerrainKey, Vec2 } from '../../src/board/types';
import type { FactionId, GameState, UnitInstance } from '../../src/core/types';
import { useAppStore } from '../../src/state/store';
import { App } from '../../src/App';
import { TopCta } from '../../src/ui/TopCta';

afterEach(cleanup);

function lineBoard(n: number, terrains: Partial<Record<number, TerrainKey>> = {}): Board {
  const cells = new Map<CellId, Cell>();
  for (let i = 0; i < n; i++) {
    cells.set(i, {
      id: i,
      center: [i, 0] as Vec2,
      polygon: [
        [i - 0.4, -0.4] as Vec2,
        [i + 0.4, -0.4] as Vec2,
        [i + 0.4, 0.4] as Vec2,
        [i - 0.4, 0.4] as Vec2,
      ],
      neighbors: [i - 1, i + 1].filter((j) => j >= 0 && j < n),
      terrain: terrains[i] ?? 'plains',
    });
  }
  return { cells, seed: 0, donorMapId: 'cta-test', placementAnchors: [0, n - 1] };
}

function unit(id: string, faction: FactionId, cell: CellId, type = 'infantry'): UnitInstance {
  return { id, type, faction, cell, count: 10, stance: 'aggressive', attackedFrom: [] };
}

function seedBattle(units: UnitInstance[]) {
  const board = lineBoard(12);
  const game: GameState = {
    round: 1,
    phase: 'planning',
    board,
    units: Object.fromEntries(units.map((u) => [u.id, u])),
    pendingOrders: { 0: [], 1: [] },
    rngSeed: 7,
    log: [],
  };
  useAppStore.setState({
    screen: 'battle',
    board,
    game,
    uiPhase: 'planning',
    replay: null,
    selectedUnitId: null,
    orders: {},
    buys: {},
    directive: null,
    focus: null,
    notice: null,
    battleLog: [],
  });
}

describe('TopCta in the battle screen (App integration)', () => {
  beforeEach(() => seedBattle([unit('a', 0, 0), unit('b', 0, 4), unit('e', 1, 10)]));

  it('planning shows the top-center COMMIT pill (enabled at 0 orders) and a chips-only dock', () => {
    const { container } = render(<App />);
    const pill = container.querySelector<HTMLButtonElement>('[data-testid="commit-button"]')!;
    expect(pill).not.toBeNull();
    expect(pill.disabled).toBe(false); // Ask 5: always enabled
    expect(pill.textContent).toContain('COMMIT 0/2');
    // the dock lost its commit button — chips only
    expect(container.querySelector('.bottom-dock .commit-button')).toBeNull();
    expect(container.querySelectorAll('.bottom-dock .dock-chip').length).toBe(2);
  });

  it('commit with ZERO orders asks "Commit 0 moves?" — Back keeps planning, Commit resolves', () => {
    const { container } = render(<App />);
    const pill = () => container.querySelector('[data-testid="commit-button"]')!;
    fireEvent.click(pill());
    expect(container.querySelector('[data-testid="commit-confirm"]')!.textContent).toContain(
      'Commit 0 moves?',
    );
    expect(useAppStore.getState().uiPhase).toBe('planning'); // not committed yet

    fireEvent.click(container.querySelector('[data-testid="confirm-back"]')!);
    expect(container.querySelector('[data-testid="commit-confirm"]')).toBeNull();
    expect(useAppStore.getState().uiPhase).toBe('planning');

    fireEvent.click(pill());
    fireEvent.click(container.querySelector('[data-testid="confirm-commit"]')!);
    expect(useAppStore.getState().uiPhase).toBe('replay'); // round resolved
  });

  it('commit with ≥1 order skips the confirm entirely', () => {
    useAppStore.getState().tryQueueOrder({ kind: 'move', unitId: 'a', path: [1] });
    const { container } = render(<App />);
    expect(container.querySelector('[data-testid="commit-button"]')!.textContent).toContain(
      'COMMIT 1/2',
    );
    fireEvent.click(container.querySelector('[data-testid="commit-button"]')!);
    expect(container.querySelector('[data-testid="commit-confirm"]')).toBeNull();
    expect(useAppStore.getState().uiPhase).toBe('replay');
  });

  it('the directive control opens its popover with the three directives + clear-all', () => {
    const { container } = render(<App />);
    fireEvent.click(container.querySelector('[data-testid="directive-toggle"]')!);
    const menu = container.querySelector('[data-testid="directive-menu"]')!;
    expect(menu).not.toBeNull();
    expect(menu.textContent).toContain('Forward Deploy');
    expect(menu.textContent).toContain('Tactical Retreat');
    expect(menu.textContent).toContain('Fortify');
    expect(menu.querySelector('[data-testid="clear-all-orders"]')).not.toBeNull();
  });

  it('clear-all-orders empties the queues from the popover', () => {
    useAppStore.getState().tryQueueOrder({ kind: 'move', unitId: 'a', path: [1] });
    const { container } = render(<App />);
    fireEvent.click(container.querySelector('[data-testid="directive-toggle"]')!);
    fireEvent.click(container.querySelector('[data-testid="clear-all-orders"]')!);
    expect(useAppStore.getState().orders).toEqual({});
  });
});

describe('TopCta (component)', () => {
  it('summary phase renders the CONTINUE pill wired to onContinue', () => {
    const onContinue = vi.fn();
    const { container } = render(<TopCta phase="summary" onContinue={onContinue} />);
    const btn = container.querySelector('[data-testid="cta-continue"]')!;
    expect(btn.textContent).toBe('CONTINUE');
    fireEvent.click(btn);
    expect(onContinue).toHaveBeenCalled();
  });

  it('a buys-only round (0 unit orders, ≥1 buy) commits without the confirm', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <TopCta phase="planning" done={0} total={2} buys={1} onCommit={onCommit} />,
    );
    fireEvent.click(container.querySelector('[data-testid="commit-button"]')!);
    expect(container.querySelector('[data-testid="commit-confirm"]')).toBeNull();
    expect(onCommit).toHaveBeenCalled();
  });

  it('directive chip: names the directive, flips to "modified", hides when none', () => {
    const a = render(
      <TopCta
        phase="planning"
        directive={{ kind: 'forward-deploy', modified: false }}
        directivesEnabled
      />,
    );
    expect(a.container.querySelector('[data-testid="directive-chip"]')!.textContent).toBe(
      'directive: Forward Deploy',
    );
    a.unmount();
    const b = render(
      <TopCta
        phase="planning"
        directive={{ kind: 'forward-deploy', modified: true }}
        directivesEnabled
      />,
    );
    expect(b.container.querySelector('[data-testid="directive-chip"]')!.textContent).toBe(
      'modified',
    );
    b.unmount();
    const c = render(<TopCta phase="planning" />);
    expect(c.container.querySelector('[data-testid="directive-chip"]')).toBeNull();
  });

  it('directive items are disabled while the planner export is missing', () => {
    const { container } = render(<TopCta phase="planning" directivesEnabled={false} />);
    fireEvent.click(container.querySelector('[data-testid="directive-toggle"]')!);
    const items = container.querySelectorAll<HTMLButtonElement>('[data-directive]');
    expect(items.length).toBe(3);
    for (const item of items) expect(item.disabled).toBe(true);
    // clear-all stays available regardless
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="clear-all-orders"]')!.disabled,
    ).toBe(false);
  });
});
