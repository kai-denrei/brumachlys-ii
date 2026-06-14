// CasualtyPanel — v1.3 Tweak C: chess-style captured-pieces recap, top-LEFT
// below the top bar (the skirmish.log chip owns the top-right). Two compact
// rows of small skin icons: row 1 = the player's fallen units, row 2 = enemy
// units the player WITNESSED being destroyed — both in order of death,
// repeats just repeat the icon (chess style).
//
// FOG HONESTY (§7): the rows render the store's `casualties` verbatim, which
// accumulates ONLY the fog-filtered replay summary's kills (state/replay.ts
// withholds unseen deaths). A mist kill never reaches this panel, so the
// player cannot learn an unseen unit died by counting icons.
//
// Collapses to nothing while both rows are empty; the panel is clickable
// (pointer-events: auto) to open the CasualtyModal for full detail.
//
// v0.9: expandable — clicking the panel opens CasualtyModal (bigger icons,
// grouped duplicates with counts, per-side credit value, per-unit full stats).

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FactionId, UnitInstance, UnitType } from '../core/types';
import type { Casualty } from '../state/store';
import { PLAYER_FACTION } from '../state/store';
import { factionColor } from './skin/palette';
import { UnitRenderer } from './skin';
import { UnitCard } from './Sheets';

function iconUnit(c: Casualty, k: number): UnitInstance {
  return {
    id: `cas${k}`,
    type: c.type,
    faction: c.faction,
    cell: 0,
    count: 0,
    stance: 'aggressive',
    attackedFrom: [],
  };
}

/** Exported (v1.4): the game-over banner's recap reuses this exact icon
 * vocabulary for its losses/destroyed rows. */
export function CasualtyRow({
  row,
  label,
  unitTypes,
}: {
  row: readonly Casualty[];
  label: string;
  unitTypes: Readonly<Record<string, UnitType>>;
}) {
  const names = row.map((c) => unitTypes[c.type]?.name ?? c.type).join(', ');
  return (
    <div className="casualty-row" role="img" aria-label={`${label}: ${names}`}>
      {row.map((c, k) => (
        <svg key={k} viewBox="-16 -16 32 32" className="casualty-icon" aria-hidden="true">
          <UnitRenderer unit={iconUnit(c, k)} x={0} y={0} size={24} minimal />
        </svg>
      ))}
    </div>
  );
}

// --- v0.9: CasualtyModal — expanded detail view --------------------------------

type CasualtyGroup = { type: string; faction: FactionId; count: number; totalCost: number };

/** Group casualties by type, count duplicates, compute total cost value. */
function groupCasualties(
  row: readonly Casualty[],
  unitTypes: Readonly<Record<string, UnitType>>,
): CasualtyGroup[] {
  const map = new Map<string, CasualtyGroup>();
  for (const c of row) {
    const existing = map.get(c.type);
    const cost = unitTypes[c.type]?.cost ?? 0;
    if (existing) {
      existing.count++;
      existing.totalCost += cost;
    } else {
      map.set(c.type, { type: c.type, faction: c.faction, count: 1, totalCost: cost });
    }
  }
  return [...map.values()];
}

function modalIconUnit(type: string, faction: FactionId): UnitInstance {
  return {
    id: `modal-${type}-${faction}`,
    type,
    faction,
    cell: 0,
    count: 0,
    stance: 'aggressive',
    attackedFrom: [],
  };
}

/** Full stat card used inside the modal. Shows name, type stats incl. cost. */
function CasualtyUnitCard({
  type,
  faction,
  unitTypes,
}: {
  type: string;
  faction: FactionId;
  unitTypes: Readonly<Record<string, UnitType>>;
}) {
  const unitType = unitTypes[type];
  if (!unitType) return null;
  const unit = modalIconUnit(type, faction);
  // UnitCard shows live unit stats (count, stance, veterancy). For a casualty
  // we pass a synthetic instance with count 0 — the card renders nicely still.
  return <UnitCard unit={unit} unitType={unitType} />;
}

