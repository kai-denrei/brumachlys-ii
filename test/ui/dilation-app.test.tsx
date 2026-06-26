// @vitest-environment jsdom
// Phase 2 (BULLET-TIME DILATION CLOCK) — App-level wiring. The Swiss-railway
// clock is a fixed TOP-RIGHT canvas overlay present THROUGH THE WHOLE replay
// (glide → shift → dilation → release), layered above the SkirmishLog. The R3
// board COOLING/VIGNETTE (the kept chrome) still gates on WAVE A only. The old
// R3 SVG clock geometry is gone. Pure read of the script + cursor.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Board, Cell, CellId, TerrainKey, Vec2 } from '../../src/board/types';
import type { FactionId, GameState, UnitInstance } from '../../src/core/types';
import type { ReplayFrame, ReplayScript } from '../../src/state/replay';
import { layoutPhases, type Wave } from '../../src/state/replay-timing';
import { useAppStore } from '../../src/state/store';
import { App } from '../../src/App';

// jsdom has no scrollIntoView (the ReplayDock auto-scrolls the active slot chip
// into view). Stub it so rendering the replay dock doesn't throw — unrelated to
// the dilation overlays under test.
beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
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
  return { cells, seed: 0, donorMapId: 'dilation-test', placementAnchors: [0, n - 1] };
}

function unit(id: string, faction: FactionId, cell: CellId): UnitInstance {
  return { id, type: 'infantry', faction, cell, count: 10, stance: 'aggressive', attackedFrom: [] };
}

function frame(units: UnitInstance[], wave?: Wave): ReplayFrame {
  return {
    duration: 500,
    slot: wave ? 0 : -1,
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
    ...(wave ? { wave, band: wave === 'A' ? 'ranged' : 'melee' } : {}),
  };
}

function scriptWith(frames: ReplayFrame[]): ReplayScript {
  return {
    slots: [{ kind: 'volley', actorType: 'infantry', actorFaction: 0, strikes: [] }],
    frames,
    log: [],
    discovered: new Set<CellId>(),
    phases: layoutPhases(),
    combatants: { cells: new Set<CellId>(), units: new Set<string>() },
    summary: { kills: [], damageDealt: [0, 0], fizzles: 0 },
  };
}

function seedReplay(frames: ReplayFrame[]) {
  const board = lineBoard(12);
  const units = [unit('a', 0, 0), unit('e', 1, 10)];
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
    replay: { round: 1, script: scriptWith(frames) },
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

describe('Phase 2 dilation clock — App wiring', () => {
  it('the Swiss-railway clock overlay is present through the replay (top-right HUD)', () => {
    vi.useFakeTimers();
    const units = [unit('a', 0, 0), unit('e', 1, 10)];
    // frame 0 is a plain MOVE frame (glide) — the clock is still present.
    seedReplay([frame(units), frame(units, 'A')]);
    const { container } = render(<App />);
    const clock = container.querySelector('.dilation-clock') as HTMLElement;
    expect(clock).not.toBeNull();
    expect(clock.querySelector('canvas.dilation-clock-canvas')).not.toBeNull();
    // HUD chrome — not a unit token / board group.
    expect(clock.closest('[data-unit-id]')).toBeNull();
    expect(clock.closest('.board-units')).toBeNull();
  });

  it('the R3 SVG clock geometry is GONE (replaced by the canvas clock)', () => {
    vi.useFakeTimers();
    const units = [unit('a', 0, 0), unit('e', 1, 10)];
    seedReplay([frame(units, 'A')]);
    const { container } = render(<App />);
    expect(container.querySelector('.dilation-clock-tick')).toBeNull();
    expect(container.querySelector('.dilation-clock-hand')).toBeNull();
    expect(container.querySelector('.dilation-clock-face')).toBeNull();
    expect(container.querySelector('.dilation-clock-disc')).toBeNull();
  });

  it('the clock never reuses unit-radar geometry/classes', () => {
    vi.useFakeTimers();
    const units = [unit('a', 0, 0), unit('e', 1, 10)];
    seedReplay([frame(units, 'A')]);
    const { container } = render(<App />);
    const clock = container.querySelector('.dilation-clock') as HTMLElement;
    expect(clock.querySelector('.unit-radar')).toBeNull();
    expect(clock.querySelector('.unit-radar-ring')).toBeNull();
    expect(clock.querySelector('.radar-overlay')).toBeNull();
  });

  it('WAVE A frame: the kept cooling vignette renders (clock present too)', () => {
    vi.useFakeTimers();
    const units = [unit('a', 0, 0), unit('e', 1, 10)];
    seedReplay([frame(units, 'A'), frame(units)]);
    const { container } = render(<App />);
    expect(container.querySelector('.dilation-vignette')).not.toBeNull();
    expect(container.querySelector('.dilation-clock')).not.toBeNull();
  });

  it('non-WAVE-A frame: NO cooling vignette (the clock stays — it spans the run)', () => {
    vi.useFakeTimers();
    const units = [unit('a', 0, 0), unit('e', 1, 10)];
    // frame 0 is a plain (non-combat) frame → vignette released, clock present.
    seedReplay([frame(units), frame(units, 'A')]);
    const { container } = render(<App />);
    expect(container.querySelector('.dilation-vignette')).toBeNull();
    expect(container.querySelector('.dilation-clock')).not.toBeNull();
  });

  it('WAVE B (melee) frame: NO cooling vignette (cooling is WAVE A only)', () => {
    vi.useFakeTimers();
    const units = [unit('a', 0, 0), unit('e', 1, 10)];
    seedReplay([frame(units, 'B')]);
    const { container } = render(<App />);
    expect(container.querySelector('.dilation-vignette')).toBeNull();
  });
});
