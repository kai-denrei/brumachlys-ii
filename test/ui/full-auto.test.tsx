// @vitest-environment jsdom
// FULL AUTO (store.fullAuto) — App-level wiring. When fullAuto is ON, faction 0
// (P1) is planned by the same greedy AI as P2 and the round auto-commits: the
// App autopilot effect calls commitAutopilot() during planning, so uiPhase
// leaves 'planning' with no manual input and the game self-advances. When OFF,
// planning sits still (the player is in control). The bot is the EXISTING
// greedy planner via commitAutopilot — no new AI here; this only exercises the
// reactive store-driven path that replaced the one-time ?autopilot useMemo.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useAppStore } from '../../src/state/store';
import { App } from '../../src/App';

// The ReplayDock auto-scrolls the active slot chip into view; jsdom lacks it.
beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // Leave the battle / reset so the next test starts from the start screen.
  useAppStore.getState().exitBattle();
  useAppStore.setState({ fullAuto: false });
});

function startSkirmish() {
  useAppStore.setState({
    screen: 'start',
    donorId: '53316',
    seed: 7,
    mode: 'skirmish',
    roundLimit: null,
    fullAuto: false,
    board: null,
    game: null,
    uiPhase: 'planning',
    replay: null,
    orders: {},
    buys: {},
  });
  useAppStore.getState().startBattle();
}

describe('FULL AUTO — App autopilot path', () => {
  it('with fullAuto ON the planning phase auto-commits (P1 greedy plan + commit)', () => {
    vi.useFakeTimers();
    startSkirmish();
    useAppStore.setState({ fullAuto: true });
    expect(useAppStore.getState().uiPhase).toBe('planning');

    render(<App />);
    // The autopilot effect schedules commitAutopilot() ~200ms into planning.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // commitAutopilot ran: resolver advanced the round → replay phase, and the
    // player's queued orders were consumed (the bot's plan was committed).
    expect(useAppStore.getState().uiPhase).not.toBe('planning');
    expect(useAppStore.getState().game!.round).toBeGreaterThan(1);
  });

  it('with fullAuto OFF planning sits still — no auto-commit (player in control)', () => {
    vi.useFakeTimers();
    startSkirmish();
    expect(useAppStore.getState().fullAuto).toBe(false);

    render(<App />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // No autopilot fired: still planning round 1, awaiting manual input.
    expect(useAppStore.getState().uiPhase).toBe('planning');
    expect(useAppStore.getState().game!.round).toBe(1);
  });

  it('toggling fullAuto ON mid-planning fires the autopilot reactively', () => {
    vi.useFakeTimers();
    startSkirmish();
    render(<App />);
    // Initially OFF — nothing happens.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(useAppStore.getState().uiPhase).toBe('planning');
    expect(useAppStore.getState().game!.round).toBe(1);

    // Flip it ON at runtime (what the gear-menu toggle does). The effect re-runs
    // because `autopilot` is now a reactive store selector.
    act(() => {
      useAppStore.getState().setFullAuto(true);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(useAppStore.getState().uiPhase).not.toBe('planning');
    expect(useAppStore.getState().game!.round).toBeGreaterThan(1);
  });
});
