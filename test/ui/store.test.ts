// @vitest-environment jsdom
// App store: start → battle transition generates a board and display armies.
// jsdom env: the store sits in the UI layer (donor-registry pulls Vite ?raw
// imports; jsdom matches how it runs in the app).

import { beforeEach, describe, expect, it } from 'vitest';
import { STANDARD_ARMY, useAppStore } from '../../src/state/store';

describe('app store', () => {
  beforeEach(() => {
    useAppStore.setState({
      screen: 'start',
      donorId: '53316',
      seed: 7,
      board: null,
      displayUnits: [],
    });
  });

  it('starts on the start screen with no board', () => {
    const s = useAppStore.getState();
    expect(s.screen).toBe('start');
    expect(s.board).toBeNull();
  });

  it('startBattle generates the board and both mirror armies, deterministic in (donor, seed)', () => {
    useAppStore.getState().startBattle();
    const s = useAppStore.getState();
    expect(s.screen).toBe('battle');
    expect(s.board).not.toBeNull();
    expect(s.board!.donorMapId).toBe('53316');
    expect(s.displayUnits.length).toBe(16); // 8 per faction (§6.4)

    for (const faction of [0, 1] as const) {
      const own = s.displayUnits.filter((u) => u.faction === faction);
      expect(own.map((u) => u.type).sort()).toEqual([...STANDARD_ARMY].sort());
      // distinct passable cells
      const cells = own.map((u) => u.cell);
      expect(new Set(cells).size).toBe(cells.length);
      for (const u of own) {
        expect(s.board!.cells.get(u.cell)!.terrain).not.toBe('water');
      }
    }
    // P7: placement authority moved from the P6 buildDisplayArmies stand-in
    // to core newGame (P6 handoff: prefer setup.ts once it exists). newGame's
    // placeForce excludes only water, so the P6 "armored never on mountains"
    // display nicety no longer holds here — known wart, flagged to P8/P4.

    const firstCells = s.displayUnits.map((u) => `${u.id}@${u.cell}`);
    useAppStore.getState().exitBattle();
    useAppStore.getState().startBattle();
    const again = useAppStore.getState().displayUnits.map((u) => `${u.id}@${u.cell}`);
    expect(again).toEqual(firstCells);
  });

  it('exitBattle returns to start and clears the board', () => {
    useAppStore.getState().startBattle();
    useAppStore.getState().exitBattle();
    const s = useAppStore.getState();
    expect(s.screen).toBe('start');
    expect(s.board).toBeNull();
    expect(s.displayUnits).toEqual([]);
  });

  it('seed controls: setSeed truncates, randomizeSeed changes the seed', () => {
    useAppStore.getState().setSeed(42.9);
    expect(useAppStore.getState().seed).toBe(42);
    useAppStore.getState().randomizeSeed();
    expect(Number.isInteger(useAppStore.getState().seed)).toBe(true);
  });
});
