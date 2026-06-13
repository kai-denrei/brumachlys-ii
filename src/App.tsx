// App — shell screens (spec §9.6): start ↔ battle, driven by the Zustand
// store. P7: the battle screen is the order-entry surface — Layer 1 (what can
// be decided, §9.2) and Layer 2 (what is about to happen, §9.3) plus the
// §9.5 long-press info sheet. P8: the full game loop — commit → AI plans →
// resolver → Layer-3 animated replay (§9.4) through the player's fog (§7),
// round summary, win/draw banner, New Battle (§4.3).
//
// Playback driver: the replay script (state/replay.ts) is a flat list of
// fixed-duration frames; a timer walks them, durations divided by the speed
// factor. Move animation rides the P6 CSS hook — tokens transition their
// transform, so updating a unit's cell per 250 ms frame glides it cell to
// cell. `skip` jumps to the final frame and opens the summary. The breakdown
// modal pauses playback while open.
//
// P9 camera + affordances:
// - Auto-follow: each frame carries `focus` cells; the Board eases the view
//   to keep them framed. A manual pan/pinch/wheel during playback SUSPENDS
//   following for the rest of the current timeline slot (the user is looking
//   at something); it resumes on the next event group, or immediately via
//   the ⌖ recenter button in the replay dock.
// - Last-volley linger: the most recent damage floaters stay on the board
//   (settled, still tappable → breakdown) for ~2 s after their frame ends or
//   until the next volley replaces them.
//
// ?autopilot=greedy (dev/demo flag, kept on purpose): faction 0 is planned by
// the same greedy AI on commit-less rounds — auto-commits each planning phase
// and auto-dismisses summaries, so a full game fast-forwards to the banner
// organically. Useful for demos and for exercising long games by hand.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BASELESS_GRACE,
  assumedTerrainView,
  findConvergences,
  movementCostsFor,
  orderedUnitIds,
  plannedEndCell,
  reachableCells,
  visibleCells,
} from './core';
import { findPath } from './core/pathing';
import { occupantVacates, type OrderKind } from './core/orders';
import type { FactionId, Stance, UnitInstance } from './core/types';
import { cellsWithin, graphDistance } from './board/geometry';
import type { CellId } from './board/types';
import { loadUnits } from './io/data-loader';
import type { ReplayFrame } from './state/replay';
import { PLAYER_FACTION, useAppStore } from './state/store';
import { Board, type StancePopoverState } from './ui/Board';
import { BottomDock, type DockBuy } from './ui/BottomDock';
import { BuildSheet } from './ui/BuildSheet';
import { CasualtyPanel } from './ui/CasualtyPanel';
import { BreakdownModal, GameOverBanner, ReplayDock, SummarySheet } from './ui/Replay';
import { InfoSheet, OrderSheet, UnitHoverCard } from './ui/Sheets';
import { SkirmishLog } from './ui/SkirmishLog';
import { StartScreen } from './ui/StartScreen';
import { TopBar, type CreditsHud } from './ui/TopBar';
import { TopCta } from './ui/TopCta';
import type { BuyGhostMark, GhostOrder, ImpactMark, TrailMark } from './ui/skin';
import { resolvePlanDirective } from './state/store';

/** v1.3 Tweak B: a finished trail lingers (fading) this long before removal —
 * the CSS opacity transition (~1.6 s) runs inside this window. */
const TRAIL_LINGER_MS = 1900;

/** E1 ignition: a dark → live cell keeps its fading cover this long — the
 * 0.4 s CSS fade runs inside it even when 250 ms move frames advance past. */
const IGNITE_LINGER_MS = 500;

type SheetState =
  | { kind: 'order'; unitId: string }
  | { kind: 'info'; cellId: CellId }
  | { kind: 'build'; baseCell: CellId } // E3 conquest: tap an owned base
  | null;

function urlFlag(name: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(name);
}

