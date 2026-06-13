// BuildSheet — E3 conquest production (addendum §B.4). Tap an OWNED base
// during planning → this bottom sheet: the full 8-unit roster with icon,
// name, cost, and the fixed one-glance stat vocabulary (i/a/r/v/p/h — same
// line the hover card uses). Affordable rows are active; the queued buy (if
// any) is highlighted; tapping a row queues/REPLACES the base's buy (max one
// per base per round is structural — core BuyQueues); a remove row drops it.
//
// Affordability is judged against credits MINUS what's already committed on
// OTHER bases (this base's own queued buy is the one being replaced, so its
// cost frees up) — mirroring core validateBuy exactly, so a tappable row can
// never be rejected.

import { useMemo } from 'react';
import type { CellId } from '../board/types';
import type { UnitInstance, UnitType } from '../core/types';
import type { BuyOrder } from '../core/orders';
import { PLAYER_FACTION } from '../state/store';
import { UnitRenderer } from './skin';

function fmtRange(min: number, max: number): string {
  return min === max ? String(max) : `${min}–${max}`;
}

/** Throwaway instance so rows render the real token art through the skin. */
const rowUnit = (type: string): UnitInstance => ({
  id: `build-${type}`,
  type,
  faction: PLAYER_FACTION,
  cell: 0,
  count: 1,
  stance: 'aggressive',
  attackedFrom: [],
});

export function BuildSheet({
  baseCell,
  unitTypes,
  credits,
  committedElsewhere,
  queued,
  onQueue,
  onRemove,
  onClose,
}: {
  baseCell: CellId;
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

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div
        className="bottom-sheet build-sheet"
        role="dialog"
        aria-label={`base ${baseCell} production`}
        data-testid="build-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grab" />
        <div className="sheet-header">
          <span className="sheet-title">Base {baseCell} — muster a unit</span>
          <span className="build-available" data-testid="build-available">
            ◈ {available}
          </span>
          <button className="sheet-close" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="build-rows">
          {roster.map((t) => {
            const isQueued = queued?.unitTypeKey === t.key;
            const affordable = t.cost <= available;
            return (
              <button
                key={t.key}
                className={`build-row${isQueued ? ' build-row-queued' : ''}${
                  !affordable && !isQueued ? ' build-row-locked' : ''
                }`}
                data-build-type={t.key}
                disabled={!affordable && !isQueued}
                onClick={() => (isQueued ? onRemove() : onQueue(t.key))}
                aria-label={`${isQueued ? 'remove queued' : 'buy'} ${t.name} for ${t.cost}`}
              >
                <svg viewBox="-14 -14 28 28" className="build-row-icon">
                  <UnitRenderer unit={rowUnit(t.key)} x={0} y={0} size={24} minimal />
                </svg>
                <span className="build-row-main">
                  <span className="build-row-name">{t.name}</span>
                  <span className="build-row-stats">
                    i:{t.initiative} a:{t.armor} r:{fmtRange(t.minRange, t.maxRange)} v:{t.vision}{' '}
                    p:{t.attackStrengths.personnel} h:{t.attackStrengths.armored} m:{t.movement}
                  </span>
                </span>
                <span className="build-row-cost">◈ {t.cost}</span>
                {isQueued && <span className="build-row-badge">queued</span>}
              </button>
            );
          })}
        </div>
        {queued && (
          <div className="sheet-actions">
            <button className="sheet-button sheet-button-danger" onClick={onRemove}>
              remove {unitTypes[queued.unitTypeKey]?.name ?? queued.unitTypeKey} order
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
