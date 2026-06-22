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
import * as ai from '../ai';
import { buildFactionView, greedyPlanner } from '../ai';
import type { OrderPlanner } from '../ai';
import type { FactionId, GameMode, GameState } from '../core/types';
import {
  type BuyOrder,
  type BuyQueues,
  type BuyValidationResult,
  type Order,
  type OrderKind,
  type OrderQueues,
  type UnitOrders,
  type ValidationResult,
  flattenBuys,
  flattenOrders,
  plannedEndCell,
  queueBuy,
  queueOrder,
  removeBuy,
  removeOrder,
  validateBuy,
  validateOrder,
} from '../core/orders';
import { weewar } from '../core/combat/weewar';
import { accumulateDiscovery, assumedTerrainView, seedDiscovery, visibleCells } from '../core/fog';
import { resolveRound } from '../core/resolver';
import { createRng } from '../core/rng';
import { newGame } from '../core/setup';
import { loadUnits } from '../io/data-loader';
import { DONOR_ENTRIES, loadDonor } from '../io/donor-registry';
import {
  buildReplay,
  type ReplayLogEntry,
  type ReplayScript,
  type TimelineSlot,
} from './replay';

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

/** Unit-render skin (gear menu, top bar). Replaces the old binary "anim" flag:
 *  - 'icon'       → the flat squircle + glyph (default, every context)
 *  - 'anim'       → animated infantry sprites on the board (infantry-only)
 *  - 'watercolor' → static faction-colored watercolor art for ALL 8 types
 *  Board tokens only; minimal contexts (chips, demoted corner tokens, hover
 *  cards) always keep the glyph regardless of the mode. */
export type UnitRenderMode = 'icon' | 'anim' | 'watercolor';

/** localStorage key for the persisted unit-render mode (mirrors the audio
 *  preference key convention in ui/audio/combatAudio.ts). */
const UNIT_RENDER_MODE_KEY = 'brumachlys.unitRenderMode';

const UNIT_RENDER_MODES: readonly UnitRenderMode[] = ['icon', 'anim', 'watercolor'];

/** Read the persisted unit-render mode. Defaults to 'icon' when unset, invalid,
 *  or when storage is unavailable (jsdom may lack it; private mode can block).
 *  PURE-ish (reads storage only). */
export function loadUnitRenderMode(): UnitRenderMode {
  try {
    if (typeof localStorage === 'undefined') return 'icon';
    const v = localStorage.getItem(UNIT_RENDER_MODE_KEY);
    return UNIT_RENDER_MODES.includes(v as UnitRenderMode) ? (v as UnitRenderMode) : 'icon';
  } catch {
    return 'icon';
  }
}

/** Persist the unit-render mode. No-op when storage is unavailable. */
export function saveUnitRenderMode(mode: UnitRenderMode): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(UNIT_RENDER_MODE_KEY, mode);
  } catch {
    // storage blocked (private mode etc.) — preference simply won't persist.
  }
}

/** FULL AUTO seed: the historical ?autopilot=greedy demo flag is now just the
 *  initial value of the runtime-toggleable `fullAuto` store field. The URL is
 *  read ONCE at store creation (here); after that the gear-menu toggle owns the
 *  value. Returns false in non-browser / test envs (no window). */
export function loadFullAutoFlag(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('autopilot') === 'greedy';
  } catch {
    return false;
  }
}

/** UI phase — orthogonal to GameState.phase (which the resolver owns). */
export type UiPhase = 'planning' | 'replay' | 'summary' | 'over';

/** RESOLUTION SLOW-DOWN SLIDER (operator feedback: the replay is still too
 *  fast). replaySpeed is now a continuous NUMBER the slider sets — the fine
 *  control — plus the discrete 'skip' action (jump to end). The range
 *  emphasises SLOWER: 0.1× (bullet-time test) → 1× (normal) → 2×. A LOWER value
 *  stretches the WHOLE resolution: the App divides each frame's duration by the
 *  multiplier (0.5× → 2× longer), and the SAME value flows to the dilation clock
 *  + audio (via elapsedReplayTime), so the clock glide/ticks + audio stretch
 *  coherently with the board FX. Speed only scales playback WALL-CLOCK — it
 *  never touches the resolved outcome or the frame data (determinism intact). */
export type ReplaySpeed = number | 'skip';

/** Slider bounds — min emphasises SLOWER (bullet-time), default normal. */
export const REPLAY_SPEED_MIN = 0.1;
export const REPLAY_SPEED_MAX = 2;
export const REPLAY_SPEED_DEFAULT = 1;
/** Slider step — 0.1 granularity over the [0.1, 2] range. */
export const REPLAY_SPEED_STEP = 0.1;

/** localStorage key for the persisted resolution speed (mirrors the unit-render
 *  + audio preference key convention). */
const REPLAY_SPEED_KEY = 'brumachlys.replaySpeed';

/** Clamp a raw number into the slider's [min, max] range. PURE. */
export function clampReplaySpeed(v: number): number {
  if (!(typeof v === 'number') || Number.isNaN(v)) return REPLAY_SPEED_DEFAULT;
  return Math.max(REPLAY_SPEED_MIN, Math.min(REPLAY_SPEED_MAX, v));
}

/** Read the persisted resolution speed. Defaults to 1× when unset, invalid, out
 *  of range, or when storage is unavailable (jsdom may lack it; private mode can
 *  block). Only NUMERIC speeds persist — 'skip' is a transient action. */
export function loadReplaySpeed(): number {
  try {
    if (typeof localStorage === 'undefined') return REPLAY_SPEED_DEFAULT;
    const raw = localStorage.getItem(REPLAY_SPEED_KEY);
    if (raw === null) return REPLAY_SPEED_DEFAULT;
    const n = Number(raw);
    if (Number.isNaN(n) || n < REPLAY_SPEED_MIN || n > REPLAY_SPEED_MAX) {
      return REPLAY_SPEED_DEFAULT;
    }
    return n;
  } catch {
    return REPLAY_SPEED_DEFAULT;
  }
}

