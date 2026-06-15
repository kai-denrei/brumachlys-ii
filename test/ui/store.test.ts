// @vitest-environment jsdom
// App store: start → battle transition generates a board and a full core
// GameState (P8 rebased the P6 display armies onto newGame). jsdom env: the
// store sits in the UI layer (donor-registry pulls Vite ?raw imports; jsdom
// matches how it runs in the app).

import { beforeEach, describe, expect, it } from 'vitest';
import { STANDARD_ARMY, useAppStore } from '../../src/state/store';

describe('app store', () => {
  beforeEach(() => {
    useAppStore.setState({
      screen: 'start',
      donorId: '53316',
      seed: 7,
      donorDefaultsApplied: new Set(),
      // E3: the store defaults to conquest; these suites pin the v1 skirmish
      // game (mirror armies, no bases) — conquest plumbing has its own suite.
      mode: 'skirmish',
      roundLimit: null,
      board: null,
      game: null,
      uiPhase: 'planning',
      replay: null,
    });
  });

  it('starts on the start screen with no board or game', () => {
    const s = useAppStore.getState();
    expect(s.screen).toBe('start');
    expect(s.board).toBeNull();
    expect(s.game).toBeNull();
  });

  it('startBattle generates the board and a GameState with mirror armies, deterministic in (donor, seed)', () => {
    useAppStore.getState().startBattle();
    const s = useAppStore.getState();
    expect(s.screen).toBe('battle');
    expect(s.board).not.toBeNull();
    expect(s.board!.donorMapId).toBe('53316');
    expect(s.game).not.toBeNull();
    expect(s.game!.round).toBe(1);
    expect(s.game!.phase).toBe('planning');
    expect(s.uiPhase).toBe('planning');
    const units = Object.values(s.game!.units);
    expect(units.length).toBe(16); // 8 per faction (§6.4)

    for (const faction of [0, 1] as const) {
      const own = units.filter((u) => u.faction === faction);
      expect(own.map((u) => u.type).sort()).toEqual([...STANDARD_ARMY].sort());
      // distinct passable cells
      const cells = own.map((u) => u.cell);
      expect(new Set(cells).size).toBe(cells.length);
      for (const u of own) {
        expect(s.board!.cells.get(u.cell)!.terrain).not.toBe('water');
      }
    }

    const firstCells = units.map((u) => `${u.id}@${u.cell}`);
    useAppStore.getState().exitBattle();
    useAppStore.getState().startBattle();
    const again = Object.values(useAppStore.getState().game!.units).map(
      (u) => `${u.id}@${u.cell}`,
    );
    expect(again).toEqual(firstCells);
  });

  it('exitBattle returns to start and clears board, game and replay', () => {
    useAppStore.getState().startBattle();
    useAppStore.getState().exitBattle();
    const s = useAppStore.getState();
    expect(s.screen).toBe('start');
    expect(s.board).toBeNull();
    expect(s.game).toBeNull();
    expect(s.replay).toBeNull();
    expect(s.uiPhase).toBe('planning');
  });

  it('seed controls: setSeed truncates, randomizeSeed changes the seed', () => {
    useAppStore.getState().setSeed(42.9);
    expect(useAppStore.getState().seed).toBe(42);
    useAppStore.getState().randomizeSeed();
    expect(Number.isInteger(useAppStore.getState().seed)).toBe(true);
  });

  it('selecting Aruba the FIRST time adopts its curated seed (25837); re-picking keeps the player seed', () => {
    // first pick → curated "good layout" seed fills in
    useAppStore.getState().selectDonor('5');
    expect(useAppStore.getState().donorId).toBe('5');
    expect(useAppStore.getState().seed).toBe(25837);

    // player overrides the seed, wanders to another map, then comes back
    useAppStore.getState().setSeed(99);
    useAppStore.getState().selectDonor('53316');
    useAppStore.getState().selectDonor('5');
    // second pick must NOT clobber the player's own seed
    expect(useAppStore.getState().donorId).toBe('5');
    expect(useAppStore.getState().seed).toBe(99);

    // a donor with no curated seed never touches the seed box
    useAppStore.getState().selectDonor('53316');
    expect(useAppStore.getState().seed).toBe(99);
  });
});
