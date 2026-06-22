// replay.ts — P8 replay-script builder. PURE function over (board, pre-round
// units, event log) — lives in state/ but takes no ambient input, so the
// fog-filtering logic is unit-testable without a DOM.
//
// THE SIGNATURE RULE (spec §7, replay fog): playback renders through the
// PLAYER's fog, recomputed as units move during playback. Concretely, this
// module simulates the round event-by-event and, at each event, asks "what
// can the player's living units see RIGHT NOW?" (their own positions/counts
// at this instant — vision moves with the player's own replayed moves and
// shrinks when a player unit dies):
//
//   • AI move wholly outside player vision  → applied silently: no frame, no
//     timeline slot (the timeline must not leak that something happened).
//   • AI move partially visible             → shown; the token is rendered
//     only while its current cell is visible, so it emerges from / sinks
//     into the mist cell-by-cell.
//   • Strike whose DEFENDER the player can see but whose attacker cell is
//     fogged → "fire from the mist": impact marker + damage floater on the
//     defender, attacker id/cell/type WITHHELD (null), no arc, and the
//     timeline slot shows a mist glyph instead of the attacker's.
//   • Strike by the player's own units      → always fully shown (the player
//     watched their own unit fire; artillery can legally hit beyond vision).
//   • kill of a unit the player cannot see and that no shown strike just
//     killed → not shown (the player learns nothing).
//
// Gang-up itemization passes through class+weight only (§9.4 "itemized by
// class") — prior-attacker CELLS are not surfaced, so a mist attacker's
// position can't leak through a later breakdown modal.
//
// Output is a flat list of fixed-duration "frames" (move steps ~250 ms/cell,
// volleys ~800 ms) plus a timeline of visible slots; the playback driver in
// the UI just walks frames on a timer (durations divide by the speed factor).
//
// P9 pacing: repeated exchanges of the SAME brawl (same cell + pair) compress
// to ~350 ms after the first, and their damage floaters show RUNNING TOTALS
// (−5, −9, −12 …) so the sum stays readable instead of stacking pills.
//
// P9 camera: each frame carries `focus` — the cells the camera should keep
// in view (mover's current cell; attacker+defender of a volley; just the
// defender when the source is withheld, so auto-follow can't leak a mist
// attacker's position; the brawl cell). The Board pans/zooms to frame them.

// E3 (conquest addendum §B) — BLIND-BUY FILTERING lives HERE, inside the same
// fog-honest walk: capture / income / spawn / spawn-failed events surface for
// the player's own faction ALWAYS; for the enemy ONLY when the affected cell
// is live-visible at that replay instant (vision recomputed event-by-event,
// owned bases contributing BASE_VISION via the simulated ownership record).
// Enemy income has no affected cell and is therefore never shown — enemy
// credits stay secret. Frames in conquest mode carry the base-ownership
// record and the player's credits AS OF that frame, so the board tint flips
// and the HUD ticks exactly when the replay shows the cause.

import type { Board, CellId } from '../board/types';
import { calloutTerm, type Callout } from './callouts';
import { visibleCells } from '../core/fog';
import type {
  AttackBreakdown,
  FactionId,
  ResolutionEvent,
  SpawnFailReason,
  UnitInstance,
  UnitType,
} from '../core/types';
import {
  classifyBand,
  bandWave,
  layoutPhases,
  projectileKind,
  WAVE_B_COUNTER_OFFSET,
  type CombatBand,
  type PhaseDurations,
  type PhaseLayout,
  type Projectile,
  type Wave,
} from './replay-timing';

export type StrikeKind = 'attack' | 'counter' | 'brawl' | 'brawl-return';

/** One half of an exchange, ready for the §9.4 breakdown modal. Attacker
 *  fields are null when the source is withheld (fire from the mist). */
export type Strike = {
  kind: StrikeKind;
  attackerId: string | null;
  attackerType: string | null;
  attackerCell: CellId | null;
  attackerFaction: FactionId | null;
  defenderId: string;
  defenderType: string;
  defenderCell: CellId;
  defenderFaction: FactionId;
  damage: number;
  fromMist: boolean;
  breakdown: AttackBreakdown;
};

export type TimelineSlot = {
  kind: 'move' | 'volley' | 'brawl' | 'fizzle' | 'capture' | 'spawn' | 'promotion' | 'interrupt';
  /** Unit-type key for the slot glyph; null = mist (source withheld). */
  actorType: string | null;
  actorFaction: FactionId | null;
  /** Tap target for the breakdown modal (empty for moves/fizzles). */
  strikes: Strike[];
};

/** R5: a damage floater's category, derived PURELY from the resolved event:
 *  - 'kill'    — the lethal blow (the strike that brings the target to 0 count)
 *  - 'counter' — a counter event OR a brawl-return strike (the answering blow)
 *  - 'taken'   — any other (normal) damage
 *  Drives the floater's colour (taken = INK, counter = GREY, kill = GOLD) and is
 *  orthogonal to `mist` (fog) — a mist floater carries an honest category but the
 *  renderer keeps its fog-grey treatment so the hidden attacker never leaks. The
 *  fizzle / "no target" / "build failed" floaters carry no damage and default to
 *  'taken' (they are styled as their own non-damage labels, not by category). */
export type FloaterCategory = 'taken' | 'counter' | 'kill';

export type Floater = {
  id: string;
  cell: CellId;
  text: string;
  /** Source withheld — render the impact marker, grey pill. */
  mist: boolean;
  /** R5: category-colour bucket (see FloaterCategory). */
  category: FloaterCategory;
  /** Timeline slot this floater belongs to (breakdown modal tap target). */
  slot: number;
};

/** v1.3 Tweak B — a move's origin trail: the cells the player SAW the mover
 *  occupy, origin first. Built inside the same fog-filtered walk as the
 *  frames (a step the player never saw is simply absent), so the dotted line
 *  can never trace a path through the mist. One trail per move slot; frames
 *  carry it while the move animates, and the UI lets it linger/fade after. */
export type TrailFx = {
  id: string;
  faction: FactionId;
  /** Witnessed path cells, origin first (≥2 cells or the trail is dropped). */
  path: CellId[];
};

export type ReplayFrame = {
  /** ms at 1× speed. */
  duration: number;
  /** Active timeline slot (-1 for the establishing frame). */
  slot: number;
  /** Fog-filtered render set: own units always, AI units only on visible
   *  cells at this instant. Positions are mid-move for the moving unit. */
  units: UnitInstance[];
  /** Cells NOT visible to the player right now (Board `fog` prop shape). */
  fog: ReadonlySet<CellId>;
  /** E1 discovery (addendum §A): cells the player has EVER seen, as of this
   *  frame — accumulates frame-by-frame as own units move, never shrinks.
   *  Board tiers: fog ∧ ¬discovered = dark, fog ∧ discovered = memory. */
  discovered: ReadonlySet<CellId>;
  /** E1 ignition delta: cells that turned dark → live ON this frame (their
   *  first time ever inside the player's vision) — the UI soft-ignites them
   *  (~0.4 s). Ascending cell ids. live → memory needs no delta: it falls
   *  out of `fog`+`discovered` as the wake closes behind the advance. */
  ignite: CellId[];
  arcs: { from: CellId; to: CellId; faction: FactionId }[];
  floaters: Floater[];
  /** Brawl clash burst cells. */
  bursts: CellId[];
  /** Units fading out this frame (snapshot at death). R6: the dissolve no longer
   *  rides the kill frame — it is DEFERRED to the dedicated SETTLE beat, so this
   *  is non-empty ONLY on the `settle` frame (all the round's doomed units fall
   *  together there, including brawl/crossfire mutual deaths). */
  kills: UnitInstance[];
  /** R6 (DEFERRED DISSOLVE): units in the DOOMED visual HOLD this frame —
   *  snapshots (count already 0) of units killed during the combat waves that
   *  have NOT yet dissolved. They render greyed toward grey with a small smoke
   *  wisp / flicker / hairline-crack and a DEATH GLYPH replacing the count badge
   *  (never a "0"). A doomed unit persists (held) through every remaining wave
   *  frame after its death, then dissolves once — in the SETTLE beat (`kills`).
   *  Posthumous is OFF in this model: this is purely the deferred visual FALL,
   *  not a deferred action — a doomed unit never acts. Empty on non-combat /
   *  pre-death / post-SETTLE frames. */
  doomed?: UnitInstance[];
  /** R6 (SETTLE): this is the dedicated SETTLE beat appended after the combat
   *  waves — the first time the script carries a real SETTLE frame. ALL the
   *  round's doomed units DISSOLVE here (collapse + fade, the existing DeathFx
   *  motion), the spotlight is released so the board RESATURATES as a visible
   *  beat (fixing the R2 caveat where a combat-final round only resaturated at
   *  the planning transition), and the income/upkeep LEDGER ticks play AFTER it.
   *  Its duration is wired from REPLAY_PHASE_DURATIONS.SETTLE. Absent on every
   *  other frame; a combat-less round carries no SETTLE beat. */
  settle?: boolean;
  /** E3 conquest: units materializing this frame (Phase E spawns the player
   *  may see). The unit is withheld from `units` on its spawn frame so the
   *  fx layer alone draws it (fade/scale in); it joins `units` next frame. */
  spawns: UnitInstance[];
  /** E3 conquest: bases flipping THIS frame (claim FX). v0.6: when the
   *  capture CONSUMED the capturing unit (core `unitConsumed` rule), its
   *  snapshot rides along so the fx layer can dissolve the token INTO the
   *  flag — a claim, not a death (it still lands in summary.kills). */
  captures: { cell: CellId; to: FactionId; consumed?: UnitInstance }[];
  /** v0.8 veterancy: units that ranked up this frame (fog-filtered). */
  promotions?: Array<{ cell: CellId; faction: FactionId; rank: number }>;
  /** Forced-crossing combat (addendum 2026-06-21 §5): "path interrupted!"
   *  signs at crossing cells the player witnessed this frame. Each rides just
   *  before the ensuing Phase A.5 brawl FX. Fog-gated exactly like the other
   *  spatial beats — a crossing in the dark surfaces no sign (it stays secret,
   *  like an enemy brawl the player cannot see). Empty by default. */
  signs?: Array<{ cell: CellId; text: string }>;
  /** Feature A (callouts §2): transient board-anchored combat callouts fired
   *  this frame — a military-font pop-up at each event's cell (crossing /
   *  no-target / capture / kill), the flavor term chosen deterministically by
   *  FNV hash of a stable per-event key (so scrub/replay show the SAME word).
   *  Fog-gated exactly like the other spatial beats: a callout never fires for
   *  an event the player could not witness (a mist kill surfaces nothing). The
   *  path-interrupted CrossSign migrated INTO this (the callout is now the
   *  sign). Empty by default. */
  callouts?: Callout[];
  /** v1.3: active movement origin trails (fog-filtered, see TrailFx). */
  trails: TrailFx[];
  /** Cells the camera should keep in view this frame (auto-follow, P9).
   *  Empty = leave the view alone. Never contains a withheld mist source. */
  focus: CellId[];
  /** E3 conquest only: base ownership AS OF this frame — captures already
   *  shown have flipped, later ones have not. Absent in skirmish. */
  bases?: Record<CellId, FactionId | null>;
  /** E3 conquest only: the player's credits as of this frame (income and
   *  spawn events tick it via creditsAfter). Absent in skirmish. */
  credits?: number;
  /** R1 (TEMPO BACKBONE): the presentation range-band WAVE this combat frame
   *  plays in — 'A' for ranged/artillery (dilated), 'B' for melee/brawl
   *  (quick). Absent on non-combat frames (move/capture/income/etc.). The
   *  builder regroups combat frames so every WAVE_A frame precedes every
   *  WAVE_B frame in a round (no melee impact before all ranged impacts). */
  wave?: Wave;
  /** R1: the finer range-band of this combat frame's leading strike
   *  (artillery | ranged | melee), derived from existing data without changing
   *  any resolved value. Absent on non-combat frames. */
  band?: CombatBand;
  /** R4 (PROJECTILE + ATTACK MOTION): the attack-motion primitives for this
   *  combat frame's SHOWN strikes — crawling tracers / arcing shells (WAVE_A) or
   *  melee stabs (WAVE_B). All WAVE_A projectiles of a beat share ONE dilated
   *  envelope (no per-unit sequencing); WAVE_B counters carry a ~75 ms crossfire
   *  delay so an exchange reads as two motions. Mist strikes withhold the source
   *  → no projectile (the impact alone shows). Empty on non-combat frames. */
  projectiles?: Projectile[];
  /** R4: screen-shake magnitude (px at 1×) for this combat frame — scales with
   *  the total damage landing this beat; artillery gets the biggest shake of the
   *  set. 0/absent on non-combat frames. The App nudges the board container. */
  shake?: number;
};