/** Persist a numeric resolution speed (clamped to range). No-op when storage is
 *  unavailable, or when the value is out of range (so a bad save can't poison the
 *  remembered choice). */
export function saveReplaySpeed(speed: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (Number.isNaN(speed) || speed < REPLAY_SPEED_MIN || speed > REPLAY_SPEED_MAX) return;
    localStorage.setItem(REPLAY_SPEED_KEY, String(speed));
  } catch {
    // storage blocked (private mode etc.) — preference simply won't persist.
  }
}

export type ReplaySlice = {
  script: ReplayScript;
  /** The round these events resolved (game.round is already advanced). */
  round: number;
};

/** v1.1 skirmish log: one completed round's fog-filtered lines. */
export type LoggedRound = { round: number; entries: ReplayLogEntry[] };

/** v1.1: transient toast-level signal (dependent orders auto-removed). */
export type OrderNotice = { text: string; token: number };

/** v0.9 propose-then-confirm: a transient MOVE proposal that has NOT been
 * queued yet. The player's first tap on a reachable cell sets this; a second
 * tap on the same dest (or Enter, or selecting another unit) commits it to a
 * real queued order. `path` excludes the start cell (order shape, §2.3) and is
 * the exact path that commit will hand to tryQueueOrder. At most one pending
 * proposal exists at a time, and it is always for the currently-selected unit.
 * It is cleared whenever it is committed, cancelled, or invalidated (selection
 * change without commit, clear-all, commit-round, new battle). */
export type PendingMove = { unitId: string; dest: CellId; path: CellId[] };

// --- v0.6 group directives (Ask 2) -------------------------------------------
// A directive is a BULK QUEUE FILL: the ai layer's planDirective generates a
// full order set for the player's units and it replaces the current queues.
// Every unit can then be re-ordered individually through the existing flows —
// the chip flips to "modified" on the first individual edit, clears entirely
// on clear-all/commit/new battle.

export type DirectiveKind = 'forward-deploy' | 'tactical-retreat' | 'fortify';

export type DirectiveState = { kind: DirectiveKind; modified: boolean } | null;

/** CORE-AGENT SEAM (v0.6): `planDirective(kind, view, rng): Order[]` is being
 * added to src/ai by the core agent. Probed optionally so the UI wiring ships
 * first — until the export lands, the directive control renders disabled
 * (resolvePlanDirective() === null) and applyDirective is a no-op. */
export type PlanDirectiveFn = (
  kind: DirectiveKind,
  view: ReturnType<typeof buildFactionView>,
  rng: ReturnType<typeof createRng>,
) => Order[];

export function resolvePlanDirective(): PlanDirectiveFn | null {
  const fn = (ai as Record<string, unknown>).planDirective;
  return typeof fn === 'function' ? (fn as PlanDirectiveFn) : null;
}

// --- v0.7 Item 4: AI archetype registry (concurrent ai-agent contract) -------
// The ai layer is adding a registry: `ARCHETYPES: readonly Archetype[]`,
// `DEFAULT_ARCHETYPE: ArchetypeKey`, `archetype(key): Archetype`, where
// Archetype = { key, label, blurb, planner: OrderPlanner }. The UI wiring
// ships first, so the registry is PROBED defensively — until the export lands,
// a single synthetic "greedy" archetype backed by the existing greedyPlanner
// stands in, and commit() falls back to greedyPlanner. The shape below is the
// contractual one; once the ai export exists it is used verbatim.

export type ArchetypeMeta = { key: string; label: string; blurb: string };

/** Synthetic fallback used until the ai registry export lands. */
const FALLBACK_ARCHETYPE: ArchetypeMeta = {
  key: 'greedy',
  label: 'Greedy',
  blurb: 'The default opponent — values the strongest move it can see this round.',
};

/** The archetype list the start screen renders. Reads the ai registry when
 * present; otherwise the single greedy fallback. */
export function archetypeList(): readonly ArchetypeMeta[] {
  const reg = (ai as Record<string, unknown>).ARCHETYPES;
  if (Array.isArray(reg) && reg.length > 0) {
    return reg.map((a) => ({
      key: String((a as ArchetypeMeta).key),
      label: String((a as ArchetypeMeta).label),
      blurb: String((a as ArchetypeMeta).blurb),
    }));
  }
  return [FALLBACK_ARCHETYPE];
}

/** Default archetype key — the ai registry's DEFAULT_ARCHETYPE, else greedy. */
export function defaultArchetypeKey(): string {
  const dflt = (ai as Record<string, unknown>).DEFAULT_ARCHETYPE;
  if (typeof dflt === 'string' && dflt.length > 0) return dflt;
  const list = archetypeList();
  return list[0]!.key;
}

/** The planner for a key — `archetype(key).planner` from the registry, with a
 * hard greedyPlanner fallback so commit() always has a real planner. */
export function archetypePlanner(key: string): OrderPlanner {
  const fn = (ai as Record<string, unknown>).archetype;
  if (typeof fn === 'function') {
    try {
      const arch = (fn as (k: string) => { planner?: OrderPlanner })(key);
      if (arch && arch.planner) return arch.planner;
    } catch {
      // registry present but key unknown — fall through to greedy
    }
  }
  return greedyPlanner;
}

/** Distinct deterministic rng salt per directive kind (same round, different
 * directives must not share a stream; re-tapping the same one is idempotent). */
const DIRECTIVE_SALT: Record<DirectiveKind, number> = {
  'forward-deploy': 0x00d1f0c4,
  'tactical-retreat': 0x00d1f0c5,
  fortify: 0x00d1f0c6,
};

/** v1.3 Tweak C: one witnessed casualty (chess-style recap row entry).
 * FOG-HONEST by construction: entries come ONLY from the fog-filtered replay
 * summary's kills (state/replay.ts withholds unseen deaths), never from the
 * raw event log — a unit destroyed in the mist never lands here. */
export type Casualty = { type: string; faction: FactionId };

