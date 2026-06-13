// BottomDock — spec §9.1/§9.2: one chip per own unit (glyph; filled = has
// orders, hollow = not yet). P7: chips select + center their unit.
//
// v0.6 Ask 1: the COMMIT button moved to the top-center TopCta pill — the
// dock keeps unit chips only and they get the full width.
//
// E3 conquest: queued buys get their own dashed chips after the unit chips
// (the §B.4 order-list representation) — tap re-opens that base's build
// sheet.

import type { CellId } from '../board/types';
import type { UnitInstance } from '../core/types';
import { UnitRenderer } from './skin';

export type DockBuy = { baseCell: CellId; unit: UnitInstance };

export function BottomDock({
  units,
  ordersByUnit = new Set<string>(),
  buys = [],
  onChipTap,
  onBuyChipTap,
}: {
  /** The player's own units (faction 0), chip order = given order. */
  units: readonly UnitInstance[];
  /** Unit ids that have at least one queued order. */
  ordersByUnit?: ReadonlySet<string>;
  /** E3 conquest: queued buys, base-cell ascending (ghost instances). */
  buys?: readonly DockBuy[];
  onChipTap?: (unitId: string) => void;
  /** Tap a buy chip → center the base + reopen its build sheet. */
  onBuyChipTap?: (baseCell: CellId) => void;
}) {
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
        {buys.map((b) => (
          <button
            key={`buy-${b.baseCell}`}
            className="dock-chip dock-chip-buy"
            onClick={onBuyChipTap ? () => onBuyChipTap(b.baseCell) : undefined}
            aria-label={`${b.unit.type} purchase queued on base ${b.baseCell}`}
          >
            <svg viewBox="-16 -16 32 32" className="dock-chip-svg">
              <UnitRenderer unit={b.unit} x={0} y={0} size={24} minimal />
            </svg>
            <span className="dock-chip-buy-badge">◈</span>
          </button>
        ))}
      </div>
    </footer>
  );
}