function BattleScreen() {
  const board = useAppStore((s) => s.board);
  const game = useAppStore((s) => s.game);
  const uiPhase = useAppStore((s) => s.uiPhase);
  const replay = useAppStore((s) => s.replay);
  const replaySpeed = useAppStore((s) => s.replaySpeed);
  const orders = useAppStore((s) => s.orders);
  const buys = useAppStore((s) => s.buys);
  const directive = useAppStore((s) => s.directive);
  const applyDirective = useAppStore((s) => s.applyDirective);
  const clearOrders = useAppStore((s) => s.clearOrders);
  const selectedUnitId = useAppStore((s) => s.selectedUnitId);
  const focus = useAppStore((s) => s.focus);
  const notice = useAppStore((s) => s.notice);
  const battleLog = useAppStore((s) => s.battleLog);
  const casualties = useAppStore((s) => s.casualties);
  const exitBattle = useAppStore((s) => s.exitBattle);
  const selectUnit = useAppStore((s) => s.selectUnit);
  const centerOn = useAppStore((s) => s.centerOn);
  const tryQueueOrder = useAppStore((s) => s.tryQueueOrder);
  const removeUnitOrder = useAppStore((s) => s.removeUnitOrder);
  const tryQueueBuy = useAppStore((s) => s.tryQueueBuy);
  const removeBuyOrder = useAppStore((s) => s.removeBuyOrder);
  const commit = useAppStore((s) => s.commit);
  const setReplaySpeed = useAppStore((s) => s.setReplaySpeed);
  const finishReplay = useAppStore((s) => s.finishReplay);
  const closeSummary = useAppStore((s) => s.closeSummary);
  const rematch = useAppStore((s) => s.rematch);

  const [sheet, setSheet] = useState<SheetState>(null);
  const types = useMemo(() => loadUnits(), []);
  const autopilot = useMemo(() => urlFlag('autopilot') === 'greedy', []);

  // v1.1 Feature A: mouse-hover unit card (Board detects; this renders).
  const [hover, setHover] = useState<{ unitId: string; clientX: number; clientY: number } | null>(
    null,
  );
  // v1.1 Feature D: skirmish log — open by default on ≥700px viewports.
  const logDefaultOpen = useMemo(
    () => typeof window !== 'undefined' && window.innerWidth >= 700,
    [],
  );

  const units = useMemo(
    () => (game ? Object.values(game.units).filter((u) => u.count > 0) : []),
    [game],
  );

  // --- replay playback driver (§9.4) ------------------------------------------
  const script = replay?.script ?? null;
  const [frameIdx, setFrameIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [breakdownSlot, setBreakdownSlot] = useState<number | null>(null);
  // P9 auto-follow suspension: the slot during which the user grabbed the
  // camera. Following resumes when playback moves to a different slot (the
  // comparison below), or via the recenter button (clears + bumps the token).
  const [suspendedAt, setSuspendedAt] = useState<number | null>(null);
  const [recenterBump, setRecenterBump] = useState(0);
  // P9 last-volley linger: the latest floaters stay tappable ~2 s.
  const [linger, setLinger] = useState<{ floaters: ReplayFrame['floaters'] } | null>(null);
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // v1.3 Tweak B: movement origin trails. Frames carry the in-progress move's
  // trail; when it stops appearing (move done) it flips to `fading` (CSS
  // opacity transition) and is removed after TRAIL_LINGER_MS. Cleared at
  // planning start. Multiple simultaneous (fading) trails are fine.
  const [trails, setTrails] = useState<TrailMark[]>([]);
  const trailTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  function clearTrails() {
    for (const t of trailTimers.current.values()) clearTimeout(t);
    trailTimers.current.clear();
    setTrails((cur) => (cur.length === 0 ? cur : []));
  }

  // E1 replay ignition: cells whose dark cover is mid-fade (frame.ignite
  // started it; each lingers IGNITE_LINGER_MS so the 0.4 s CSS fade finishes
  // even when faster frames advance underneath).
  const [ignites, setIgnites] = useState<ReadonlySet<CellId>>(new Set());
  const igniteTimers = useRef(new Map<CellId, ReturnType<typeof setTimeout>>());

  function clearIgnites() {
    for (const t of igniteTimers.current.values()) clearTimeout(t);
    igniteTimers.current.clear();
    setIgnites((cur) => (cur.size === 0 ? cur : new Set()));
  }

  // New script → restart playback.
  useEffect(() => {
    setFrameIdx(0);
    setPaused(false);
    setBreakdownSlot(null);
    setSheet(null);
    setSuspendedAt(null);
    setLinger(null);
    setHover(null);
    clearIgnites();
  }, [script]);

  // E1 ignition driver: each frame's dark → live deltas start a soft fade.
  useEffect(() => {
    if (uiPhase === 'planning' || !script) {
      clearIgnites();
      return;
    }
    const fr = script.frames[Math.min(frameIdx, script.frames.length - 1)];
    if (!fr || fr.ignite.length === 0) return;
    setIgnites((cur) => new Set([...cur, ...fr.ignite]));
    for (const cell of fr.ignite) {
      const pending = igniteTimers.current.get(cell);
      if (pending) clearTimeout(pending);
      igniteTimers.current.set(
        cell,
        setTimeout(() => {
          igniteTimers.current.delete(cell);
          setIgnites((cur) => {
            if (!cur.has(cell)) return cur;
            const next = new Set(cur);
            next.delete(cell);
            return next;
          });
        }, IGNITE_LINGER_MS),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiPhase, script, frameIdx]);
  useEffect(() => clearIgnites, []); // unmount: drop pending timers

  // Phase flips reuse the same <Board> instance — drop a stale hover card.
  useEffect(() => setHover(null), [uiPhase]);

  useEffect(() => {
    if (uiPhase !== 'replay' || !script) return;
    if (replaySpeed === 'skip') {
      setFrameIdx(script.frames.length - 1);
      finishReplay();
      return;
    }
    if (paused || breakdownSlot !== null) return;
    const frame = script.frames[frameIdx];
    if (!frame) {
      finishReplay();
      return;
    }
    const t = setTimeout(() => {
      if (frameIdx + 1 >= script.frames.length) finishReplay();
      else setFrameIdx(frameIdx + 1);
    }, frame.duration / replaySpeed);
    return () => clearTimeout(t);
  }, [uiPhase, script, frameIdx, paused, breakdownSlot, replaySpeed, finishReplay]);

  // P9 linger: when a frame lands floaters, hold them (settled, tappable)
  // past the frame — replaced by the next volley's, expired after 2 s. The
  // timer lives in a ref so unrelated frame advances don't clear it.
  useEffect(() => {
    if (uiPhase !== 'replay' || !script) return;
    const fr = script.frames[Math.min(frameIdx, script.frames.length - 1)];
    if (!fr || fr.floaters.length === 0) return;
    setLinger({ floaters: fr.floaters });
    if (lingerTimer.current) clearTimeout(lingerTimer.current);
    lingerTimer.current = setTimeout(() => setLinger(null), 2000);
  }, [uiPhase, script, frameIdx]);
  useEffect(
    () => () => {
      if (lingerTimer.current) clearTimeout(lingerTimer.current);
    },
    [],
  );

  // v1.3 trails: sync with the current frame's active trails. A trail absent
  // from the frame (its move completed) starts fading and self-removes; one
  // still present is upserted with its latest (growing) path.
  useEffect(() => {
    if (uiPhase === 'planning' || !script) {
      clearTrails(); // planning phase start: trails clear (Tweak B contract)
      return;
    }
    const fr = script.frames[Math.min(frameIdx, script.frames.length - 1)];
    if (!fr) return;
    const live = new Map(fr.trails.map((t) => [t.id, t]));
    setTrails((prev) => {
      if (prev.length === 0 && live.size === 0) return prev;
      const next: TrailMark[] = [];
      for (const t of prev) {
        if (live.has(t.id)) continue; // re-added below with the latest path
        if (!t.fading) {
          const timer = setTimeout(() => {
            trailTimers.current.delete(t.id);
            setTrails((cur) => cur.filter((x) => x.id !== t.id));
          }, TRAIL_LINGER_MS);
          trailTimers.current.set(t.id, timer);
          next.push({ ...t, fading: true });
        } else next.push(t);
      }
      for (const t of live.values()) {
        const pending = trailTimers.current.get(t.id);
        if (pending) {
          clearTimeout(pending); // paused/replayed frame: back to active
          trailTimers.current.delete(t.id);
        }
        next.push({ id: t.id, faction: t.faction, path: t.path, fading: false });
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiPhase, script, frameIdx]);
  useEffect(() => clearTrails, []); // unmount: drop pending removal timers

  // --- autopilot (dev/demo) ------------------------------------------------------
  useEffect(() => {
    if (!autopilot || !game) return;
    if (uiPhase === 'planning' && !game.outcome) {
      const t = setTimeout(() => useAppStore.getState().commitAutopilot(), 200);
      return () => clearTimeout(t);
    }
    if (uiPhase === 'summary') {
      const t = setTimeout(() => useAppStore.getState().closeSummary(), 250);
      return () => clearTimeout(t);
    }
  }, [autopilot, uiPhase, game]);

  // --- E3 conquest selectors -----------------------------------------------------
  const conquest = game?.mode === 'conquest';
  const gameBases = conquest ? game?.bases : undefined;
  const ownedBaseCount = (faction: FactionId): number =>
    gameBases ? Object.values(gameBases).filter((o) => o === faction).length : 0;
  /** Credits committed by queued buys (entry-validated ≤ available). */
  const committed = useMemo(
    () =>
      Object.values(buys).reduce((sum, b) => sum + (types[b.unitTypeKey]?.cost ?? 0), 0),
    [buys, types],
  );

  // --- planning selectors (P7, unchanged semantics over the game slice) --------
  const visible = useMemo(() => {
    if (!board) return new Set<CellId>();
    // E2/E3: owned bases contribute vision in conquest (gameBases is
    // undefined in skirmish — bit-identical to the pre-E2 call).
    return visibleCells(board, units, PLAYER_FACTION, types, gameBases);
  }, [board, units, types, gameBases]);

  const fog = useMemo(() => {
    if (!board) return undefined;
    const fogged = new Set<CellId>();
    for (const id of board.cells.keys()) {
      if (!visible.has(id)) fogged.add(id);
    }
    return fogged;
  }, [board, visible]);

  // E1 discovery (addendum §A): the player's ever-seen set — fogged cells in
  // it render as memory, outside it as dark. Seeded at battle start,
  // accumulated by the store after each round.
  const discovered = useMemo(
    () => game?.discovered?.[PLAYER_FACTION] ?? new Set<CellId>(),
    [game],
  );

  // E1 planning honesty: dark cells are ASSUMED plains (cost 3) by every
  // planning-side path/preview — the overlay must not leak unscouted terrain.
  // The resolver re-paths against truth and truncates on surprise.
  const assumedTerrain = useMemo(
    () => (board ? assumedTerrainView(board, discovered, visible) : undefined),
    [board, discovered, visible],
  );

  // Planning fog (spec §7): enemy units outside the player's vision union do
  // NOT exist in the planning view — they're filtered out of `units` here.
  const knownUnits = useMemo(
    () => units.filter((u) => u.faction === PLAYER_FACTION || visible.has(u.cell)),
    [units, visible],
  );

  // Live stance preview (§9.2/§10.2): a queued stance restyles the token's
  // stroke immediately, before commit.
  const boardUnits = useMemo(
    () =>
      knownUnits.map((u) => {
        const queued = orders[u.id]?.stance?.stance;
        return queued && queued !== u.stance ? { ...u, stance: queued } : u;
      }),
    [knownUnits, orders],
  );

  const selected = useMemo(() => {
    const u = selectedUnitId ? boardUnits.find((x) => x.id === selectedUnitId) : undefined;
    return u && u.faction === PLAYER_FACTION ? u : undefined;
  }, [boardUnits, selectedUnitId]);

  const friendlyAt = (cell: CellId, except?: string): UnitInstance | undefined =>
    knownUnits.find(
      (u) => u.cell === cell && u.faction === PLAYER_FACTION && u.id !== except && u.count > 0,
    );
  const visibleEnemyAt = (cell: CellId): UnitInstance | undefined =>
    knownUnits.find((u) => u.cell === cell && u.faction !== PLAYER_FACTION && u.count > 0);

  /** Pathing policy for planning (§2.5, mirrored in core validateOrder):
   * friendlies traversable but not a destination — UNLESS they have a queued
   * move elsewhere (v1.1 vacancy promise: the tile tints and is orderable);
   * VISIBLE enemies block traversal but are charge destinations; hidden
   * enemies don't exist. */
  const pathOpts = (unit: UnitInstance) => ({
    canStopAt: (c: CellId) => {
      const f = friendlyAt(c, unit.id);
      return !f || occupantVacates(f, orders);
    },
    canPassThrough: (c: CellId) => !visibleEnemyAt(c),
  });

  // --- Layer 1 (§9.2): reachable tint, target rings, vision edge --------------
  const layer1 = useMemo(() => {
    if (!board || !selected) return undefined;
    const ut = types[selected.type];
    if (!ut) return undefined;
    const costs = movementCostsFor(ut);
    const budget = ut.movement;
    // Tint shows moves available FROM THE CURRENT CELL (a new tap replaces
    // any queued move); rings show targets from the PLANNED end position —
    // "where could I go" vs "who can my current plan shoot".
    const reach = reachableCells(board, costs, selected.cell, budget, {
      ...pathOpts(selected),
      assumedTerrain,
    });
    const reachable = new Map<CellId, number>();
    for (const [cell, cost] of reach) reachable.set(cell, (budget - cost) / budget);

    const from = plannedEndCell(selected, orders[selected.id]);
    const targets = new Set<CellId>();
    for (const enemy of knownUnits) {
      if (enemy.faction === PLAYER_FACTION || enemy.count <= 0) continue;
      const d = graphDistance(board, from, enemy.cell);
      if (d >= ut.minRange && d <= ut.maxRange) targets.add(enemy.cell);
    }
    const visionEdge = new Set(cellsWithin(board, selected.cell, ut.vision));
    return { reachable, targets, visionEdge };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, selected, knownUnits, orders, types, assumedTerrain]);

  // --- Layer 2 (§9.3): ghost orders -------------------------------------------
  const ghosts = useMemo<GhostOrder[]>(() => {
    if (!board) return [];
    const converging = findConvergences(orders, knownUnits, PLAYER_FACTION);
    const convergingUnits = new Set<string>();
    for (const ids of converging.values()) for (const id of ids) convergingUnits.add(id);
    const out: GhostOrder[] = [];
    for (const unit of boardUnits) {
      if (unit.faction !== PLAYER_FACTION) continue;
      const uo = orders[unit.id];
      if (!uo || (!uo.move && !uo.attack)) continue;
      const dest = uo.move?.path[uo.move.path.length - 1];
      out.push({
        unit,
        movePath: uo.move?.path,
        attackTarget: uo.attack?.targetCell,
        attackFrom: plannedEndCell(unit, uo),
        converging: convergingUnits.has(unit.id),
        // charge ghosts offset beside the occupant (see GhostOrder docs)
        destOccupied:
          dest !== undefined && knownUnits.some((u) => u.cell === dest && u.id !== unit.id),
      });
    }
    return out;
  }, [board, boardUnits, knownUnits, orders]);

  // --- E3 conquest: queued-buy ghosts + dock chips (§B.4 messaging) -------------
  const buyGhosts = useMemo<BuyGhostMark[]>(() => {
    if (!conquest) return [];
    return Object.values(buys).map((b) => ({
      baseCell: b.baseCell,
      unit: {
        id: `buy-${b.baseCell}`,
        type: b.unitTypeKey,
        faction: PLAYER_FACTION,
        cell: b.baseCell,
        count: 10,
        stance: 'aggressive' as const,
        attackedFrom: [],
      },
      pill: `${types[b.unitTypeKey]?.name ?? b.unitTypeKey} purchased — arrives at round end`,
    }));
  }, [conquest, buys, types]);

  const dockBuys = useMemo<DockBuy[]>(
    () => buyGhosts.map((g) => ({ baseCell: g.baseCell, unit: g.unit })),
    [buyGhosts],
  );

  function openBuildSheet(baseCell: CellId) {
    centerOn(baseCell);
    setSheet({ kind: 'build', baseCell });
  }

  // --- interactions -------------------------------------------------------------
  function queueMoveTo(unit: UnitInstance, cell: CellId): boolean {
    if (!board) return false;
    const ut = types[unit.type];
    if (!ut) return false;
    const res = findPath(board, movementCostsFor(ut), unit.cell, cell, {
      budget: ut.movement,
      ...pathOpts(unit),
      assumedTerrain,
    });
    if (!res || res.path.length === 0) return false;
    return tryQueueOrder({ kind: 'move', unitId: unit.id, path: res.path }).ok;
  }

  /** Enemy interaction: attack if the plan can shoot it, else charge-move. */
  function engageEnemy(enemy: UnitInstance) {
    if (!selected) return;
    const attacked = tryQueueOrder({
      kind: 'attack',
      unitId: selected.id,
      targetCell: enemy.cell,
    });
    if (!attacked.ok) queueMoveTo(selected, enemy.cell);
  }

  function onUnitTap(unitId: string) {
    const unit = boardUnits.find((u) => u.id === unitId);
    if (!unit) return;
    if (unit.faction === PLAYER_FACTION) {
      selectUnit(unit.id === selectedUnitId ? null : unit.id);
    } else {
      engageEnemy(unit);
    }
  }

  function onCellTap(cellId: CellId) {
    if (!selected) {
      // E3 conquest: with nothing selected, tapping an OWNED base opens the
      // build sheet (a friendly standing on it catches the tap as a token —
      // deselect first, then tap the cell; the buy still queues fine since
      // vacancy is only checked at Phase E).
      if (conquest && uiPhase === 'planning' && gameBases?.[cellId] === PLAYER_FACTION) {
        setSheet({ kind: 'build', baseCell: cellId });
      }
      return;
    }
    if (cellId === selected.cell) return; // token tap toggles selection
    const enemy = visibleEnemyAt(cellId);
    if (enemy) {
      engageEnemy(enemy);
      return;
    }
    if (layer1?.reachable.has(cellId)) {
      queueMoveTo(selected, cellId);
      return;
    }
    // v1.1 (Feature C audit): a friendly-occupied cell used to fall through
    // to deselect — a tap that landed on a friend's cell silently killed the
    // plan, reading as "friendlies block movement". Behave like tapping the
    // friend's token instead: switch selection.
    const friend = friendlyAt(cellId);
    if (friend) {
      selectUnit(friend.id);
      return;
    }
    selectUnit(null); // tap elsewhere = deselect
  }

  /** v1.1 (Feature C root cause): ghost tokens render ABOVE cells and used to
   * swallow taps on their destination cell — with a unit selected, tapping a
   * cell covered by a friendly's queued-move ghost opened that friend's order
   * sheet instead of queueing the selected unit's move. Now: with a DIFFERENT
   * own unit selected, the tap falls through to the cell underneath; the
   * order sheet still opens when nothing is selected (or for the selected
   * unit's own ghost). */
  function onGhostTap(unitId: string) {
    if (selected && selected.id !== unitId) {
      const path = orders[unitId]?.move?.path;
      const dest = path && path.length > 0 ? path[path.length - 1] : undefined;
      if (dest !== undefined) {
        onCellTap(dest);
        return;
      }
    }
    setSheet({ kind: 'order', unitId });
  }

  // --- stance popover (§9.2) -----------------------------------------------------
  const stancePopover = useMemo<StancePopoverState | null>(() => {
    if (!selected) return null;
    const uo = orders[selected.id];
    return {
      active: uo?.stance?.stance ?? selected.stance,
      holdFireDisabled: !!uo?.attack,
      onPick: (stance: Stance) =>
        void tryQueueOrder({ kind: 'stance', unitId: selected.id, stance }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, orders]);

  if (!board || !game) return null;

  // --- replay rendering (§9.4 / §7) ----------------------------------------------
  const replayActive = uiPhase !== 'planning' && script !== null;
  const frame = replayActive
    ? script.frames[Math.min(frameIdx, script.frames.length - 1)]!
    : null;

  // P9 auto-follow: suspended while the user's grab-slot is still playing;
  // a new slot (or recenter) hands the camera back automatically.
  const followSuspended =
    frame !== null && suspendedAt !== null && frame.slot === suspendedAt;
  const follow =
    uiPhase === 'replay' && frame && !followSuspended && frame.focus.length > 0
      ? { cells: frame.focus, token: frameIdx + recenterBump * 1_000_000 }
      : null;

  // P9 linger: the current frame's own floaters win; otherwise the last
  // volley's pills stay on the board, settled but still breakdown-tappable.
  const fxFloaters =
    frame === null
      ? []
      : frame.floaters.length > 0
        ? frame.floaters
        : (linger?.floaters.map((f) => ({ ...f, linger: true })) ?? []);

  // v0.6 Ask 7 ("unit hit" verb): flash on the defender + recoil on the
  // attacker for every shown strike whose defender SURVIVES this frame —
  // dying defenders get the destruction verb (fx.kills) instead. Strikes come
  // from the frame's own timeline slot, so this only fires on the strike
  // frame itself (never on lingered floaters). Mist strikes already carry
  // attackerCell null — flash only, the source stays withheld.
  const fxImpacts: ImpactMark[] = (() => {
    if (!script || !frame || frame.slot < 0 || frame.floaters.length === 0) return [];
    const strikes = script.slots[frame.slot]?.strikes ?? [];
    if (strikes.length === 0) return [];
    const killed = new Set(frame.kills.map((k) => k.id));
    return strikes
      .filter((s) => !killed.has(s.defenderId))
      .map((s) => ({
        attackerId: s.attackerId,
        attackerCell: s.attackerCell,
        defenderId: s.defenderId,
        defenderCell: s.defenderCell,
      }));
  })();

  const own = units.filter((u) => u.faction === PLAYER_FACTION);
  const orderedIds = orderedUnitIds(orders);

  const sheetUnit =
    sheet?.kind === 'order' ? knownUnits.find((u) => u.id === sheet.unitId) : undefined;
  const sheetCell = sheet?.kind === 'info' ? board.cells.get(sheet.cellId) : undefined;
  const sheetOccupant =
    sheet?.kind === 'info' ? knownUnits.find((u) => u.cell === sheet.cellId) : undefined;

  const phaseChip = uiPhase === 'planning' ? 'planning' : uiPhase === 'over' ? 'over' : 'replay';
  const topRound = replayActive && replay ? replay.round : game.round;

  // E3 credits HUD: planning = available − committed (static); replay = the
  // frame's creditsAfter feed (income/spawn events tick it live).
  const creditsHud: CreditsHud | null = conquest
    ? frame
      ? { value: frame.credits ?? game.credits?.[PLAYER_FACTION] ?? 0 }
      : { value: game.credits?.[PLAYER_FACTION] ?? 0, committed }
    : null;

  // E3 baseless grace warning (§B.5): the player's own countdown only —
  // enemy baseless state is never surfaced.
  const playerBaseless = conquest && uiPhase !== 'over' && ownedBaseCount(PLAYER_FACTION) === 0;
  const graceLeft = Math.max(1, BASELESS_GRACE - (game.baseless?.[PLAYER_FACTION] ?? 0));

  // E3: replay base tint follows the frame (captures flip it mid-playback).
  const boardBases = conquest ? (frame ? frame.bases : gameBases) : undefined;

  // v1.1 hover card: resolve the hovered unit against whatever the Board is
  // rendering right now (fog-filtered frame units during replay) — both
  // factions' visible units carry cards.
  const hoverUnit = hover
    ? (frame ? frame.units : boardUnits).find((u) => u.id === hover.unitId)
    : undefined;
  const hoverType = hoverUnit ? types[hoverUnit.type] : undefined;
  const hoverCard =
    hover && hoverUnit && hoverType ? (
      <UnitHoverCard
        unit={hoverUnit}
        unitType={hoverType}
        clientX={hover.clientX}
        clientY={hover.clientY}
      />
    ) : null;

  return (
    <div className="app">
      <TopBar round={topRound} phase={phaseChip} credits={creditsHud} onBack={exitBattle} />
      {playerBaseless && (
        <div className="baseless-warning" role="alert" data-testid="baseless-warning">
          no bases — {graceLeft} round{graceLeft === 1 ? '' : 's'} to retake one
        </div>
      )}
      {/* v0.6 Ask 1: the primary CTA floats top-center, below the bar —
          COMMIT during planning, CONTINUE over the round summary. Replay
          keeps its speed controls in the bottom dock. */}
      {(uiPhase === 'planning' || (uiPhase === 'summary' && breakdownSlot === null)) && (
        <TopCta
          phase={uiPhase === 'planning' ? 'planning' : 'summary'}
          done={own.filter((u) => orderedIds.has(u.id)).length}
          total={own.length}
          buys={dockBuys.length}
          directive={directive}
          directivesEnabled={resolvePlanDirective() !== null}
          onCommit={() => commit()}
          onContinue={closeSummary}
          onDirective={applyDirective}
          onClearAll={clearOrders}
        />
      )}
      <main className="board-area">
        {frame ? (
          <Board
            board={board}
            units={frame.units}
            fog={frame.fog}
            discovered={frame.discovered}
            ignite={ignites}
            bases={boardBases}
            replayFx={{
              key: frameIdx,
              fx: {
                arcs: frame.arcs,
                floaters: fxFloaters,
                bursts: frame.bursts,
                kills: frame.kills,
                spawns: frame.spawns,
                captures: frame.captures,
                impacts: fxImpacts,
              },
            }}
            trails={trails}
            onFloaterTap={(slot) => {
              // E3: spawn-failed floaters point at strike-less slots — no math
              // to show, so don't open an empty breakdown modal.
              if (script && (script.slots[slot]?.strikes.length ?? 0) > 0) setBreakdownSlot(slot);
            }}
            follow={follow}
            onUserPan={() => {
              if (uiPhase === 'replay' && frame) setSuspendedAt(frame.slot);
            }}
            onUnitHover={setHover}
            className={replaySpeed === 2 ? 'board-replay-2x' : undefined}
          />
        ) : (
          <Board
            board={board}
            units={boardUnits}
            fog={fog}
            discovered={discovered}
            bases={boardBases}
            buyGhosts={buyGhosts}
            onBuyGhostTap={openBuildSheet}
            highlights={layer1}
            selectedUnitId={selected?.id ?? null}
            ghosts={ghosts}
            focus={focus}
            stancePopover={stancePopover}
            onCellTap={onCellTap}
            onUnitTap={onUnitTap}
            onGhostTap={onGhostTap}
            onUnitHover={setHover}
            onCellLongPress={(cellId) => setSheet({ kind: 'info', cellId })}
          />
        )}
      </main>
      <CasualtyPanel casualties={casualties} unitTypes={types} />
      <SkirmishLog
        history={battleLog}
        live={
          replayActive && script && replay
            ? { round: replay.round, entries: script.log, upToFrame: frameIdx }
            : null
        }
        defaultOpen={logDefaultOpen}
      />
      {notice && !replayActive && (
        <div className="order-notice" key={notice.token} role="status">
          {notice.text}
        </div>
      )}
      {hoverCard}
      {replayActive && script ? (
        <ReplayDock
          slots={script.slots}
          activeSlot={frame?.slot ?? -1}
          speed={replaySpeed}
          paused={paused}
          done={uiPhase !== 'replay'}
          onSpeed={setReplaySpeed}
          onTogglePause={() => setPaused((p) => !p)}
          onSlotTap={(slot) => setBreakdownSlot(slot)}
          onRecenter={
            followSuspended && uiPhase === 'replay'
              ? () => {
                  setSuspendedAt(null);
                  setRecenterBump((b) => b + 1);
                }
              : null
          }
        />
      ) : (
        <BottomDock
          units={own}
          ordersByUnit={orderedIds}
          buys={dockBuys}
          onChipTap={(unitId) => {
            const unit = own.find((u) => u.id === unitId);
            if (!unit) return;
            selectUnit(unitId);
            centerOn(unit.cell);
          }}
          onBuyChipTap={openBuildSheet}
        />
      )}
      {breakdownSlot !== null && script?.slots[breakdownSlot] && (
        <BreakdownModal
          slot={script.slots[breakdownSlot]!}
          unitTypes={types}
          onClose={() => setBreakdownSlot(null)}
        />
      )}
      {uiPhase === 'summary' && replay && breakdownSlot === null && (
        <SummarySheet
          round={replay.round}
          summary={replay.script.summary}
          unitTypes={types}
          onClose={closeSummary}
        />
      )}
      {uiPhase === 'over' && game.outcome && (
        <GameOverBanner
          outcome={game.outcome}
          conquest={
            conquest
              ? { playerBases: ownedBaseCount(PLAYER_FACTION), enemyBases: ownedBaseCount(1) }
              : null
          }
          seedSuggestion={Date.now() % 1_000_000}
          onRematch={rematch}
          onChangeBattlefield={exitBattle}
        />
      )}
      {sheet?.kind === 'build' && !replayActive && conquest && (
        <BuildSheet
          baseCell={sheet.baseCell}
          unitTypes={types}
          credits={game.credits?.[PLAYER_FACTION] ?? 0}
          committedElsewhere={
            committed - (types[buys[sheet.baseCell]?.unitTypeKey ?? '']?.cost ?? 0)
          }
          queued={buys[sheet.baseCell]}
          onQueue={(unitTypeKey) => {
            const verdict = tryQueueBuy({ kind: 'buy', baseCell: sheet.baseCell, unitTypeKey });
            if (verdict.ok) setSheet(null); // ghost + pill confirm on the board
          }}
          onRemove={() => removeBuyOrder(sheet.baseCell)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheetUnit && !replayActive && (
        <OrderSheet
          unit={sheetUnit}
          unitType={types[sheetUnit.type]}
          orders={orders[sheetUnit.id] ?? {}}
          targetName={(() => {
            const t = orders[sheetUnit.id]?.attack?.targetCell;
            if (t === undefined) return undefined;
            const enemy = visibleEnemyAt(t);
            return enemy ? types[enemy.type]?.name : undefined;
          })()}
          onEdit={() => {
            selectUnit(sheetUnit.id);
            setSheet(null);
          }}
          onRemove={(kind: OrderKind) => {
            removeUnitOrder(sheetUnit.id, kind);
            const remaining = useAppStore.getState().orders[sheetUnit.id];
            if (!remaining) setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheetCell && !replayActive && (
        <InfoSheet
          cell={sheetCell}
          occupant={sheetOccupant}
          occupantType={sheetOccupant ? types[sheetOccupant.type] : undefined}
          unitTypes={types}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

export function App() {
  const screen = useAppStore((s) => s.screen);
  return screen === 'start' ? <StartScreen /> : <BattleScreen />;
}
