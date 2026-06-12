// store.ts — Zustand app store. P6: shell navigation (start ↔ battle),
// donor/seed choice, the generated board. P7: the planning slice (selected
// unit, queued orders, validation gate). P8: the GAME slice — a full core
// GameState from newGame(), the commit → AI → resolve → replay loop, and the
// replay/summary/banner phase machine.
//
// Determinism boundary (spec §0/§4.3): board generation and resolution stay
// pure; ONLY randomizeSeed/freshSeed touch Date.now, and they live here in
// the UI layer where that is allowed.
//
// UI phase machine (uiPhase — game.phase stays the core's own field):
//   planning --commit--> replay --frames end--> summary --close-->
//     game.outcome ? over (banner §9.6) : planning (fog recomputed from the
//     new GameState by the planning selectors — nothing special to do).
//
// P7's ?debug=close hook is gone: with the resolver wired, contact happens
// organically.

import { create } from 'zustand';
import type { Board, CellId } from '../board/types';
import { generateBoard } from '../board';
import { buildFactionView, greedyPlanner } from '../ai';
import type { FactionId, GameState } from '../core/types';
import {
  type Order,
  type OrderKind,
  type OrderQueues,
  type UnitOrders,
  type ValidationResult,
  flattenOrders,
  queueOrder,
  removeOrder,
  validateOrder,
} from '../core/orders';
import { weewar } from '../core/combat/weewar';
import { visibleCells } from '../core/fog';
import { resolveRound } from '../core/resolver';
import { createRng } from '../core/rng';
import { newGame } from '../core/setup';
import { loadUnits } from '../io/data-loader';
import { DONOR_ENTRIES, loadDonor } from '../io/donor-registry';
import { buildReplay, type ReplayScript } from './replay';

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

/** UI phase — orthogonal to GameState.phase (which the resolver owns). */
export type UiPhase = 'planning' | 'replay' | 'summary' | 'over';

export type ReplaySpeed = 1 | 2 | 'skip';

export type ReplaySlice = {
  script: ReplayScript;
  /** The round these events resolved (game.round is already advanced). */
  round: number;
};

export type AppState = {
  screen: Screen;
  donorId: string;
  seed: number;
  /** Generated battle board (null until startBattle). game.board === board. */
  board: Board | null;

  // --- game slice (P8) --------------------------------------------------------
  /** The authoritative core GameState (newGame → resolveRound chain). */
  game: GameState | null;
  uiPhase: UiPhase;
  /** Last resolved round's replay script (null in planning of round 1). */
  replay: ReplaySlice | null;
  replaySpeed: ReplaySpeed;

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

  // --- game actions (P8) -------------------------------------------------------
  /** Commit the round: player orders (or the override — the ?autopilot=greedy
   * flag plans faction 0 too) + AI planOrders → resolveRound → replay. */
  commit: (playerOrdersOverride?: Order[]) => void;
  /** Dev/demo: plan faction 0 with the same greedy AI, then commit. */
  commitAutopilot: () => void;
  setReplaySpeed: (speed: ReplaySpeed) => void;
  /** Playback driver reached the last frame → round summary sheet. */
  finishReplay: () => void;
  /** Summary dismissed → back to planning, or the §2.8 banner. */
  closeSummary: () => void;
  /** §4.3 New Battle: same donor, given seed (banner seed field). */
  rematch: (seed: number) => void;
};

/** Non-zero deterministic planner seed per (game seed, round, faction). */
function plannerSeed(rngSeed: number, round: number, faction: FactionId): number {
  return ((rngSeed ^ Math.imul(round, 0x9e3779b9) ^ faction) >>> 0) || 1;
}