/** One section (your losses / enemy destroyed) of the modal. */
function CasualtySection({
  label,
  color,
  groups,
  unitTypes,
  selectedType,
  onSelect,
}: {
  label: string;
  color: string;
  groups: CasualtyGroup[];
  unitTypes: Readonly<Record<string, UnitType>>;
  selectedType: string | null;
  onSelect: (type: string) => void;
}) {
  const totalValue = groups.reduce((sum, g) => sum + g.totalCost, 0);
  if (groups.length === 0) return null;

  return (
    <section className="casualty-modal-section" data-testid={`casualty-section-${label.replace(/\s+/g, '-')}`}>
      <div className="casualty-modal-section-header">
        <span className="casualty-modal-section-label" style={{ color }}>
          {label}
        </span>
        {totalValue > 0 && (
          <span className="casualty-modal-section-value" style={{ color }}>
            ◈ {totalValue}
          </span>
        )}
      </div>
      <div className="casualty-modal-grid">
        {groups.map((g) => {
          const isSelected = selectedType === g.type;
          return (
            <button
              key={g.type}
              className={`casualty-modal-unit-btn${isSelected ? ' is-selected' : ''}`}
              onClick={() => onSelect(g.type)}
              aria-pressed={isSelected}
              aria-label={`${unitTypes[g.type]?.name ?? g.type}, ${g.count} lost`}
              data-testid={`casualty-unit-btn-${g.type}`}
            >
              <svg viewBox="-22 -22 44 44" className="casualty-modal-icon" aria-hidden="true">
                <UnitRenderer unit={modalIconUnit(g.type, g.faction)} x={0} y={0} size={44} minimal />
              </svg>
              {g.count > 1 && (
                <span className="casualty-modal-count" style={{ color }}>
                  ×{g.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {selectedType && groups.some((g) => g.type === selectedType) && (
        <div className="casualty-modal-detail" data-testid="casualty-detail-card">
          <CasualtyUnitCard
            type={selectedType}
            faction={groups.find((g) => g.type === selectedType)!.faction}
            unitTypes={unitTypes}
          />
        </div>
      )}
    </section>
  );
}

/** Portal modal — full casualty detail with bigger icons, grouped duplicates,
 * credit value totals per side, and tap-to-inspect full stats (incl. cost). */
export function CasualtyModal({
  fallen,
  destroyed,
  unitTypes,
  onClose,
}: {
  fallen: readonly Casualty[];
  destroyed: readonly Casualty[];
  unitTypes: Readonly<Record<string, UnitType>>;
  onClose: () => void;
}) {
  const [selectedType, setSelectedType] = useState<string | null>(null);

  const fallenGroups = useMemo(() => groupCasualties(fallen, unitTypes), [fallen, unitTypes]);
  const destroyedGroups = useMemo(() => groupCasualties(destroyed, unitTypes), [destroyed, unitTypes]);

  const colorA = factionColor(PLAYER_FACTION);
  const colorB = factionColor(1);

  const isEmpty = fallen.length === 0 && destroyed.length === 0;

  function handleSelect(type: string) {
    setSelectedType((prev) => (prev === type ? null : type));
  }

  return createPortal(
    <div
      className="sheet-scrim"
      onClick={onClose}
      data-testid="casualty-modal-scrim"
    >
      <div
        className="rules-modal casualty-modal"
        role="dialog"
        aria-label="casualties"
        data-testid="casualty-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grab" />
        <div className="sheet-header">
          <span className="sheet-title">CASUALTIES</span>
          <button
            className="sheet-close"
            onClick={onClose}
            aria-label="close casualties"
            data-testid="casualty-modal-close"
          >
            ✕
          </button>
        </div>
        <div className="rules-body">
          {isEmpty ? (
            <p className="sheet-empty">No casualties yet.</p>
          ) : (
            <>
              <CasualtySection
                label="your losses"
                color={colorA}
                groups={fallenGroups}
                unitTypes={unitTypes}
                selectedType={selectedType}
                onSelect={handleSelect}
              />
              <CasualtySection
                label="enemy destroyed"
                color={colorB}
                groups={destroyedGroups}
                unitTypes={unitTypes}
                selectedType={selectedType}
                onSelect={handleSelect}
              />
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function CasualtyPanel({
  casualties,
  unitTypes,
}: {
  casualties: readonly Casualty[];
  unitTypes: Readonly<Record<string, UnitType>>;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  const { fallen, destroyed } = useMemo(() => {
    return {
      fallen: casualties.filter((c) => c.faction === PLAYER_FACTION),
      destroyed: casualties.filter((c) => c.faction !== PLAYER_FACTION),
    };
  }, [casualties]);

  if (fallen.length === 0 && destroyed.length === 0) return null;

  return (
    <>
      <button
        className="casualty-panel"
        data-testid="casualty-panel"
        onClick={() => setModalOpen(true)}
        aria-label="casualties — tap to expand"
        title="Tap to see full casualty breakdown"
      >
        {fallen.length > 0 && (
          <CasualtyRow row={fallen} label="your fallen units" unitTypes={unitTypes} />
        )}
        {destroyed.length > 0 && (
          <CasualtyRow row={destroyed} label="enemy units destroyed" unitTypes={unitTypes} />
        )}
      </button>
      {modalOpen && (
        <CasualtyModal
          fallen={fallen}
          destroyed={destroyed}
          unitTypes={unitTypes}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}
