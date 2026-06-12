// StartScreen — spec §9.6: donor map picker with generated previews, seed
// field + randomize, Battle button. Previews are the ACTUAL boards each donor
// produces at a fixed seed (7), generated once and cached module-level so
// returning from a battle doesn't regenerate.
//
// E1 (conquest addendum §A): previews render as paper-tone SILHOUETTES —
// the cell mesh without terrain tint. Terrain is no longer public knowledge;
// a full-color preview would let players scout the map before round 1.

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

/** E3 (addendum §B): conquest round-limit choices — off is the default. */
const ROUND_LIMITS: readonly (number | null)[] = [null, 40, 60, 80];

export function StartScreen() {
  const donorId = useAppStore((s) => s.donorId);
  const seed = useAppStore((s) => s.seed);
  const mode = useAppStore((s) => s.mode);
  const roundLimit = useAppStore((s) => s.roundLimit);
  const selectDonor = useAppStore((s) => s.selectDonor);
  const setSeed = useAppStore((s) => s.setSeed);
  const setMode = useAppStore((s) => s.setMode);
  const setRoundLimit = useAppStore((s) => s.setRoundLimit);
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
                {/* E1 (addendum §A): silhouette — terrain stays undiscovered. */}
                <Board board={board} interactive={false} silhouette />
              </div>
              <span className="donor-name">{entry.name}</span>
            </button>
          ))}
        </div>
        {/* E3 (addendum §B): mode select — Conquest is the default game. */}
        <div className="mode-row" data-testid="mode-select">
          {(
            [
              { key: 'conquest', name: 'Conquest', desc: 'bases · credits · production' },
              { key: 'skirmish', name: 'Skirmish', desc: 'mirror armies · annihilation' },
            ] as const
          ).map((m) => (
            <button
              key={m.key}
              className={`mode-card${mode === m.key ? ' mode-card-selected' : ''}`}
              data-mode={m.key}
              onClick={() => setMode(m.key)}
            >
              <span className="mode-name">{m.name}</span>
              <span className="mode-desc">{m.desc}</span>
            </button>
          ))}
        </div>
        {mode === 'conquest' && (
          <div className="limit-row" data-testid="round-limit-select">
            <span className="limit-label">round limit</span>
            {ROUND_LIMITS.map((v) => (
              <button
                key={String(v)}
                className={`limit-option${roundLimit === v ? ' limit-option-selected' : ''}`}
                data-limit={String(v)}
                onClick={() => setRoundLimit(v)}
              >
                {v === null ? 'off' : v}
              </button>
            ))}
          </div>
        )}
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
