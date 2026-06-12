// Replay.tsx — Layer-3 chrome (spec §9.4): the initiative timeline strip
// that slides up over the dock during playback (unit glyphs in slot order,
// active slot highlighted, mist slots anonymous), the 1×/2×/skip speed
// control, the term-by-term breakdown modal, and the §2.8/§9.6 game-over
// banner with the New Battle flow (§4.3).
//
// Fog honesty: these components render the ReplayScript verbatim — slots and
// strikes arrive pre-filtered/withheld from state/replay.ts. A mist slot has
// actorType null (rendered as a "?" chip) and its strikes carry null attacker
// fields; nothing here can resurrect a hidden position.

import { useEffect, useRef, useState } from 'react';
import type { FactionId, GameOutcome, UnitInstance, UnitType } from '../core/types';
import type { RoundSummary, Strike, TimelineSlot } from '../state/replay';
import type { ReplaySpeed } from '../state/store';
import { UnitRenderer, factionColor } from './skin';

// --- timeline strip + speed control (§9.4) -------------------------------------

const SLOT_KIND_BADGE: Record<TimelineSlot['kind'], string> = {
  move: '→',
  volley: '⚔',
  brawl: '✦',
  fizzle: '∅',
};

function chipUnit(slot: TimelineSlot): UnitInstance | null {
  if (!slot.actorType || slot.actorFaction === null) return null;
  return {
    id: `chip`,
    type: slot.actorType,
    faction: slot.actorFaction,
    cell: 0,
    count: 0,
    stance: 'aggressive',
    attackedFrom: [],
  };
}

export function ReplayDock({
  slots,
  activeSlot,
  speed,
  paused,
  done,
  onSpeed,
  onTogglePause,
  onSlotTap,
}: {
  slots: readonly TimelineSlot[];
  activeSlot: number;
  speed: ReplaySpeed;
  paused: boolean;
  /** Playback finished — the strip stays browsable under the summary. */
  done: boolean;
  onSpeed: (s: ReplaySpeed) => void;
  onTogglePause: () => void;
  onSlotTap: (slot: number) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);

  // Keep the active slot in view as playback advances.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const el = strip.querySelector<HTMLElement>(`[data-slot="${activeSlot}"]`);
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeSlot]);

  return (
    <footer className="replay-dock" data-testid="replay-dock">
      <div className="timeline-strip" ref={stripRef}>
        {slots.length === 0 && <span className="timeline-empty">nothing stirred in the mist</span>}
        {slots.map((slot, k) => {
          const unit = chipUnit(slot);
          const active = k === activeSlot;
          const tappable = slot.strikes.length > 0;
          return (
            <button
              key={k}
              data-slot={k}
              className={`timeline-slot${active ? ' timeline-slot-active' : ''}${
                k < activeSlot || done ? ' timeline-slot-past' : ''
              }${tappable ? ' timeline-slot-tappable' : ''}`}
              onClick={tappable ? () => onSlotTap(k) : undefined}
              aria-label={`slot ${k + 1}: ${slot.kind}${slot.actorType ? ` by ${slot.actorType}` : ' from the mist'}`}
            >
              {unit ? (
                <svg viewBox="-16 -16 32 32" className="timeline-slot-svg">
                  <UnitRenderer unit={unit} x={0} y={0} size={24} minimal />
                </svg>
              ) : (
                <span className="timeline-slot-mist">?</span>
              )}
              <span className="timeline-slot-kind">{SLOT_KIND_BADGE[slot.kind]}</span>
            </button>
          );
        })}
      </div>
      <div className="replay-controls">
        <button
          className="replay-button"
          onClick={onTogglePause}
          aria-label={paused ? 'play' : 'pause'}
          disabled={done}
        >
          {paused ? '▶' : '❚❚'}
        </button>
        {([1, 2, 'skip'] as const).map((s) => (
          <button
            key={String(s)}
            className={`replay-button${speed === s ? ' replay-button-active' : ''}`}
            onClick={() => onSpeed(s)}
            disabled={done}
          >
            {s === 'skip' ? '≫' : `${s}×`}
          </button>
        ))}
      </div>
    </footer>
  );
}