export type RoundSummary = {
  /** Shown kills only (snapshot at death). */
  kills: { id: string; type: string; faction: FactionId }[];
  /** Damage dealt by faction [player, ai], from shown strikes. */
  damageDealt: [number, number];
  /** Shown lost-target fizzles. */
  fizzles: number;
  /** E3 conquest: credits the PLAYER spent this round (successful spawns
   *  only — failed buys never deduct). Absent/0 in skirmish. */
  creditsSpent?: number;
};

// --- v1.1 skirmish log (Feature D) ----------------------------------------------
// Human-readable battle-log lines derived HERE, inside the same fog-filtered
// simulation that builds the frames — never from the raw event log. A line is
// only emitted for events the frames actually show, so unseen moves/kills
// never appear and fromMist strikes carry no attacker name/cell.

/** One colored fragment of a log line. `f`: faction tint, or 'mist'. */
export type LogSeg = { t: string; f?: FactionId | 'mist' };

export type ReplayLogEntry = {
  /** Append this line when playback reaches this frame index. */
  atFrame: number;
  segs: LogSeg[];
};

/** R2 (SPOTLIGHT): the round's combatant set — the cells and unit ids the
 *  player WITNESSES taking part in this round's combat (attackers, defenders,
 *  brawl participants). Fog-respecting: only strikes the script actually shows
 *  contribute, and a mist strike (attacker withheld) surfaces only its DEFENDER
 *  cell/id — the firing position never leaks. During replay the spotlight keeps
 *  these full-colour + ringed while every non-combatant tile/unit desaturates
 *  and dims; SETTLE/end resaturates. Computed ONCE per round (one spotlight for
 *  the whole turn, never re-spotlit per wave). PURE — no resolved value. */
export type Combatants = {
  /** Cells involved in shown combat (attacker + defender cells, brawl cells). */
  cells: ReadonlySet<CellId>;
  /** Unit ids involved in shown combat (attackers, defenders, brawlers). */
  units: ReadonlySet<string>;
};

export type ReplayScript = {
  slots: TimelineSlot[];
  frames: ReplayFrame[];
  summary: RoundSummary;
  /** v1.1 skirmish-log lines, fog-filtered, in playback order. */
  log: ReplayLogEntry[];
  /** E1: the player's accumulated discovery at playback end (initial set ∪
   *  every frame's vision) — the store folds this into GameState.discovered. */
  discovered: ReadonlySet<CellId>;
  /** R1 (TEMPO BACKBONE): the laid-out combat phase windows (SPOTLIGHT → HOLD
   *  → WAVE_A → INTERLUDE → WAVE_B → SETTLE) for this round's playback. The
   *  transport maps wave-tagged combat frames onto WAVE_A / WAVE_B; the 2:1
   *  WAVE_A≈2×WAVE_B tempo contrast is the load-bearing cue. */
  phases: PhaseLayout;
  /** R2 (SPOTLIGHT): the round's witnessed combatant set (see Combatants). One
   *  pass for the whole turn — the spotlight engages on replay start and
   *  resaturates in SETTLE / at replay end. */
  combatants: Combatants;
};

const MOVE_STEP_MS = 160;
const VOLLEY_MS = 520;
/** Follow-up exchanges of the SAME brawl compress (P9 pacing). */
const BRAWL_FOLLOWUP_MS = 240;
const FIZZLE_MS = 320;
const ESTABLISH_MS = 300;
/** E3 conquest: capture flag swap / spawn materialization / income tick. */
const CAPTURE_MS = 700;
const SPAWN_MS = 700;
const INCOME_MS = 400;
const PROMOTE_MS = 450;
/** Forced-crossing "path interrupted!" sign — a brief announce beat before the
 *  ensuing brawl FX (addendum 2026-06-21 §5). */
const SIGN_MS = 450;

// --- R4 (screen-shake) -------------------------------------------------------
// Shake magnitude (px at 1×) scales with the total damage landing on the beat.
// Artillery is the BIGGEST shake of the set (source spec §8: "biggest shake");
// ranged a sharp small punch; melee a light nudge. PURE — derived from the
// shown strikes' damage + band, no resolved value touched. The App applies it
// to the board container; reduced-motion drops it.
const SHAKE_MAX = 14; // px ceiling so the board never lurches off-screen
/** Per-band scale on √damage — artillery > ranged > melee. */
const SHAKE_BAND_SCALE: Record<CombatBand, number> = {
  artillery: 2.4,
  ranged: 1.0,
  melee: 1.3,
};

/** R4 (PURE, exported for tests): the screen-shake magnitude (px at 1×) for a
 *  combat beat — `√(totalDamage)` × the band's scale, clamped to SHAKE_MAX.
 *  Monotonic in damage (more damage ⇒ a bigger shake) and ordered by band
 *  (artillery is the biggest of the set at equal damage). 0 for no damage. */
export function shakeMagnitude(totalDamage: number, band: CombatBand): number {
  if (totalDamage <= 0) return 0;
  const m = Math.sqrt(totalDamage) * SHAKE_BAND_SCALE[band];
  return Math.min(SHAKE_MAX, m);
}

/** E3: what buildReplay needs to simulate conquest fog + the credits HUD —
 *  the round-START picture (the resolver's events advance it). */
export type ConquestReplayCtx = {
  /** Base ownership entering the round (pre-capture). */
  bases: Readonly<Record<CellId, FactionId | null>>;
  /** The PLAYER's credits entering the round. */
  credits: number;
};

