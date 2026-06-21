// UnitPicker — the reusable roster grid extracted from BuildSheet (Phase 3
// Task 3.2). A plain block (no card chrome, anchor, scrim, or header) the
// parent lays out: the 4×2 .build-grid of unit cells (icon + name + cost),
// affordability gating, a demoted .build-stat-row reflecting the focused unit,
// and an optional remove action. Affordability is judged against `available`
// (credits MINUS what's already committed elsewhere) — mirroring core
// validateBuy exactly, so a tappable cell can never be rejected. The queued
// cell stays enabled even when it would otherwise be unaffordable, since its
// cost is already reserved.

import { useMemo, useState } from 'react';
import type { UnitInstance, UnitType } from '../core/types';
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

export function UnitPicker({
  unitTypes,
  available,
  queuedKey,
  onPick,
  onRemove,
}: {
  unitTypes: Readonly<Record<string, UnitType>>;
  /** Spendable budget: credits − committed elsewhere. */
  available: number;
  /** The unit type already queued on this base, if any. */
  queuedKey?: string;
  onPick: (unitTypeKey: string) => void;
  onRemove?: () => void;
}) {
  // Cost ascending — the shop reads cheapest first; ties by initiative desc.
  const roster = useMemo(
    () =>
      Object.values(unitTypes).sort((a, b) => a.cost - b.cost || b.initiative - a.initiative),
    [unitTypes],
  );

  // Focused unit for the demoted stat row: the queued buy, else the cheapest;
  // overridden when the player taps/hovers a cell (key change without buying).
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const focused =
    roster.find((t) => t.key === focusKey) ??
    roster.find((t) => t.key === queuedKey) ??
    roster[0];

  return (
    <>
      <div className="build-grid">
        {roster.map((t) => {
          const isQueued = queuedKey === t.key;
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
                if (isQueued) onRemove?.();
                else onPick(t.key);
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
    </>
  );
}
