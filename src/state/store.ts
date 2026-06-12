// store.ts — Zustand app store. P6 scope: shell navigation (start ↔ battle),
// donor/seed choice, the generated board, and DISPLAY units (mirror armies
// placed for looking at, not playing — P7 adds an order/ui slice, P8 a
// game+replay slice holding GameState; this file is structured so those land
// as sibling slices without reshaping P6 state).
//
// Determinism boundary (spec §0/§4.3): board generation stays pure
// (generateBoard); ONLY randomizeSeed touches Date.now, and it lives here in
// the UI layer where that is allowed.
//
// Display placement: src/core/setup.ts (P4 resolver agent) did not exist when
// P6 wired this; buildDisplayArmies below is a UI-side stand-in using the §4.1
// placeForce contract. When setup.ts/newGame lands, startBattle should prefer
// it and this helper dies.

import { create } from 'zustand';
import type { Board, CellId } from '../board/types';
import { generateBoard, placeForce } from '../board';
import type { FactionId, UnitInstance } from '../core/types';
import { loadUnits } from '../io/data-loader';
import { DONOR_ENTRIES, loadDonor } from '../io/donor-registry';

/** §6.4 standard army: one of each of the 8 types, initiative descending. */
export const STANDARD_ARMY: readonly string[] = [
  'sniper',
  'humvee',
  'ranger',
  'infantry',
  'grenadier',
  'tank',
  'artillery',
  'heavytank',
];

export type Screen = 'start' | 'battle';

export type AppState = {
  screen: Screen;
  donorId: string;
  seed: number;
  /** Generated battle board (null until startBattle). */
  board: Board | null;
  /** Mirror armies placed for display (P6). P8's GameState supersedes. */
  displayUnits: UnitInstance[];
  selectDonor: (donorId: string) => void;
  setSeed: (seed: number) => void;
  /** UI layer may use wall-clock entropy (spec §4.3). */
  randomizeSeed: () => void;
  startBattle: () => void;
  exitBattle: () => void;
};

/**
 * One of each of the 8 unit types per faction on the placeForce cells.
 * Vehicles (armored) prefer cells they can actually stand on (not mountains)
 * — a display nicety; real placement is core/setup.ts territory.
 */
export function buildDisplayArmies(board: Board): UnitInstance[] {
  const anchors = board.placementAnchors;
  if (!anchors) throw new Error('buildDisplayArmies: board has no placement anchors');
  const types = loadUnits();
  const units: UnitInstance[] = [];
  for (const faction of [0, 1] as FactionId[]) {
    const cells = placeForce(board, anchors[faction], STANDARD_ARMY.length);
    const vehicleOk = (c: CellId) => board.cells.get(c)?.terrain !== 'mountains';
    const free = [...cells];
    const take = (pred: (c: CellId) => boolean): CellId => {
      const i = free.findIndex(pred);
      const j = i >= 0 ? i : 0;
      return free.splice(j, 1)[0]!;
    };
    // Armored units claim non-mountain cells first (deterministic: BFS order).
    const assigned = new Map<string, CellId>();
    for (const key of STANDARD_ARMY) {
      if (types[key]?.armorType === 'armored') assigned.set(key, take(vehicleOk));
    }
    for (const key of STANDARD_ARMY) {
      if (!assigned.has(key)) assigned.set(key, take(() => true));
    }
    for (const key of STANDARD_ARMY) {
      units.push({
        id: `${faction}-${key}`,
        type: key,
        faction,
        cell: assigned.get(key)!,
        count: 10,
        stance: 'aggressive',
        attackedFrom: [],
      });
    }
  }
  return units;
}

export const useAppStore = create<AppState>((set, get) => ({
  screen: 'start',
  donorId: DONOR_ENTRIES[0]!.id,
  seed: 7,
  board: null,
  displayUnits: [],

  selectDonor: (donorId) => set({ donorId }),
  setSeed: (seed) => set({ seed: Math.trunc(seed) }),
  randomizeSeed: () => set({ seed: Date.now() % 1_000_000 }),

  startBattle: () => {
    const { donorId, seed } = get();
    const board = generateBoard(loadDonor(donorId), seed);
    set({ board, displayUnits: buildDisplayArmies(board), screen: 'battle' });
  },

  exitBattle: () => set({ screen: 'start', board: null, displayUnits: [] }),
}));