export function buildReplay(
  board: Board,
  baseUnits: readonly UnitInstance[],
  events: readonly ResolutionEvent[],
  unitTypes: Readonly<Record<string, UnitType>>,
  player: FactionId,
  /** E1: the player's discovery set entering the round (GameState.discovered).
   *  Absent ⇒ empty — everything outside the establishing vision is dark. */
  discoveredAtStart?: ReadonlySet<CellId>,
  /** E3: pass in conquest mode only — enables base vision, ownership frames,
   *  the credits feed, and the §B.4 blind-buy event filtering. */
  conquest?: ConquestReplayCtx,
  /** R1 (TEMPO BACKBONE): override any phase-window duration (e.g. a global
   *  fast-forward). Defaults to the source-spec §4 values; keep WAVE_A≈2×WAVE_B
   *  if you retune. Affects only the exposed phase layout — frame durations are
   *  the existing per-beat constants, divided by speed in the transport. */
  timing?: Partial<PhaseDurations>,
): ReplayScript {
  // R1: the laid-out combat phase windows for this round (presentation only).
  const phases = layoutPhases(timing);
  // --- simulation state ------------------------------------------------------
  const sim = new Map<string, UnitInstance>(
    baseUnits.map((u) => [u.id, { ...u, attackedFrom: [] }]),
  );
  // E3 conquest sim: ownership flips on capture events, the player's credits
  // tick on own income/spawn events. Null in skirmish — zero behavior change.
  const cq: { bases: Record<CellId, FactionId | null>; credits: number } | null = conquest
    ? { bases: { ...conquest.bases }, credits: conquest.credits }
    : null;
  const living = (): UnitInstance[] => [...sim.values()].filter((u) => u.count > 0);
  const vision = (): Set<CellId> =>
    visibleCells(board, living(), player, unitTypes, cq?.bases);
  const fogOf = (vis: ReadonlySet<CellId>): Set<CellId> => {
    const fog = new Set<CellId>();
    for (const id of board.cells.keys()) if (!vis.has(id)) fog.add(id);
    return fog;
  };
  // E1 discovery: accumulates across frames; each frame's fog fields come
  // from ONE place so discovery and ignition can never drift apart. E3 rides
  // the same chokepoint: every frame snapshots ownership + credits here.
  let disc: ReadonlySet<CellId> = new Set(discoveredAtStart);
  const fogFields = (
    vis: ReadonlySet<CellId>,
  ): Pick<ReplayFrame, 'fog' | 'discovered' | 'ignite'> &
    Partial<Pick<ReplayFrame, 'bases' | 'credits'>> => {
    const ignite: CellId[] = [];
    for (const c of vis) if (!disc.has(c)) ignite.push(c);
    if (ignite.length > 0) {
      ignite.sort((a, b) => a - b);
      const next = new Set(disc);
      for (const c of ignite) next.add(c);
      disc = next;
    }
    return {
      fog: fogOf(vis),
      discovered: disc,
      ignite,
      ...(cq ? { bases: { ...cq.bases }, credits: cq.credits } : {}),
    };
  };
  /** The player can "see" a unit: own units always, others by cell fog. */
  const seen = (faction: FactionId, cell: CellId, vis: ReadonlySet<CellId>): boolean =>
    faction === player || vis.has(cell);
  const renderUnits = (vis: ReadonlySet<CellId>): UnitInstance[] =>
    living()
      .filter((u) => seen(u.faction, u.cell, vis))
      .map((u) => ({ ...u, attackedFrom: [] }));

  const slots: TimelineSlot[] = [];
  const frames: ReplayFrame[] = [];
  const summary: RoundSummary = { kills: [], damageDealt: [0, 0], fizzles: 0 };
  const log: ReplayLogEntry[] = [];
  // R2 (SPOTLIGHT): the round's witnessed combatant set — accumulated from the
  // SAME fog-filtered shown strikes that drive the frames, so it can never leak
  // an unseen unit or a mist attacker's firing cell. A `Strike` already withholds
  // the attacker (id/cell null) when fired from the mist, so feeding the strike
  // list in is fog-honest by construction. Folded onto the script at return.
  const combatantCells = new Set<CellId>();
  const combatantUnits = new Set<string>();
  /** Record both ends of a shown strike. Mist attacker fields are null and are
   *  skipped — only the witnessed defender (and any non-withheld attacker) join. */
  const addStrikeCombatants = (strikes: readonly Strike[]): void => {
    for (const s of strikes) {
      if (s.attackerId !== null) combatantUnits.add(s.attackerId);
      if (s.attackerCell !== null) combatantCells.add(s.attackerCell);
      combatantUnits.add(s.defenderId);
      combatantCells.add(s.defenderCell);
    }
  };
  // v0.6: units removed by capture-consumption — already accounted for as a
  // claim; a (defensive) stray kill event for one of them must stay silent.
  const consumedIds = new Set<string>();

  // R6 (DEFERRED DISSOLVE): the round's shown casualties, snapshotted at death
  // with the combat (wave) frame index on which they fell. The dissolve no
  // longer rides this frame — instead each casualty enters a DOOMED hold from
  // here through the last wave frame, and ALL of them dissolve together on the
  // appended SETTLE beat. Captured-consumed units are NOT here (they claim, not
  // die) and brawl mutual deaths share their brawl frame index (they fall
  // together in SETTLE). Pure: derived from the same shown kills as before.
  const doomedDeaths: { unit: UnitInstance; deathFrame: number }[] = [];
  const recordDoomed = (kills: readonly UnitInstance[], frameIdx: number): void => {
    for (const k of kills) doomedDeaths.push({ unit: { ...k, attackedFrom: [] }, deathFrame: frameIdx });
  };

  const nameOf = (type: string | null): string =>
    type === null ? '?' : (unitTypes[type]?.name ?? type);
  /** Feature A: a kill callout for a SHOWN casualty — routed to the own table
   *  (PLAYER) or the enemy table, anchored at the victim's cell. The eventKey
   *  is stable (unitId + cell) so the term is identical across scrub/replay.
   *  The own table interpolates the unit's display name (`{type} Down!`). */
  const killCallout = (victim: UnitInstance): Callout => {
    const own = victim.faction === player;
    return {
      cell: victim.cell,
      kind: own ? 'kill-own' : 'kill-enemy',
      text: calloutTerm(
        own ? 'kill-own' : 'kill-enemy',
        `kill:${victim.id}:${victim.cell}`,
        own ? nameOf(victim.type) : undefined,
      ),
    };
  };
  const lastFrame = (): number => Math.max(0, frames.length - 1);
  const logKills = (shown: readonly UnitInstance[], atFrame: number): void => {
    for (const k of shown) {
      log.push({
        atFrame,
        segs: [
          { t: k.faction === player ? 'your ' : 'enemy ' },
          { t: nameOf(k.type), f: k.faction },
          { t: ' destroyed' },
        ],
      });
    }
  };

  const emptyFx = () => ({
    arcs: [] as ReplayFrame['arcs'],
    floaters: [] as Floater[],
    bursts: [] as CellId[],
    kills: [] as UnitInstance[],
    spawns: [] as UnitInstance[],
    captures: [] as ReplayFrame['captures'],
    promotions: [] as ReplayFrame['promotions'],
    signs: [] as ReplayFrame['signs'],
    callouts: [] as Callout[],
    trails: [] as TrailFx[],
    focus: [] as CellId[],
  });

  // Establishing frame: the pre-round picture through the player's fog.
  {
    const vis = vision();
    frames.push({
      duration: ESTABLISH_MS,
      slot: -1,
      units: renderUnits(vis),
      ...fogFields(vis),
      ...emptyFx(),
    });
  }

  /** Consume trailing `kill` events of a strike group. Returns shown kills;
   *  unseen kills (and kills of units no shown strike touched) stay silent. */
  const consumeKills = (
    i: number,
    vis: ReadonlySet<CellId>,
    shownVictims: ReadonlySet<string>,
  ): { next: number; shown: UnitInstance[] } => {
    const shown: UnitInstance[] = [];
    let j = i;
    while (j < events.length && events[j]!.type === 'kill') {
      const ev = events[j]! as Extract<ResolutionEvent, { type: 'kill' }>;
      const victim = sim.get(ev.unitId);
      // v0.6 guard: a capture-consumed unit can't die twice — if the core
      // ever pairs a kill event with unitConsumed, the claim rendering and
      // the single casualty entry stand.
      if (victim && !consumedIds.has(victim.id)) {
        const isShown = seen(victim.faction, victim.cell, vis) || shownVictims.has(victim.id);
        if (isShown) {
          shown.push({ ...victim, attackedFrom: [] });
          summary.kills.push({ id: victim.id, type: victim.type, faction: victim.faction });
        }
        victim.count = 0; // dead — drops out of living()/vision
      }
      j++;
    }
    return { next: j, shown };
  };

  // --- event walk --------------------------------------------------------------
  // P9 brawl pacing: consecutive exchanges of the same brawl (same cell +
  // same pair — the resolver emits them back-to-back) compress after the
  // first and accumulate their floater totals. Any other event breaks the chain.
  type BrawlChain = { key: string; cum: [number, number] };
  let brawlChain: BrawlChain | null = null;

  let i = 0;
  while (i < events.length) {
    const ev = events[i]!;
    if (ev.type !== 'brawl-exchange') brawlChain = null;

    if (ev.type === 'stance') {
      const u = sim.get(ev.unitId);
      if (u) u.stance = ev.stance;
      i++;
      continue;
    }

    if (ev.type === 'move') {
      // Phase 4.1: gather the maximal contiguous run of move events and animate
      // all visible movers simultaneously. Each step index k advances ALL movers
      // to step k in one shared frame, recomputing vision once over all combined
      // positions.  Wholly-fogged movers advance silently (no slot), matching
      // the existing per-mover fog contract exactly.

      // ── collect the contiguous run of move events ──────────────────────────
      // v0.8 pacing fix: the resolver INTERLEAVES `path-truncated` events into
      // this run — a mover whose walk fell short (or bounced on a vacancy) emits
      // its `path-truncated` right after its own `move`, before the next mover.
      // We must NOT stop the run at one (that fragments the simultaneous beat).
      // Continue across `path-truncated`, folding its supplementary feedback
      // (the own-unit "why it stopped" log line) into this same move beat. The
      // `move`'s pathTaken already reflects the truncated path, so the mover
      // animates correctly; the truncation is feedback only.
      type MoverDesc = {
        u: UnitInstance;
        from: CellId;
        pathTaken: CellId[];
        visiblyMoves: boolean;
      };
      const run: MoverDesc[] = [];
      // Own-unit truncation log lines, gathered across the run so they emit
      // inside this single beat (own plans only; AI truncation reasons stay
      // secret — surfacing one would leak what the AI intended).
      const truncLines: LogSeg[][] = [];
      let runEnd = i;
      {
        const visBefore = vision();
        while (
          runEnd < events.length &&
          (events[runEnd]!.type === 'move' || events[runEnd]!.type === 'path-truncated')
        ) {
          const cur = events[runEnd]!;
          if (cur.type === 'path-truncated') {
            const tu = sim.get(cur.unitId);
            if (tu && tu.faction === player) {
              const why: Record<string, string> = {
                'enemy-contact': ' runs into the enemy',
                'enemy-friction': ' slowed by the enemy',
                'friendly-occupied': ' stops short — tile occupied',
                'vacancy-failed': ' falls back — tile never cleared',
                budget: ' halts — out of reach',
                'invalid-step': ' halts — order failed',
              };
              truncLines.push([
                { t: nameOf(tu.type), f: tu.faction },
                { t: why[cur.reason] ?? ' halts' },
              ]);
            }
            runEnd++;
            continue;
          }
          const mev = cur as Extract<ResolutionEvent, { type: 'move' }>;
          const mu = sim.get(mev.unitId);
          if (mu) {
            const visibly =
              mu.faction === player ||
              seen(mu.faction, mev.from, visBefore) ||
              mev.pathTaken.some((c) => visBefore.has(c));
            run.push({ u: mu, from: mev.from, pathTaken: mev.pathTaken, visiblyMoves: visibly });
          }
          runEnd++;
        }
      }

      // ── apply wholly-fogged movers silently ───────────────────────────────
      // Separate visible from silent movers so silent ones still update their
      // sim position (fog contract: they moved, the builder just doesn't show it).
      const visibleMovers = run.filter((m) => m.visiblyMoves);
      const silentMovers = run.filter((m) => !m.visiblyMoves);
      for (const m of silentMovers) {
        m.u.cell = m.pathTaken[m.pathTaken.length - 1] ?? m.u.cell;
      }

      if (visibleMovers.length === 0) {
        // Nothing to animate — consume the run and move on.
        i = runEnd;
        continue;
      }

      // ── emit ONE shared slot for the whole movement beat ───────────────────
      // Use the first visible mover's info for the slot glyph (arbitrary — the
      // strip shows one chip for the beat). Log enemy moves.
      const slot = slots.length;
      const firstVis = visibleMovers[0]!;
      slots.push({ kind: 'move', actorType: firstVis.u.type, actorFaction: firstVis.u.faction, strikes: [] });
      for (const m of visibleMovers) {
        if (m.u.faction !== player) {
          log.push({
            atFrame: frames.length,
            segs: [{ t: 'enemy ' }, { t: nameOf(m.u.type), f: m.u.faction }, { t: ' on the move' }],
          });
        }
      }

      // ── per-mover trail state ──────────────────────────────────────────────
      const trailPaths = new Map<string, CellId[]>();
      const visBefore = vision();
      for (const m of visibleMovers) {
        const trail: CellId[] = [];
        if (seen(m.u.faction, m.from, visBefore)) trail.push(m.from);
        trailPaths.set(m.u.id, trail);
      }

      // ── concurrent step frames ────────────────────────────────────────────
      // maxSteps = longest path among visible movers. In frame k, advance each
      // visible mover to min(k, lastStep) (so shorter movers hold at their
      // final cell). Recompute vision ONCE per frame over the combined positions.
      const maxSteps = Math.max(...visibleMovers.map((m) => m.pathTaken.length));

      for (let k = 0; k < maxSteps; k++) {
        // advance each visible mover to step k (or hold at final if exhausted)
        for (const m of visibleMovers) {
          const stepK = m.pathTaken[k] ?? m.pathTaken[m.pathTaken.length - 1]!;
          m.u.cell = stepK;
        }
        const vis = vision(); // combined positions for this step

        // update trail paths for visible movers on this step
        const activeTrails: TrailFx[] = [];
        for (const m of visibleMovers) {
          const stepK = m.pathTaken[k] ?? m.pathTaken[m.pathTaken.length - 1]!;
          const trail = trailPaths.get(m.u.id)!;
          if (seen(m.u.faction, stepK, vis)) {
            if (trail[trail.length - 1] !== stepK) trail.push(stepK);
          }
          if (trail.length >= 2) {
            activeTrails.push({ id: `t${slot}-${m.u.id}`, faction: m.u.faction, path: [...trail] });
          }
        }

        // camera: focus on the step-k cell of the first visible mover (or all)
        const focusCells: CellId[] = [];
        for (const m of visibleMovers) {
          const stepK = m.pathTaken[k] ?? m.pathTaken[m.pathTaken.length - 1]!;
          if (!focusCells.includes(stepK)) focusCells.push(stepK);
        }

        frames.push({
          duration: MOVE_STEP_MS,
          slot,
          units: renderUnits(vis),
          ...fogFields(vis),
          ...emptyFx(),
          trails: activeTrails,
          focus: focusCells,
        });
      }

      // Fold the run's own-unit truncation feedback into THIS beat: the player
      // is told why their move stopped short, on the last move frame of the
      // beat. (Empty when no own mover was truncated — and a wholly-fogged run
      // never gathered any, since own units always count as visible movers.)
      for (const segs of truncLines) log.push({ atFrame: lastFrame(), segs });

      i = runEnd;
      continue;
    }

    if (ev.type === 'path-truncated') {
      // A stray `path-truncated` not attached to a move run (defensive — the
      // resolver always emits it right after the truncated mover's `move`, so
      // the move branch above folds it in). The move frames already show the
      // real path; only the own-unit "why it stopped" log line is supplementary.
      const u = sim.get(ev.unitId);
      if (u && u.faction === player) {
        const why: Record<string, string> = {
          'enemy-contact': ' runs into the enemy',
          'enemy-friction': ' slowed by the enemy',
          'friendly-occupied': ' stops short — tile occupied',
          'vacancy-failed': ' falls back — tile never cleared',
          budget: ' halts — out of reach',
          'invalid-step': ' halts — order failed',
        };
        log.push({
          atFrame: lastFrame(),
          segs: [{ t: nameOf(u.type), f: u.faction }, { t: why[ev.reason] ?? ' halts' }],
        });
      }
      i++;
      continue;
    }

    if (ev.type === 'path-interrupted') {
      // Forced-crossing combat (addendum 2026-06-21 §5): the movement pre-pass
      // halted this mover on a shared cell — a "path interrupted!" sign
      // announces the clash; the ensuing brawl renders via the existing brawl
      // FX. The resolver emits these in a contiguous run (one per interrupted
      // mover, BEFORE any movement), so gather the run and surface ONE sign per
      // distinct crossing cell. Fog discipline (same rule the other spatial
      // beats use): show the sign only when the player can see the cell at this
      // instant — own crosser always, otherwise the cell must be in vision. A
      // crossing wholly in the dark surfaces nothing (it stays secret, exactly
      // like an enemy brawl the player cannot witness).
      const vis = vision();
      // Feature A: the path-interrupted CrossSign migrates into a CALLOUT — the
      // callout becomes the sign (spec §2.2). One per distinct crossing cell;
      // the first interrupted unit witnessed on that cell owns the eventKey so
      // the flavor term is deterministic + stable across scrub/replay.
      const crossCells: CellId[] = [];
      const crossKeyer = new Map<CellId, string>();
      let j = i;
      while (j < events.length && events[j]!.type === 'path-interrupted') {
        const pe = events[j] as Extract<ResolutionEvent, { type: 'path-interrupted' }>;
        const u = sim.get(pe.unitId);
        const shown = u ? seen(u.faction, pe.cell, vis) : vis.has(pe.cell);
        if (shown && !crossCells.includes(pe.cell)) {
          crossCells.push(pe.cell);
          crossKeyer.set(pe.cell, `cross:${pe.unitId}:${pe.cell}`);
        }
        j++;
      }
      if (crossCells.length > 0) {
        const slot = slots.length;
        slots.push({ kind: 'interrupt', actorType: null, actorFaction: null, strikes: [] });
        const callouts: Callout[] = crossCells.map((cell) => ({
          cell,
          kind: 'crossing',
          text: calloutTerm('crossing', crossKeyer.get(cell)!),
        }));
        frames.push({
          duration: SIGN_MS,
          slot,
          units: renderUnits(vis),
          ...fogFields(vis),
          ...emptyFx(),
          callouts,
          focus: [...crossCells],
        });
        // One announce line for the beat (the callouts carry the cells + flavor
        // spatially; the log keeps the plain crossing announcement copy).
        log.push({
          atFrame: frames.length - 1,
          segs: [{ t: 'path interrupted!' }],
        });
      }
      i = j;
      continue;
    }

    if (ev.type === 'attack' || ev.type === 'lost-target') {
      // Phase 4.2: gather the maximal contiguous run of attack/counter/kill
      // events (+ interleaved lost-target fizzles, v0.8 pacing fix) and emit
      // them into a minimal number of dense frames where all simultaneously-
      // visible arcs, floaters, and bursts appear together. Each "exchange" =
      // one attack (+ optional counter) + trailing kills. All visible exchanges
      // from the run land in a SINGLE combined volley frame so the player sees
      // them all at once. A run of ONLY lost-target events degrades to a lone
      // 'fizzle' beat, identical to the legacy standalone handler.

      // R1 (TEMPO BACKBONE): a contiguous attack run may MIX range-bands
      // (initiative order interleaves a ranged sniper and an adjacent melee
      // strike). We bucket every shown strike/arc/floater/log line BY WAVE so
      // the ranged/artillery impacts (WAVE_A) emit as one beat and the melee
      // impacts (WAVE_B) as a separate, later beat — no melee impact ever plays
      // before all ranged impacts. Bucketing changes no resolved value (damage,
      // counts, kills, fog are applied to `sim` exactly as before); it only
      // groups the *presentation* by band.
      type WaveBucket = {
        strikes: Strike[];
        arcs: ReplayFrame['arcs'];
        floaters: Floater[];
        logLines: LogSeg[][];
        firstAttSet: boolean;
        firstAttType: string | null;
        firstAttFaction: FactionId | null;
        firstIsMist: boolean;
      };
      const mkBucket = (): WaveBucket => ({
        strikes: [],
        arcs: [],
        floaters: [],
        logLines: [],
        firstAttSet: false,
        firstAttType: null,
        firstAttFaction: null,
        firstIsMist: false,
      });
      const buckets: Record<Wave, WaveBucket> = { A: mkBucket(), B: mkBucket() };
      // Fizzles (lost-target) have no band — fold them into WAVE_B so a melee
      // beat carries them (or, for a fizzle-only run, the lone fizzle beat). A
      // held-fire shot is a non-event; it never gates the ranged wave.
      const combinedLogLines: LogSeg[][] = []; // fizzle-only log lines (no strike)
      const allShownVictims = new Set<string>();
      // The first shown strike OF EACH WAVE owns that wave beat's slot glyph
      // (mist or not). The per-bucket `firstAttSet` flag is the sentinel — NOT
      // `firstAttType === null`, since a mist strike legitimately sets
      // firstAttType to null and would otherwise let a later visible strike
      // hijack the chip.
      // v0.8 pacing fix: an explicit attack whose target evaporated emits a
      // `lost-target` INTERLEAVED between real attacks (in initiative order).
      // Folding it into this run keeps the volley a single beat instead of
      // splitting into volley/fizzle/volley. Its existing feedback is preserved
      // inside the combined frame (fizzle floater on the attacker, fizzle log
      // line, summary tally). The first shown fizzle's glyph backs the slot when
      // the run is fizzle-only, so a lone fizzle still looks exactly as before.
      let shownFizzles = 0;
      let fizzleGlyphType: string | null = null;
      let fizzleGlyphFaction: FactionId | null = null;
      const fizzleFloaters: Floater[] = [];
      // Feature A: no-target callouts for SHOWN fizzles, anchored at the
      // attacker's cell. Deterministic key per fizzle (attacker + target cell).
      const fizzleCallouts: Callout[] = [];

      // We'll scan forward to collect the full run of attacks (each may have a
      // counter + kills inline) plus any interleaved lost-target fizzles. The
      // brawlChain reset (already done above at
      // `if (ev.type !== 'brawl-exchange') brawlChain = null`) still fires when
      // we hit the attack, so that's handled. We consume events into j.
      let j = i;

      while (
        j < events.length &&
        (events[j]!.type === 'attack' || events[j]!.type === 'lost-target')
      ) {
        if (events[j]!.type === 'lost-target') {
          // Fold the fizzle into the run without breaking the volley. Same
          // visibility rule as the standalone handler: shown when the player
          // can see the attacker's cell (own units always). A held-fire shot
          // has no band; it is collected separately and surfaces ONLY when the
          // run carries no real strike (a lone fizzle beat) or rides the WAVE_B
          // beat — it never gates the ranged wave.
          const le = events[j] as Extract<ResolutionEvent, { type: 'lost-target' }>;
          const lAtt = sim.get(le.attackerId);
          const lVis = vision();
          if (lAtt && seen(lAtt.faction, lAtt.cell, lVis)) {
            summary.fizzles += 1;
            shownFizzles += 1;
            fizzleFloaters.push({
              id: `fcombat-fizz-${fizzleFloaters.length}`,
              cell: lAtt.cell,
              text: 'no target',
              mist: false,
              category: 'taken', // R5: a non-damage label, not category-coloured
              slot: slots.length, // patched at emit
            });
            combinedLogLines.push([
              { t: nameOf(lAtt.type), f: lAtt.faction },
              { t: ' holds fire — target lost' },
            ]);
            fizzleCallouts.push({
              cell: lAtt.cell,
              kind: 'no-target',
              text: calloutTerm('no-target', `lost:${le.attackerId}:${le.targetCell}`),
            });
            if (fizzleGlyphType === null && fizzleGlyphFaction === null) {
              fizzleGlyphType = lAtt.type;
              fizzleGlyphFaction = lAtt.faction;
            }
          }
          j += 1;
          continue;
        }
        const aev = events[j] as Extract<ResolutionEvent, { type: 'attack' }>;
        const vis = vision(); // recompute for each attack — a prior kill may have shifted fog
        const att = sim.get(aev.attackerId);
        const def = sim.get(aev.defenderId);
        let innerJ = j + 1;
        let strikeLine: LogSeg[] | null = null;

        if (att && def) {
          const attackerSeen = seen(att.faction, aev.attackerCell, vis);
          const defenderSeen = seen(def.faction, aev.defenderCell, vis);
          const shown = att.faction === player || defenderSeen;
          const mist = shown && att.faction !== player && !attackerSeen;

          // R1: the exchange's WAVE is set by the ATTACK's band (an attack and
          // its counter form one beat — the counter, geometrically the same
          // shot reversed, rides the same wave so the exchange reads cohesively
          // as strike + answering crossfire). Band derives only from the
          // attacker's type + the shot distance; no resolved value changes.
          const band = classifyBand('attack', att, aev.attackerCell, aev.defenderCell, board, unitTypes);
          const wave = bandWave(band);
          const bucket = buckets[wave];

          if (shown) {
            bucket.strikes.push(
              makeStrike('attack', aev.attackerId, att, aev.attackerCell, aev.defenderId, def, aev.defenderCell, aev.damage, mist, aev.breakdown),
            );
            allShownVictims.add(aev.defenderId);
            if (!mist) bucket.arcs.push({ from: aev.attackerCell, to: aev.defenderCell, faction: att.faction });
            bucket.floaters.push({
              id: `fcombat-${wave}-${bucket.floaters.length}`,
              cell: aev.defenderCell,
              text: `−${aev.damage}`,
              mist,
              // R5: a lethal opening strike (defender → 0) is a kill; otherwise
              // it is normal damage taken.
              category: aev.defenderCountAfter === 0 ? 'kill' : 'taken',
              slot: slots.length, // patched to the bucket's slot index at emit
            });
            summary.damageDealt[att.faction] += aev.damage;
            strikeLine = mist
              ? [
                  { t: nameOf(def.type), f: def.faction },
                  { t: ` −${aev.damage} ` },
                  { t: 'from the mist', f: 'mist' },
                ]
              : [
                  { t: nameOf(att.type), f: att.faction },
                  { t: ' → ' },
                  { t: nameOf(def.type), f: def.faction },
                  { t: ` −${aev.damage}` },
                ];
            // The first shown strike of THIS wave owns the wave beat's chip
            // (mist or not).
            if (!bucket.firstAttSet) {
              bucket.firstAttSet = true;
              bucket.firstAttType = mist ? null : att.type;
              bucket.firstAttFaction = mist ? null : att.faction;
              bucket.firstIsMist = mist;
            }
          }
          def.count = aev.defenderCountAfter;

          // Inline counter (same exchange — rides the attack's wave bucket).
          if (aev.counterFired && innerJ < events.length && events[innerJ]!.type === 'counter') {
            const ce = events[innerJ] as Extract<ResolutionEvent, { type: 'counter' }>;
            const cAtt = sim.get(ce.attackerId);
            const cDef = sim.get(ce.defenderId);
            if (cAtt && cDef) {
              const cAttSeen = seen(cAtt.faction, ce.attackerCell, vis);
              const cShown = cAtt.faction === player || seen(cDef.faction, ce.defenderCell, vis);
              const cMist = cShown && cAtt.faction !== player && !cAttSeen;
              if (cShown) {
                bucket.strikes.push(
                  makeStrike('counter', ce.attackerId, cAtt, ce.attackerCell, ce.defenderId, cDef, ce.defenderCell, ce.damage, cMist, ce.breakdown),
                );
                allShownVictims.add(ce.defenderId);
                if (!cMist) bucket.arcs.push({ from: ce.attackerCell, to: ce.defenderCell, faction: cAtt.faction });
                bucket.floaters.push({
                  id: `fcombat-${wave}-${bucket.floaters.length}`,
                  cell: ce.defenderCell,
                  text: `−${ce.damage}`,
                  mist: cMist,
                  // R5: a counter that kills reads as a kill (gold) — kill
                  // precedence over the counter category; otherwise 'counter'.
                  category: ce.defenderCountAfter === 0 ? 'kill' : 'counter',
                  slot: slots.length,
                });
                summary.damageDealt[cAtt.faction] += ce.damage;
                if (strikeLine) strikeLine.push({ t: ` / counter −${ce.damage}` });
              }
              cDef.count = ce.defenderCountAfter;
            }
            innerJ++;
          }

          if (strikeLine) bucket.logLines.push(strikeLine);
        }

        // Consume trailing kills for this exchange (they may affect fog for
        // subsequent attacks in the run — apply them now, but we'll render
        // all kills in the shared frame below).
        const kills = consumeKills(innerJ, vision(), allShownVictims);
        // Note: consumeKills advances victim.count = 0, so fog is updated
        // live for subsequent iterations of this while loop.
        for (const k of kills.shown) {
          // We'll collect shown kills separately and attach them to the frame.
          allShownVictims.add(k.id);
        }
        innerJ = kills.next;
        j = innerJ;
      }

      // Collect the dead shown victims for this run. consumeKills already
      // zeroed their counts and recorded them in summary.kills during the loop;
      // we snapshot the (now count==0) units from sim here. R1: a death is
      // attached to the LATEST wave that struck the victim (B if any melee
      // strike hit it, else A), so it fades WITH its band's beat and never
      // surfaces a melee death before the ranged wave's impacts.
      const strikeHits = (w: Wave, id: string): boolean =>
        buckets[w].strikes.some((s) => s.defenderId === id);
      const combinedKills: UnitInstance[] = [];
      for (const id of allShownVictims) {
        const u = sim.get(id);
        if (u && u.count === 0 && !consumedIds.has(u.id)) {
          // Check it was in the summary (added by consumeKills).
          if (summary.kills.some((k) => k.id === id)) {
            combinedKills.push({ ...u, attackedFrom: [] });
          }
        }
      }
      const killWave = (id: string): Wave => (strikeHits('B', id) ? 'B' : 'A');

      // R1: emit up to two combat beats — WAVE_A (ranged/artillery) FIRST, then
      // WAVE_B (melee). Each is a self-contained beat (its own slot + frame)
      // carrying only that wave's strikes/arcs/floaters/kills/log lines. This
      // is the presentation regroup: damage, counts, kills, and fog were all
      // applied to `sim` in resolution order above and are unchanged here.
      const emitWaveBeat = (w: Wave): void => {
        const b = buckets[w];
        const waveKills = combinedKills.filter((k) => killWave(k.id) === w);
        if (b.strikes.length === 0 && waveKills.length === 0) return;
        // R2 spotlight: this wave's shown strikes name combatant cells/units.
        addStrikeCombatants(b.strikes);
        const slot = slots.length;
        for (const fl of b.floaters) fl.slot = slot;
        slots.push({
          kind: 'volley',
          actorType: b.firstIsMist ? null : b.firstAttType,
          actorFaction: b.firstIsMist ? null : b.firstAttFaction,
          strikes: b.strikes,
        });
        const focus = new Set<CellId>();
        for (const s of b.strikes) {
          if (s.attackerCell !== null) focus.add(s.attackerCell);
          focus.add(s.defenderCell);
        }
        for (const k of waveKills) focus.add(k.cell);
        const visAfter = vision(); // deaths shrink player vision
        const beatBand: CombatBand = w === 'A'
          ? (b.strikes.some((s) => classifiedArtillery(s)) ? 'artillery' : 'ranged')
          : 'melee';
        // R4: attack-motion primitives for this beat's SHOWN, source-revealed
        // strikes. A mist strike (attackerCell null) yields no projectile — the
        // impact alone shows, the source never leaks. WAVE_A projectiles all fly
        // on the SAME dilated envelope (delay 0 — never sequenced per-unit, so
        // five snipers' tracers fly together); a WAVE_B counter trails the strike
        // it answers by WAVE_B_COUNTER_OFFSET (crossfire reads as two motions).
        const projectiles = buildProjectiles(b.strikes, board, unitTypes);
        // R4: shake scales with the TOTAL damage of this beat (band-weighted —
        // artillery is the biggest of the set).
        const beatDamage = b.strikes.reduce((sum, s) => sum + s.damage, 0);
        frames.push({
          duration: VOLLEY_MS,
          slot,
          units: renderUnits(visAfter),
          ...fogFields(visAfter),
          ...emptyFx(),
          arcs: b.arcs,
          floaters: b.floaters,
          // R6: the dissolve is DEFERRED to SETTLE — this beat shows the lethal
          // blow but the victim does not fall here. It is recorded as DOOMED and
          // dissolves on the appended SETTLE beat. (No `kills` on a wave frame.)
          kills: [],
          // Feature A: a kill callout per shown casualty of this beat (the
          // lethal blow is announced here, even though the visual fall waits for
          // SETTLE). Fog-honest: waveKills are the SHOWN casualties only.
          callouts: waveKills.map(killCallout),
          focus: [...focus],
          wave: w,
          band: beatBand,
          projectiles,
          shake: shakeMagnitude(beatDamage, beatBand),
        });
        // R6: this beat's casualties enter the DOOMED hold from THIS frame.
        recordDoomed(waveKills, frames.length - 1);
        for (const line of b.logLines) log.push({ atFrame: frames.length - 1, segs: line });
        // The casualty log lines still fire on the death frame (the player is
        // told who died when the lethal blow lands — only the visual fall waits).
        logKills(waveKills, frames.length - 1);
      };
      // classify a shown strike as artillery purely for the frame's finer band
      // tag (presentation only; mist strikes withhold the attacker, so they
      // read as 'ranged' — the indirect-fire band is a cosmetic refinement).
      function classifiedArtillery(s: Strike): boolean {
        if (s.attackerType === null) return false;
        return (unitTypes[s.attackerType]?.minRange ?? 1) >= 2;
      }

      emitWaveBeat('A');
      emitWaveBeat('B');

      // A fizzle-only run (no real strike anywhere) keeps the legacy lone
      // 'fizzle' beat — a held-fire shot with its own short beat + floater.
      const anyStrike = buckets.A.strikes.length > 0 || buckets.B.strikes.length > 0 || combinedKills.length > 0;
      if (!anyStrike && shownFizzles > 0) {
        const slot = slots.length;
        for (const fl of fizzleFloaters) fl.slot = slot;
        slots.push({
          kind: 'fizzle',
          actorType: fizzleGlyphType,
          actorFaction: fizzleGlyphFaction,
          strikes: [],
        });
        const focus = new Set<CellId>();
        for (const fl of fizzleFloaters) focus.add(fl.cell);
        const visAfter = vision();
        frames.push({
          duration: FIZZLE_MS,
          slot,
          units: renderUnits(visAfter),
          ...fogFields(visAfter),
          ...emptyFx(),
          floaters: fizzleFloaters,
          // Feature A: surface a no-target callout at each shown fizzle.
          callouts: fizzleCallouts,
          focus: [...focus],
        });
        for (const line of combinedLogLines) log.push({ atFrame: frames.length - 1, segs: line });
      } else if (shownFizzles > 0) {
        // A held-fire shot alongside real strikes: keep its log line(s) (the
        // player is told the shot was held) attached to the last combat frame
        // of this run. No extra floater beat — the floater belonged to the
        // standalone fizzle case; here the strikes carry the visuals.
        for (const line of combinedLogLines) log.push({ atFrame: lastFrame(), segs: line });
        // Feature A: the no-target callouts still surface (the player witnessed
        // the held fire), riding the last combat frame of this run.
        if (fizzleCallouts.length > 0) {
          const last = frames[lastFrame()]!;
          (last.callouts ??= []).push(...fizzleCallouts);
        }
      }

      i = j;
      continue;
    }

    if (ev.type === 'brawl-exchange') {
      const vis = vision();
      const hi = sim.get(ev.higherInitId);
      const lo = sim.get(ev.lowerInitId);
      let j = i + 1;
      const fx = emptyFx();
      const strikes: Strike[] = [];
      const shownVictims = new Set<string>();
      // P9 pacing: same brawl continuing? Compress + accumulate totals.
      const chainKey = `${ev.cell}:${ev.higherInitId}:${ev.lowerInitId}`;
      const prevChain: BrawlChain | null = brawlChain;
      const followup = prevChain !== null && prevChain.key === chainKey;
      const chain: BrawlChain =
        followup && prevChain !== null ? prevChain : { key: chainKey, cum: [0, 0] };
      brawlChain = chain;
      chain.cum[0] += ev.higherInitDamageDealt;
      chain.cum[1] += ev.lowerInitDamageDealt;
      // A brawl cell always contains both factions, so one side is the
      // player's and the cell is inside their vision; checked anyway.
      const shown = !!hi && !!lo && (vis.has(ev.cell) || hi.faction === player || lo.faction === player);
      if (hi && lo) {
        if (shown) {
          strikes.push(
            makeStrike('brawl', ev.higherInitId, hi, ev.cell, ev.lowerInitId, lo, ev.cell, ev.higherInitDamageDealt, false, ev.higherInitBreakdown),
          );
          summary.damageDealt[hi.faction] += ev.higherInitDamageDealt;
          fx.floaters.push({
            id: `f${slots.length}-0`,
            cell: ev.cell,
            text: `−${chain.cum[0]}`, // running brawl total (P9)
            mist: false,
            // R5: the higher-init's blow — a kill if it dropped the lower-init's
            // unit to 0, otherwise normal damage taken (it strikes first).
            category: ev.lowerInitCountAfter === 0 ? 'kill' : 'taken',
            slot: slots.length,
          });
          if (ev.lowerInitBreakdown) {
            strikes.push(
              makeStrike('brawl-return', ev.lowerInitId, lo, ev.cell, ev.higherInitId, hi, ev.cell, ev.lowerInitDamageDealt, false, ev.lowerInitBreakdown),
            );
            summary.damageDealt[lo.faction] += ev.lowerInitDamageDealt;
            fx.floaters.push({
              id: `f${slots.length}-1`,
              cell: ev.cell,
              text: `−${chain.cum[1]}`, // running brawl total (P9)
              mist: false,
              // R5: the lower-init's answering blow is a brawl-return — 'counter',
              // unless it killed the higher-init's unit (kill precedence).
              category: ev.higherInitCountAfter === 0 ? 'kill' : 'counter',
              slot: slots.length,
            });
          }
          fx.bursts.push(ev.cell);
          shownVictims.add(ev.higherInitId);
          shownVictims.add(ev.lowerInitId);
        }
        hi.count = ev.higherInitCountAfter;
        lo.count = ev.lowerInitCountAfter;
      }
      const kills = consumeKills(j, vis, shownVictims);
      j = kills.next;
      // R6: a brawl casualty does NOT dissolve on its clash frame — it enters
      // the DOOMED hold and falls in SETTLE. Brawl/crossfire MUTUAL deaths share
      // this one frame, so they fall TOGETHER on the SETTLE beat. (No `kills`.)
      fx.kills = [];
      // Feature A: a kill callout per shown brawl casualty (announced on the
      // clash frame; the visual fall waits for SETTLE). Fog-honest.
      fx.callouts = kills.shown.map(killCallout);
      if (shown) {
        // R2 spotlight: a shown brawl's participants (both factions, same cell)
        // are combatants. The strikes already carry both ends.
        addStrikeCombatants(strikes);
        const slot = slots.length;
        slots.push({
          kind: 'brawl',
          actorType: hi?.type ?? null,
          actorFaction: hi?.faction ?? null,
          strikes,
        });
        const visAfter = vision();
        // R4: a brawl is melee — both halves stab (a short dash toward the
        // shared cell), the return offset by WAVE_B_COUNTER_OFFSET so the
        // exchange reads as a crossfire of two motions. Shake scales with the
        // total damage landing on the tile (light melee nudge).
        const brawlProjectiles = buildProjectiles(strikes, board, unitTypes);
        const brawlDamage = strikes.reduce((sum, s) => sum + s.damage, 0);
        frames.push({
          duration: followup ? BRAWL_FOLLOWUP_MS : VOLLEY_MS,
          slot,
          units: renderUnits(visAfter),
          ...fogFields(visAfter),
          ...fx,
          focus: [ev.cell],
          // R1: a brawl is same-cell mutual combat — always WAVE_B (melee).
          wave: 'B',
          band: 'melee',
          projectiles: brawlProjectiles,
          shake: shakeMagnitude(brawlDamage, 'melee'),
        });
        // R6: brawl casualties enter the DOOMED hold from this clash frame and
        // fall together in SETTLE (mutual annihilation reads as both at once).
        recordDoomed(kills.shown, frames.length - 1);
        if (hi && lo) {
          const segs: LogSeg[] = [
            { t: 'brawl: ' },
            { t: nameOf(hi.type), f: hi.faction },
            { t: ' → ' },
            { t: nameOf(lo.type), f: lo.faction },
            { t: ` −${ev.higherInitDamageDealt}` },
          ];
          if (ev.lowerInitBreakdown) segs.push({ t: ` / counter −${ev.lowerInitDamageDealt}` });
          log.push({ atFrame: frames.length - 1, segs });
        }
        // R6: log lines still fire on the death frame (visual fall waits, the
        // announcement does not) — `fx.kills` is now empty, so use kills.shown.
        logKills(kills.shown, frames.length - 1);
      }
      i = j;
      continue;
    }

    // NOTE: `lost-target` (fizzle) is handled entirely by the combat branch
    // above — it enters on `attack` OR `lost-target` and folds interleaved
    // fizzles into the volley beat (or degrades to a lone 'fizzle' beat). There
    // is no separate standalone handler, so a fizzle can never split a volley.

    // ── E3 conquest events (addendum §B) — the BLIND-BUY FILTER. Own-faction
    // events always show; enemy capture/spawn/spawn-failed show only when the
    // affected cell is live-visible at this instant; enemy income (no cell)
    // never shows. Hidden events still advance the simulation silently.
    if (ev.type === 'capture') {
      const visBefore = vision(); // visibility judged BEFORE the flip
      const own = ev.to === player;
      const shown = own || visBefore.has(ev.cell);
      const u = sim.get(ev.unitId);
      // v0.6 capture-consumes rule: with `unitConsumed: true` the capturing
      // unit is REMOVED on capture (the resolver emits NO kill event for it).
      // It counts as a loss in the casualty rows (summary.kills, fog-honest:
      // only when the capture itself is shown) but renders as a CLAIM, not a
      // death — the fx layer dissolves the token into the rising flag.
      const consumed = ev.unitConsumed === true && !!u && u.count > 0;
      const consumedSnapshot: UnitInstance | undefined = consumed
        ? { ...u!, attackedFrom: [] }
        : undefined;
      if (cq) cq.bases[ev.cell] = ev.to;
      if (consumed) {
        if (shown) summary.kills.push({ id: u!.id, type: u!.type, faction: u!.faction });
        u!.count = 0; // removed — drops out of living()/vision before the frame renders
        consumedIds.add(u!.id);
      }
      if (shown) {
        const slot = slots.length;
        slots.push({ kind: 'capture', actorType: u?.type ?? null, actorFaction: ev.to, strikes: [] });
        const vis = vision(); // post-flip: a taken base extends the watch
        const fx = emptyFx();
        fx.captures.push(
          consumedSnapshot
            ? { cell: ev.cell, to: ev.to, consumed: consumedSnapshot }
            : { cell: ev.cell, to: ev.to },
        );
        // Feature A: a base-captured callout alongside the claim FX, anchored at
        // the base cell, term deterministic per (cell, new owner).
        fx.callouts.push({
          cell: ev.cell,
          kind: 'captured',
          text: calloutTerm('captured', `capture:${ev.cell}:${ev.to}`),
        });
        frames.push({
          duration: CAPTURE_MS,
          slot,
          units: renderUnits(vis),
          ...fogFields(vis),
          ...fx,
          focus: [ev.cell],
        });
        log.push({
          atFrame: frames.length - 1,
          segs: [
            ...(own ? [] : [{ t: 'enemy ' }]),
            { t: nameOf(u?.type ?? null), f: ev.to },
            { t: ' raises the colors' },
          ],
        });
      }
      i++;
      continue;
    }

    if (ev.type === 'income') {
      // Own income only: the HUD ticks, the log notes it. Enemy income has
      // no witnessable cell — enemy credits stay secret.
      if (cq && ev.faction === player) {
        cq.credits = ev.creditsAfter;
        if (ev.amount > 0) {
          const vis = vision();
          frames.push({
            duration: INCOME_MS,
            slot: -1, // no timeline slot — a bookkeeping beat, not an action
            units: renderUnits(vis),
            ...fogFields(vis),
            ...emptyFx(),
          });
          log.push({
            atFrame: frames.length - 1,
            segs: [
              { t: 'income ' },
              { t: `+${ev.amount}`, f: player },
              { t: ` · ◈ ${ev.creditsAfter}` },
            ],
          });
        }
      }
      i++;
      continue;
    }

    if (ev.type === 'upkeep') {
      // Own upkeep only: the HUD ticks down, the log notes it. Enemy upkeep has
      // no witnessable cell — enemy credits stay secret (mirrors income).
      if (cq && ev.faction === player) {
        cq.credits = ev.creditsAfter;
        if (ev.amount > 0) {
          const vis = vision();
          frames.push({
            duration: INCOME_MS,
            slot: -1,
            units: renderUnits(vis),
            ...fogFields(vis),
            ...emptyFx(),
          });
          log.push({
            atFrame: frames.length - 1,
            segs: [
              { t: 'upkeep ' },
              { t: `−${ev.amount}`, f: player },
              { t: ` · ◈ ${ev.creditsAfter}` },
            ],
          });
        }
      }
      i++;
      continue;
    }

    if (ev.type === 'spawn') {
      const visBefore = vision();
      const own = ev.faction === player;
      const shown = own || visBefore.has(ev.cell);
      const unit: UnitInstance = {
        id: ev.unitId,
        type: ev.typeKey,
        faction: ev.faction,
        cell: ev.cell,
        count: 10,
        stance: 'aggressive',
        attackedFrom: [],
      };
      sim.set(ev.unitId, unit); // hidden spawns still enter the sim silently
      if (cq && own) {
        cq.credits = ev.creditsAfter; // credits deduct on SUCCESS only
        summary.creditsSpent = (summary.creditsSpent ?? 0) + (unitTypes[ev.typeKey]?.cost ?? 0);
      }
      if (shown) {
        const slot = slots.length;
        slots.push({ kind: 'spawn', actorType: ev.typeKey, actorFaction: ev.faction, strikes: [] });
        const vis = vision(); // an own recruit's vision joins the union
        const fx = emptyFx();
        fx.spawns.push({ ...unit, attackedFrom: [] });
        frames.push({
          duration: SPAWN_MS,
          slot,
          // the fx layer draws the materializing token; withhold the real one
          units: renderUnits(vis).filter((u) => u.id !== ev.unitId),
          ...fogFields(vis),
          ...fx,
          focus: [ev.cell],
        });
        log.push({
          atFrame: frames.length - 1,
          segs: [
            ...(own ? [] : [{ t: 'enemy ' }]),
            { t: nameOf(ev.typeKey), f: ev.faction },
            { t: ' musters at the base' },
          ],
        });
      }
      i++;
      continue;
    }

    if (ev.type === 'spawn-failed') {
      const vis = vision();
      const own = ev.faction === player;
      const shown = own || vis.has(ev.cell);
      if (shown) {
        const slot = slots.length;
        slots.push({ kind: 'fizzle', actorType: ev.unitTypeKey, actorFaction: ev.faction, strikes: [] });
        const fx = emptyFx();
        fx.floaters.push({ id: `f${slot}-0`, cell: ev.cell, text: 'build failed', mist: false, category: 'taken', slot });
        frames.push({
          duration: FIZZLE_MS,
          slot,
          units: renderUnits(vis),
          ...fogFields(vis),
          ...fx,
          focus: [ev.cell],
        });
        const why: Record<SpawnFailReason, string> = {
          occupied: 'base occupied',
          'base-lost': 'base lost',
          'no-credits': 'credits short',
        };
        log.push({
          atFrame: frames.length - 1,
          segs: [
            ...(own ? [] : [{ t: 'enemy ' }]),
            { t: nameOf(ev.unitTypeKey), f: ev.faction },
            { t: ` build failed — ${why[ev.reason]}` },
          ],
        });
      }
      i++;
      continue;
    }

    if (ev.type === 'promotion') {
      // v0.8 veterancy: end-of-round rank-up. Only surface the event when the
      // promoted unit's cell is visible (own units always; enemy veterans only
      // when their cell is currently in-vision — same fog discipline as kills).
      const u = sim.get(ev.unitId);
      const vis = vision();
      const shown = u ? seen(u.faction, ev.cell, vis) : false;
      if (u) { u.count = ev.healedTo; u.rank = ev.rank; }
      if (shown) {
        const slot = slots.length;
        slots.push({ kind: 'promotion', actorType: u?.type ?? null, actorFaction: ev.faction, strikes: [] });
        frames.push({
          duration: PROMOTE_MS,
          slot,
          units: renderUnits(vis),
          ...fogFields(vis),
          ...emptyFx(),
          promotions: [{ cell: ev.cell, faction: ev.faction, rank: ev.rank }],
        });
      }
      i++;
      continue;
    }

    if (ev.type === 'kill') {
      // Stray kill outside a strike group (defensive — the resolver always
      // emits kills inside one): apply with the standard visibility rule.
      const { next } = consumeKills(i, vision(), new Set());
      i = next;
      continue;
    }

    // game-over — the store reads state.outcome; nothing to animate.
    i++;
  }

  // R1 (TEMPO BACKBONE) — wave regroup post-pass. Within each maximal
  // contiguous run of combat frames (frames tagged with a `wave`), stable-sort
  // so every WAVE_A (ranged/artillery) frame precedes every WAVE_B (melee/
  // brawl) frame. This is a PRESENTATION reorder of already-built frames: the
  // resolution walk above ran in event order (so damage, counts, kills, fog,
  // and log content are computed exactly as before); only the play ORDER of a
  // round's combat beats changes, satisfying "no melee impact before all ranged
  // impacts." Each combat frame owns exactly one slot pushed immediately before
  // it, so within a run the frame subarray and the slot subarray share a
  // permutation; floater.slot and log.atFrame are remapped to match.
  regroupCombatWaves(frames, slots, log, doomedDeaths);

  // R6 (DEFERRED DISSOLVE + real SETTLE frame) — the deferral post-pass. The
  // resolution walk computed every casualty exactly as before (summary.kills,
  // damage, fog are untouched); here we only move the visible FALL to SETTLE:
  //
  //  A. DOOMED HOLD — each casualty rides `doomed` (a snapshot) from its death
  //     frame through the round's LAST wave frame, so it stays visibly on the
  //     board (greyed + a death glyph, never a "0") instead of vanishing at the
  //     kill frame. Posthumous is OFF: this is the deferred FALL, not an action.
  //  B. SETTLE BEAT — one dedicated SETTLE frame is appended right after the
  //     last wave frame, carrying ALL the casualties in `kills` so they dissolve
  //     TOGETHER (brawl/crossfire mutual deaths included). Its duration is wired
  //     from REPLAY_PHASE_DURATIONS.SETTLE.
  //  C. RESATURATE — the SETTLE frame is the first post-wave frame, so spotlightAt
  //     releases on it: the board returns to full colour as a visible beat
  //     (fixes the R2 caveat where a combat-final round only resaturated at the
  //     planning transition).
  //  D. LEDGER LAST — income/upkeep frames were emitted by the walk AFTER combat
  //     (Phase E), so inserting SETTLE right after the last wave frame keeps the
  //     ledger ticks after the board has settled.
  insertSettleBeat(frames, log, doomedDeaths, phases.SETTLE.duration);

  return {
    slots,
    frames,
    summary,
    log,
    discovered: disc,
    phases,
    combatants: { cells: combatantCells, units: combatantUnits },
  };
}

