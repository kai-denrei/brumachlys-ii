// @vitest-environment jsdom
// v0.8 round-tempo / UX — auto-advance, "Your turn" announcement, [Enter] key.
// Covers the behaviors introduced in commit 41defef and the fixes in the follow-up:
//   1. Auto-advance: summary → planning transition fires without user interaction.
//   2. Announcement gating: shown after auto-advance, NOT on the game-over path.
//   3. [Enter] commits during planning (with ≥1 order) and dismisses the announcement.
//   4. [Enter] is ignored when a text INPUT is focused.
//   5. Backstop timer clears the announcement at 2200 ms (reduced-motion path).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { Board, Cell, CellId, TerrainKey, Vec2 } from '../../src/board/types';
import type { FactionId, GameState, UnitInstance } from '../../src/core/types';
import type { ReplayFrame, ReplayScript } from '../../src/state/replay';
import { useAppStore } from '../../src/state/store';
import { App } from '../../src/App';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ── helpers ────────────────────────────────────────────────────────────────────

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
  return { cells, seed: 0, donorMapId: 'round-tempo-test', placementAnchors: [0, n - 1] };
}

function unit(id: string, faction: FactionId, cell: CellId, type = 'infantry'): UnitInstance {
  return { id, type, faction, cell, count: 10, stance: 'aggressive', attackedFrom: [] };
}

/** A minimal valid ReplayFrame with all required fields empty/zero. */
function minFrame(units: UnitInstance[] = []): ReplayFrame {
  return {
    duration: 500,
    slot: -1,
    units,
    fog: new Set<CellId>(),
    discovered: new Set<CellId>(),
    ignite: [],
    arcs: [],
    floaters: [],
    bursts: [],
    kills: [],
    spawns: [],
    captures: [],
    promotions: [],
    trails: [],
    focus: [],
  };
}

/** A minimal valid ReplayScript with the given summary values and one frame
 *  so BattleScreen can index into frames[] without crashing. */
function minScript(
  units: UnitInstance[],
  summary: Partial<ReplayScript['summary']> = {},
): ReplayScript {
  return {
    slots: [],
    frames: [minFrame(units)],
    log: [],
    discovered: new Set<CellId>(),
    summary: {
      kills: [],
      damageDealt: [0, 0],
      fizzles: 0,
      ...summary,
    },
  };
}

/** Seed the store with a running battle in the given uiPhase. */
function seedBattle(
  units: UnitInstance[],
  opts: {
    uiPhase?: 'planning' | 'summary' | 'replay' | 'over';
    outcome?: GameState['outcome'];
    round?: number;
    replaySummary?: Partial<ReplayScript['summary']>;
  } = {},
) {
  const board = lineBoard(12);
  const {
    uiPhase = 'planning',
    outcome,
    round = 2,
    replaySummary = {},
  } = opts;

  const game: GameState = {
    round,
    phase: uiPhase === 'planning' ? 'planning' : 'over',
    board,
    units: Object.fromEntries(units.map((u) => [u.id, u])),
    pendingOrders: { 0: [], 1: [] },
    rngSeed: 7,
    log: [],
    ...(outcome ? { outcome } : {}),
  };

  const replay =
    uiPhase === 'summary' || uiPhase === 'replay'
      ? { round: round - 1, script: minScript(units, replaySummary) }
      : null;

  useAppStore.setState({
    screen: 'battle',
    board,
    game,
    uiPhase,
    replay,
    selectedUnitId: null,
    orders: {},
    buys: {},
    directive: null,
    focus: null,
    notice: null,
    battleLog: [],
    casualties: [],
  });
}

// ── 1. Auto-advance ────────────────────────────────────────────────────────────

describe('auto-advance: summary → planning', () => {
  const players = [unit('a', 0, 0), unit('e', 1, 10)];
  beforeEach(() => seedBattle(players, { uiPhase: 'summary' }));

  it('transitions to planning without any user interaction', () => {
    render(<App />);
    // The auto-advance effect fires on first render; React's act() wrapping in
    // render() flushes it. No click or key needed.
    expect(useAppStore.getState().uiPhase).toBe('planning');
  });

  it('shows the "Your turn" announcement pill after auto-advance', () => {
    const { container } = render(<App />);
    expect(useAppStore.getState().uiPhase).toBe('planning');
    expect(container.querySelector('.your-turn-announcement')).not.toBeNull();
    expect(container.querySelector('.your-turn-label')!.textContent).toContain('Your turn');
  });

  it('the replay state is cleared (replay=null) after closeSummary fires', () => {
    render(<App />);
    expect(useAppStore.getState().replay).toBeNull();
  });
});

