// BuildDashboard — Phase 4 Task 4.1 (upkeep addendum §11). The full-screen
// economy-planning modal that replaces the on-map "+" card. Mobile-first,
// scrollable, modeled on RulesModal's shell (.sheet-scrim + a .build-dashboard
// container). Four sections, top → bottom:
//   A · economy summary — credits, income, upkeep, net (income − upkeep,
//       U+2212 minus), committed (Σ queued buys cost), credits-after-commit.
//   B · mini-map — projectBoard SVG; every cell faint, each base polygon
//       tinted by ownership (palette.factionColor blended via mix; neutral
//       grey for null), badged when a buy is queued, marked when occupied.
//       Tapping a base scrolls its row into view.
//   C · per-base production list — one row per PLAYER-owned base, ascending by
//       cell id, with occupancy state, the queued buy + a cancel control, and
//       a build action that reveals the reused UnitPicker scoped to that base.
//   D · army roster — counts by unit type across the player's units, each with
//       its unitUpkeep contribution, and a total-upkeep footer.
//
// State-free and additive: it reads game.credits / game.bases / store.buys and
// the §1 economy helpers; create/cancel route through the caller's onQueue /
// onRemove (which wrap tryQueueBuy / removeBuyOrder). One buy per base stays.
//
// Affordability mirrors core validateBuy exactly: a row's UnitPicker is gated
// by available = credits − committedElsewhere(cell), where committedElsewhere
// is the Σ of all queued buys' cost minus this base's own queued cost (its cost
// frees up on replace), so a tappable cell can never be rejected at resolution.

import { useEffect, useMemo, useRef } from 'react';
import type { Board, CellId } from '../board/types';
import type { FactionId, UnitInstance, UnitType } from '../core/types';
import type { BuyQueues } from '../core/orders';
import { factionUpkeep, unitUpkeep } from '../core/economy';
import { PLAYER_FACTION } from '../state/store';
import { UnitRenderer } from './skin';
import { factionColor, mix, PALETTE } from './skin/palette';
import { projectBoard } from './skin/board-projection';
import { UnitPicker } from './UnitPicker';

/** Typographic minus (U+2212) — the modal stays hyphen free (house style). */
function fmtSigned(v: number): string {
  return v < 0 ? `−${Math.abs(v)}` : `+${v}`;
}

/** Throwaway instance so the roster/occupant tokens render real art. */
const tokenUnit = (type: string, faction: FactionId): UnitInstance => ({
  id: `dash-${type}-${faction}`,
  type,
  faction,
  cell: 0,
  count: 1,
  stance: 'aggressive',
  attackedFrom: [],
});

