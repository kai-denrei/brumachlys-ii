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

import type { Board, CellId } from '../board/types';
import { visibleCells } from '../core/fog';
import type {
  AttackBreakdown,
  FactionId,
  ResolutionEvent,
  UnitInstance,
  UnitType,
} from '../core/types';

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
  kind: 'move' | 'volley' | 'brawl' | 'fizzle';
  /** Unit-type key for the slot glyph; null = mist (source withheld). */
  actorType: string | null;
  actorFaction: FactionId | null;
  /** Tap target for the breakdown modal (empty for moves/fizzles). */
  strikes: Strike[];
};

export type Floater = {
  id: string;
  cell: CellId;
  text: string;
  /** Source withheld — render the impact marker, grey pill. */
  mist: boolean;
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
  arcs: { from: CellId; to: CellId; faction: FactionId }[];
  floaters: Floater[];
  /** Brawl clash burst cells. */
  bursts: CellId[];
  /** Units fading out this frame (snapshot at death). */
  kills: UnitInstance[];
  /** v1.3: active movement origin trails (fog-filtered, see TrailFx). */
  trails: TrailFx[];
  /** Cells the camera should keep in view this frame (auto-follow, P9).
   *  Empty = leave the view alone. Never contains a withheld mist source. */
  focus: CellId[];
};