/** R6 (PURE): defer every shown casualty's dissolve to a dedicated SETTLE beat.
 *  Mutates the frame list IN PLACE (still pure over its inputs — it derives only
 *  from the already-computed frames + casualty snapshots, no resolved value):
 *
 *   1. Find the round's last wave (combat) frame. No wave frame ⇒ no witnessed
 *      combat ⇒ nothing to settle: leave the script untouched (no SETTLE beat).
 *   2. DOOMED HOLD: add each casualty's snapshot to `doomed` on every wave frame
 *      from its death frame through the last wave frame (it persists held).
 *   3. SETTLE BEAT: splice one SETTLE frame in right after the last wave frame,
 *      carrying ALL casualties in `kills` (they dissolve together). It clones the
 *      last wave frame's fog/units/board picture (the post-combat state) but
 *      drops the combat FX + wave tag and is flagged `settle`; spotlightAt
 *      releases on it (resaturation). Frames AFTER it (ledger, etc.) shift right.
 */
function insertSettleBeat(
  frames: ReplayFrame[],
  log: ReplayLogEntry[],
  doomedDeaths: readonly { unit: UnitInstance; deathFrame: number }[],
  settleDuration: number,
): void {
  let lastWave = -1;
  for (let i = 0; i < frames.length; i++) if (frames[i]!.wave !== undefined) lastWave = i;
  if (lastWave < 0) return; // no witnessed combat → no SETTLE beat

  // DOOMED HOLD: each casualty holds (greyed + glyph) from its death frame
  // through the last wave frame. Only wave frames carry the hold (non-combat
  // frames between waves don't occur within a contiguous combat run).
  for (const { unit, deathFrame } of doomedDeaths) {
    for (let i = Math.max(0, deathFrame); i <= lastWave; i++) {
      const f = frames[i]!;
      if (f.wave === undefined) continue;
      (f.doomed ??= []).push({ ...unit, attackedFrom: [] });
    }
  }

  // SETTLE BEAT: clone the post-combat board picture from the last wave frame,
  // strip the combat FX + wave tag, and carry every casualty as a dissolve.
  const base = frames[lastWave]!;
  const settle: ReplayFrame = {
    duration: settleDuration,
    slot: -1, // a transition/bookkeeping beat, not a timeline action
    units: base.units,
    fog: base.fog,
    discovered: base.discovered,
    ignite: [],
    arcs: [],
    floaters: [],
    bursts: [],
    // ALL the round's casualties fall TOGETHER here (mutual deaths included).
    kills: doomedDeaths.map((d) => ({ ...d.unit, attackedFrom: [] })),
    spawns: [],
    captures: [],
    promotions: [],
    signs: [],
    callouts: [],
    trails: [],
    focus: [],
    settle: true,
    ...(base.bases ? { bases: base.bases } : {}),
    ...(base.credits !== undefined ? { credits: base.credits } : {}),
  };
  frames.splice(lastWave + 1, 0, settle);
  // The splice shifts every frame after the insertion point right by one — any
  // log line bound to such a frame (the post-combat ledger / capture / promotion
  // lines) must follow it so it still fires on the right beat.
  for (const entry of log) if (entry.atFrame > lastWave) entry.atFrame += 1;
}