// --- breakdown modal (§9.4) ------------------------------------------------------
// `A + Ta − D − Td + B → p → damage`, each term labeled, gang-up contributions
// itemized by class. The math is never invisible (v1 lesson).

const STRIKE_LABEL: Record<Strike['kind'], string> = {
  attack: 'Attack',
  counter: 'Counter-attack',
  brawl: 'Brawl strike',
  'brawl-return': 'Brawl return',
};

function fmtSigned(v: number): string {
  return v >= 0 ? `+${v}` : `−${Math.abs(v)}`;
}

function StrikeBreakdown({
  strike,
  unitTypes,
}: {
  strike: Strike;
  unitTypes: Readonly<Record<string, UnitType>>;
}) {
  const b = strike.breakdown;
  const attackerName = strike.fromMist
    ? 'from the mist'
    : (strike.attackerType && unitTypes[strike.attackerType]?.name) ?? strike.attackerType ?? '?';
  const defenderName = unitTypes[strike.defenderType]?.name ?? strike.defenderType;
  const net = b.A + b.Ta - b.D - b.Td + b.B;

  return (
    <div className={`breakdown-strike${strike.fromMist ? ' breakdown-mist' : ''}`}>
      <div className="breakdown-head">
        <span className="breakdown-kind">{STRIKE_LABEL[strike.kind]}</span>
        <span className="breakdown-vs">
          <strong style={{ color: strike.fromMist ? undefined : factionColor(strike.attackerFaction ?? 0) }}>
            {attackerName}
          </strong>
          {' → '}
          <strong style={{ color: factionColor(strike.defenderFaction) }}>{defenderName}</strong>
        </span>
      </div>
      <table className="breakdown-table">
        <tbody>
          <tr>
            <td className="bd-term">A</td>
            <td className="bd-label">attack strength</td>
            <td className="bd-value">{b.A}</td>
          </tr>
          <tr>
            <td className="bd-term">+ Ta</td>
            <td className="bd-label">terrain attack bonus</td>
            <td className="bd-value">{fmtSigned(b.Ta)}</td>
          </tr>
          <tr>
            <td className="bd-term">− D</td>
            <td className="bd-label">defender armor</td>
            <td className="bd-value">−{b.D}</td>
          </tr>
          <tr>
            <td className="bd-term">− Td</td>
            <td className="bd-label">terrain armor bonus</td>
            <td className="bd-value">−{b.Td}</td>
          </tr>
          <tr>
            <td className="bd-term">+ B</td>
            <td className="bd-label">gang-up bonus</td>
            <td className="bd-value">{fmtSigned(b.B)}</td>
          </tr>
          {b.gangUp.contributions.map((c, k) => (
            <tr key={k} className="bd-gangup-row">
              <td className="bd-term" />
              <td className="bd-label">↳ {c.cls}</td>
              <td className="bd-value">+{c.weight}</td>
            </tr>
          ))}
          <tr className="bd-p-row">
            <td className="bd-term">p</td>
            <td className="bd-label">0.5 + 0.05 × ({fmtSigned(net).replace('+', '')})</td>
            <td className="bd-value">{b.p.toFixed(2)}</td>
          </tr>
          <tr className="bd-damage-row">
            <td className="bd-term">dmg</td>
            <td className="bd-label">damage</td>
            <td className="bd-value">{b.damage}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function BreakdownModal({
  slot,
  unitTypes,
  onClose,
}: {
  slot: TimelineSlot;
  unitTypes: Readonly<Record<string, UnitType>>;
  onClose: () => void;
}) {
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div
        className="bottom-sheet breakdown-modal"
        role="dialog"
        aria-label="combat breakdown"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grab" />
        <div className="sheet-header">
          <span className="sheet-title">Combat math</span>
          <button className="sheet-close" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        {slot.strikes.map((s, k) => (
          <StrikeBreakdown key={k} strike={s} unitTypes={unitTypes} />
        ))}
      </div>
    </div>
  );
}

// --- round summary sheet (§9.4) ---------------------------------------------------

export function SummarySheet({
  round,
  summary,
  unitTypes,
  onClose,
}: {
  round: number;
  summary: RoundSummary;
  unitTypes: Readonly<Record<string, UnitType>>;
  onClose: () => void;
}) {
  const killsFor = (faction: FactionId) => summary.kills.filter((k) => k.faction === faction);
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div
        className="bottom-sheet summary-sheet"
        role="dialog"
        aria-label={`round ${round} summary`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grab" />
        <div className="sheet-header">
          <span className="sheet-title">Round {round} — the smoke clears</span>
          <button className="sheet-close" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="summary-grid">
          <div className="summary-cell">
            <span className="summary-num" style={{ color: factionColor(0) }}>
              {summary.damageDealt[0]}
            </span>
            <span className="summary-label">damage dealt</span>
          </div>
          <div className="summary-cell">
            <span className="summary-num" style={{ color: factionColor(1) }}>
              {summary.damageDealt[1]}
            </span>
            <span className="summary-label">damage taken</span>
          </div>
          <div className="summary-cell">
            <span className="summary-num">{summary.fizzles}</span>
            <span className="summary-label">fizzles</span>
          </div>
        </div>
        {summary.kills.length > 0 && (
          <div className="summary-kills">
            {([0, 1] as const).map((faction) =>
              killsFor(faction).length > 0 ? (
                <div key={faction} className="summary-kill-row">
                  <span className="summary-kill-side" style={{ color: factionColor(faction) }}>
                    {faction === 0 ? 'your losses' : 'enemy losses'}
                  </span>
                  <span className="summary-kill-names">
                    {killsFor(faction)
                      .map((k) => unitTypes[k.type]?.name ?? k.type)
                      .join(', ')}
                  </span>
                </div>
              ) : null,
            )}
          </div>
        )}
        {summary.kills.length === 0 && summary.damageDealt[0] + summary.damageDealt[1] === 0 && (
          <p className="sheet-empty">Quiet round. The mist gives nothing away.</p>
        )}
        <div className="sheet-actions">
          <button className="sheet-button summary-continue" onClick={onClose}>
            continue
          </button>
        </div>
      </div>
    </div>
  );
}

// --- game-over banner + New Battle (§2.8, §9.6, §4.3) ------------------------------

function outcomeText(outcome: GameOutcome): { title: string; sub: string } {
  if (outcome.winner === 0) return { title: 'VICTORY', sub: 'The mist parts. The field is yours.' };
  if (outcome.winner === 1) return { title: 'DEFEAT', sub: 'Your army is lost to the mist.' };
  if (outcome.reason === 'mutual-annihilation')
    return { title: 'MUTUAL RUIN', sub: 'Nothing remains on either side.' };
  return { title: 'THE MIST SETTLES', sub: 'Forty rounds, and no decision. A draw.' };
}

export function GameOverBanner({
  outcome,
  seedSuggestion,
  onRematch,
  onChangeBattlefield,
}: {
  outcome: GameOutcome;
  /** Fresh-seed suggestion (UI layer may use wall-clock entropy, §4.3). */
  seedSuggestion: number;
  onRematch: (seed: number) => void;
  onChangeBattlefield: () => void;
}) {
  const [seed, setSeed] = useState(seedSuggestion);
  const { title, sub } = outcomeText(outcome);
  return (
    <div className="banner-scrim">
      <div className="banner" role="dialog" aria-label="battle over">
        <h2 className={`banner-title banner-${outcome.winner === 0 ? 'win' : outcome.winner === 1 ? 'loss' : 'draw'}`}>
          {title}
        </h2>
        <p className="banner-sub">{sub}</p>
        <div className="seed-row">
          <label className="seed-label" htmlFor="banner-seed">
            seed
          </label>
          <input
            id="banner-seed"
            className="seed-input"
            type="number"
            inputMode="numeric"
            value={seed}
            onChange={(e) => setSeed(Math.trunc(Number(e.target.value) || 0))}
          />
        </div>
        <div className="banner-actions">
          <button className="battle-button banner-rematch" onClick={() => onRematch(seed)}>
            NEW BATTLE — SAME GROUND
          </button>
          <button className="sheet-button banner-leave" onClick={onChangeBattlefield}>
            change battlefield
          </button>
        </div>
      </div>
    </div>
  );
}
