// Sheets.tsx — bottom sheets (spec §9.3 ghost-order details, §9.5 long-press
// info). Ordinary DOM rendered over the board; they don't anchor to board
// geometry, so they live OUTSIDE the SVG (see Board.tsx overlay-UI note).

import type { Cell, TerrainKey } from '../board/types';
import type { Stance, UnitInstance, UnitType } from '../core/types';
import type { OrderKind, UnitOrders } from '../core/orders';
import { IMPASSABLE } from '../core/pathing';
import { UnitRenderer } from './skin';

function SheetShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div
        className="bottom-sheet"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grab" />
        <div className="sheet-header">
          <span className="sheet-title">{title}</span>
          <button className="sheet-close" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const STANCE_LABEL: Record<Stance, string> = {
  aggressive: 'Aggressive',
  defensive: 'Defensive',
  'hold-fire': 'Hold fire',
};

// --- §9.3 — queued-order details ------------------------------------------------

export function OrderSheet({
  unit,
  unitType,
  orders,
  targetName,
  onEdit,
  onRemove,
  onClose,
}: {
  unit: UnitInstance;
  unitType: UnitType | undefined;
  orders: UnitOrders;
  /** Name of the unit on the attack target cell, if visible. */
  targetName?: string;
  /** Re-select the unit (sheet closes); new taps REPLACE same-kind orders. */
  onEdit: () => void;
  onRemove: (kind: OrderKind) => void;
  onClose: () => void;
}) {
  const rows: { kind: OrderKind; label: string; detail: string }[] = [];
  if (orders.move) {
    const path = orders.move.path;
    rows.push({
      kind: 'move',
      label: 'Move',
      detail: `${path.length} step${path.length === 1 ? '' : 's'} → cell ${path[path.length - 1]}`,
    });
  }
  if (orders.attack) {
    rows.push({
      kind: 'attack',
      label: 'Attack',
      detail: targetName ? `${targetName} (cell ${orders.attack.targetCell})` : `cell ${orders.attack.targetCell}`,
    });
  }
  if (orders.stance) {
    rows.push({ kind: 'stance', label: 'Stance', detail: STANCE_LABEL[orders.stance.stance] });
  }

  return (
    <SheetShell title={`${unitType?.name ?? unit.type} — orders`} onClose={onClose}>
      <div className="order-rows">
        {rows.length === 0 && <p className="sheet-empty">No orders queued.</p>}
        {rows.map((row) => (
          <div className="order-row" key={row.kind}>
            <span className="order-kind">{row.label}</span>
            <span className="order-detail">{row.detail}</span>
            <button className="sheet-button sheet-button-danger" onClick={() => onRemove(row.kind)}>
              remove
            </button>
          </div>
        ))}
      </div>
      <div className="sheet-actions">
        <button className="sheet-button" onClick={onEdit}>
          edit orders
        </button>
      </div>
    </SheetShell>
  );
}

// --- §9.5 — long-press cell info -------------------------------------------------

const TERRAIN_LABEL: Record<TerrainKey, string> = {
  plains: 'Plains',
  woods: 'Woods',
  mountains: 'Mountains',
  swamp: 'Swamp',
  water: 'Water',
  base: 'Base',
};

function fmtCost(cost: number | undefined): string {
  if (cost === undefined || cost >= IMPASSABLE) return '—';
  return String(cost);
}

function fmtBonus(v: number | undefined): string {
  if (v === undefined) return '—';
  return v > 0 ? `+${v}` : String(v);
}

export function InfoSheet({
  cell,
  occupant,
  occupantType,
  unitTypes,
  onClose,
}: {
  cell: Cell;
  /** Unit on the cell, if any and VISIBLE to the player (caller filters). */
  occupant?: UnitInstance;
  occupantType?: UnitType;
  unitTypes: Readonly<Record<string, UnitType>>;
  onClose: () => void;
}) {
  // Class representatives for the §6.2 per-class terrain table: terrain
  // effects are uniform within a class, so any personnel/vehicle pair works.
  const personnel = Object.values(unitTypes).find((t) => t.armorType === 'personnel');
  const vehicle = Object.values(unitTypes).find((t) => t.armorType === 'armored');
  const pe = personnel?.terrainEffects[cell.terrain];
  const ve = vehicle?.terrainEffects[cell.terrain];

  return (
    <SheetShell title={`${TERRAIN_LABEL[cell.terrain]} — cell ${cell.id}`} onClose={onClose}>
      <table className="terrain-table">
        <thead>
          <tr>
            <th />
            <th>move cost</th>
            <th>Ta</th>
            <th>Td</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>personnel</td>
            <td>{fmtCost(pe?.movementCost)}</td>
            <td>{pe && pe.movementCost < IMPASSABLE ? fmtBonus(pe.attackBonus) : '—'}</td>
            <td>{pe && pe.movementCost < IMPASSABLE ? fmtBonus(pe.armorBonus) : '—'}</td>
          </tr>
          <tr>
            <td>vehicle</td>
            <td>{fmtCost(ve?.movementCost)}</td>
            <td>{ve && ve.movementCost < IMPASSABLE ? fmtBonus(ve.attackBonus) : '—'}</td>
            <td>{ve && ve.movementCost < IMPASSABLE ? fmtBonus(ve.armorBonus) : '—'}</td>
          </tr>
        </tbody>
      </table>

      {occupant && occupantType && (
        <div className="unit-card">
          <div className="unit-card-head">
            <svg viewBox="-20 -20 40 40" className="unit-card-token">
              <UnitRenderer unit={occupant} x={0} y={0} size={30} />
            </svg>
            <div>
              <div className="unit-card-name">{occupantType.name}</div>
              <div className="unit-card-sub">
                count {occupant.count} · {STANCE_LABEL[occupant.stance]}
              </div>
            </div>
          </div>
          <dl className="unit-card-stats">
            <div>
              <dt>initiative</dt>
              <dd>{occupantType.initiative}</dd>
            </div>
            <div>
              <dt>movement</dt>
              <dd>{occupantType.movement}</dd>
            </div>
            <div>
              <dt>armor</dt>
              <dd>
                {occupantType.armor} ({occupantType.armorType})
              </dd>
            </div>
            <div>
              <dt>range</dt>
              <dd>
                {occupantType.minRange === occupantType.maxRange
                  ? occupantType.maxRange
                  : `${occupantType.minRange}–${occupantType.maxRange}`}
              </dd>
            </div>
            <div>
              <dt>vision</dt>
              <dd>{occupantType.vision}</dd>
            </div>
            <div>
              <dt>atk vs pers / arm</dt>
              <dd>
                {occupantType.attackStrengths.personnel} / {occupantType.attackStrengths.armored}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </SheetShell>
  );
}