export const useAppStore = create<AppState>((set, get) => ({
  screen: 'start',
  donorId: DONOR_ENTRIES[0]!.id,
  seed: 7,
  board: null,

  game: null,
  uiPhase: 'planning',
  replay: null,
  replaySpeed: 1,

  selectedUnitId: null,
  orders: {},
  focus: null,

  selectDonor: (donorId) => set({ donorId }),
  setSeed: (seed) => set({ seed: Math.trunc(seed) }),
  randomizeSeed: () => set({ seed: Date.now() % 1_000_000 }),

  startBattle: () => {
    const { donorId, seed } = get();
    const board = generateBoard(loadDonor(donorId), seed);
    const game = newGame(board, STANDARD_ARMY, loadUnits(), seed);
    set({
      board,
      game,
      screen: 'battle',
      uiPhase: 'planning',
      replay: null,
      selectedUnitId: null,
      orders: {},
      focus: null,
    });
  },

  exitBattle: () =>
    set({
      screen: 'start',
      board: null,
      game: null,
      uiPhase: 'planning',
      replay: null,
      selectedUnitId: null,
      orders: {},
      focus: null,
    }),

  // --- planning actions --------------------------------------------------------

  selectUnit: (unitId) => set({ selectedUnitId: unitId }),

  centerOn: (cell) => set((s) => ({ focus: { cell, token: (s.focus?.token ?? 0) + 1 } })),

  tryQueueOrder: (order) => {
    const { board, game, orders } = get();
    if (!board || !game) return { ok: false, reason: 'unknown-unit' };
    const types = loadUnits();
    const units = Object.values(game.units).filter((u) => u.count > 0);
    const visible = visibleCells(board, units, PLAYER_FACTION, types);
    // The player's KNOWN units: own + visible enemies (spec §7 planning fog).
    const known = units.filter((u) => u.faction === PLAYER_FACTION || visible.has(u.cell));
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

  // --- game actions (P8) ---------------------------------------------------------

  commit: (playerOrdersOverride) => {
    const { game, orders, uiPhase } = get();
    if (!game || game.outcome || uiPhase !== 'planning') return;
    const types = loadUnits();
    const playerOrders = playerOrdersOverride ?? flattenOrders(orders);

    // The AI plans when the player commits (spec §2.1, solo flow) — through
    // its own fog-filtered FactionView only (§8.1 symmetric honesty).
    const aiView = buildFactionView(game.board, game, 1, types);
    const aiOrders = greedyPlanner.planOrders(
      aiView,
      createRng(plannerSeed(game.rngSeed, game.round, 1)),
    );

    // Pre-resolution snapshot — the replay simulates forward from here.
    const baseUnits = Object.values(game.units).map((u) => ({
      ...u,
      attackedFrom: u.attackedFrom.map((e) => ({ ...e })),
    }));

    const { state, events } = resolveRound(
      game.board,
      game,
      { 0: playerOrders, 1: aiOrders },
      types,
      weewar,
    );
    const script = buildReplay(game.board, baseUnits, events, types, PLAYER_FACTION);

    set({
      game: state,
      replay: { script, round: game.round },
      uiPhase: 'replay',
      orders: {},
      selectedUnitId: null,
      focus: null,
    });
  },

  commitAutopilot: () => {
    const { game, uiPhase } = get();
    if (!game || game.outcome || uiPhase !== 'planning') return;
    const types = loadUnits();
    const view = buildFactionView(game.board, game, PLAYER_FACTION, types);
    const planned = greedyPlanner.planOrders(
      view,
      createRng(plannerSeed(game.rngSeed, game.round, PLAYER_FACTION)),
    );
    get().commit(planned);
  },

  setReplaySpeed: (replaySpeed) => set({ replaySpeed }),

  finishReplay: () => {
    if (get().uiPhase === 'replay') set({ uiPhase: 'summary' });
  },

  closeSummary: () =>
    set((s) => {
      if (s.uiPhase !== 'summary') return s;
      if (s.game?.outcome) return { ...s, uiPhase: 'over' as const };
      // Back to planning; the replay script is spent. Planning fog recomputes
      // from the advanced GameState in the selectors.
      return { ...s, uiPhase: 'planning' as const, replay: null };
    }),

  rematch: (seed) => {
    set({ seed: Math.trunc(seed) });
    get().startBattle();
  },
}));