/** v1.4 battle recap (game-over dashboard): battle-long totals, accumulated
 * round by round when each summary closes — same moment the casualty recap
 * accrues, same source: the FOG-FILTERED replay script (state/replay.ts).
 *
 * FOG HONESTY, field by field:
 * - `dealt`  = summary.damageDealt[player]: built only from strikes the replay
 *   SHOWED; the player's own strikes are always shown, so this is exactly the
 *   damage the player watched land.
 * - `taken`  = summary.damageDealt[enemy]: enemy strikes enter the summary
 *   only when shown — a strike on the player's own unit always is (impact +
 *   floater render even when the source hides in the mist), so taken damage
 *   is complete WITHOUT revealing attackers.
 * - `fizzles`: only lost-target fizzles whose actor the player could see.
 * - `brawls`: counted from the script's brawl slots (countWitnessedBrawls) —
 *   a brawl always involves a player unit, so all real brawls are witnessed.
 * - `rounds`: the last resolved round number — public knowledge.
 * Enemy units destroyed are NOT here: the dashboard reuses `casualties`
 * (witnessed kills only) for both icon rows. */
export type BattleRecap = {
  rounds: number;
  dealt: number;
  taken: number;
  fizzles: number;
  brawls: number;
  /** E3 conquest: credits the player spent on successful spawns, battle-long
   *  (summary.creditsSpent accumulated per round). Stays 0 in skirmish. */
  spent: number;
};

export const EMPTY_RECAP: BattleRecap = {
  rounds: 0,
  dealt: 0,
  taken: 0,
  fizzles: 0,
  brawls: 0,
  spent: 0,
};

/** VICTORY DASHBOARD (v1.5): one round's contribution to the game-over data
 * visualizations — accumulated round-by-round in closeSummary, the SAME moment
 * (and from the SAME fog-filtered source) as the casualty recap and BattleRecap
 * totals. The dashboard's sparklines/histogram walk a `roundHistory` of these.
 *
 * FOG HONESTY (inherits the BattleRecap argument, field by field):
 * - `damageDealt` = [summary.damageDealt[player], summary.damageDealt[enemy]]:
 *   built only from strikes the replay SHOWED (own strikes always shown; an
 *   enemy strike on the player's own unit always renders). The damage arc never
 *   reveals a hidden attacker — it plots watched-land damage vs watched-taken.
 * - `kills`   = the round's WITNESSED kills (summary.kills.length) — a mist kill
 *   was never in the summary, so it never inflates the per-round line.
 * - `fizzles` = shown lost-target fizzles only.
 * - `brawls`  = witnessed brawl chains (countWitnessedBrawls) — a brawl always
 *   involves a player unit, so all real brawls are witnessed.
 * The conquest economy fields are PUBLIC to the player about their OWN side
 * (their credits, their bases, their living units), so plotting them leaks
 * nothing about the enemy. They are ABSENT in skirmish (the economy section of
 * the dashboard hides on their absence). */
export type RoundRecord = {
  /** The resolved round number (1-indexed) this record summarizes. */
  round: number;
  /** [player, ai] fog-filtered damage dealt this round (same as the recap). */
  damageDealt: [number, number];
  /** Witnessed kills this round (both sides; fog-filtered summary.kills). */
  kills: number;
  /** Shown lost-target fizzles this round. */
  fizzles: number;
  /** Witnessed distinct brawls this round. */
  brawls: number;
  /** CONQUEST ONLY: the player's credits at round end. Absent in skirmish. */
  credits?: number;
  /** CONQUEST ONLY: the player's base count at round end. Absent in skirmish. */
  basesHeld?: number;
  /** CONQUEST ONLY: the player's living unit count at round end. Absent in
   *  skirmish. */
  unitsAlive?: number;
};

/** v1.4: distinct brawls in one round's replay script. The builder emits one
 * slot per brawl EXCHANGE, back-to-back per brawl (same P9 chain rule that
 * compresses follow-up frames): consecutive brawl slots whose strikes carry
 * the same cell + pair are one brawl; any other slot kind breaks the chain. */
export function countWitnessedBrawls(slots: readonly TimelineSlot[]): number {
  let brawls = 0;
  let prevKey: string | null = null;
  for (const slot of slots) {
    if (slot.kind !== 'brawl') {
      prevKey = null;
      continue;
    }
    const s = slot.strikes[0];
    const key = s ? `${s.defenderCell}:${s.attackerId}:${s.defenderId}` : '?';
    if (key !== prevKey) brawls++;
    prevKey = key;
  }
  return brawls;
}

/** v1.5 victory dashboard: build one round's RoundRecord from the fog-filtered
 * replay script + the POST-round game state. PURE — derived entirely from its
 * arguments (no ambient input). The conquest economy fields are populated ONLY
 * when the state carries conquest bookkeeping (game.mode === 'conquest'); in
 * skirmish they are omitted so the dashboard hides the economy section. The
 * player's living unit count and base count are PUBLIC to the player about
 * their own side, so plotting them leaks nothing about the enemy. */
export function makeRoundRecord(
  round: number,
  script: ReplayScript,
  game: GameState | null,
): RoundRecord {
  const base: RoundRecord = {
    round,
    damageDealt: [script.summary.damageDealt[PLAYER_FACTION], script.summary.damageDealt[1]],
    kills: script.summary.kills.length,
    fizzles: script.summary.fizzles,
    brawls: countWitnessedBrawls(script.slots),
  };
  if (game?.mode === 'conquest') {
    base.credits = game.credits?.[PLAYER_FACTION] ?? 0;
    base.basesHeld = game.bases
      ? Object.values(game.bases).filter((owner) => owner === PLAYER_FACTION).length
      : 0;
    base.unitsAlive = Object.values(game.units).filter(
      (u) => u.faction === PLAYER_FACTION && u.count > 0,
    ).length;
  }
  return base;
}

/**
 * v1.1 Feature B (dependent re-validation): after a queue edit/removal, every
 * still-queued order is re-validated against the NEW queue state — a vacancy
 * move whose occupant no longer vacates (move removed, replaced, or looped
 * back) is auto-removed, cascading until stable. DECISION (documented):
 * auto-remove + notice, rather than keeping invalid orders flagged in the
 * order sheet — the resolver would only bounce them anyway, and a queue that
 * is always-valid keeps ghosts honest about what will actually happen.
 * Returns the settled queues and which orders were dropped.
 */