/** R2 (SPOTLIGHT): is the combat spotlight engaged at this playback cursor?
 *  PURE read of the script + frame index — playback never mutates state, and a
 *  given frame is a stable function of (script, cursor).
 *
 *  The spotlight is ONE pass for the whole turn: it engages as the
 *  planning→replay transition (replay start, frame 0) and RESATURATES in the
 *  SETTLE phase — i.e. once playback has passed the round's LAST combat
 *  (wave-tagged) frame. Concretely it is active for every frame up to and
 *  including the last `wave`-tagged frame, released for every frame after it.
 *  A round with no witnessed combat never dims (no combat frames ⇒ no spotlight).
 *
 *  Returns `active` plus the round's `combatants` so the Board has both in one
 *  read; `combatants` is always the script's set (it is the spotlight subject
 *  whether or not the dim is currently engaged). */
export function spotlightAt(
  script: Pick<ReplayScript, 'frames' | 'combatants'>,
  frameIdx: number,
): { active: boolean; combatants: Combatants } {
  let lastCombat = -1;
  for (let i = 0; i < script.frames.length; i++) {
    if (script.frames[i]!.wave !== undefined) lastCombat = i;
  }
  const active = lastCombat >= 0 && frameIdx <= lastCombat;
  return { active, combatants: script.combatants };
}

