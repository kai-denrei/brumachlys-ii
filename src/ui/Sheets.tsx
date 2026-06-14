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
  // v0.8 Task 2.4: capture order — show in the order sheet so the player can
  // remove it from the sheet in addition to the in-board toggle.
  if (orders.capture) {
    rows.push({ kind: 'capture', label: 'Capture', detail: 'will claim base on arrival' });
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

/** v0.7 Item 2: base ownership status surfaced in the info sheet. */
const BASE_STATUS_LABEL: Record<'yours' | 'enemy' | 'camp', string> = {
  yours: 'Your base — produces units & credits',
  enemy: 'Enemy base',
  camp: 'Neutral camp — capture to claim it',
};

export function InfoSheet({
  cell,
  tier = 'live',
  baseStatus,
  occupant,
  occupantType,
  unitTypes,
  onClose,
}: {
  cell: Cell;
  /** v0.7 Item 2: fog tier of the tapped cell. 'dark' = never scouted: show
   * "unscouted", NEVER the terrain (secrecy). 'memory'/'live' show terrain. */
  tier?: 'live' | 'memory' | 'dark';
  /** v0.7 Item 2 (conquest): base ownership status, when known (not dark). */
  baseStatus?: 'yours' | 'enemy' | 'camp';
  /** Unit on the cell, if any and VISIBLE to the player (caller filters). */
  occupant?: UnitInstance;
  occupantType?: UnitType;
  unitTypes: Readonly<Record<string, UnitType>>;
  onClose: () => void;
}) {
  // v0.7 Item 2: a dark cell has never been scouted — its terrain is secret.
  // Show only "Unscouted", no terrain table (the planning lens assumes plains;
  // the info sheet must not leak that or the truth).
  if (tier === 'dark') {
    return (
      <SheetShell title={`Cell ${cell.id} — unscouted`} onClose={onClose}>
        <p className="sheet-empty">
          This ground hasn&apos;t been scouted. Move a unit into vision to reveal its terrain.
        </p>
      </SheetShell>
    );
  }

  // Class representatives for the §6.2 per-class terrain table: terrain
  // effects are uniform within a class, so any personnel/vehicle pair works.
  const personnel = Object.values(unitTypes).find((t) => t.armorType === 'personnel');
  const vehicle = Object.values(unitTypes).find((t) => t.armorType === 'armored');
  const pe = personnel?.terrainEffects[cell.terrain];
  const ve = vehicle?.terrainEffects[cell.terrain];

  const titleSuffix = tier === 'memory' ? ' (remembered)' : '';
  return (
    <SheetShell
      title={`${TERRAIN_LABEL[cell.terrain]} — cell ${cell.id}${titleSuffix}`}
      onClose={onClose}
    >
      {baseStatus && (
        <p className="info-base-status" data-base-status={baseStatus}>
          {BASE_STATUS_LABEL[baseStatus]}
        </p>
      )}
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

      {occupant && occupantType && <UnitCard unit={occupant} unitType={occupantType} />}
    </SheetShell>
  );
}

/** min–max range, collapsed to one number when min = max. */
function fmtRange(min: number, max: number): string {
  return min === max ? String(max) : `${min}–${max}`;
}

/** The verbose unit-stats card — the §9.5 long-press info sheet's detail
 * view: name, count, stance, init, movement, armor (+type), range, vision,
 * attack vs personnel/armored. (v1.2: the hover card no longer shares this —
 * it has its own one-glance layout below.) */
export function UnitCard({ unit, unitType }: { unit: UnitInstance; unitType: UnitType }) {
  return (
    <div className="unit-card">
      <div className="unit-card-head">
        <svg viewBox="-20 -20 40 40" className="unit-card-token">
          <UnitRenderer unit={unit} x={0} y={0} size={30} />
        </svg>
        <div>
          <div className="unit-card-name">{unitType.name}</div>
          <div className="unit-card-sub">
            count {unit.count} · {STANCE_LABEL[unit.stance]}
          </div>
        </div>
      </div>
      <dl className="unit-card-stats">
        <div>
          <dt>initiative</dt>
          <dd>{unitType.initiative}</dd>
        </div>
        <div>
          <dt>movement</dt>
          <dd>{unitType.movement}</dd>
        </div>
        <div>
          <dt>armor</dt>
          <dd>
            {unitType.armor} ({unitType.armorType})
          </dd>
        </div>
        <div>
          <dt>range</dt>
          <dd>{fmtRange(unitType.minRange, unitType.maxRange)}</dd>
        </div>
        <div>
          <dt>vision</dt>
          <dd>{unitType.vision}</dd>
        </div>
        <div>
          <dt>atk vs pers / arm</dt>
          <dd>
            {unitType.attackStrengths.personnel} / {unitType.attackStrengths.armored}
          </dd>
        </div>
      </dl>
      <div className="unit-card-veterancy">
        <span className="unit-card-vet-label">veterancy</span>
        <span className="unit-card-vet-stats">
          {'★'.repeat(Math.max(0, unit.rank ?? 0)) || '—'} &nbsp; xp {unit.xp ?? 0} &nbsp; kills {unit.kills ?? 0}
        </span>
      </div>
    </div>
  );
}

/** v1.1 Feature A / v1.2 tweak 3 — the hover card is the GLANCE (the
 * long-press info sheet keeps the verbose detail view): one line of identity
 * (name + count + stance), one monospace stat line in the fixed vocabulary
 * `i:13 a:4 r:1–2 v:4 p:9 h:2 m:6` — initiative, armor, range (min–max
 * collapsed when equal), vision, attack vs personnel, attack vs
 * heavy/armored, and (v0.6 Ask 4) m = raw movement budget in tenths,
 * consistent with the terrain cost table.
 * Mouse only; the Board owns detection/dismissal, this is pure presentation.
 * Position is fixed at hover time — any pan/zoom dismisses the card. */
export function UnitHoverCard({
  unit,
  unitType,
  clientX,
  clientY,
}: {
  unit: UnitInstance;
  unitType: UnitType;
  clientX: number;
  clientY: number;
}) {
  // Clamp into the viewport; float above the token, below when near the top.
  const w = 200;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const left = Math.max(8 + w / 2, Math.min(clientX, vw - w / 2 - 8));
  const below = clientY < 140;
  return (
    <div
      className="hover-card"
      data-testid="unit-hover-card"
      style={{
        left,
        top: clientY,
        width: w,
        transform: below ? 'translate(-50%, 22px)' : 'translate(-50%, calc(-100% - 22px))',
      }}
      role="tooltip"
    >
      <div className="hover-card-head">
        <span className="hover-card-name">{unitType.name}</span>
        <span className="hover-card-sub">
          ×{unit.count} · {STANCE_LABEL[unit.stance].toLowerCase()}
        </span>
      </div>
      <div className="hover-card-stats">
        i:{unitType.initiative} a:{unitType.armor} r:
        {fmtRange(unitType.minRange, unitType.maxRange)} v:{unitType.vision} p:
        {unitType.attackStrengths.personnel} h:{unitType.attackStrengths.armored} m:
        {unitType.movement}
        {(unit.kills ?? 0) > 0 || (unit.rank ?? 0) > 0
          ? ` · k:${unit.kills ?? 0} ★${unit.rank ?? 0}`
          : null}
      </div>
    </div>
  );
}
