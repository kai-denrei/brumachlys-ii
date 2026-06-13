// BuildSheet — E3 conquest production (addendum §B.4), v0.7 Item 3 redesign.
// A COMPACT CARD that pops up over the tapped base cell (anchored in screen
// space, clamped to the viewport) instead of a full-width bottom sheet. The 8
// units sit in a 4×2 grid: a large ICON, a small NAME, and the cost; affordable
// cells are active, unaffordable ones dimmed. Tapping a cell queues that buy
// (the on-board ghost + "arrives at round end" pill confirm). The i/a/r/v/p/h/m
// stat line is DEMOTED to a single compact row under the grid that reflects the
// FOCUSED unit (last tapped/hovered, default the queued or cheapest unit) — the
// stats are still one tap/hover away, just not cluttering every cell. Close on
// outside tap, on pick, or via the X.
//
// Affordability is judged against credits MINUS what's already committed on
// OTHER bases (this base's own queued buy is being replaced, so its cost frees
// up) — mirroring core validateBuy exactly, so a tappable cell can never be
// rejected.

import { useMemo, useState } from 'react';
import type { CellId } from '../board/types';
import type { UnitInstance, UnitType } from '../core/types';
import type { BuyOrder } from '../core/orders';
import { PLAYER_FACTION } from '../state/store';
import { UnitRenderer } from './skin';

function fmtRange(min: number, max: number): string {
  return min === max ? String(max) : `${min}–${max}`;
}

/** Throwaway instance so cells render the real token art through the skin. */
const cellUnit = (type: string): UnitInstance => ({
  id: `build-${type}`,
  type,
  faction: PLAYER_FACTION,
  cell: 0,
  count: 1,
  stance: 'aggressive',
  attackedFrom: [],
});

const CARD_W = 300; // px — clamped target width of the compact card
const CARD_MARGIN = 8; // viewport edge keep-out

/** Clamp the anchored card into the viewport: center it over the click point
 * horizontally, sit it above the point (below when near the top). Returns a
 * style object. Pure-ish (reads window once) — exported for tests. */
export function anchorCardStyle(
  anchor: { x: number; y: number } | undefined,
  vw: number,
  vh: number,
): React.CSSProperties {
  if (!anchor) {
    // No anchor (e.g. dock-chip reopen) — center it.
    return { left: vw / 2, top: vh / 2, transform: 'translate(-50%, -50%)' };
  }
  const half = CARD_W / 2;
  const left = Math.max(CARD_MARGIN + half, Math.min(anchor.x, vw - half - CARD_MARGIN));
  // Prefer above the tap; flip below when the tap is high on screen.
  const below = anchor.y < vh * 0.42;
  const top = below ? anchor.y + 18 : anchor.y - 18;
  return {
    left,
    top,
    transform: below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
  };
}

export function BuildSheet({
  baseCell,
  anchor,
  unitTypes,
  credits,
  committedElsewhere,
  queued,
  onQueue,
  onRemove,
  onClose,
}: {
  baseCell: CellId;
  /** v0.7 Item 3: client-space point the user tapped (card pops up over it). */
  anchor?: { x: number; y: number };
  unitTypes: Readonly<Record<string, UnitType>>;
  /** The player's credits on hand (planning is static — no income preview). */
  credits: number;
  /** Cost committed by buys queued on OTHER bases. */
  committedElsewhere: number;
  /** This base's queued buy, if any. */
  queued?: BuyOrder;
  onQueue: (unitTypeKey: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  // Cost ascending — the shop reads cheapest first; ties by initiative desc.
  const roster = useMemo(
    () =>
      Object.values(unitTypes).sort((a, b) => a.cost - b.cost || b.initiative - a.initiative),
    [unitTypes],
  );
  const available = credits - committedElsewhere;

  // Focused unit for the demoted stat row: the queued buy, else the cheapest;
  // overridden when the player taps/hovers a cell (key change without buying).
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const focused =
    roster.find((t) => t.key === focusKey) ??
    roster.find((t) => t.key === queued?.unitTypeKey) ??
    roster[0];

  const vw = typeof window !== 'undefined' ? window.innerWidth : 390;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 844;
  const style = anchorCardStyle(anchor, vw, vh);

  return (
    <div className="sheet-scrim sheet-scrim-anchored" onClick={onClose}>
      <div
        className="build-card"
        role="dialog"
        aria-label={`base ${baseCell} production`}
        data-testid="build-sheet"
        style={style}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="build-card-head">
          <span className="build-card-title">Base {baseCell}</span>
          <span className="build-available" data-testid="build-available">
            ◈ {available}
          </span>
          <button className="sheet-close" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="build-grid">
          {roster.map((t) => {
            const isQueued = queued?.unitTypeKey === t.key;
            const affordable = t.cost <= available;
            const isFocus = focused?.key === t.key;
            return (
              <button
                key={t.key}
                className={`build-row build-cell${isQueued ? ' build-row-queued' : ''}${
                  !affordable && !isQueued ? ' build-row-locked' : ''
                }${isFocus ? ' build-cell-focus' : ''}`}
                data-build-type={t.key}
                disabled={!affordable && !isQueued}
                onClick={() => {
                  setFocusKey(t.key);
                  if (isQueued) onRemove();
                  else onQueue(t.key);
                }}
                onPointerEnter={() => setFocusKey(t.key)}
                aria-label={`${isQueued ? 'remove queued' : 'buy'} ${t.name} for ${t.cost}`}
              >
                <svg viewBox="-14 -14 28 28" className="build-cell-icon">
                  <UnitRenderer unit={cellUnit(t.key)} x={0} y={0} size={28} minimal />
                </svg>
                <span className="build-cell-name">{t.name}</span>
                <span className="build-cell-cost">◈ {t.cost}</span>
                {isQueued && <span className="build-cell-badge">queued</span>}
              </button>
            );
          })}
        </div>
        {focused && (
          <div className="build-stat-row" data-testid="build-stat-row">
            <span className="build-stat-name">{focused.name}</span>
            <span className="build-stat-line">
              i:{focused.initiative} a:{focused.armor} r:
              {fmtRange(focused.minRange, focused.maxRange)} v:{focused.vision} p:
              {focused.attackStrengths.personnel} h:{focused.attackStrengths.armored} m:
              {focused.movement}
            </span>
          </div>
        )}
        {queued && (
          <div className="build-card-actions">
            <button className="sheet-button sheet-button-danger" onClick={onRemove}>
              remove {unitTypes[queued.unitTypeKey]?.name ?? queued.unitTypeKey} order
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
