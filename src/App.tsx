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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BASELESS_GRACE,
  assumedTerrainView,
  enemyFrictionAt,
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
import { cellsWithin, cellsWithinD, graphDistance } from './board/geometry';
import type { CellId } from './board/types';
import { loadUnits } from './io/data-loader';
import type { ReplayFrame } from './state/replay';
import { PLAYER_FACTION, useAppStore } from './state/store';
import { Board, type CaptureToggleState, type StancePopoverState } from './ui/Board';
import { BottomDock, type DockBuy } from './ui/BottomDock';
import { BuildSheet } from './ui/BuildSheet';
import { CasualtyPanel } from './ui/CasualtyPanel';
import { HudCluster } from './ui/HudCluster';
import { BreakdownModal, GameOverBanner, ReplayDock, SummarySheet } from './ui/Replay';
import { InfoSheet, OrderSheet, UnitHoverCard } from './ui/Sheets';
import { SkirmishLog } from './ui/SkirmishLog';
import { StartScreen } from './ui/StartScreen';
import { TopBar, type CreditsHud } from './ui/TopBar';
import { TopCta } from './ui/TopCta';
import type { BuildPipMark, BuyGhostMark, CaptureIntentMark, GhostOrder, ImpactMark, ProposalGhostMark, TrailMark } from './ui/skin';
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
  // E3 conquest: tap an owned base. v0.7 Item 3: `anchor` is the client-space
  // point the user tapped — the compact build card pops up over it (clamped).
  | { kind: 'build'; baseCell: CellId; anchor?: { x: number; y: number } }
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
  const pendingMove = useAppStore((s) => s.pendingMove);
  const focus = useAppStore((s) => s.focus);
  const notice = useAppStore((s) => s.notice);
  const battleLog = useAppStore((s) => s.battleLog);
  const casualties = useAppStore((s) => s.casualties);
  const exitBattle = useAppStore((s) => s.exitBattle);
  const selectUnit = useAppStore((s) => s.selectUnit);
  const proposeMove = useAppStore((s) => s.proposeMove);
  const commitPendingMove = useAppStore((s) => s.commitPendingMove);
  const clearPendingMove = useAppStore((s) => s.clearPendingMove);
  const centerOn = useAppStore((s) => s.centerOn);
  const tryQueueOrder = useAppStore((s) => s.tryQueueOrder);
  const removeUnitOrder = useAppStore((s) => s.removeUnitOrder);
  const queueCapture = useAppStore((s) => s.queueCapture);
  const removeCapture = useAppStore((s) => s.removeCapture);
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

  // v0.9 radar: the unit whose shooting-range distances are displayed on the
  // board. null = overlay hidden. Toggled by tapping the bottom-left radar pip
  // on own units during planning. Cleared on phase change (planning exits).
  const [rangeOverlayUnit, setRangeOverlayUnit] = useState<string | null>(null);

  // #5 auto-advance: "Your turn — R{n}" announcement token (null = not shown).
  // The announcement appears when replay finishes (summary phase), auto-fades
  // after ~1.9 s via CSS animation. A JS backstop timer (2200 ms) clears it
  // regardless of CSS — required for prefers-reduced-motion users where the
  // CSS animation is disabled and opacity stays at 1 indefinitely.
  type AnnouncementState = {
    round: number;
    token: number;
    /** Snapshot of the round's kills/damage/fizzles — shown briefly so the
     * player can read the recap without blocking their planning input. */
    summarySnap: {
      damageDealt: readonly [number, number];
      killCount: number;
      fizzles: number;
    } | null;
  };
  const [announcement, setAnnouncement] = useState<AnnouncementState | null>(null);
  // Ref holding the active backstop timer so it can be cleared on early dismiss
  // or when a new announcement replaces an existing one.
  const announcementTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // v0.9 radar: clear the overlay whenever the phase leaves planning — the
  // measurement is only meaningful while the player can act on it.
  useEffect(() => {
    if (uiPhase !== 'planning') setRangeOverlayUnit(null);
  }, [uiPhase]);

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
    // #5: autopilot still closes summary — but in normal play the auto-advance
    // below handles it; autopilot just fires faster to keep the demo running.
    if (uiPhase === 'summary') {
      const t = setTimeout(() => useAppStore.getState().closeSummary(), 250);
      return () => clearTimeout(t);
    }
  }, [autopilot, uiPhase, game]);

  // --- #5 auto-advance: summary → planning with "Your turn" announcement -------
  // When replay finishes, uiPhase goes to 'summary'. If the game is NOT over,
  // auto-call closeSummary (the same transition the old CONTINUE pill used),
  // then show a brief "Your turn — R{n}" toast (with a mini recap snapshot) so
  // the player knows they can act. The announcement is non-blocking (pointer-
  // events: none on the overlay; tapping it dismisses early). The CSS animation
  // fades it out at ~1.9 s. A JS backstop timer (2200 ms) calls dismissAnnouncement
  // unconditionally — under prefers-reduced-motion the CSS sets animation:none and
  // opacity:1, so the CSS never removes the pill; the timer is the sole lifecycle
  // owner. Game-over path: closeSummary transitions to 'over' — that banner is
  // deliberate and is NOT auto-dismissed.
  useEffect(() => {
    if (uiPhase !== 'summary' || autopilot || !game || game.outcome) return;
    // Next round number = game.round (closeSummary has NOT run yet; the core
    // resolver already advanced game.round in commit() before returning).
    const nextRound = game.round;

    // Snapshot the replay summary NOW before closeSummary sets replay → null.
    const replayState = useAppStore.getState().replay;
    const summarySnap = replayState
      ? {
          damageDealt: replayState.script.summary.damageDealt as readonly [number, number],
          killCount: replayState.script.summary.kills.length,
          fizzles: replayState.script.summary.fizzles,
        }
      : null;

    // Transition immediately — no perceptible delay. The announcement overlays
    // the (now-planning) board and fades on its own schedule.
    useAppStore.getState().closeSummary();
    // Clear any previous backstop timer before setting a new announcement.
    if (announcementTimer.current !== null) clearTimeout(announcementTimer.current);
    setAnnouncement((prev) => ({
      round: nextRound,
      token: (prev?.token ?? 0) + 1,
      summarySnap,
    }));
    // Backstop timer: clears the announcement after 2200 ms regardless of CSS.
    // This is the primary dismissal path for prefers-reduced-motion users (where
    // the CSS fade is disabled and opacity stays 1 forever). It also covers normal
    // users in case the animationend event is never fired (detached nodes, etc.).
    announcementTimer.current = setTimeout(() => {
      announcementTimer.current = null;
      setAnnouncement(null);
    }, 2200);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiPhase, autopilot, game?.outcome]);

  // Dismiss the "Your turn" announcement early (tapping it or pressing Enter).
  // Also cancels the pending backstop timer so it doesn't fire on a null state.
  const dismissAnnouncement = useCallback(() => {
    if (announcementTimer.current !== null) {
      clearTimeout(announcementTimer.current);
      announcementTimer.current = null;
    }
    setAnnouncement(null);
  }, []);

  // FIX B: when the phase leaves planning (e.g., commit → 'replay'), clear the
  // announcement state AND cancel its pending backstop timer so the pill never
  // floats over the replay strip or the game-over summary.
  //
  // Implementation note: we track the PREVIOUS phase in a ref so the effect
  // only fires on the transition FROM 'planning', not on the initial mount when
  // uiPhase may already be 'summary' (where the announcement hasn't been set yet
  // and dismissAnnouncement would race with the auto-advance effect).
  const prevUiPhaseRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevUiPhaseRef.current;
    prevUiPhaseRef.current = uiPhase;
    if (prev === 'planning' && uiPhase !== 'planning') dismissAnnouncement();
  }, [uiPhase, dismissAnnouncement]);

  // --- #6 [Enter] finalizes the current action -----------------------------------
  // Global keydown listener. ENTER PRIORITY ORDER (deliberate, documented):
  //   1. text field focused → ignore (don't interfere with form inputs).
  //   2. "Your turn" announcement visible → dismiss it ("proceed").
  //   3. v0.9 a PENDING MOVE proposal exists → COMMIT that proposal (same as a
  //      second tap / switching units). Enter VALIDATES the pending proposal
  //      FIRST and stops there — it does NOT also commit the round. This makes
  //      Enter a single, predictable "confirm what I'm pointing at" key: the
  //      player presses Enter to lock in the move they just proposed, then
  //      presses Enter AGAIN (now with no pending proposal) to commit the round.
  //   4. no pending proposal, planning, ≥1 order/buy queued → COMMIT the round
  //      (mirrors only the non-zero branch of the CTA pill — the zero-orders
  //      path triggers a confirm dialog in TopCta that Enter intentionally does
  //      not open; the player must tap COMMIT explicitly for that flow).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter') return;
      // (1) Ignore if a text field is focused.
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      // (2) Dismiss the "Your turn" announcement first — Enter = "proceed".
      if (announcement) {
        dismissAnnouncement();
        return;
      }
      if (uiPhase === 'planning' && game && !game.outcome) {
        const state = useAppStore.getState();
        // (3) Pending MOVE proposal → commit it and STOP (don't fall through to
        // round-commit). One Enter confirms the proposal; a second commits.
        if (state.pendingMove) {
          e.preventDefault();
          state.commitPendingMove();
          return;
        }
        // (4) No pending proposal → commit the round if anything is queued.
        const hasOrders =
          Object.keys(state.orders).length > 0 || Object.keys(state.buys).length > 0;
        if (hasOrders) {
          e.preventDefault();
          state.commit();
        }
        // Zero-orders case: let the user explicitly use the COMMIT pill confirm —
        // Enter should not silently commit an empty round. (Same guard as TopCta.)
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [uiPhase, game, announcement, dismissAnnouncement]);

  // v0.9: Escape clears a pending MOVE proposal (and, with no proposal, keeps
  // the existing deselect behavior). A dedicated listener — Escape had no
  // global handler before; it just cancels the transient proposal layer here.
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      const state = useAppStore.getState();
      if (state.pendingMove) {
        state.clearPendingMove();
        return;
      }
      // No pending proposal: deselect (preserve the prior "Escape deselects"
      // expectation — selecting nothing is the calm reset).
      if (state.selectedUnitId) state.selectUnit(null);
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

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
    // v0.9 ENEMY FRICTION (movement friction near enemies): cells holding a
    // VISIBLE enemy add a soft per-step movement malus to ENTER an adjacent
    // cell (core/pathing enemyFrictionAt). Feed the SAME helper into the reach
    // search so the highlighted reach SHRINKS near enemies — the primary
    // message: the player SEES reduced reach (hidden enemies stay a resolution
    // surprise by design). Built from the rendered enemy units (visible,
    // opposing faction, alive).
    const visibleEnemyCells = new Set<CellId>();
    for (const e of knownUnits) {
      if (e.faction !== PLAYER_FACTION && e.count > 0) visibleEnemyCells.add(e.cell);
    }
    // Tint shows moves available FROM THE CURRENT CELL (a new tap replaces
    // any queued move); rings show targets from the PLANNED end position —
    // "where could I go" vs "who can my current plan shoot".
    const reach = reachableCells(board, costs, selected.cell, budget, {
      ...pathOpts(selected),
      assumedTerrain,
      extraCostAt: (c) => enemyFrictionAt(board, c, visibleEnemyCells),
    });
    const reachable = new Map<CellId, number>();
    // Friction cells: reachable cells whose ENTRY pays enemy friction (they
    // border a visible enemy). The Board tints these distinctly — a "slowed
    // here" cue so the malus is legible at planning, not a hidden surprise.
    const frictionCells = new Set<CellId>();
    for (const [cell, cost] of reach) {
      reachable.set(cell, (budget - cost) / budget);
      if (enemyFrictionAt(board, cell, visibleEnemyCells) > 0) frictionCells.add(cell);
    }

    const from = plannedEndCell(selected, orders[selected.id]);
    const targets = new Set<CellId>();
    for (const enemy of knownUnits) {
      if (enemy.faction === PLAYER_FACTION || enemy.count <= 0) continue;
      const d = graphDistance(board, from, enemy.cell);
      if (d >= ut.minRange && d <= ut.maxRange) targets.add(enemy.cell);
    }
    // v0.9 preemptive fire (area denial): a RANGED unit (maxRange > 1) may also
    // aim at an EMPTY, visible, in-range cell — the resolver hits whoever moves
    // there (enemy → hit; empty/friendly → fizzle). Surface those cells as a
    // distinct dashed aim-ring. Excluded cells: any occupant (enemy ones are
    // already solid target-rings, friendly ones aren't legal targets) AND any
    // movement-reachable cell — onCellTap treats reachable cells as a MOVE, so
    // an aim-ring there would be deceptive. Preemptive fire is for cells you're
    // holding range on, not ones you'd step onto. cellsWithinD yields each
    // cell's BFS distance, so no per-cell graphDistance is needed; it already
    // bounds at maxRange, so only the minRange floor must be checked.
    const aimCells = new Set<CellId>();
    if (ut.maxRange > 1) {
      for (const [cell, d] of cellsWithinD(board, from, ut.maxRange)) {
        if (d < ut.minRange) continue;
        if (!visible.has(cell)) continue;
        if (reachable.has(cell)) continue; // a move, not an aim
        if (knownUnits.some((u) => u.cell === cell && u.count > 0)) continue; // any occupant
        aimCells.add(cell);
      }
    }
    const visionEdge = new Set(cellsWithin(board, selected.cell, ut.vision));
    return { reachable, targets, aimCells, visionEdge, frictionCells };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, selected, knownUnits, orders, types, assumedTerrain, visible]);

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
      const atkTarget = uo.attack?.targetCell;
      out.push({
        unit,
        movePath: uo.move?.path,
        attackTarget: atkTarget,
        attackFrom: plannedEndCell(unit, uo),
        converging: convergingUnits.has(unit.id),
        // charge ghosts offset beside the occupant (see GhostOrder docs)
        destOccupied:
          dest !== undefined && knownUnits.some((u) => u.cell === dest && u.id !== unit.id),
        // v0.9 preemptive fire: an armed attack on a cell with no known unit is
        // an area-denial shot — flag it so the ghost draws a crosshair there.
        preemptive:
          atkTarget !== undefined &&
          !knownUnits.some((u) => u.cell === atkTarget && u.count > 0),
      });
    }
    return out;
  }, [board, boardUnits, knownUnits, orders]);

  // --- v0.9 propose-then-confirm: the PROPOSAL ghost --------------------------
  // The un-queued move proposal renders as its OWN ghost, visually distinct
  // from a committed queued-order ghost (Board draws it brighter + a dashed
  // destination ring + a "tap again / Enter" affordance). It only shows for the
  // currently-selected unit (the proposal invariant); a proposal whose unit is
  // somehow no longer selected (defensive) is dropped from the render.
  const proposalGhost = useMemo<ProposalGhostMark | null>(() => {
    if (!board || !pendingMove || !selected || pendingMove.unitId !== selected.id) return null;
    return {
      unit: selected,
      movePath: pendingMove.path,
      dest: pendingMove.dest,
      destOccupied: knownUnits.some((u) => u.cell === pendingMove.dest && u.id !== selected.id),
    };
  }, [board, pendingMove, selected, knownUnits]);

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

  // v0.7 Item 1: a build pip on every base the player owns (rendered above
  // units → always tappable, even when an occupant token sits on the base). A
  // base with a queued buy reads "queued" (check) instead of "＋".
  const buildPips = useMemo<BuildPipMark[]>(() => {
    if (!conquest || !gameBases) return [];
    return Object.entries(gameBases)
      .filter(([, owner]) => owner === PLAYER_FACTION)
      .map(([cellKey]) => {
        const baseCell = Number(cellKey);
        return { baseCell, queued: buys[baseCell] !== undefined };
      });
  }, [conquest, gameBases, buys]);

  // v0.7 Item 3: the compact build card anchors to where the user tapped. We
  // record the last pointer position over the board area (capture-phase, so it
  // fires before the cell/pip onClick that opens the sheet) and pass it as the
  // anchor. centerOn is dropped here — the card pops up AT the click, no pan.
  const lastPointer = useRef<{ x: number; y: number } | null>(null);

  function openBuildSheet(baseCell: CellId) {
    setSheet({ kind: 'build', baseCell, anchor: lastPointer.current ?? undefined });
  }

  // --- interactions -------------------------------------------------------------

  /** Compute the planning-side path (start excluded) for a move to `cell` —
   * the same findPath call queueMoveTo used. Returns null if unreachable. */
  function pathTo(unit: UnitInstance, cell: CellId): CellId[] | null {
    if (!board) return null;
    const ut = types[unit.type];
    if (!ut) return null;
    const res = findPath(board, movementCostsFor(ut), unit.cell, cell, {
      budget: ut.movement,
      ...pathOpts(unit),
      assumedTerrain,
    });
    if (!res || res.path.length === 0) return null;
    return res.path;
  }

  /** Immediately QUEUE a move (used by enemy-charge fallback — charges keep
   * their one-step behavior; only empty-destination moves go through the
   * propose-then-confirm flow below). */
  function queueMoveTo(unit: UnitInstance, cell: CellId): boolean {
    const path = pathTo(unit, cell);
    if (!path) return false;
    return tryQueueOrder({ kind: 'move', unitId: unit.id, path }).ok;
  }

  // v0.9 propose-then-confirm (MOVE destinations only). Tapping a reachable
  // empty cell does NOT queue immediately; it sets a transient proposal. The
  // SECOND tap on the same dest (or Enter, or selecting another unit) commits.
  // State machine for a reachable-cell tap on the SELECTED unit's `cell`:
  //   - no pending, or pending.dest !== cell  → propose (compute path, set pending)
  //   - pending.dest === cell (second tap)    → commit (queue the order, clear)
  // This is the move-only branch; attacks/aim/stance keep one-step behavior.
  function proposeOrCommitMove(unit: UnitInstance, cell: CellId): void {
    const cur = useAppStore.getState().pendingMove;
    if (cur && cur.unitId === unit.id && cur.dest === cell) {
      commitPendingMove(); // second tap on the same dest → commit
      return;
    }
    const path = pathTo(unit, cell);
    if (!path) return; // unreachable (shouldn't happen — caller gates on reachable)
    proposeMove({ unitId: unit.id, dest: cell, path }); // first tap / retarget
  }

  /** Enemy interaction: attack if the plan can shoot it, else charge-move.
   * Charges/attacks are one-step (not part of the move proposal flow), but a
   * standing MOVE proposal must not be silently lost — commit it first so the
   * player's set-up move still lands when they pivot to an attack. */
  function engageEnemy(enemy: UnitInstance) {
    if (!selected) return;
    commitPendingMove(); // don't discard a pending proposal on an attack pivot
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
      if (unit.id === selectedUnitId) {
        // Re-tapping the SELECTED unit's own token: cancel any pending proposal
        // first (the "own cell cancels" affordance), else toggle selection off.
        if (useAppStore.getState().pendingMove) clearPendingMove();
        else selectUnit(null);
        return;
      }
      // Switching to ANOTHER friendly unit COMMITS the previous unit's pending
      // proposal (don't drop a move the player set up), then selects the new one.
      commitPendingMove();
      selectUnit(unit.id);
    } else {
      engageEnemy(unit);
    }
  }

  // v0.7 Item 2 — tap-precedence for a cell tap, documented top to bottom.
  // (Build pips and buy ghosts are SEPARATE overlay elements above the cells,
  // so they consume their own tap before this handler ever runs — they don't
  // appear here.)
  //
  // With a unit selected:
  //   1. the selected unit's own cell → no-op (token tap toggles selection)
  //   2. visible enemy on the cell    → attack / charge
  //   3. reachable cell               → queue move
  //   4. friendly on the cell         → switch selection to that friendly
  //   5. owned base (conquest)        → open build sheet
  //   6. otherwise                    → deselect (the meaningful "tap away")
  // With nothing selected:
  //   A. owned base (conquest)        → open build sheet
  //   B. otherwise                    → INFO SHEET (terrain/base stats; on a
  //      dark tile InfoSheet reads "unscouted", memory shows remembered
  //      terrain — neither leaks dark truth, the cell data IS the truth and
  //      InfoSheet gates on the tier flag the caller passes).
  function openInfo(cellId: CellId) {
    setSheet({ kind: 'info', cellId });
  }
  function ownedBase(cellId: CellId): boolean {
    return (
      conquest && uiPhase === 'planning' && gameBases?.[cellId] === PLAYER_FACTION
    );
  }

  function onCellTap(cellId: CellId) {
    if (!selected) {
      if (ownedBase(cellId)) {
        setSheet({ kind: 'build', baseCell: cellId });
        return;
      }
      openInfo(cellId); // Item 2: empty/any tile tap → info
      return;
    }
    if (cellId === selected.cell) {
      // v0.9: tapping the selected unit's OWN cell cancels a pending proposal
      // (an explicit "never mind"); with no pending it stays a no-op (the
      // token tap toggles selection via onUnitTap).
      if (useAppStore.getState().pendingMove) clearPendingMove();
      return;
    }
    const enemy = visibleEnemyAt(cellId);
    if (enemy) {
      engageEnemy(enemy);
      return;
    }
    if (layer1?.reachable.has(cellId)) {
      // v0.9 propose-then-confirm: first tap proposes, second tap on the same
      // dest commits, a tap on a different reachable cell retargets the proposal.
      proposeOrCommitMove(selected, cellId);
      return;
    }
    // v0.9 preemptive fire: a RANGED unit may target an EMPTY in-range cell
    // (area denial). aimCells are empty + visible + in [minRange, maxRange] and
    // never reachable (reachable wins above), so this gesture is unambiguous.
    // tryQueueOrder re-validates, so an illegal aim still rejects cleanly.
    if (layer1?.aimCells?.has(cellId)) {
      // v0.9: pivoting to a ranged aim shot must not silently drop a pending
      // MOVE proposal — commit it first, then queue the aim.
      commitPendingMove();
      tryQueueOrder({ kind: 'attack', unitId: selected.id, targetCell: cellId });
      return;
    }
    // v1.1 (Feature C audit): a friendly-occupied cell used to fall through
    // to deselect — a tap that landed on a friend's cell silently killed the
    // plan, reading as "friendlies block movement". Behave like tapping the
    // friend's token instead: switch selection. v0.9: switching units COMMITS
    // the previous unit's pending proposal first (don't drop a set-up move).
    const friend = friendlyAt(cellId);
    if (friend) {
      commitPendingMove();
      selectUnit(friend.id);
      return;
    }
    if (ownedBase(cellId)) {
      // v0.9: opening a build sheet keeps any pending proposal alive? No — an
      // explicit tap elsewhere should not silently discard it; commit it first.
      commitPendingMove();
      setSheet({ kind: 'build', baseCell: cellId });
      return;
    }
    // v0.9: tap on an empty/unreachable cell — COMMIT any pending proposal
    // (don't silently discard a move the player set up), THEN deselect.
    commitPendingMove();
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

  // --- v0.8 Task 2.4: capture toggle (conquest + personnel + unowned base) -----
  // Shown for the selected unit when ALL of:
  //   1. conquest mode (gameBases is defined)
  //   2. unit is the player's and its armorType === 'personnel'
  //   3. the unit's planned END cell is a base NOT owned by the player
  const captureToggle = useMemo<CaptureToggleState | null>(() => {
    if (!conquest || !gameBases || !selected) return null;
    const ut = types[selected.type];
    if (!ut || ut.armorType !== 'personnel') return null;
    const endCell = plannedEndCell(selected, orders[selected.id]);
    const baseOwner = gameBases[endCell];
    // bases[endCell] must be defined (the cell IS a base) and not owned by the player
    if (baseOwner === undefined || baseOwner === PLAYER_FACTION) return null;
    const armed = !!(orders[selected.id]?.capture);
    return {
      armed,
      // v0.9: anchor the toggle on the TARGET base (planned end), not the
      // unit's start cell — the player reads "capture THIS base".
      targetCell: endCell,
      onToggle: armed
        ? () => removeCapture(selected.id)
        : () => queueCapture(selected.id),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conquest, gameBases, selected, orders, types]);

  // --- v0.8 Task 2.4: claim-intent markers on base cells ---
  // One mark per player unit with an armed capture order.
  const captureIntentMarks = useMemo<CaptureIntentMark[]>(() => {
    if (!conquest) return [];
    const out: CaptureIntentMark[] = [];
    for (const unit of boardUnits) {
      if (unit.faction !== PLAYER_FACTION) continue;
      if (!orders[unit.id]?.capture) continue;
      const endCell = plannedEndCell(unit, orders[unit.id]);
      out.push({ baseCell: endCell, faction: PLAYER_FACTION });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conquest, boardUnits, orders]);

  // v0.9 radar: toggle handler — same id clears, different id switches.
  const onUnitRadarTap = useCallback((unitId: string) => {
    setRangeOverlayUnit((cur) => (cur === unitId ? null : unitId));
  }, []);

  // v0.9 radar: compute the overlay payload whenever a unit is selected for
  // radar. Finds the unit, computes its vision set (using the same args as the
  // main visible-cells call), then BFS-distances every visible cell from the
  // unit's position using graphDistance. Heavy in theory on large maps but fog
  // (vision set) bounds the visible cell count tightly.
  const rangeOverlay = useMemo(() => {
    if (!rangeOverlayUnit || !board) return null;
    const unit = boardUnits.find((u) => u.id === rangeOverlayUnit);
    if (!unit || unit.faction !== PLAYER_FACTION) return null;
    // Compute vision for this single unit (same args as the main visibleCells call).
    const vision = visibleCells(board, [unit], PLAYER_FACTION, types, gameBases);
    // BFS distance from the unit's cell to each visible cell.
    const distances = new Map<CellId, number>();
    for (const cell of vision) {
      distances.set(cell, graphDistance(board, unit.cell, cell));
    }
    return { unitId: unit.id, cell: unit.cell, distances };
  }, [rangeOverlayUnit, board, boardUnits, types, gameBases]);

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
  // v0.7 Item 2: the tapped cell's fog tier — InfoSheet shows full terrain for
  // live, remembered terrain for memory, and "unscouted" (no terrain leak) for
  // dark. Same tiering the Board uses (fog ∧ discovered).
  const sheetTier: 'live' | 'memory' | 'dark' | undefined =
    sheet?.kind === 'info'
      ? !fog?.has(sheet.cellId)
        ? 'live'
        : discovered.has(sheet.cellId)
          ? 'memory'
          : 'dark'
      : undefined;
  // v0.7 Item 2: conquest base ownership status for the info sheet ("camp" when
  // neutral, "your base"/"enemy base" otherwise). Dark hides it (no leak).
  const sheetBase:
    | { status: 'yours' | 'enemy' | 'camp' }
    | undefined =
    sheet?.kind === 'info' && conquest && gameBases && sheetTier !== 'dark' && sheetCell?.terrain === 'base'
      ? {
          status:
            gameBases[sheet.cellId] === PLAYER_FACTION
              ? 'yours'
              : gameBases[sheet.cellId] === null || gameBases[sheet.cellId] === undefined
                ? 'camp'
                : 'enemy',
        }
      : undefined;

  const phaseChip = uiPhase === 'planning' ? 'planning' : uiPhase === 'over' ? 'over' : 'replay';
  const topRound = replayActive && replay ? replay.round : game.round;

  // v0.9 HUD: per-turn income — player's owned bases × the board's per-base
  // payout (conquest only; donor fallback 100). Shown beside the credits
  // odometer during planning so the economy reads at a glance. Hidden during
  // replay (the frame feed ticks the live credit value instead).
  const perBaseCredits = board.economy?.perBaseCredits ?? 100;
  const income = conquest ? ownedBaseCount(PLAYER_FACTION) * perBaseCredits : 0;

  // E3 credits HUD: planning = available − committed (static) + per-turn income;
  // replay = the frame's creditsAfter feed (income/spawn events tick it live).
  const creditsHud: CreditsHud | null = conquest
    ? frame
      ? { value: frame.credits ?? game.credits?.[PLAYER_FACTION] ?? 0 }
      : { value: game.credits?.[PLAYER_FACTION] ?? 0, committed, income }
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
      <TopBar phase={phaseChip} onBack={exitBattle} />
      {playerBaseless && (
        <div className="baseless-warning" role="alert" data-testid="baseless-warning">
          no bases — {graceLeft} round{graceLeft === 1 ? '' : 's'} to retake one
        </div>
      )}
      {/* v0.6 Ask 1 / #5: the primary CTA floats top-center below the bar —
          COMMIT during planning. Summary no longer blocks: auto-advance fires
          instead. Replay keeps its speed controls in the bottom dock. */}
      {uiPhase === 'planning' && (
        <TopCta
          phase="planning"
          done={own.filter((u) => orderedIds.has(u.id)).length}
          total={own.length}
          buys={dockBuys.length}
          directive={directive}
          directivesEnabled={resolvePlanDirective() !== null}
          onCommit={() => commit()}
          onDirective={applyDirective}
          onClearAll={clearOrders}
        />
      )}
      {/* #5 "Your turn" announcement — transient, non-blocking, self-fading.
          The overlay is pointer-events: none so planning input is never blocked;
          tapping the pill itself still dismisses it early (pointer-events: auto
          on the inner element). FIX B belt-and-suspenders: also gated on
          uiPhase === 'planning' so a stale pill can never render over replay
          or the game-over summary even before the effect clears it. */}
      {announcement && uiPhase === 'planning' && (
        <div
          key={announcement.token}
          className="your-turn-announcement-wrap"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <button
            className="your-turn-announcement"
            onClick={dismissAnnouncement}
            aria-label="dismiss announcement"
          >
            <span className="your-turn-label">Your turn — R{announcement.round}</span>
            {announcement.summarySnap && (announcement.summarySnap.damageDealt[0] > 0 || announcement.summarySnap.damageDealt[1] > 0 || announcement.summarySnap.killCount > 0 || announcement.summarySnap.fizzles > 0) && (
              <span className="your-turn-recap">
                {announcement.summarySnap.damageDealt[0] > 0 && `dealt ${announcement.summarySnap.damageDealt[0]}`}
                {announcement.summarySnap.damageDealt[0] > 0 && announcement.summarySnap.damageDealt[1] > 0 && ' · '}
                {announcement.summarySnap.damageDealt[1] > 0 && `took ${announcement.summarySnap.damageDealt[1]}`}
                {(announcement.summarySnap.damageDealt[0] > 0 || announcement.summarySnap.damageDealt[1] > 0) && announcement.summarySnap.killCount > 0 && ' · '}
                {announcement.summarySnap.killCount > 0 && `${announcement.summarySnap.killCount} kill${announcement.summarySnap.killCount !== 1 ? 's' : ''}`}
                {(announcement.summarySnap.damageDealt[0] > 0 || announcement.summarySnap.damageDealt[1] > 0 || announcement.summarySnap.killCount > 0) && announcement.summarySnap.fizzles > 0 && ' · '}
                {announcement.summarySnap.fizzles > 0 && `${announcement.summarySnap.fizzles} fizzle${announcement.summarySnap.fizzles !== 1 ? 's' : ''}`}
              </span>
            )}
          </button>
        </div>
      )}
      <main
        className="board-area"
        onPointerDownCapture={(e) => {
          lastPointer.current = { x: e.clientX, y: e.clientY };
        }}
      >
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
                promotions: frame.promotions,
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
            unitTypes={types}
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
            buildPips={buildPips}
            onBuildTap={openBuildSheet}
            highlights={layer1}
            selectedUnitId={selected?.id ?? null}
            ghosts={ghosts}
            proposal={proposalGhost}
            onProposalConfirm={commitPendingMove}
            focus={focus}
            stancePopover={stancePopover}
            captureToggle={captureToggle}
            captureIntentMarks={captureIntentMarks}
            onUnitRadarTap={onUnitRadarTap}
            rangeOverlay={rangeOverlay}
            onCellTap={onCellTap}
            onUnitTap={onUnitTap}
            onGhostTap={onGhostTap}
            onUnitHover={setHover}
            onCellLongPress={(cellId) => setSheet({ kind: 'info', cellId })}
            unitTypes={types}
          />
        )}
      </main>
      {/* v0.9 HUD: top-left column — Round + Credits cluster on top, casualty
          tally stacked immediately below. Fixed over the board, below modals. */}
      <div className="hud-column">
        <HudCluster round={topRound} credits={creditsHud} />
        <CasualtyPanel casualties={casualties} unitTypes={types} />
      </div>
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
            // Mirror onUnitTap: commit any pending proposal BEFORE switching
            // units so the player's set-up move is never silently dropped.
            commitPendingMove();
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
      {/* #5: summary no longer blocks — auto-advance fires in the effect above.
          SummarySheet still shows for the game-over branch (game.outcome) where
          closeSummary → 'over', and the effect is guarded by game.outcome check.
          For the normal (non-game-over) path the effect fires synchronously on
          the first render with uiPhase==='summary', so this guard also prevents
          a flash of the blocking scrim. The 'Your turn' announcement carries the
          round recap snapshot so no information is lost. */}
      {uiPhase === 'summary' && replay && game.outcome && breakdownSlot === null && (
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
          anchor={sheet.anchor}
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
          tier={sheetTier}
          baseStatus={sheetBase?.status}
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
  // v0.9: each page load starts from a fresh random seed. The store defaults to
  // a fixed 7 (deterministic for tests); the live app randomizes once on mount
  // so every load generates a different battlefield. A manual/rematch seed set
  // afterwards still wins (this only runs once).
  useEffect(() => {
    useAppStore.getState().randomizeSeed();
  }, []);
  return screen === 'start' ? <StartScreen /> : <BattleScreen />;
}