/** R3 (DILATION): the analog clock advances LESS THAN one full rotation across
 *  the whole WAVE_A window (~0.9 turn). A barely-moving hand is the read: real
 *  time has nearly stopped while shells arc and rounds crawl (addendum). */
export const DILATION_HAND_TURNS = 0.9;
/** R3: clock fade-in/out envelope at the WAVE_A edges (ms at 1× — addendum:
 *  fade in over the first ~180 ms, fade out over the last ~180 ms). */
export const DILATION_FADE_MS = 180;

/** R3 (DILATION): is the playback cursor inside the round's WAVE_A
 *  (ranged/artillery) window, and how far through it? PURE read of (script,
 *  frameIdx) — mirrors spotlightAt; playback never mutates state and a given
 *  frame is a stable function of (script, cursor).
 *
 *  The WAVE_A window is exactly the `wave === 'A'` combat frames (R1 already
 *  regrouped a round so every WAVE_A frame precedes every WAVE_B frame). During
 *  this window the board cools + vignettes and the analog dilation clock HUD is
 *  present; everywhere else dilation is released (the clock is gone by INTERLUDE
 *  / WAVE_B). The cue layers ON TOP of the R2 spotlight (it does not replace it).
 *
 *  Returns:
 *   • `active`   — this frame is a WAVE_A frame (cool/vignette engaged, clock on).
 *   • `progress` — 0..1 through the WAVE_A window by accumulated frame duration
 *                  (0 at the window's first instant → 1 at its end). The clock
 *                  hand and the fade envelope read from this. 0 when inactive.
 *   • `turns`    — `progress × DILATION_HAND_TURNS` — the hand's rotation in
 *                  turns; ALWAYS < 1 over the full window (the slow-sweep read).
 *   • `fade`     — 0..1 opacity multiplier for the clock: rises over the first
 *                  ~DILATION_FADE_MS of the window, holds at 1, falls over the
 *                  last ~DILATION_FADE_MS. 0 when inactive (clock gone). */
