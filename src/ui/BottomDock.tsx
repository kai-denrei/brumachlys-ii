// BottomDock — spec §9.1/§9.2: one chip per own unit (glyph; filled = has
// orders, hollow = not yet) + Commit button showing n/8. P7: chips select +
// center their unit; Commit enables at ≥1 queued order (the player may leave
// units unordered deliberately). P8 wires onCommit to resolution.

import type { UnitInstance } from '../core/types';
import { UnitRenderer } from './skin';

export function BottomDock({
  units,
  ordersByUnit = new Set<string>(),
  onChipTap,
  onCommit,
}: {
  /** The player's own units (faction 0), chip order = given order. */
  units: readonly UnitInstance[];
  /** Unit ids that have at least one queued order. */
  ordersByUnit?: ReadonlySet<string>;
  onChipTap?: (unitId: string) => void;
  /** P8: commit → AI plans → resolver. Absent = stub (button still gates). */
  onCommit?: () => void;
}) {
  const done = units.filter((u) => ordersByUnit.has(u.id)).length;
  return (
    <footer className="bottom-dock">
      <div className="dock-chips">
        {units.map((u) => {
          const filled = ordersByUnit.has(u.id);
          return (
            <button
              key={u.id}
              className={`dock-chip${filled ? ' dock-chip-filled' : ' dock-chip-hollow'}`}
              onClick={onChipTap ? () => onChipTap(u.id) : undefined}
              aria-label={`${u.type} orders ${filled ? 'set' : 'unset'}`}
            >
              <svg viewBox="-16 -16 32 32" className="dock-chip-svg">
                <UnitRenderer unit={u} x={0} y={0} size={24} />
              </svg>
            </button>
          );
        })}
      </div>
      <button className="commit-button" disabled={done === 0} onClick={onCommit}>
        COMMIT {done}/{units.length}
      </button>
    </footer>
  );
}
