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
// Collapses to nothing while both rows are empty; pointer-events: none — it
// is purely informational and must never steal a board tap.

import { useMemo } from 'react';
import type { UnitInstance, UnitType } from '../core/types';
import type { Casualty } from '../state/store';
import { PLAYER_FACTION } from '../state/store';
import { UnitRenderer } from './skin';

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

export function CasualtyPanel({
  casualties,
  unitTypes,
}: {
  casualties: readonly Casualty[];
  unitTypes: Readonly<Record<string, UnitType>>;
}) {
  const { fallen, destroyed } = useMemo(() => {
    return {
      fallen: casualties.filter((c) => c.faction === PLAYER_FACTION),
      destroyed: casualties.filter((c) => c.faction !== PLAYER_FACTION),
    };
  }, [casualties]);
  if (fallen.length === 0 && destroyed.length === 0) return null;
  return (
    <div className="casualty-panel" data-testid="casualty-panel">
      {fallen.length > 0 && (
        <CasualtyRow row={fallen} label="your fallen units" unitTypes={unitTypes} />
      )}
      {destroyed.length > 0 && (
        <CasualtyRow row={destroyed} label="enemy units destroyed" unitTypes={unitTypes} />
      )}
    </div>
  );
}