export type RoundSummary = {
  /** Shown kills only (snapshot at death). */
  kills: { id: string; type: string; faction: FactionId }[];
  /** Damage dealt by faction [player, ai], from shown strikes. */
  damageDealt: [number, number];
  /** Shown lost-target fizzles. */
  fizzles: number;
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

export type ReplayScript = {
  slots: TimelineSlot[];
  frames: ReplayFrame[];
  summary: RoundSummary;
  /** v1.1 skirmish-log lines, fog-filtered, in playback order. */
  log: ReplayLogEntry[];
};

const MOVE_STEP_MS = 250;
const VOLLEY_MS = 800;
/** Follow-up exchanges of the SAME brawl compress (P9 pacing). */
const BRAWL_FOLLOWUP_MS = 350;
const FIZZLE_MS = 500;
const ESTABLISH_MS = 350;

export function buildReplay(
  board: Board,
  baseUnits: readonly UnitInstance[],
  events: readonly ResolutionEvent[],
  unitTypes: Readonly<Record<string, UnitType>>,
  player: FactionId,
): ReplayScript {
  // --- simulation state ------------------------------------------------------
  const sim = new Map<string, UnitInstance>(
    baseUnits.map((u) => [u.id, { ...u, attackedFrom: [] }]),
  );
  const living = (): UnitInstance[] => [...sim.values()].filter((u) => u.count > 0);
  const vision = (): Set<CellId> => visibleCells(board, living(), player, unitTypes);
  const fogOf = (vis: ReadonlySet<CellId>): Set<CellId> => {
    const fog = new Set<CellId>();
    for (const id of board.cells.keys()) if (!vis.has(id)) fog.add(id);
    return fog;
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

  const nameOf = (type: string | null): string =>
    type === null ? '?' : (unitTypes[type]?.name ?? type);
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
      fog: fogOf(vis),
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
      if (victim) {
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
      const u = sim.get(ev.unitId);
      if (!u) {
        i++;
        continue;
      }
      const visBefore = vision();
      const visiblyMoves =
        u.faction === player ||
        seen(u.faction, ev.from, visBefore) ||
        ev.pathTaken.some((c) => visBefore.has(c));
      if (!visiblyMoves) {
        u.cell = ev.to; // wholly in the mist: applied silently, no slot
        i++;
        continue;
      }
      const slot = slots.length;
      slots.push({ kind: 'move', actorType: u.type, actorFaction: u.faction, strikes: [] });
      // Skirmish log: AI movement the player can see. Own moves stay silent
      // (the player gave the order) unless truncated — see path-truncated.
      if (u.faction !== player) {
        log.push({
          atFrame: frames.length,
          segs: [{ t: 'enemy ' }, { t: nameOf(u.type), f: u.faction }, { t: ' on the move' }],
        });
      }
      // v1.3 Tweak B: origin trail — only cells the player saw the mover on.
      // Own moves are fully witnessed; for AI movers each cell is included
      // iff it was inside the player's vision AT THAT STEP (same rule that
      // gates the token render), so the trail never dips into the mist.
      const trailPath: CellId[] = [];
      if (seen(u.faction, ev.from, visBefore)) trailPath.push(ev.from);
      for (const step of ev.pathTaken) {
        u.cell = step; // player movers drag their vision along with them
        const vis = vision();
        if (seen(u.faction, step, vis)) trailPath.push(step);
        frames.push({
          duration: MOVE_STEP_MS,
          slot,
          units: renderUnits(vis),
          fog: fogOf(vis),
          ...emptyFx(),
          trails:
            trailPath.length >= 2
              ? [{ id: `t${slot}`, faction: u.faction, path: [...trailPath] }]
              : [],
          focus: [step], // camera follows the mover cell-by-cell
        });
      }
      i++;
      continue;
    }

    if (ev.type === 'path-truncated') {
      // The move frames already show the real path. Skirmish log: the player
      // is told why THEIR OWN move stopped short; AI plans stay secret (a
      // truncation reason would leak what the AI intended).
      const u = sim.get(ev.unitId);
      if (u && u.faction === player) {
        const why: Record<string, string> = {
          'enemy-contact': ' runs into the enemy',
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

    if (ev.type === 'attack') {
      const vis = vision();
      const strikes: Strike[] = [];
      const fx = emptyFx();
      const shownVictims = new Set<string>();

      const att = sim.get(ev.attackerId);
      const def = sim.get(ev.defenderId);
      let j = i + 1;
      let strikeLine: LogSeg[] | null = null;

      if (att && def) {
        const attackerSeen = seen(att.faction, ev.attackerCell, vis);
        const defenderSeen = seen(def.faction, ev.defenderCell, vis);
        // Own attacks are always fully shown; otherwise the defender must be
        // visible (an AI strike on an unseen AI unit cannot occur in a
        // 2-faction game, but the builder still withholds it).
        const shown = att.faction === player || defenderSeen;
        const mist = shown && att.faction !== player && !attackerSeen;
        if (shown) {
          strikes.push(
            makeStrike('attack', ev.attackerId, att, ev.attackerCell, ev.defenderId, def, ev.defenderCell, ev.damage, mist, ev.breakdown),
          );
          shownVictims.add(ev.defenderId);
          if (!mist) fx.arcs.push({ from: ev.attackerCell, to: ev.defenderCell, faction: att.faction });
          fx.floaters.push({
            id: `f${slots.length}-0`,
            cell: ev.defenderCell,
            text: `−${ev.damage}`,
            mist,
            slot: slots.length,
          });
          summary.damageDealt[att.faction] += ev.damage;
          // Skirmish log line: attacker withheld when the strike is from the
          // mist — the defender (the player's own unit) is named, nothing else.
          strikeLine = mist
            ? [
                { t: nameOf(def.type), f: def.faction },
                { t: ` −${ev.damage} ` },
                { t: 'from the mist', f: 'mist' },
              ]
            : [
                { t: nameOf(att.type), f: att.faction },
                { t: ' → ' },
                { t: nameOf(def.type), f: def.faction },
                { t: ` −${ev.damage}` },
              ];
        }
        def.count = ev.defenderCountAfter;

        if (ev.counterFired && j < events.length && events[j]!.type === 'counter') {
          const ce = events[j]! as Extract<ResolutionEvent, { type: 'counter' }>;
          // Counter roles: original defender returns fire at the attacker.
          const cAtt = sim.get(ce.attackerId);
          const cDef = sim.get(ce.defenderId);
          if (cAtt && cDef) {
            const cAttSeen = seen(cAtt.faction, ce.attackerCell, vis);
            const cShown = cAtt.faction === player || seen(cDef.faction, ce.defenderCell, vis);
            const cMist = cShown && cAtt.faction !== player && !cAttSeen;
            if (cShown) {
              strikes.push(
                makeStrike('counter', ce.attackerId, cAtt, ce.attackerCell, ce.defenderId, cDef, ce.defenderCell, ce.damage, cMist, ce.breakdown),
              );
              shownVictims.add(ce.defenderId);
              if (!cMist) fx.arcs.push({ from: ce.attackerCell, to: ce.defenderCell, faction: cAtt.faction });
              fx.floaters.push({
                id: `f${slots.length}-1`,
                cell: ce.defenderCell,
                text: `−${ce.damage}`,
                mist: cMist,
                slot: slots.length,
              });
              summary.damageDealt[cAtt.faction] += ce.damage;
              if (strikeLine) strikeLine.push({ t: ` / counter −${ce.damage}` });
            }
            cDef.count = ce.defenderCountAfter;
          }
          j++;
        }
      }

      const kills = consumeKills(j, vis, shownVictims);
      j = kills.next;
      fx.kills = kills.shown;

      if (strikes.length > 0 || fx.kills.length > 0) {
        const mistSlot = strikes.length > 0 && strikes[0]!.fromMist;
        const slot = slots.length;
        slots.push({
          kind: 'volley',
          actorType: mistSlot ? null : (att?.type ?? null),
          actorFaction: mistSlot ? null : (att?.faction ?? null),
          strikes,
        });
        // Camera target: attacker+defender of shown strikes (mist attacker
        // cells are already null — only the impact is framed) + shown kills.
        const focus = new Set<CellId>();
        for (const s of strikes) {
          if (s.attackerCell !== null) focus.add(s.attackerCell);
          focus.add(s.defenderCell);
        }
        for (const k of fx.kills) focus.add(k.cell);
        const visAfter = vision(); // deaths may have shrunk player vision
        frames.push({
          duration: VOLLEY_MS,
          slot,
          units: renderUnits(visAfter),
          fog: fogOf(visAfter),
          ...fx,
          focus: [...focus],
        });
        if (strikeLine) log.push({ atFrame: frames.length - 1, segs: strikeLine });
        logKills(fx.kills, frames.length - 1);
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
      fx.kills = kills.shown;
      if (shown) {
        const slot = slots.length;
        slots.push({
          kind: 'brawl',
          actorType: hi?.type ?? null,
          actorFaction: hi?.faction ?? null,
          strikes,
        });
        const visAfter = vision();
        frames.push({
          duration: followup ? BRAWL_FOLLOWUP_MS : VOLLEY_MS,
          slot,
          units: renderUnits(visAfter),
          fog: fogOf(visAfter),
          ...fx,
          focus: [ev.cell],
        });
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
        logKills(fx.kills, frames.length - 1);
      }
      i = j;
      continue;
    }

    if (ev.type === 'lost-target') {
      const att = sim.get(ev.attackerId);
      const vis = vision();
      if (att && seen(att.faction, att.cell, vis)) {
        summary.fizzles += 1;
        const slot = slots.length;
        slots.push({ kind: 'fizzle', actorType: att.type, actorFaction: att.faction, strikes: [] });
        frames.push({
          duration: FIZZLE_MS,
          slot,
          units: renderUnits(vis),
          fog: fogOf(vis),
          ...emptyFx(),
          floaters: [{ id: `f${slot}-0`, cell: att.cell, text: 'no target', mist: false, slot }],
          focus: [att.cell],
        });
        log.push({
          atFrame: frames.length - 1,
          segs: [{ t: nameOf(att.type), f: att.faction }, { t: ' holds fire — target lost' }],
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

  return { slots, frames, summary, log };
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
