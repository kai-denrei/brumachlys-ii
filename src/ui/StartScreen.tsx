// StartScreen — spec §9.6: donor map picker with generated previews, seed
// field + randomize, Battle button. Previews are the ACTUAL boards each donor
// produces at a fixed seed (7), generated once and cached module-level so
// returning from a battle doesn't regenerate.

import { useMemo } from 'react';
import type { Board as BoardGraph } from '../board/types';
import { generateBoard } from '../board';
import { DONOR_ENTRIES, loadDonor } from '../io/donor-registry';
import { useAppStore } from '../state/store';
import { Board } from './Board';
import { TopBar } from './TopBar';

const PREVIEW_SEED = 7;
const previewCache = new Map<string, BoardGraph>();

function previewBoard(donorId: string): BoardGraph {
  let b = previewCache.get(donorId);
  if (!b) {
    b = generateBoard(loadDonor(donorId), PREVIEW_SEED);
    previewCache.set(donorId, b);
  }
  return b;
}

export function StartScreen() {
  const donorId = useAppStore((s) => s.donorId);
  const seed = useAppStore((s) => s.seed);
  const selectDonor = useAppStore((s) => s.selectDonor);
  const setSeed = useAppStore((s) => s.setSeed);
  const randomizeSeed = useAppStore((s) => s.randomizeSeed);
  const startBattle = useAppStore((s) => s.startBattle);

  const previews = useMemo(
    () => DONOR_ENTRIES.map((e) => ({ entry: e, board: previewBoard(e.id) })),
    [],
  );

  return (
    <div className="app">
      <TopBar round={null} phase="new battle" />
      <main className="start-screen">
        <p className="start-tagline">The mist is gathering. Choose your ground.</p>
        <div className="donor-grid">
          {previews.map(({ entry, board }) => (
            <button
              key={entry.id}
              className={`donor-card${entry.id === donorId ? ' donor-card-selected' : ''}`}
              data-donor-id={entry.id}
              onClick={() => selectDonor(entry.id)}
            >
              <div className="donor-preview">
                <Board board={board} interactive={false} />
              </div>
              <span className="donor-name">{entry.name}</span>
            </button>
          ))}
        </div>
        <div className="seed-row">
          <label className="seed-label" htmlFor="seed-input">
            seed
          </label>
          <input
            id="seed-input"
            className="seed-input"
            type="number"
            inputMode="numeric"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value) || 0)}
          />
          <button className="seed-randomize" onClick={randomizeSeed} aria-label="random seed">
            ⟳
          </button>
        </div>
        <button className="battle-button" onClick={startBattle}>
          BATTLE
        </button>
      </main>
    </div>
  );
}