export function dilationAt(
  script: Pick<ReplayScript, 'frames'>,
  frameIdx: number,
): { active: boolean; progress: number; turns: number; fade: number } {
  const frames = script.frames;
  const released = { active: false, progress: 0, turns: 0, fade: 0 };
  const f = frames[frameIdx];
  if (!f || f.wave !== 'A') return released;

  // Total WAVE_A duration + this frame's start offset within the window. The
  // window is the set of wave==='A' frames; after R1's regroup they are
  // contiguous, but we sum over all 'A' frames so the read is order-robust.
  let totalA = 0;
  let startBefore = 0;
  for (let i = 0; i < frames.length; i++) {
    const fi = frames[i]!;
    if (fi.wave !== 'A') continue;
    if (i < frameIdx) startBefore += fi.duration;
    totalA += fi.duration;
  }
  // The cursor sits on this frame for its full duration; read the MIDPOINT so a
  // single-frame window lands at a sensible mid-sweep rather than at 0 or 1.
  const mid = startBefore + f.duration / 2;
  const progress = totalA > 0 ? Math.min(1, Math.max(0, mid / totalA)) : 0;
  const turns = progress * DILATION_HAND_TURNS;

  // Fade envelope: linear ramp up over the first DILATION_FADE_MS, ramp down
  // over the last DILATION_FADE_MS, full in between. Degenerate short windows
  // (totalA ≤ 2×fade) still yield a positive triangular fade.
  const ramp = Math.min(DILATION_FADE_MS, totalA / 2);
  const fadeIn = ramp > 0 ? Math.min(1, mid / ramp) : 1;
  const fadeOut = ramp > 0 ? Math.min(1, (totalA - mid) / ramp) : 1;
  const fade = Math.max(0, Math.min(fadeIn, fadeOut));

  return { active: true, progress, turns, fade };
}