export function BuildDashboard({
  board,
  bases,
  units,
  unitTypes,
  credits,
  income,
  upkeepRate,
  buys,
  focusBase,
  onQueue,
  onRemove,
  onClose,
}: {
  board: Board;
  /** Ownership by base cell: a faction id, or null for a neutral camp. */
  bases: Readonly<Record<CellId, FactionId | null>>;
  units: Readonly<Record<string, UnitInstance>>;
  unitTypes: Readonly<Record<string, UnitType>>;
  /** Player credits on hand. */
  credits: number;
  /** Projected income next round end (owned bases × perBaseCredits). */
  income: number;
  upkeepRate: number;
  buys: BuyQueues;
  /** Scroll this base's row into view + mark it; null = economy overview. */
  focusBase?: CellId | null;
  onQueue: (baseCell: CellId, unitTypeKey: string) => void;
  onRemove: (baseCell: CellId) => void;
  onClose: () => void;
}) {
  const unitList = useMemo(() => Object.values(units), [units]);

  // --- A · economy numbers ---------------------------------------------------
  const upkeep = useMemo(
    () => factionUpkeep(unitList, PLAYER_FACTION, unitTypes, upkeepRate),
    [unitList, unitTypes, upkeepRate],
  );
  const net = income - upkeep;
  const committed = useMemo(
    () =>
      Object.values(buys).reduce((sum, b) => sum + (unitTypes[b.unitTypeKey]?.cost ?? 0), 0),
    [buys, unitTypes],
  );
  const afterCommit = credits - committed;

  /** Cost queued on OTHER bases (this base's own cost frees on replace). */
  const committedElsewhere = (cell: CellId): number =>
    committed - (unitTypes[buys[cell]?.unitTypeKey ?? '']?.cost ?? 0);

  // --- C · player-owned bases, ascending -------------------------------------
  const ownedBases = useMemo(
    () =>
      Object.entries(bases)
        .filter(([, owner]) => owner === PLAYER_FACTION)
        .map(([cell]) => Number(cell))
        .sort((a, b) => a - b),
    [bases],
  );

  // A living unit standing on a base cell makes it occupied (matches the
  // resolver: a failed spawn refunds, so the buy stays queue-able).
  const occupantOf = (cell: CellId): UnitInstance | undefined =>
    unitList.find((u) => u.cell === cell && u.count > 0);

  // --- D · army roster (player, by type) -------------------------------------
  const roster = useMemo(() => {
    const byType = new Map<string, number>();
    for (const u of unitList) {
      if (u.faction !== PLAYER_FACTION || u.count <= 0) continue;
      byType.set(u.type, (byType.get(u.type) ?? 0) + 1);
    }
    return [...byType.entries()]
      .map(([type, count]) => {
        const ut = unitTypes[type];
        // Per-type upkeep contribution: sum each living unit's upkeep (counts
        // differ, so this respects attrition — not count × a single value).
        const up = unitList
          .filter((u) => u.faction === PLAYER_FACTION && u.type === type && u.count > 0)
          .reduce((s, u) => s + (ut ? unitUpkeep(ut, u.count, upkeepRate) : 0), 0);
        return { type, name: ut?.name ?? type, count, upkeep: up };
      })
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [unitList, unitTypes, upkeepRate]);

  // --- focusBase: scroll the row into view + mark it -------------------------
  const rowRefs = useRef<Map<CellId, HTMLElement | null>>(new Map());
  useEffect(() => {
    if (focusBase == null) return;
    const el = rowRefs.current.get(focusBase);
    // jsdom doesn't implement scrollIntoView — guard so tests don't crash.
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center' });
    }
  }, [focusBase]);

  // --- B · mini-map projection ----------------------------------------------
  const { pts } = useMemo(() => projectBoard(board), [board]);
  const baseCenter = (poly: [number, number][]): [number, number] => {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of poly) {
      sx += x;
      sy += y;
    }
    return [sx / poly.length, sy / poly.length];
  };

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div
        className="build-dashboard"
        role="dialog"
        aria-label="build"
        data-testid="build-dashboard"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grab" />
        <div className="sheet-header">
          <span className="sheet-title">BUILD</span>
          <span className="build-dash-credits" data-testid="build-credits">
            ◈ {credits}
          </span>
          <button className="sheet-close" onClick={onClose} aria-label="close build">
            ✕
          </button>
        </div>

        <div className="build-dash-body">
          {/* A · economy summary */}
          <section className="build-dash-econ" data-testid="econ-summary">
            <div className="econ-cell">
              <span className="econ-label">credits</span>
              <span className="econ-value">◈ {credits}</span>
            </div>
            <div className="econ-cell">
              <span className="econ-label">income</span>
              <span className="econ-value">+{income}/turn</span>
            </div>
            <div className="econ-cell">
              <span className="econ-label">upkeep</span>
              <span className="econ-value">−{upkeep}/turn</span>
            </div>
            <div className="econ-cell econ-cell-net">
              <span className="econ-label">net</span>
              <span
                className={`econ-value ${net < 0 ? 'econ-net-down' : 'econ-net-up'}`}
                data-testid="econ-net"
              >
                {fmtSigned(net)}/turn
              </span>
            </div>
            <div className="econ-cell">
              <span className="econ-label">committed</span>
              <span className="econ-value">◈ {committed}</span>
            </div>
            <div className="econ-cell">
              <span className="econ-label">after commit</span>
              <span className="econ-value">◈ {afterCommit}</span>
            </div>
          </section>

          {/* B · mini-map */}
          <section className="build-minimap-wrap">
            <svg
              viewBox="0 0 240 200"
              className="build-minimap"
              data-testid="build-minimap"
              aria-label="board overview: bases tinted by ownership"
            >
              {/* every cell faint */}
              {[...board.cells.values()].map((c) => {
                const poly = pts.get(c.id);
                if (!poly) return null;
                return (
                  <polygon
                    key={`bg${c.id}`}
                    points={poly.map(([x, y]) => `${x},${y}`).join(' ')}
                    fill="#ece8de"
                    stroke="#d7d2c6"
                    strokeWidth="0.6"
                  />
                );
              })}
              {/* base polygons tinted by ownership */}
              {Object.entries(bases).map(([cellStr, owner]) => {
                const cell = Number(cellStr);
                const poly = pts.get(cell);
                if (!poly) return null;
                const fill =
                  owner === null
                    ? '#b9b3a6' // neutral camp grey
                    : mix(PALETTE.base, factionColor(owner), 0.62);
                const queued = !!buys[cell];
                const occupied = !!occupantOf(cell);
                const [cx, cy] = baseCenter(poly);
                return (
                  <g key={`base${cell}`} className="build-minimap-base">
                    <polygon
                      data-base={cell}
                      data-owner={owner === null ? 'neutral' : owner}
                      data-queued={queued ? 'true' : undefined}
                      data-occupied={occupied ? 'true' : undefined}
                      points={poly.map(([x, y]) => `${x},${y}`).join(' ')}
                      fill={fill}
                      stroke="#5a5040"
                      strokeWidth="1"
                      style={{ cursor: owner === PLAYER_FACTION ? 'pointer' : 'default' }}
                      onClick={() => {
                        if (owner !== PLAYER_FACTION) return;
                        const el = rowRefs.current.get(cell);
                        if (el && typeof el.scrollIntoView === 'function') {
                          el.scrollIntoView({ block: 'center' });
                        }
                      }}
                    />
                    {queued && (
                      <circle cx={cx} cy={cy} r={3.5} fill="#fff" stroke="#5a5040" strokeWidth="0.8" />
                    )}
                    {occupied && (
                      <text
                        x={cx}
                        y={cy}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize="7"
                        fontWeight={800}
                        fill="#5a2800"
                      >
                        !
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </section>

          {/* C · per-base production list */}
          <section className="build-base-list" data-testid="base-list">
            {ownedBases.length === 0 && (
              <p className="sheet-empty">No bases held. Capture ground to recruit.</p>
            )}
            {ownedBases.map((cell) => {
              const occupant = occupantOf(cell);
              const queued = buys[cell];
              const queuedType = queued ? unitTypes[queued.unitTypeKey] : undefined;
              const available = credits - committedElsewhere(cell);
              const isFocused = focusBase === cell;
              return (
                <section
                  key={cell}
                  className={`build-dash-row${isFocused ? ' build-dash-row-focused' : ''}`}
                  data-base-row={cell}
                  data-focused={isFocused ? 'true' : undefined}
                  ref={(el) => {
                    rowRefs.current.set(cell, el);
                  }}
                >
                  <div className="build-dash-row-head">
                    <span className="build-dash-row-label">Base {cell}</span>
                    {occupant ? (
                      <span className="build-dash-occ build-dash-occ-warn" data-occupied="true">
                        <svg viewBox="-14 -14 28 28" className="build-dash-occ-icon">
                          <UnitRenderer
                            unit={tokenUnit(occupant.type, occupant.faction)}
                            x={0}
                            y={0}
                            size={24}
                            minimal
                          />
                        </svg>
                        occupied, will not spawn
                      </span>
                    ) : (
                      <span className="build-dash-occ build-dash-occ-vacant">vacant</span>
                    )}
                  </div>

                  {queued && (
                    <div className="build-dash-queued" data-base-queued={cell}>
                      <span className="build-dash-queued-name">
                        {queuedType?.name ?? queued.unitTypeKey}
                      </span>
                      <span className="build-dash-queued-cost">◈ {queuedType?.cost ?? 0}</span>
                      <button
                        className="sheet-button sheet-button-danger"
                        data-base-cancel={cell}
                        onClick={() => onRemove(cell)}
                        aria-label={`cancel ${queuedType?.name ?? queued.unitTypeKey} on base ${cell}`}
                      >
                        cancel
                      </button>
                    </div>
                  )}

                  <UnitPicker
                    unitTypes={unitTypes}
                    available={available}
                    queuedKey={queued?.unitTypeKey}
                    onPick={(k) => onQueue(cell, k)}
                    onRemove={() => onRemove(cell)}
                  />
                </section>
              );
            })}
          </section>

          {/* D · army roster */}
          <section className="build-roster" data-testid="army-roster">
            <h3 className="build-roster-h">Army</h3>
            {roster.length === 0 && <p className="sheet-empty">No units in the field.</p>}
            {roster.map((r) => (
              <div className="build-roster-row" key={r.type}>
                <svg viewBox="-14 -14 28 28" className="build-roster-icon">
                  <UnitRenderer unit={tokenUnit(r.type, PLAYER_FACTION)} x={0} y={0} size={24} minimal />
                </svg>
                <span className="build-roster-name">{r.name}</span>
                <span className="build-roster-count">×{r.count}</span>
                <span className="build-roster-upkeep">−{r.upkeep}</span>
              </div>
            ))}
            <div className="build-roster-total">
              <span className="build-roster-total-label">total upkeep</span>
              <span className="build-roster-total-value">−{upkeep}/turn</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