// ── 2. Announcement gating ─────────────────────────────────────────────────────

describe('announcement gating', () => {
  it('announcement does NOT appear on the game-over path', () => {
    // outcome present → auto-advance effect returns early (the summary stays up
    // for the user to dismiss; closeSummary then transitions to 'over', not
    // 'planning'). No announcement pill should appear.
    seedBattle([unit('a', 0, 0), unit('e', 1, 10)], {
      uiPhase: 'summary',
      outcome: { winner: 1, reason: 'annihilation' },
    });
    const { container } = render(<App />);
    // The auto-advance effect is guarded by game.outcome — it does NOT fire.
    expect(useAppStore.getState().uiPhase).toBe('summary');
    expect(container.querySelector('.your-turn-announcement')).toBeNull();
  });

  it('recap snapshot in the announcement includes fizzles', () => {
    seedBattle([unit('a', 0, 0), unit('e', 1, 10)], {
      uiPhase: 'summary',
      replaySummary: { damageDealt: [5, 3], kills: [], fizzles: 2 },
    });
    const { container } = render(<App />);
    const recap = container.querySelector('.your-turn-recap');
    expect(recap).not.toBeNull();
    expect(recap!.textContent).toContain('dealt 5');
    expect(recap!.textContent).toContain('took 3');
    expect(recap!.textContent).toContain('2 fizzles');
  });

  it('announcement does NOT appear for a fresh planning start (no prior summary)', () => {
    seedBattle([unit('a', 0, 0), unit('e', 1, 10)], { uiPhase: 'planning' });
    const { container } = render(<App />);
    expect(container.querySelector('.your-turn-announcement')).toBeNull();
  });
});

// ── 3. [Enter] key during planning ────────────────────────────────────────────

describe('[Enter] key during planning', () => {
  beforeEach(() =>
    seedBattle([unit('a', 0, 0), unit('b', 0, 4), unit('e', 1, 10)], { uiPhase: 'planning' }),
  );

  it('commits when ≥1 order is queued', () => {
    useAppStore.getState().tryQueueOrder({ kind: 'move', unitId: 'a', path: [1] });
    render(<App />);
    expect(useAppStore.getState().uiPhase).toBe('planning');
    fireEvent.keyDown(window, { key: 'Enter' });
    // commit() moves uiPhase → 'replay'.
    expect(useAppStore.getState().uiPhase).toBe('replay');
  });

  it('does NOT commit when zero orders are queued', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(useAppStore.getState().uiPhase).toBe('planning');
  });

  it('does NOT commit when focus is on an INPUT element', () => {
    useAppStore.getState().tryQueueOrder({ kind: 'move', unitId: 'a', path: [1] });
    const { container } = render(<App />);
    const input = document.createElement('input');
    container.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useAppStore.getState().uiPhase).toBe('planning');
  });
});

// ── 4. [Enter] dismisses the announcement ─────────────────────────────────────

describe('[Enter] dismisses the announcement', () => {
  it('Enter removes the pill when it is visible', () => {
    seedBattle([unit('a', 0, 0), unit('e', 1, 10)], { uiPhase: 'summary' });
    const { container } = render(<App />);
    // Auto-advance fired; announcement should be present.
    expect(container.querySelector('.your-turn-announcement')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(container.querySelector('.your-turn-announcement')).toBeNull();
  });
});

// ── 5. Backstop timer (reduced-motion path) ───────────────────────────────────

describe('backstop timer', () => {
  it('clears the announcement after 2200 ms regardless of CSS animation', () => {
    vi.useFakeTimers();
    seedBattle([unit('a', 0, 0), unit('e', 1, 10)], { uiPhase: 'summary' });
    const { container } = render(<App />);
    expect(container.querySelector('.your-turn-announcement')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(2200);
    });
    expect(container.querySelector('.your-turn-announcement')).toBeNull();
  });

  it('early dismiss (tap) cancels the timer — no double-fire after 2200 ms', () => {
    vi.useFakeTimers();
    seedBattle([unit('a', 0, 0), unit('e', 1, 10)], { uiPhase: 'summary' });
    const { container } = render(<App />);
    const pill = container.querySelector<HTMLButtonElement>('.your-turn-announcement')!;
    expect(pill).not.toBeNull();
    // Dismiss by tap.
    fireEvent.click(pill);
    expect(container.querySelector('.your-turn-announcement')).toBeNull();
    // Advancing past the backstop should not cause errors or re-show the pill.
    act(() => {
      vi.advanceTimersByTime(2200);
    });
    expect(container.querySelector('.your-turn-announcement')).toBeNull();
  });
});
