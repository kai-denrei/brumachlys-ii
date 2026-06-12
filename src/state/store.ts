// store.ts — Zustand app store. P6: shell navigation (start ↔ battle),
// donor/seed choice, the generated board, DISPLAY units. P7 adds the planning
// slice: selected unit, queued orders per unit (core/orders.ts OrderQueues),
// queue/edit/remove actions and the commit gate. P8 adds game+replay slices.
//
// Determinism boundary (spec §0/§4.3): board generation stays pure
// (generateBoard); ONLY randomizeSeed touches Date.now, and it lives here in
// the UI layer where that is allowed.
//
// Placement: P4's core/setup.ts newGame landed mid-P7 and startBattle now
// prefers it (P6 handoff). buildDisplayArmies remains only as the fallback
// for boards without anchors and dies entirely when P8's game slice holds the
// full GameState. KNOWN WART (P8): newGame/placeForce excludes only water, so
// an armored unit can be seated on mountains it cannot legally re-enter —
// flagged to the resolver owner, not patched UI-side (the planning view must
// match what the resolver will resolve).

import { create } from 'zustand';
import type { Board, CellId } from '../board/types';
import { generateBoard, placeForce } from '../board';
import type { FactionId, UnitInstance } from '../core/types';
import {
  type Order,
  type OrderKind,
  type OrderQueues,
  type UnitOrders,
  type ValidationResult,
  queueOrder,
  removeOrder,
  validateOrder,
} from '../core/orders';
import { visibleCells } from '../core/fog';
import { newGame } from '../core/setup';
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

export const PLAYER_FACTION: FactionId = 0;

export type AppState = {
  screen: Screen;
  donorId: string;
  seed: number;
  /** Generated battle board (null until startBattle). */
  board: Board | null;
  /** Mirror armies placed for display (P6). P8's GameState supersedes. */
  displayUnits: UnitInstance[];

  // --- planning slice (P7) ---------------------------------------------------
  /** Currently selected OWN unit (Layer 1, §9.2). */
  selectedUnitId: string | null;
  /** Player faction's queued orders, by unit id (core OrderQueues). */
  orders: OrderQueues;
  /** Bumped by centerOn; the Board pans to `cell` when token changes. */
  focus: { cell: CellId; token: number } | null;

  selectDonor: (donorId: string) => void;
  setSeed: (seed: number) => void;
  /** UI layer may use wall-clock entropy (spec §4.3). */
  randomizeSeed: () => void;
  startBattle: () => void;
  exitBattle: () => void;

  selectUnit: (unitId: string | null) => void;
  centerOn: (cell: CellId) => void;
  /** Validate against the player's fog-filtered view, then queue (replacing
   * any same-kind order — edit semantics). Returns the validation verdict so
   * the UI can react to rejections. */
  tryQueueOrder: (order: Order) => ValidationResult;
  removeUnitOrder: (unitId: string, kind: OrderKind) => void;
  clearOrders: () => void;
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

/**
 * Dev-only (`?debug=close`): relocate the AI army next to the player's so
 * enemies are visible/in range during planning — P7 has no resolver yet, so
 * from a fresh battle both armies otherwise sit outside each other's vision
 * and attack arcs / target rings cannot be exercised. Never active in
 * production flows (URL param only); noted in the P7 verification report.
 */
function debugCloseArmies(board: Board, units: UnitInstance[]): UnitInstance[] {
  const anchors = board.placementAnchors;
  if (!anchors) return units;
  const types = loadUnits();
  const taken = new Set(units.filter((u) => u.faction === 0).map((u) => u.cell));
  // A generous BFS ring around the PLAYER anchor; faction-1 units take the
  // first free legal cells beyond the player's 8.
  const ring = placeForce(board, anchors[0], 8 + 24).filter((c) => !taken.has(c));
  return units.map((u) => {
    if (u.faction !== 1) return u;
    const armored = types[u.type]?.armorType === 'armored';
    const i = ring.findIndex((c) => !armored || board.cells.get(c)?.terrain !== 'mountains');
    const cell = i >= 0 ? ring.splice(i, 1)[0]! : u.cell;
    return { ...u, cell };
  });
}

function debugFlag(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('debug');
}

export const useAppStore = create<AppState>((set, get) => ({
  screen: 'start',
  donorId: DONOR_ENTRIES[0]!.id,
  seed: 7,
  board: null,
  displayUnits: [],

  selectedUnitId: null,
  orders: {},
  focus: null,

  selectDonor: (donorId) => set({ donorId }),
  setSeed: (seed) => set({ seed: Math.trunc(seed) }),
  randomizeSeed: () => set({ seed: Date.now() % 1_000_000 }),

  startBattle: () => {
    const { donorId, seed } = get();
    const board = generateBoard(loadDonor(donorId), seed);
    let displayUnits = Object.values(
      newGame(board, STANDARD_ARMY, loadUnits(), seed).units,
    );
    if (debugFlag() === 'close') displayUnits = debugCloseArmies(board, displayUnits);
    set({
      board,
      displayUnits,
      screen: 'battle',
      selectedUnitId: null,
      orders: {},
      focus: null,
    });
  },

  exitBattle: () =>
    set({
      screen: 'start',
      board: null,
      displayUnits: [],
      selectedUnitId: null,
      orders: {},
      focus: null,
    }),

  // --- planning actions --------------------------------------------------------

  selectUnit: (unitId) => set({ selectedUnitId: unitId }),

  centerOn: (cell) => set((s) => ({ focus: { cell, token: (s.focus?.token ?? 0) + 1 } })),

  tryQueueOrder: (order) => {
    const { board, displayUnits, orders } = get();
    if (!board) return { ok: false, reason: 'unknown-unit' };
    const types = loadUnits();
    const visible = visibleCells(board, displayUnits, PLAYER_FACTION, types);
    // The player's KNOWN units: own + visible enemies (spec §7 planning fog).
    const known = displayUnits.filter(
      (u) => u.faction === PLAYER_FACTION || visible.has(u.cell),
    );
    const queued: UnitOrders | undefined = orders[order.unitId];
    const verdict = validateOrder(
      { board, units: known, unitTypes: types, visible, queued },
      order,
    );
    if (verdict.ok) set({ orders: queueOrder(orders, order) });
    return verdict;
  },

  removeUnitOrder: (unitId, kind) => set((s) => ({ orders: removeOrder(s.orders, unitId, kind) })),

  clearOrders: () => set({ orders: {} }),
}));
