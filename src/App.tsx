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
// FULL AUTO (store.fullAuto, gear menu → DEBUG, seeded from ?autopilot=greedy):
// faction 0 is planned by the same greedy AI on commit-less rounds — auto-
// commits each planning phase and auto-dismisses summaries, so a full game
// fast-forwards to the banner organically. The store field is read as a
// selector below, so toggling it live drives self-play ON/OFF mid-game. Useful
// for demos and for exercising long games by hand. The URL flag still seeds it.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { factionUpkeep, upkeepRateOf } from './core/economy';
import { loadUnits } from './io/data-loader';
import type { ReplayFrame } from './state/replay';
import { dilationAt, spotlightAt } from './state/replay';
import { activeCellsAt, clampFrame, frameAtTime, frameStartTime, totalDuration } from './state/replay-timing';
import { elapsedReplayTime } from './state/dilation-clock';
import { PLAYER_FACTION, useAppStore } from './state/store';
import { Board, type CaptureToggleState, type StancePopoverState } from './ui/Board';
import { BottomDock, type DockBuy } from './ui/BottomDock';
// Code-split: the conquest economy dashboard is opened on demand (button), so
// keep it out of the initial bundle (v1.6 refactor Phase 5).
const BuildDashboard = lazy(() =>
  import('./ui/BuildDashboard').then((m) => ({ default: m.BuildDashboard })),
);
import { CasualtyPanel } from './ui/CasualtyPanel';
import { HudCluster } from './ui/HudCluster';
import { BreakdownModal, GameOverBanner, ReplayDock, SummarySheet } from './ui/Replay';
import { useCombatAudio } from './ui/audio/useCombatAudio';
import { useKeyboardShortcuts } from './ui/hooks/useKeyboardShortcuts';
import { useAnnouncement } from './ui/hooks/useAnnouncement';
import { useAutopilot } from './ui/hooks/useAutopilot';
import { InfoSheet, OrderSheet, UnitHoverCard } from './ui/Sheets';
import { SkirmishLog } from './ui/SkirmishLog';
import { StartScreen } from './ui/StartScreen';
import { TopBar, type CreditsHud } from './ui/TopBar';
import { TopCta } from './ui/TopCta';
import type { BuildPipMark, BuyGhostMark, CaptureIntentMark, GhostOrder, ImpactMark, ProposalGhostMark, TrailMark } from './ui/skin';
import { DilationClock, DilationVignette } from './ui/skin';
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
  // E3 conquest: the BUILD dashboard (full-screen economy modal). `focusBase`
  // scrolls that base's row into view on open (null = economy overview).
  | { kind: 'build'; focusBase: CellId | null }
  | null;

