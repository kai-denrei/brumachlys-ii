// App — shell screens (spec §9.6): start ↔ battle, driven by the Zustand
// store. P6: the battle screen is display-only (board + mirror armies + the
// player's fog); P7 adds order entry, P8 resolution/replay.

import { useMemo } from 'react';
import { visibleCells } from './core';
import type { CellId } from './board/types';
import { loadUnits } from './io/data-loader';
import { useAppStore } from './state/store';
import { Board } from './ui/Board';
import { BottomDock } from './ui/BottomDock';
import { StartScreen } from './ui/StartScreen';
import { TopBar } from './ui/TopBar';

function BattleScreen() {
  const board = useAppStore((s) => s.board);
  const units = useAppStore((s) => s.displayUnits);
  const exitBattle = useAppStore((s) => s.exitBattle);

  // Player's (faction 0) fog: cells outside the vision union get the mist.
  // P6 display shows ALL units (both armies are the point of the screen);
  // P7's planning view will filter hidden enemies out of `units`.
  const fog = useMemo(() => {
    if (!board) return undefined;
    const visible = visibleCells(board, units, 0, loadUnits());
    const fogged = new Set<CellId>();
    for (const id of board.cells.keys()) {
      if (!visible.has(id)) fogged.add(id);
    }
    return fogged;
  }, [board, units]);

  if (!board) return null;
  const own = units.filter((u) => u.faction === 0);

  return (
    <div className="app">
      <TopBar round={1} phase="planning" onBack={exitBattle} />
      <main className="board-area">
        <Board board={board} units={units} fog={fog} />
      </main>
      <BottomDock units={own} />
    </div>
  );
}

export function App() {
  const screen = useAppStore((s) => s.screen);
  return screen === 'start' ? <StartScreen /> : <BattleScreen />;
}
