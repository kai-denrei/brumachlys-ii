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
// ?autopilot=greedy (dev/demo flag, kept on purpose): faction 0 is planned by
// the same greedy AI on commit-less rounds — auto-commits each planning phase
// and auto-dismisses summaries, so a full game fast-forwards to the banner
// organically. Useful for demos and for exercising long games by hand.

import { useEffect, useMemo, useState } from 'react';
import {
  findConvergences,
  movementCostsFor,
  orderedUnitIds,
  plannedEndCell,
  reachableCells,
  visibleCells,
} from './core';
import { findPath } from './core/pathing';
import type { OrderKind } from './core/orders';
import type { Stance, UnitInstance } from './core/types';
import { cellsWithin, graphDistance } from './board/geometry';
import type { CellId } from './board/types';
import { loadUnits } from './io/data-loader';
import { PLAYER_FACTION, useAppStore } from './state/store';
import { Board, type StancePopoverState } from './ui/Board';
import { BottomDock } from './ui/BottomDock';
import { BreakdownModal, GameOverBanner, ReplayDock, SummarySheet } from './ui/Replay';
import { InfoSheet, OrderSheet } from './ui/Sheets';
import { StartScreen } from './ui/StartScreen';
import { TopBar } from './ui/TopBar';
import type { GhostOrder } from './ui/skin';

type SheetState = { kind: 'order'; unitId: string } | { kind: 'info'; cellId: CellId } | null;

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
  const selectedUnitId = useAppStore((s) => s.selectedUnitId);
  const focus = useAppStore((s) => s.focus);
  const exitBattle = useAppStore((s) => s.exitBattle);
  const selectUnit = useAppStore((s) => s.selectUnit);
  const centerOn = useAppStore((s) => s.centerOn);
  const tryQueueOrder = useAppStore((s) => s.tryQueueOrder);
  const removeUnitOrder = useAppStore((s) => s.removeUnitOrder);
  const commit = useAppStore((s) => s.commit);
  const setReplaySpeed = useAppStore((s) => s.setReplaySpeed);
  const finishReplay = useAppStore((s) => s.finishReplay);
  const closeSummary = useAppStore((s) => s.closeSummary);
  const rematch = useAppStore((s) => s.rematch);

  const [sheet, setSheet] = useState<SheetState>(null);
  const types = useMemo(() => loadUnits(), []);
  const autopilot = useMemo(() => urlFlag('autopilot') === 'greedy', []);

  const units = useMemo(
    () => (game ? Object.values(game.units).filter((u) => u.count > 0) : []),
    [game],
  );

  // --- replay playback driver (§9.4) ------------------------------------------
  const script = replay?.script ?? null;
  const [frameIdx, setFrameIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [breakdownSlot, setBreakdownSlot] = useState<number | null>(null);

  // New script → restart playback.
  useEffect(() => {
    setFrameIdx(0);
    setPaused(false);
    setBreakdownSlot(null);
    setSheet(null);
  }, [script]);

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

  // --- planning selectors (P7, unchanged semantics over the game slice) --------
  const visible = useMemo(() => {
    if (!board) return new Set<CellId>();
    return visibleCells(board, units, PLAYER_FACTION, types);
  }, [board, units, types]);

  const fog = useMemo(() => {
    if (!board) return undefined;
    const fogged = new Set<CellId>();
    for (const id of board.cells.keys()) {
      if (!visible.has(id)) fogged.add(id);
    }
    return fogged;
  }, [board, visible]);

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
   * friendlies traversable but not a destination; VISIBLE enemies block
   * traversal but are charge destinations; hidden enemies don't exist. */
  const pathOpts = (unit: UnitInstance) => ({
    canStopAt: (c: CellId) => !friendlyAt(c, unit.id),
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
    const reach = reachableCells(board, costs, selected.cell, budget, pathOpts(selected));
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
  }, [board, selected, knownUnits, orders, types]);

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

  // --- interactions -------------------------------------------------------------
  function queueMoveTo(unit: UnitInstance, cell: CellId): boolean {
    if (!board) return false;
    const ut = types[unit.type];
    if (!ut) return false;
    const res = findPath(board, movementCostsFor(ut), unit.cell, cell, {
      budget: ut.movement,
      ...pathOpts(unit),
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
    if (!selected) return;
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
    selectUnit(null); // tap elsewhere = deselect
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

  const own = units.filter((u) => u.faction === PLAYER_FACTION);
  const orderedIds = orderedUnitIds(orders);

  const sheetUnit =
    sheet?.kind === 'order' ? knownUnits.find((u) => u.id === sheet.unitId) : undefined;
  const sheetCell = sheet?.kind === 'info' ? board.cells.get(sheet.cellId) : undefined;
  const sheetOccupant =
    sheet?.kind === 'info' ? knownUnits.find((u) => u.cell === sheet.cellId) : undefined;

  const phaseChip = uiPhase === 'planning' ? 'planning' : uiPhase === 'over' ? 'over' : 'replay';
  const topRound = replayActive && replay ? replay.round : game.round;

  return (
    <div className="app">
      <TopBar round={topRound} phase={phaseChip} onBack={exitBattle} />
      <main className="board-area">
        {frame ? (
          <Board
            board={board}
            units={frame.units}
            fog={frame.fog}
            replayFx={{
              key: frameIdx,
              fx: {
                arcs: frame.arcs,
                floaters: frame.floaters,
                bursts: frame.bursts,
                kills: frame.kills,
              },
            }}
            onFloaterTap={(slot) => setBreakdownSlot(slot)}
            className={replaySpeed === 2 ? 'board-replay-2x' : undefined}
          />
        ) : (
          <Board
            board={board}
            units={boardUnits}
            fog={fog}
            highlights={layer1}
            selectedUnitId={selected?.id ?? null}
            ghosts={ghosts}
            focus={focus}
            stancePopover={stancePopover}
            onCellTap={onCellTap}
            onUnitTap={onUnitTap}
            onGhostTap={(unitId) => setSheet({ kind: 'order', unitId })}
            onCellLongPress={(cellId) => setSheet({ kind: 'info', cellId })}
          />
        )}
      </main>
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
        />
      ) : (
        <BottomDock
          units={own}
          ordersByUnit={orderedIds}
          onChipTap={(unitId) => {
            const unit = own.find((u) => u.id === unitId);
            if (!unit) return;
            selectUnit(unitId);
            centerOn(unit.cell);
          }}
          onCommit={() => commit()}
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
          seedSuggestion={Date.now() % 1_000_000}
          onRematch={rematch}
          onChangeBattlefield={exitBattle}
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
