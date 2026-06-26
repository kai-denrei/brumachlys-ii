// @vitest-environment jsdom
// R7 (SEEK / SCRUB transport) — App-level behavior of the replay driver:
//   • scrubbing backward NEVER finishes the replay (no mis-fired summary).
//   • grabbing the scrubber pauses playback.
//   • skip still jumps to the final state.
//   • seeking is a pure cursor move — it never mutates game state.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { Board, Cell, CellId, TerrainKey, Vec2 } from '../../src/board/types';
import type { FactionId, GameState, UnitInstance } from '../../src/core/types';
import type { ReplayFrame, ReplayScript } from '../../src/state/replay';
import { layoutPhases } from '../../src/state/replay-timing';
import { useAppStore } from '../../src/state/store';
import { App } from '../../src/App';

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function lineBoard(n: number): Board {
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
      terrain: 'plains' as TerrainKey,
    });
  }
  return { cells, seed: 0, donorMapId: 'seek-app-test', placementAnchors: [0, n - 1] };
}

function unit(id: string, faction: FactionId, cell: CellId, type = 'infantry'): UnitInstance {
  return { id, type, faction, cell, count: 10, stance: 'aggressive', attackedFrom: [] };
}

function frame(units: UnitInstance[], slot: number): ReplayFrame {
  return {
    duration: 200,
    slot,
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

/** A script with several frames so seeking has somewhere to go. */
function multiScript(units: UnitInstance[], frameCount: number): ReplayScript {
  const frames = Array.from({ length: frameCount }, (_, i) =>
    frame(units, i === 0 ? -1 : Math.min(i - 1, 1)),
  );
  return {
    slots: [
      { kind: 'move', actorType: 'infantry', actorFaction: 0, strikes: [] },
      { kind: 'move', actorType: 'infantry', actorFaction: 1, strikes: [] },
    ],
    frames,
    log: [],
    discovered: new Set<CellId>(),
    phases: layoutPhases(),
    combatants: { cells: new Set<CellId>(), units: new Set<string>() },
    summary: { kills: [], damageDealt: [0, 0], fizzles: 0 },
  };
}

function seedReplay(frameCount: number) {
  const units = [unit('a', 0, 0), unit('e', 1, 11)];
  const board = lineBoard(12);
  const game: GameState = {
    round: 2,
    phase: 'over',
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
    uiPhase: 'replay',
    replay: { round: 1, script: multiScript(units, frameCount) },
    replaySpeed: 1,
    selectedUnitId: null,
    orders: {},
    buys: {},
    directive: null,
    focus: null,
    notice: null,
    battleLog: [],
    casualties: [],
  });
  return { units, game };
}

function scrub(container: HTMLElement) {
  return container.querySelector('[data-testid="replay-scrub"]') as HTMLInputElement;
}

describe('R7 App seek/scrub transport', () => {
  it('renders the scrubber during replay', () => {
    vi.useFakeTimers();
    seedReplay(8);
    let container!: HTMLElement;
    act(() => {
      container = render(<App />).container;
    });
    expect(scrub(container)).not.toBeNull();
  });

  it('scrubbing backward does NOT finish the replay (no mis-fired summary)', () => {
    vi.useFakeTimers();
    seedReplay(8);
    let container!: HTMLElement;
    act(() => {
      container = render(<App />).container;
    });
    // Advance a few frames so the cursor is mid-replay.
    act(() => {
      vi.advanceTimersByTime(200 * 4);
    });
    expect(useAppStore.getState().uiPhase).toBe('replay');

    // Grab + scrub the slider back toward the start (time 0).
    act(() => {
      fireEvent.pointerDown(scrub(container));
      fireEvent.change(scrub(container), { target: { value: '0' } });
    });

    // Still in replay; the summary/finish never fired; replay state intact.
    expect(useAppStore.getState().uiPhase).toBe('replay');
    expect(useAppStore.getState().replay).not.toBeNull();

    // Let timers settle — a paused scrub must not auto-advance into a finish.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(useAppStore.getState().uiPhase).toBe('replay');
  });

  it('grabbing the scrubber pauses playback', () => {
    vi.useFakeTimers();
    seedReplay(8);
    let container!: HTMLElement;
    act(() => {
      container = render(<App />).container;
    });
    act(() => {
      fireEvent.pointerDown(scrub(container));
      fireEvent.change(scrub(container), { target: { value: '400' } });
    });
    // Paused → the pause control now offers "play".
    expect(container.querySelector('[aria-label="play"]')).not.toBeNull();
  });

  it('seeking does not mutate game-state unit positions (pure cursor move)', () => {
    vi.useFakeTimers();
    const { game } = seedReplay(8);
    const before = JSON.stringify(useAppStore.getState().game!.units);
    let container!: HTMLElement;
    act(() => {
      container = render(<App />).container;
    });
    act(() => {
      fireEvent.pointerDown(scrub(container));
      fireEvent.change(scrub(container), { target: { value: '600' } });
      fireEvent.change(scrub(container), { target: { value: '0' } });
    });
    expect(JSON.stringify(useAppStore.getState().game!.units)).toBe(before);
    void game;
  });

  it('skip still jumps to the final state (replay finishes)', () => {
    vi.useFakeTimers();
    seedReplay(8);
    let container!: HTMLElement;
    act(() => {
      container = render(<App />).container;
    });
    // Tap the skip control (≫). The driver jumps to the last frame + finishes;
    // for a non-game-over battle the auto-advance effect then lands on planning.
    act(() => {
      fireEvent.click(container.querySelector('.replay-button:last-child')!);
    });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(useAppStore.getState().uiPhase).toBe('planning');
  });
});