/** R1: stable-reorder combat frames so WAVE_A precedes WAVE_B within each
 *  contiguous combat-frame run, remapping all cross-references. PURE. */
function regroupCombatWaves(
  frames: ReplayFrame[],
  slots: TimelineSlot[],
  log: ReplayLogEntry[],
  /** R6: doomed-death frame references to remap through the same permutation
   *  (a casualty's death frame must follow its beat after the wave reorder). */
  doomedDeaths: { unit: UnitInstance; deathFrame: number }[] = [],
): void {
  const isCombat = (f: ReplayFrame): boolean => f.wave !== undefined;
  // frame index → new frame index, identity until a run is permuted.
  const frameMap = frames.map((_, i) => i);
  // slot index → new slot index.
  const slotMap = slots.map((_, i) => i);

  let r = 0;
  while (r < frames.length) {
    if (!isCombat(frames[r]!)) {
      r++;
      continue;
    }
    // [r, e) is a maximal contiguous combat-frame run.
    let e = r;
    while (e < frames.length && isCombat(frames[e]!)) e++;
    const run = frames.slice(r, e);
    // Already in order? (all A then all B) → skip, keeps a no-op stable.
    const firstB = run.findIndex((f) => f.wave === 'B');
    const needs = firstB !== -1 && run.slice(firstB).some((f) => f.wave === 'A');
    if (needs) {
      // The slots for this run are contiguous, starting at the first frame's
      // slot index (frames+slots were pushed in lockstep, no foreign slot
      // interleaves a combat run).
      const slotStart = frames[r]!.slot;
      // Stable partition: WAVE_A frames first, then WAVE_B, original order kept.
      const order = run
        .map((f, k) => ({ f, k }))
        .sort((x, y) => {
          const wx = x.f.wave === 'A' ? 0 : 1;
          const wy = y.f.wave === 'A' ? 0 : 1;
          return wx !== wy ? wx - wy : x.k - y.k;
        });
      // Reordered slot subarray follows the same permutation.
      const slotRun = slots.slice(slotStart, slotStart + run.length);
      const newSlots = order.map((o) => slotRun[o.k]!);
      for (let k = 0; k < run.length; k++) {
        const src = order[k]!;
        const newFrameIdx = r + k;
        const newSlotIdx = slotStart + k;
        frameMap[r + src.k] = newFrameIdx;
        slotMap[slotStart + src.k] = newSlotIdx;
        frames[newFrameIdx] = src.f;
        slots[newSlotIdx] = newSlots[k]!;
        // Re-point the frame at its (unchanged-value, re-indexed) slot.
        src.f.slot = newSlotIdx;
      }
    }
    r = e;
  }

  // Remap cross-references through the permutations.
  for (const fr of frames) {
    for (const fl of fr.floaters) fl.slot = slotMap[fl.slot] ?? fl.slot;
  }
  for (const entry of log) entry.atFrame = frameMap[entry.atFrame] ?? entry.atFrame;
  // R6: a casualty's death frame moves with its beat under the reorder.
  for (const d of doomedDeaths) d.deathFrame = frameMap[d.deathFrame] ?? d.deathFrame;
}

/** R4 (PURE): turn a beat's SHOWN strikes into attack-motion primitives. One
 *  projectile per source-revealed strike — a mist strike (attackerCell null)
 *  yields none (the impact alone shows; the source never leaks). The kind +
 *  land fraction follow the per-strike band (artillery shell / ranged tracer /
 *  melee stab). WAVE_A projectiles all carry delay 0 (the SHARED dilated
 *  envelope — no per-unit sequencing). A WAVE_B counter / brawl-return trails
 *  the strike it answers by WAVE_B_COUNTER_OFFSET so the exchange reads as a
 *  crossfire of two motions; leading strikes carry delay 0. */
function buildProjectiles(
  strikes: readonly Strike[],
  board: Board,
  unitTypes: Readonly<Record<string, UnitType>>,
): Projectile[] {
  const out: Projectile[] = [];
  for (const s of strikes) {
    // Source withheld (fire from the mist): no projectile — only the impact.
    if (s.attackerCell === null || s.attackerFaction === null || s.attackerType === null) {
      continue;
    }
    // Per-strike band: a brawl/brawl-return is melee; otherwise classify by the
    // attacker's type + the shot geometry (the SAME pure classifier R1 uses).
    const att: UnitInstance = {
      id: s.attackerId ?? '',
      type: s.attackerType,
      faction: s.attackerFaction,
      cell: s.attackerCell,
      count: 1,
      stance: 'aggressive',
      attackedFrom: [],
    };
    const band = classifyBand(
      s.kind === 'attack' ? 'attack' : s.kind === 'counter' ? 'counter' : s.kind,
      att,
      s.attackerCell,
      s.defenderCell,
      board,
      unitTypes,
    );
    const { kind, impact } = projectileKind(band);
    // Crossfire: the answering half of an exchange trails by the offset so the
    // two motions read as a crossing, not one. WAVE_A shares the envelope (0).
    const isCounter = s.kind === 'counter' || s.kind === 'brawl-return';
    const delay = band === 'melee' && isCounter ? WAVE_B_COUNTER_OFFSET : 0;
    out.push({
      kind,
      from: s.attackerCell,
      to: s.defenderCell,
      faction: s.attackerFaction,
      impact,
      delay,
    });
  }
  return out;
}

function makeStrike(
  kind: StrikeKind,
  attackerId: string,
  att: UnitInstance,
  attackerCell: CellId,
  defenderId: string,
  def: UnitInstance,
  defenderCell: CellId,
  damage: number,
  fromMist: boolean,
  breakdown: AttackBreakdown,
): Strike {
  return {
    kind,
    attackerId: fromMist ? null : attackerId,
    attackerType: fromMist ? null : att.type,
    attackerCell: fromMist ? null : attackerCell,
    attackerFaction: fromMist ? null : att.faction,
    defenderId,
    defenderType: def.type,
    defenderCell,
    defenderFaction: def.faction,
    damage,
    fromMist,
    breakdown,
  };
}