export function settleDependentOrders(
  board: Board,
  game: GameState,
  queues: OrderQueues,
): { queues: OrderQueues; dropped: { unitId: string; kind: OrderKind }[] } {
  const types = loadUnits();
  const units = Object.values(game.units).filter((u) => u.count > 0);
  // E2/E3: owned bases contribute vision in conquest (game.bases is absent in
  // skirmish, so the extra arg is mode-gated by the state shape itself).
  const visible = visibleCells(board, units, PLAYER_FACTION, types, game.bases);
  const known = units.filter((u) => u.faction === PLAYER_FACTION || visible.has(u.cell));
  // E1: re-validate against the player's BELIEVED terrain (dark ⇒ plains),
  // same lens tryQueueOrder used to admit the order in the first place.
  const assumedTerrain = assumedTerrainView(
    board,
    game.discovered?.[PLAYER_FACTION] ?? new Set(),
    visible,
  );
  const dropped: { unitId: string; kind: OrderKind }[] = [];
  let cur = queues;
  for (let pass = 0; pass < 64; pass++) {
    let removedThisPass = false;
    for (const [unitId, uo] of Object.entries(cur)) {
      for (const kind of ['move', 'attack', 'stance'] as const) {
        const order = uo[kind];
        if (!order) continue;
        const verdict = validateOrder(
          {
            board,
            units: known,
            unitTypes: types,
            visible,
            queued: cur[unitId],
            allQueued: cur,
            assumedTerrain,
          },
          order,
        );
        if (!verdict.ok) {
          cur = removeOrder(cur, unitId, kind);
          dropped.push({ unitId, kind });
          removedThisPass = true;
        }
      }
      // FIX C: drop a stale capture order when the unit's planned end cell is
      // no longer a capturable (unowned) base — mirrors the capture-toggle gate
      // in App.tsx (bases[endCell] must be defined and not owned by the player).
      // Only relevant in conquest (game.bases is absent in skirmish).
      if (uo.capture && game.bases) {
        const unit = known.find((u) => u.id === unitId);
        if (unit) {
          const endCell = plannedEndCell(unit, cur[unitId]);
          const baseOwner = game.bases[endCell];
          // Drop when the cell is not a base (undefined) OR owned by the player.
          if (baseOwner === undefined || baseOwner === PLAYER_FACTION) {
            cur = removeOrder(cur, unitId, 'capture');
            dropped.push({ unitId, kind: 'capture' });
            removedThisPass = true;
          }
        }
      }
    }
    if (!removedThisPass) break;
  }
  return { queues: cur, dropped };
}