function BattleScreen() {
  const board = useAppStore((s) => s.board);
  const game = useAppStore((s) => s.game);
  const uiPhase = useAppStore((s) => s.uiPhase);
  const replay = useAppStore((s) => s.replay);
  const replaySpeed = useAppStore((s) => s.replaySpeed);
  // Sequencing §5: the SECOND knob — combat dilation depth (deepens combat
  // beats only; movement stays brisk). Read here for the replay dock's second
  // slider; the value flows into buildReplay via the store's commit().
  const dilationDepth = useAppStore((s) => s.dilationDepth);
  const setDilationDepth = useAppStore((s) => s.setDilationDepth);
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
  // FULL AUTO: read from the store (seeded from ?autopilot=greedy at store
  // creation, then toggled live via the ⚙ gear menu). Reading it as a store
  // selector makes the autopilot effects below REACTIVE — flipping fullAuto ON
  // mid-game fires commitAutopilot on the next planning phase + auto-closes
  // summaries; flipping it OFF hands control back to the player.
  const autopilot = useAppStore((s) => s.fullAuto);

  // v0.9 radar: the unit whose shooting-range distances are displayed on the
  // board. null = overlay hidden. Toggled by tapping the bottom-left radar pip
  // on own units during planning. Cleared on phase change (planning exits).
  const [rangeOverlayUnit, setRangeOverlayUnit] = useState<string | null>(null);


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
  // §4 FOCAL SPOTLIGHT: the active beat's cells WITHIN the current combat frame
  // — a sub-frame read driven by activeCellsAt(frame.beats, tWithinFrame). null
  // between beats / in a gap / on a non-combat frame ⇒ the board RESTORES (no
  // per-beat dim). Set by the rAF beat clock below (mirrors the DilationClock's
  // elapsed-time tracking). Determinism: a pure function of (frame, t); scrub /
  // pause hold the cursor's beat. Reduced-motion bypasses this (static board).
  const [focalCells, setFocalCells] = useState<readonly CellId[] | null>(null);
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

  // R4 (SCREEN-SHAKE): the board container, nudged per combat beat via the Web
  // Animations API (a pure DOM side-effect that never disturbs the React tree /
  // remounts the Board, so the sprite motion-diff and camera state survive).
  const boardAreaRef = useRef<HTMLElement>(null);

  // R8 (AUDIO): the synth-cue toggle + per-frame cue emission. OFF by default;
  // while OFF no AudioContext is created and `playFrame` no-ops. A pure UI side-
  // effect — it reads the replay frame only, never game state / the frame data.
  const audio = useCombatAudio();

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

  // --- R7 (SEEK / SCRUB transport) -------------------------------------------
  // Playback is a PURE function of (resolvedTurn, t): the board render is already
  // a pure read of frameIdx, so seeking is JUST moving the cursor — no resolver
  // re-run, no game-state mutation (source spec §3, §12.5). seekToFrame moves the
  // cursor to any frame in [0, len-1]; seekToTime maps an elapsed time to a frame
  // via cumulative frame durations (frameAtTime). Both clamp to the script bounds.
  //
  // The advance loop above only ever calls finishReplay when it walks PAST the
  // last frame on its timer (or on `skip`). A seek (forward OR backward) merely
  // sets frameIdx to a valid in-range frame, so it can never re-trigger the
  // summary/finish — scrubbing backward leaves playback live but earlier.
  const seekToFrame = useCallback(
    (idx: number) => {
      if (!script) return;
      setFrameIdx(clampFrame(idx, script.frames.length));
    },
    [script],
  );
  const seekToTime = useCallback(
    (ms: number) => {
      if (!script) return;
      setFrameIdx(frameAtTime(script.frames, ms));
    },
    [script],
  );
  // R7 (SCRUB): grabbing the scrubber pauses playback so the dragged frame holds
  // (it never fights the advance loop, which early-returns while paused). The
  // play control then resumes — releasing the scrubber leaves it paused, the
  // cleaner UX. No-op once playback is done (the strip is browse-only then).
  const onScrubStart = useCallback(() => {
    if (uiPhase === 'replay') setPaused(true);
  }, [uiPhase]);

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

  // R8 (AUDIO): emit the synth cues for the current replay frame as playback
  // advances. Fires once per shown frame (keyed by frameIdx), reads the frame's
  // ALREADY fog-filtered FX (projectiles/floaters/bursts/kills) via the pure
  // cuesForFrame mapper, so a hidden event is never voiced. Respects the speed
  // multiplier (envelopes tighten at 2×). No-op while the toggle is OFF (the hook
  // never touches an AudioContext then). Skipped on a 'skip' jump (no per-frame
  // playback) — only audible during live frame-by-frame playback.
  const playFrameAudio = audio.playFrame;
  useEffect(() => {
    if (uiPhase !== 'replay' || !script) return;
    if (replaySpeed === 'skip') return;
    const fr = script.frames[Math.min(frameIdx, script.frames.length - 1)];
    if (!fr) return;
    const speed = typeof replaySpeed === 'number' ? replaySpeed : 1;
    playFrameAudio(fr, speed);
  }, [uiPhase, script, frameIdx, replaySpeed, playFrameAudio]);

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

  // autopilot (dev/demo Full-Auto) — extracted to a hook (verbatim logic).
  useAutopilot({ autopilot, uiPhase, game });

  // #5 auto-advance "Your turn" announcement (summary→planning, self-fading pill
  // + 2200ms backstop) — extracted to a hook (verbatim logic + lifecycle).
  const { announcement, dismissAnnouncement } = useAnnouncement({ uiPhase, autopilot, game });

  // #6 Enter / Escape global shortcuts — extracted to a hook (verbatim logic +
  // priority order documented there).
  useKeyboardShortcuts({ announcement, dismissAnnouncement, uiPhase, game });

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

  // Phase 5: every build entry point (B pip, buy ghost, dock chip, HUD credits
  // row) opens the full-screen BuildDashboard. `focusBase` scrolls that base's
  // row into view on open; null opens the economy overview.
  function openBuildDashboard(focusBase: CellId | null = null) {
    setSheet({ kind: 'build', focusBase });
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
  //   5. owned base (conquest)        → info sheet (build is via the B pip / HUD)
  //   6. otherwise                    → deselect (the meaningful "tap away")
  // With nothing selected:
  //   A. owned base (conquest)        → info sheet (build is via the B pip / HUD)
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
      // Phase 5: a raw base cell tap no longer opens build — the B pip (above
      // the unit layer) owns that gesture. A bare cell tap shows the info sheet.
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
    // Phase 5: an owned-base tap with a unit selected reverts to the info sheet
    // (the B pip owns the build gesture now). Commit any pending proposal first
    // so an explicit tap elsewhere never silently discards a set-up move.
    if (ownedBase(cellId)) {
      commitPendingMove();
      openInfo(cellId);
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
        damage: s.damage,
      }));
  })();

  // R2 (SPOTLIGHT): a pure read of the script + cursor — engaged through the
  // combat portion (replay start → last wave frame), released in SETTLE / at
  // replay end. One spotlight for the whole turn (computed once per round; the
  // `active` flag just gates whether the dim is drawn at THIS frame). Absent
  // outside replay/summary (planning never dims).
  const roundSpotlight =
    replayActive && script ? spotlightAt(script, frameIdx) : null;
  // §4 FOCAL SPOTLIGHT: the finer per-beat read driven by activeCellsAt (NOT the
  // whole-turn combatants set). `focalCells` from the beat clock above is:
  //   • a NON-EMPTY list → spotlight JUST this beat's exchange (dim everything
  //     else; the beat's attacker/defender + the units on those cells stay lit);
  //   • an EMPTY list → a between-beats gap → the board RESTORES (active:false);
  //   • null → the clock is NOT engaged (reduced-motion / non-combat / skip) →
  //     fall back to the static round-wide R2 spotlight (the existing degraded
  //     path; reduced-motion keeps a static dim, no flicker).
  // Fog honesty holds: beat.activeCells never carries a withheld mist source.
  // Units stay lit by standing on a lit cell (Board.unitSpotlight), so an empty
  // units set is correct here.
  const spotlight =
    focalCells === null
      ? roundSpotlight
      : focalCells.length > 0
        ? {
            active: true,
            combatants: { cells: new Set(focalCells), units: new Set<string>() },
          }
        : { active: false, combatants: (roundSpotlight ?? { combatants: { cells: new Set<CellId>(), units: new Set<string>() } }).combatants };

  // R3 (DILATION): a pure read of the script + cursor — engaged only on WAVE_A
  // (ranged/artillery) frames, released over the INTERLUDE into WAVE_B. It cools
  // + vignettes the board and shows the analog dilation CLOCK (a screen-anchored
  // HUD overlay, NEVER on a unit / never radar geometry), layered ON TOP of the
  // R2 spotlight. The clock's `fade` envelope fades it in/out at the wave edges;
  // its single gold hand sweeps `turns` (< 1 rotation across the window). Absent
  // outside replay (planning never dilates).
  const dilation =
    replayActive && script ? dilationAt(script, frameIdx) : null;

  // R4 (SCREEN-SHAKE): a combat frame nudges the board container by its `shake`
  // magnitude (px at 1×, scaled with the beat's total damage — artillery the
  // biggest of the set). Honors the replay speed (a 2× pass shakes faster via
  // the CSS class). Pure read of the frame; reduced-motion drops the animation
  // in CSS. Keyed by frameIdx so the shake restarts each combat beat.
  const boardShake = frame?.shake && frame.shake > 0 ? frame.shake : 0;

  // R4: fire the shake on each combat beat (keyed by frameIdx). Web Animations
  // API so it never remounts the Board; magnitude = the frame's `shake` px,
  // duration scaled by the replay speed. prefers-reduced-motion users get no
  // shake (the impact marks still land — outcomes unchanged either way).
  useEffect(() => {
    const el = boardAreaRef.current;
    if (!el || boardShake <= 0) return;
    if (typeof window !== 'undefined' && typeof el.animate !== 'function') return;
    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const m = boardShake;
    const speed = typeof replaySpeed === 'number' ? replaySpeed : 1;
    const dur = 360 / speed;
    const anim = el.animate?.(
      [
        { transform: 'translate(0px, 0px)' },
        { transform: `translate(${m * 0.7}px, ${-m * 0.5}px)` },
        { transform: `translate(${-m * 0.6}px, ${m * 0.4}px)` },
        { transform: `translate(${m * 0.4}px, ${m * 0.3}px)` },
        { transform: `translate(${-m * 0.2}px, ${-m * 0.15}px)` },
        { transform: 'translate(0px, 0px)' },
      ],
      { duration: dur, easing: 'ease-out' },
    );
    return () => anim?.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameIdx, boardShake, replaySpeed]);

  // §4 FOCAL SPOTLIGHT beat clock: while a COMBAT frame is on screen, track the
  // elapsed time WITHIN the frame (rAF, mirroring the DilationClock's
  // elapsedReplayTime base + re-based enteredAt) and publish the active beat's
  // cells via activeCellsAt(frame.beats, tWithinFrame). Between beats / in a gap
  // / before the first / after the last beat it publishes null ⇒ the board
  // restores. PURE read of (frame, t): scrub/pause hold the cursor's beat, so a
  // given (turn, t) always yields the same spotlight. Skipped entirely under
  // prefers-reduced-motion (the board stays static — no per-beat dim flicker)
  // and on the 'skip' fast jump. The advance loop is frame-by-frame, so this is
  // the ONLY sub-frame timing source the spotlight has.
  const replayActiveForBeats = uiPhase !== 'planning' && script !== null;
  useEffect(() => {
    if (!replayActiveForBeats || !script) {
      setFocalCells(null);
      return;
    }
    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frame = script.frames[Math.min(frameIdx, script.frames.length - 1)];
    const beats = frame?.beats;
    // Non-combat frame (no beats), reduced-motion, or skip → no per-beat dim.
    if (reduce || replaySpeed === 'skip' || !beats || beats.length === 0) {
      setFocalCells(null);
      return;
    }
    if (typeof requestAnimationFrame !== 'function') {
      // jsdom / no rAF: settle on the first beat's cells (deterministic).
      setFocalCells(beats[0]!.activeCells);
      return;
    }
    const enteredAt = typeof performance !== 'undefined' ? performance.now() : 0;
    const base = frameStartTime(script.frames, frameIdx);
    let raf = 0;
    let last: string | null = null;
    const loop = () => {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      const elapsed = elapsedReplayTime(
        script.frames,
        frameIdx,
        replaySpeed,
        paused,
        now,
        enteredAt,
      );
      const tWithinFrame = elapsed - base; // ms into THIS frame at 1× speed
      const cells = activeCellsAt(beats, tWithinFrame);
      // Clock ENGAGED: a non-empty list = the active beat's cells; an EMPTY list
      // = a between-beats gap (the board RESTORES). null is reserved for "clock
      // not engaged" (reduced-motion / non-combat) so the render can tell the two
      // apart (an empty array ⇒ restore, null ⇒ keep the round-wide spotlight).
      const key = cells.join(',');
      if (key !== last) {
        last = key;
        setFocalCells(cells);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayActiveForBeats, script, frameIdx, paused, replaySpeed]);

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

  // v0.9 upkeep (addendum §5): projected per-turn upkeep over the player's
  // living units, and the net (income − upkeep) shown beside the odometer so a
  // buy that bleeds is visible before commit.
  const upkeep = conquest
    ? factionUpkeep(Object.values(game.units), PLAYER_FACTION, types, upkeepRateOf(board))
    : 0;
  const net = income - upkeep;

  // E3 credits HUD: planning = available − committed (static) + per-turn income;
  // replay = the frame's creditsAfter feed (income/spawn events tick it live).
  const creditsHud: CreditsHud | null = conquest
    ? frame
      ? { value: frame.credits ?? game.credits?.[PLAYER_FACTION] ?? 0 }
      : { value: game.credits?.[PLAYER_FACTION] ?? 0, committed, income, upkeep, net }
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
          mode={conquest ? (sheet?.kind === 'build' ? 'economy' : 'map') : undefined}
          onModeSelect={
            conquest
              ? (m) => (m === 'economy' ? openBuildDashboard(null) : setSheet(null))
              : undefined
          }
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
      <main className="board-area" ref={boardAreaRef}>
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
                projectiles: frame.projectiles,
                beats: frame.beats,
                floaters: fxFloaters,
                bursts: frame.bursts,
                kills: frame.kills,
                doomed: frame.doomed,
                spawns: frame.spawns,
                captures: frame.captures,
                impacts: fxImpacts,
                promotions: frame.promotions,
                signs: frame.signs,
                callouts: frame.callouts,
              },
            }}
            trails={trails}
            spotlight={spotlight}
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
            onBuyGhostTap={(baseCell) => openBuildDashboard(baseCell)}
            buildPips={buildPips}
            onBuildTap={(baseCell) => openBuildDashboard(baseCell)}
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
      {/* R3 (DILATION): WAVE A board cooling — the board cools + a subtle vignette
          closes (layered OVER the board and on top of the R2 spotlight), present
          only during WAVE A (dilation.active) and a pure read of the script +
          cursor. The clock layers on top (Phase 2). */}
      {dilation?.active && <DilationVignette active progress={dilation.progress} />}
      {/* Phase 2: the Swiss-railway BULLET-TIME dilation clock — a fixed
          top-right canvas overlay present through the WHOLE replay, driven by the
          replay's elapsed time (frameStartTime(cursor) + (now−entered)·speed).
          It GLIDES during the move frames, blooms + grows IN PLACE at the
          move→combat handover (overlaying the SkirmishLog for the slow-mo beat),
          ticks in decelerating steps through WAVE_A, then recedes. Pure
          closed-form hand model; respects pause/speed/skip/scrub. */}
      {replayActive && script && (
        <DilationClock
          frames={script.frames}
          frameIdx={frameIdx}
          speed={replaySpeed}
          paused={paused}
          audio={audio.dilation}
          audioOn={audio.enabled}
        />
      )}
      {/* v0.9 HUD: top-left column — Round + Credits cluster on top, casualty
          tally stacked immediately below. Fixed over the board, below modals. */}
      <div className="hud-column">
        <HudCluster
          round={topRound}
          credits={creditsHud}
          onOpenBuild={conquest && uiPhase === 'planning' ? () => openBuildDashboard(null) : undefined}
        />
        <CasualtyPanel casualties={casualties} unitTypes={types} />
      </div>
      {/* Map/Economy mode toggle now lives in the top action cluster (TopCta),
          gathered beside Commit (was a fixed bottom-center control). It sits at
          z 26 (above the dashboard scrim z 20), so it stays tappable on the board
          AND while the economy dashboard is open. Conquest + planning only. */}
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
          frameIdx={frameIdx}
          frameCount={script.frames.length}
          elapsedMs={frameStartTime(script.frames, frameIdx)}
          totalMs={totalDuration(script.frames)}
          speed={replaySpeed}
          paused={paused}
          done={uiPhase !== 'replay'}
          onSpeed={setReplaySpeed}
          dilationDepth={dilationDepth}
          onDilationDepth={setDilationDepth}
          onTogglePause={() => setPaused((p) => !p)}
          onSlotTap={(slot) => setBreakdownSlot(slot)}
          onSeekFrame={seekToFrame}
          onSeekTime={seekToTime}
          onScrubStart={onScrubStart}
          audioOn={audio.enabled}
          onToggleAudio={audio.toggle}
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
          onBuyChipTap={(baseCell) => openBuildDashboard(baseCell)}
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
        <Suspense fallback={null}>
          <BuildDashboard
            board={board}
            bases={game.bases ?? {}}
            units={game.units}
            unitTypes={types}
            credits={game.credits?.[PLAYER_FACTION] ?? 0}
            income={income}
            upkeepRate={upkeepRateOf(board)}
            buys={buys}
            focusBase={sheet.focusBase}
            onQueue={(baseCell, unitTypeKey) => tryQueueBuy({ kind: 'buy', baseCell, unitTypeKey })}
            onRemove={(baseCell) => removeBuyOrder(baseCell)}
            onClose={() => setSheet(null)}
          />
        </Suspense>
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