export type AppState = {
  screen: Screen;
  donorId: string;
  seed: number;
  /** Donor ids whose curated `defaultSeed` has already been auto-applied this
   *  session. selectDonor fills the seed from `entry.defaultSeed` only on a
   *  donor's FIRST selection (e.g. Aruba → 25837); afterwards the player's own
   *  seed stands even if they re-pick the same map. */
  donorDefaultsApplied: ReadonlySet<string>;
  /** E3 (addendum §B): start-screen mode select. Conquest is the default. */
  mode: GameMode;
  /** E3: conquest round limit (off/40/60/80 on the start screen; null=off).
   *  Skirmish ignores it (the resolver keeps its fixed 40). */
  roundLimit: number | null;
  /** v0.7 Item 4: the selected opponent archetype key (start screen). Persisted
   *  into the battle on startBattle; commit() instantiates its planner. */
  archetypeKey: string;
  /** FULL AUTO: faction-0 (P1) bot archetype. In conquest Full Auto, P1 self-
   *  plays its full conquest round (orders + buys) under THIS archetype via
   *  commitAutopilot — the same skill-set the opponent (archetypeKey) has.
   *  Gear-menu selectable; changing it mid-game takes effect next round. */
  p1ArchetypeKey: string;
  /** Unit-render skin (gear menu, top bar): 'icon' flat glyphs · 'anim'
   *  animated infantry sprites · 'watercolor' static faction art (all types).
   *  Persisted to localStorage. */
  unitRenderMode: UnitRenderMode;
  /** FULL AUTO debug/test mode (gear menu → DEBUG section): when true, P1
   *  (faction 0) is planned by the same greedy AI as P2, so the game self-plays
   *  — the App autopilot effects auto-commit each planning phase and auto-close
   *  each summary. Seeded from the legacy ?autopilot=greedy URL flag at store
   *  creation, then runtime-toggleable. NOT persisted (a debug affordance). */
  fullAuto: boolean;
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
  /** v0.9 propose-then-confirm: the un-queued MOVE proposal (see PendingMove).
   * null = no pending proposal. Always for `selectedUnitId` when set. */
  pendingMove: PendingMove | null;
  /** Player faction's queued orders, by unit id (core OrderQueues). */
  orders: OrderQueues;
  /** E3 conquest: the player's queued buys, by base cell (core BuyQueues).
   *  Always {} in skirmish. Cleared on commit (the round spends them). */
  buys: BuyQueues;
  /** v0.6 Ask 2: the active group directive chip (null = none). `modified`
   * flips true on the first individual order edit after a directive fill. */
  directive: DirectiveState;
  /** Bumped by centerOn; the Board pans to `cell` when token changes. */
  focus: { cell: CellId; token: number } | null;
  /** v1.1: transient signal when dependent orders were auto-removed. */
  notice: OrderNotice | null;
  /** v1.1 skirmish log: completed rounds' lines (current round streams from
   * the replay script; it joins this history when the summary closes). */
  battleLog: LoggedRound[];
  /** v1.3 casualty recap: witnessed kills in order of death, battle-long.
   * Appended when a round's summary closes; resets on a new battle. */
  casualties: Casualty[];
  /** v1.4 battle recap: fog-honest battle-long totals (see BattleRecap).
   * Accumulated when each round's summary closes; resets on a new battle. */
  recap: BattleRecap;
  /** v1.5 victory dashboard: one RoundRecord per resolved round (see
   * RoundRecord), appended in closeSummary AFTER the recap accumulation, from
   * the same fog-filtered source. Resets on a new battle. Feeds the game-over
   * dashboard's sparklines (damage arc / kills / economy). */
  roundHistory: RoundRecord[];

  selectDonor: (donorId: string) => void;
  setSeed: (seed: number) => void;
  /** UI layer may use wall-clock entropy (spec §4.3). */
  randomizeSeed: () => void;
  /** E3: start-screen mode + round-limit selects. */
  setMode: (mode: GameMode) => void;
  setRoundLimit: (limit: number | null) => void;
  /** v0.7 Item 4: start-screen opponent archetype select. */
  setArchetype: (key: string) => void;
  /** Gear menu (DEBUG): set the FULL AUTO P1 bot archetype. Takes effect on the
   *  next round's commitAutopilot. */
  setP1Archetype: (key: string) => void;
  /** Gear menu: pick the unit-render skin (icon / anim / watercolor) and
   *  persist the choice to localStorage. */
  setUnitRenderMode: (mode: UnitRenderMode) => void;
  /** Gear menu (DEBUG): set FULL AUTO on/off. ON makes the App autopilot the
   *  loop reactive — P1 auto-commits + summaries auto-close; OFF hands the
   *  player back control mid-game. */
  setFullAuto: (v: boolean) => void;
  /** Convenience flip of fullAuto (menuitemcheckbox onClick). */
  toggleFullAuto: () => void;
  startBattle: () => void;
  exitBattle: () => void;

  selectUnit: (unitId: string | null) => void;
  /** v0.9 propose-then-confirm: set/replace the un-queued MOVE proposal for a
   * unit (first tap on a reachable cell, or re-tap on a different cell). The
   * caller computes the path (via findPath / the same logic queueMoveTo uses);
   * this just records it. Replaces any existing proposal (one per session). */
  proposeMove: (pending: PendingMove) => void;
  /** v0.9: commit the pending MOVE proposal — queue it as a real order via
   * tryQueueOrder and clear the proposal. No-op (returns false) when there is
   * no pending proposal. Returns whether a proposal was committed AND queued
   * (a proposal that fails re-validation is still cleared, but returns false). */
  commitPendingMove: () => boolean;
  /** v0.9: drop the pending MOVE proposal without queuing it (cancel). */
  clearPendingMove: () => void;
  centerOn: (cell: CellId) => void;
  /** Validate against the player's fog-filtered view, then queue (replacing
   * any same-kind order — edit semantics). Returns the validation verdict so
   * the UI can react to rejections. */
  tryQueueOrder: (order: Order) => ValidationResult;
  removeUnitOrder: (unitId: string, kind: OrderKind) => void;
  clearOrders: () => void;
  /** v0.6 Ask 2: bulk-fill ALL units' queues from the ai layer's
   * planDirective (replacing existing orders). No-op until the core agent's
   * planDirective export lands (resolvePlanDirective probe). */
  applyDirective: (kind: DirectiveKind) => void;
  /** E3 conquest: validate (own base, type, committed total ≤ credits) and
   *  queue a buy, REPLACING any buy on the same base (edit semantics). */
  tryQueueBuy: (order: BuyOrder) => BuyValidationResult;
  removeBuyOrder: (baseCell: CellId) => void;
  /** v1.1 internal: surface auto-removed dependent orders as a notice. */
  signalDropped: (dropped: { unitId: string; kind: OrderKind }[]) => void;
  /** v0.8 Task 2.4: arm a capture order for `unitId` (conquest only; always
   *  valid — the resolver decides if the unit actually captures at resolution).
   *  Mirrors tryQueueOrder but skips fog validation (capture has no spatial
   *  constraints at queue time). */
  queueCapture: (unitId: string) => void;
  /** v0.8 Task 2.4: disarm the capture order for `unitId`. */
  removeCapture: (unitId: string) => void;

  // --- game actions (P8) -------------------------------------------------------
  /** Commit the round: player orders (or the override — Full Auto plans faction
   * 0's orders too) + AI planOrders → resolveRound → replay. In conquest,
   * `playerBuysOverride` lets Full Auto supply faction-0's PRODUCTION (P1 buys
   * like a real AI); absent in normal play / skirmish (the player's own queued
   * buys stand). */
  commit: (playerOrdersOverride?: Order[], playerBuysOverride?: BuyOrder[]) => void;
  /** Dev/demo: plan faction 0 through the canonical dispatcher (orders + buys
   * in conquest, under p1ArchetypeKey), then commit — full self-play. */
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
  donorDefaultsApplied: new Set(),
  mode: 'conquest',
  roundLimit: null,
  archetypeKey: defaultArchetypeKey(),
  p1ArchetypeKey: defaultArchetypeKey(),
  unitRenderMode: loadUnitRenderMode(),
  // FULL AUTO seeds from the legacy ?autopilot=greedy URL flag (read once here);
  // the gear-menu toggle owns the value thereafter.
  fullAuto: loadFullAutoFlag(),
  board: null,

  game: null,
  uiPhase: 'planning',
  replay: null,
  // RESOLUTION SLOW-DOWN SLIDER: seed from the persisted choice so test sessions
  // remember the last slow level (defaults to 1× when unset).
  replaySpeed: loadReplaySpeed(),

  selectedUnitId: null,
  pendingMove: null,
  orders: {},
  buys: {},
  directive: null,
  focus: null,
  notice: null,
  battleLog: [],
  casualties: [],
  recap: EMPTY_RECAP,
  roundHistory: [],

  selectDonor: (donorId) =>
    set((s) => {
      const entry = DONOR_ENTRIES.find((e) => e.id === donorId);
      // First pick of a donor that ships a curated seed → adopt its "good
      // layout" (e.g. Aruba → 25837). Re-selecting later leaves the seed alone.
      if (entry?.defaultSeed != null && !s.donorDefaultsApplied.has(donorId)) {
        return {
          donorId,
          seed: entry.defaultSeed,
          donorDefaultsApplied: new Set(s.donorDefaultsApplied).add(donorId),
        };
      }
      return { donorId };
    }),
  setSeed: (seed) => set({ seed: Math.trunc(seed) }),
  randomizeSeed: () => set({ seed: Date.now() % 1_000_000 }),
  setMode: (mode) => set({ mode }),
  setRoundLimit: (roundLimit) => set({ roundLimit }),
  setArchetype: (archetypeKey) => set({ archetypeKey }),
  setP1Archetype: (p1ArchetypeKey) => set({ p1ArchetypeKey }),
  setUnitRenderMode: (mode) => {
    saveUnitRenderMode(mode);
    set({ unitRenderMode: mode });
  },
  setFullAuto: (v) => set({ fullAuto: v }),
  toggleFullAuto: () => set((s) => ({ fullAuto: !s.fullAuto })),

  startBattle: () => {
    const { donorId, seed, mode, roundLimit } = get();
    const board = generateBoard(loadDonor(donorId), seed);
    const types = loadUnits();
    const base = newGame(
      board,
      STANDARD_ARMY,
      types,
      seed,
      mode,
      mode === 'conquest' ? roundLimit : null,
    );
    // E1 (addendum §A): initial discovery = each faction's starting vision
    // union (E2: + owned bases' vision-2 footprints — base.bases is absent in
    // skirmish). newGame is frozen core surface — the store seeds the field.
    const game: GameState = {
      ...base,
      discovered: seedDiscovery(board, Object.values(base.units), types, base.bases),
    };
    set({
      board,
      game,
      screen: 'battle',
      uiPhase: 'planning',
      replay: null,
      selectedUnitId: null,
      pendingMove: null,
      orders: {},
      buys: {},
      directive: null,
      focus: null,
      notice: null,
      battleLog: [],
      casualties: [],
      recap: EMPTY_RECAP,
      roundHistory: [],
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
      pendingMove: null,
      orders: {},
      buys: {},
      directive: null,
      focus: null,
      notice: null,
      battleLog: [],
      casualties: [],
      recap: EMPTY_RECAP,
      roundHistory: [],
    }),

  // --- planning actions --------------------------------------------------------

  // v0.9 propose-then-confirm: selecting a (different) unit, or deselecting,
  // ALWAYS drops any lingering MOVE proposal. The App commits a pending move
  // BEFORE calling selectUnit when switching units (so the proposal isn't lost
  // — see the switch-unit transition in App.onUnitTap/onCellTap); by the time
  // selectUnit runs the proposal has already been queued, so clearing here is a
  // safety net that keeps the invariant "pendingMove is always for the current
  // selection" true even on a raw selectUnit call (e.g. dock-chip select).
  selectUnit: (unitId) =>
    set((s) => (s.pendingMove ? { selectedUnitId: unitId, pendingMove: null } : { selectedUnitId: unitId })),

  proposeMove: (pending) => set({ pendingMove: pending }),

  commitPendingMove: () => {
    const pending = get().pendingMove;
    if (!pending) return false;
    // Clear the proposal FIRST so a re-entrant render never sees both the
    // proposal ghost and the queued ghost for the same unit.
    set({ pendingMove: null });
    const verdict = get().tryQueueOrder({
      kind: 'move',
      unitId: pending.unitId,
      path: pending.path,
    });
    if (!verdict.ok) {
      // The proposal was rejected (e.g. destination now friendly-occupied).
      // Surface a notice so the player knows the move wasn't placed, mirroring
      // the settled-dependent feedback that signalDropped() produces.
      const { game } = get();
      const types = loadUnits();
      const u = game?.units[pending.unitId];
      const name = (u && types[u.type]?.name) ?? pending.unitId;
      set((s) => ({
        notice: {
          text: `${name} move cancelled — destination no longer reachable`,
          token: (s.notice?.token ?? 0) + 1,
        },
      }));
    }
    return verdict.ok;
  },

  clearPendingMove: () => set((s) => (s.pendingMove ? { pendingMove: null } : s)),

  centerOn: (cell) => set((s) => ({ focus: { cell, token: (s.focus?.token ?? 0) + 1 } })),

  tryQueueOrder: (order) => {
    const { board, game, orders } = get();
    if (!board || !game) return { ok: false, reason: 'unknown-unit' };
    const types = loadUnits();
    const units = Object.values(game.units).filter((u) => u.count > 0);
    const visible = visibleCells(board, units, PLAYER_FACTION, types, game.bases);
    // The player's KNOWN units: own + visible enemies (spec §7 planning fog).
    const known = units.filter((u) => u.faction === PLAYER_FACTION || visible.has(u.cell));
    const queued: UnitOrders | undefined = orders[order.unitId];
    // E1: moves validate against BELIEVED terrain — optimistic plains for
    // dark cells, remembered truth for memory (the resolver re-checks truth).
    const verdict = validateOrder(
      {
        board,
        units: known,
        unitTypes: types,
        visible,
        queued,
        allQueued: orders,
        assumedTerrain: assumedTerrainView(
          board,
          game.discovered?.[PLAYER_FACTION] ?? new Set(),
          visible,
        ),
      },
      order,
    );
    if (verdict.ok) {
      // v1.1: a REPLACED move can strand dependents (e.g. a vacancy move onto
      // this unit's cell) — settle the whole queue after the edit.
      const settled = settleDependentOrders(board, game, queueOrder(orders, order));
      set((s) => ({
        orders: settled.queues,
        // v0.6 Ask 2: an individual edit on top of a directive fill → the
        // chip reads "modified" (the bulk plan no longer holds verbatim).
        directive: s.directive ? { ...s.directive, modified: true } : null,
      }));
      get().signalDropped(settled.dropped);
    }
    return verdict;
  },

  removeUnitOrder: (unitId, kind) => {
    const { board, game, orders } = get();
    const removed = removeOrder(orders, unitId, kind);
    const markModified = (s: AppState): DirectiveState =>
      s.directive ? { ...s.directive, modified: true } : null;
    if (!board || !game) {
      set((s) => ({ orders: removed, directive: markModified(s) }));
      return;
    }
    const settled = settleDependentOrders(board, game, removed);
    set((s) => ({ orders: settled.queues, directive: markModified(s) }));
    get().signalDropped(settled.dropped);
  },

  clearOrders: () => set({ orders: {}, directive: null, notice: null, pendingMove: null }),

  // v0.6 Ask 2: bulk queue fill. planDirective is the ai layer's contract
  // (fog-fair: it plans over the player's own FactionView); the returned
  // orders REPLACE the whole queue, then settle through the same dependent
  // re-validation every manual edit uses, so ghosts stay honest even if a
  // generated order doesn't hold against the player's believed terrain.
  applyDirective: (kind) => {
    const { board, game, uiPhase } = get();
    if (!board || !game || game.outcome || uiPhase !== 'planning') return;
    const planDirective = resolvePlanDirective();
    if (!planDirective) return; // core-agent export not landed yet — no-op
    const types = loadUnits();
    const view = buildFactionView(game.board, game, PLAYER_FACTION, types);
    const planned = planDirective(
      kind,
      view,
      createRng(plannerSeed(game.rngSeed ^ DIRECTIVE_SALT[kind], game.round, PLAYER_FACTION)),
    );
    let queues: OrderQueues = {};
    for (const order of planned) queues = queueOrder(queues, order);
    const settled = settleDependentOrders(board, game, queues);
    set({
      orders: settled.queues,
      directive: { kind, modified: false },
      selectedUnitId: null,
      pendingMove: null,
      notice: null,
    });
  },

  // E3 conquest production (addendum §B.4): committed blind like all orders.
  // validateBuy re-checks own-base + total committed cost ≤ current credits
  // (the same-base entry frees its cost — replace semantics); the resolver
  // re-validates everything at Phase E and fails the buy with an event.
  tryQueueBuy: (order) => {
    const { game, buys } = get();
    if (!game || game.mode !== 'conquest' || !game.bases || !game.credits) {
      return { ok: false, reason: 'unknown-base' };
    }
    const verdict = validateBuy(
      {
        faction: PLAYER_FACTION,
        bases: game.bases,
        credits: game.credits[PLAYER_FACTION],
        unitTypes: loadUnits(),
        queued: buys,
      },
      order,
    );
    if (verdict.ok) set({ buys: queueBuy(buys, order) });
    return verdict;
  },

  removeBuyOrder: (baseCell) => set((s) => ({ buys: removeBuy(s.buys, baseCell) })),

  /** v1.1 internal: turn auto-removed dependents into the toast-level notice. */
  signalDropped: (dropped) => {
    if (dropped.length === 0) return;
    const { game } = get();
    const types = loadUnits();
    const name = (unitId: string): string => {
      const u = game?.units[unitId];
      return (u && types[u.type]?.name) ?? unitId;
    };
    const text = dropped
      .map((d) => `${name(d.unitId)} ${d.kind} order removed — its plan no longer holds`)
      .join(' · ');
    set((s) => ({ notice: { text, token: (s.notice?.token ?? 0) + 1 } }));
  },

  // --- v0.8 Task 2.4: capture toggle actions ------------------------------------

  queueCapture: (unitId) => {
    // capture validation is always OK (§orders.ts case 'capture'); queue it
    // directly through the core primitive — same immutable update pattern as
    // queueOrder() callers above. No dependency re-settlement needed: capture
    // has no path/vacancy dependencies (the resolver checks legality).
    set((s) => ({
      orders: queueOrder(s.orders, { kind: 'capture', unitId }),
      directive: s.directive ? { ...s.directive, modified: true } : null,
    }));
  },

  removeCapture: (unitId) => {
    set((s) => ({
      orders: removeOrder(s.orders, unitId, 'capture'),
      directive: s.directive ? { ...s.directive, modified: true } : null,
    }));
  },

  // --- game actions (P8) ---------------------------------------------------------

  commit: (playerOrdersOverride, playerBuysOverride) => {
    // v0.9 fix: flush a dangling pending-move PROPOSAL into orders before
    // resolving. Every other path (Enter, tap elsewhere, switch unit) commits
    // it, but the COMMIT button calls commit() directly — so a move the player
    // set up (first tap) but did not second tap / Enter was silently dropped,
    // which reads as "I cannot move my units". Skipped when autopilot supplies
    // its own orders override.
    if (!playerOrdersOverride && get().uiPhase === 'planning' && get().pendingMove) {
      get().commitPendingMove();
    }
    const { game, orders, buys, uiPhase, archetypeKey } = get();
    if (!game || game.outcome || uiPhase !== 'planning') return;
    const types = loadUnits();
    const playerOrders = playerOrdersOverride ?? flattenOrders(orders);
    // FULL AUTO conquest: the autopilot plans faction-0 PRODUCTION too and
    // supplies it here, so P1 builds units like a real AI. In normal play (and
    // skirmish) the override is absent → the player's own queued buys stand.
    const playerBuys = playerBuysOverride ?? flattenBuys(buys);
    const conquest = game.mode === 'conquest';

    // The AI plans when the player commits (spec §2.1, solo flow) — through
    // its own fog-filtered FactionView only (§8.1 symmetric honesty).
    // planRound is the canonical dispatcher: in conquest it routes to
    // planConquest → {orders, buys} (capture objectives + production); in
    // skirmish it returns planOrders with no buys. Routing through it here is
    // what makes the AI actually build units in real games — the acceptance
    // suite exercised planConquest directly, so this seam went uncaught.
    // v0.7 Item 4: the opponent's planner is the SELECTED archetype's (falls
    // back to greedyPlanner if the ai registry hasn't landed / key unknown).
    // planRound stays the dispatcher — same code path the conquest-buy fix
    // established (conquest → planConquest, skirmish → planOrders).
    const aiView = buildFactionView(game.board, game, 1, types);
    const aiPlan = ai.planRound(
      archetypePlanner(archetypeKey),
      aiView,
      createRng(plannerSeed(game.rngSeed, game.round, 1)),
    );
    const aiOrders = aiPlan.orders;
    const aiBuys: BuyOrder[] = conquest ? aiPlan.buys : [];

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
      conquest ? { 0: playerBuys, 1: aiBuys } : undefined,
    );
    const script = buildReplay(
      game.board,
      baseUnits,
      events,
      types,
      PLAYER_FACTION,
      game.discovered?.[PLAYER_FACTION],
      // E3: pre-round ownership + the player's credits — the replay flips
      // bases and ticks the HUD exactly when it shows the cause.
      conquest && game.bases && game.credits
        ? { bases: game.bases, credits: game.credits[PLAYER_FACTION] }
        : undefined,
    );

    // E1 discovery accrual (addendum §A): the player's set ran frame-by-frame
    // through the replay build; both factions then take the NEW round-start
    // vision (E2: owned bases included). Accumulating only — never shrinks.
    const survivors = Object.values(state.units).filter((u) => u.count > 0);
    const discovered: Record<FactionId, ReadonlySet<CellId>> = {
      0: accumulateDiscovery(
        script.discovered,
        visibleCells(game.board, survivors, 0, types, state.bases),
      ),
      1: accumulateDiscovery(
        game.discovered?.[1],
        visibleCells(game.board, survivors, 1, types, state.bases),
      ),
    };

    set({
      game: { ...state, discovered },
      replay: { script, round: game.round },
      uiPhase: 'replay',
      orders: {},
      buys: {},
      directive: null,
      selectedUnitId: null,
      pendingMove: null,
      focus: null,
      notice: null,
    });
  },

  commitAutopilot: () => {
    const { game, uiPhase, p1ArchetypeKey } = get();
    if (!game || game.outcome || uiPhase !== 'planning') return;
    const types = loadUnits();
    const conquest = game.mode === 'conquest';
    // Full Auto fix: plan faction-0 through the CANONICAL dispatcher, exactly
    // like the opponent in commit(). planRound routes conquest views to
    // planConquest → {orders, buys} (capture objectives + PRODUCTION), and
    // skirmish views to planOrders → {orders, buys: []}. Previously this called
    // greedyPlanner.planOrders directly (moves/attacks only) and the player's
    // buys came from the empty store.buys, so P1 NEVER produced units. Now P1
    // self-plays its full conquest round under its OWN archetype (p1Archetype-
    // Key, gear-menu selectable) — the same skill-set the opponent has.
    const view = buildFactionView(game.board, game, PLAYER_FACTION, types);
    const plan = ai.planRound(
      archetypePlanner(p1ArchetypeKey),
      view,
      createRng(plannerSeed(game.rngSeed, game.round, PLAYER_FACTION)),
    );
    // In conquest, hand P1's buys to commit so it actually builds; in skirmish
    // there are no buys (planRound → planOrders) and the override stays absent,
    // leaving skirmish Full Auto behavior unchanged (no production).
    get().commit(plan.orders, conquest ? plan.buys : undefined);
  },

  // RESOLUTION SLOW-DOWN SLIDER: the slider/presets set a NUMBER (clamped to
  // range); the skip button sets the transient 'skip'. Numeric choices persist
  // (so a test session remembers the slow level); 'skip' is an action, never
  // persisted — the remembered numeric speed stands behind it.
  setReplaySpeed: (replaySpeed) => {
    if (typeof replaySpeed === 'number') {
      const clamped = clampReplaySpeed(replaySpeed);
      saveReplaySpeed(clamped);
      set({ replaySpeed: clamped });
    } else {
      set({ replaySpeed });
    }
  },

  finishReplay: () => {
    if (get().uiPhase === 'replay') set({ uiPhase: 'summary' });
  },

  closeSummary: () =>
    set((s) => {
      if (s.uiPhase !== 'summary') return s;
      // v1.3 Tweak C: the round's WITNESSED kills (fog-filtered summary —
      // mist kills were never in it) join the battle-long casualty recap.
      const casualties = s.replay
        ? [
            ...s.casualties,
            ...s.replay.script.summary.kills.map((k) => ({ type: k.type, faction: k.faction })),
          ]
        : s.casualties;
      // v1.4 battle recap: accumulate the round's fog-filtered totals
      // alongside the casualties (same source, same moment — see BattleRecap
      // for the per-field fog-honesty argument).
      const recap = s.replay
        ? {
            rounds: s.replay.round,
            dealt: s.recap.dealt + s.replay.script.summary.damageDealt[PLAYER_FACTION],
            taken: s.recap.taken + s.replay.script.summary.damageDealt[1],
            fizzles: s.recap.fizzles + s.replay.script.summary.fizzles,
            brawls: s.recap.brawls + countWitnessedBrawls(s.replay.script.slots),
            // E3 conquest: own successful spawns' cost (0 in skirmish).
            spent: s.recap.spent + (s.replay.script.summary.creditsSpent ?? 0),
          }
        : s.recap;
      // v1.5 victory dashboard: append this round's RoundRecord AFTER the recap
      // accumulation, from the SAME fog-filtered replay summary (witnessed
      // kills/damage/fizzles/brawls). Conquest economy fields come from the
      // POST-round game state available here (s.game has already advanced to the
      // resolved state — its credits/bases/units are the round-end picture the
      // player owns about their own side). Absent in skirmish.
      const roundHistory = s.replay
        ? [...s.roundHistory, makeRoundRecord(s.replay.round, s.replay.script, s.game)]
        : s.roundHistory;
      if (s.game?.outcome) return { ...s, uiPhase: 'over' as const, casualties, recap, roundHistory };
      // Back to planning; the replay script is spent — its skirmish-log lines
      // join the battle log history (the log persists across rounds, §v1.1 D).
      const battleLog = s.replay
        ? [...s.battleLog, { round: s.replay.round, entries: s.replay.script.log }]
        : s.battleLog;
      return { ...s, uiPhase: 'planning' as const, replay: null, battleLog, casualties, recap, roundHistory };
    }),

  rematch: (seed) => {
    set({ seed: Math.trunc(seed) });
    get().startBattle();
  },
}));

// Dev-only hook (vite strips this from production builds): lets Playwright
// verification scripts drive precise scenarios. Not part of the app surface.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__appStore = useAppStore;
}
