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

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FactionId, GameOutcome, UnitInstance, UnitType } from '../core/types';
import { loadUnits } from '../io/data-loader';
import type { RoundSummary, Strike, TimelineSlot } from '../state/replay';
import { PLAYER_FACTION, useAppStore, type ReplaySpeed } from '../state/store';
import { CasualtyRow } from './CasualtyPanel';
import { UnitRenderer, factionColor } from './skin';

// --- timeline strip + speed control (§9.4) -------------------------------------

const SLOT_KIND_BADGE: Record<TimelineSlot['kind'], string> = {
  move: '→',
  volley: '⚔',
  brawl: '✦',
  fizzle: '∅',
  capture: '⚑',
  spawn: '✚',
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
  onRecenter,
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
  /** Non-null while auto-follow is suspended by a manual pan (P9) — shows the
   *  recenter button that hands the camera back to the replay. */
  onRecenter?: (() => void) | null;
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
        {onRecenter && (
          <button
            className="replay-button replay-recenter"
            onClick={onRecenter}
            aria-label="recenter on the action"
          >
            ⌖
          </button>
        )}
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

/** v1.4 battle recap dashboard inside the banner: rounds fought, the two
 * chess-style icon rows (CasualtyPanel's exact vocabulary — fallen vs enemy
 * destroyed), and the fog-honest battle totals. Data comes straight from the
 * store: `casualties` (witnessed kills only — a mist kill never lands there)
 * and `recap` (accumulated per round from the fog-filtered replay summaries;
 * see BattleRecap in state/store.ts for the field-by-field honesty argument).
 * Card style matches the round-summary sheet (.summary-cell), compacted so
 * the banner stays inside a 390×844 viewport without scrolling. */
function BannerRecap({ conquest }: { conquest?: ConquestOutcome | null }) {
  const recap = useAppStore((s) => s.recap);
  const casualties = useAppStore((s) => s.casualties);
  const types = useMemo(() => loadUnits(), []);
  const fallen = casualties.filter((c) => c.faction === PLAYER_FACTION);
  const destroyed = casualties.filter((c) => c.faction !== PLAYER_FACTION);

  const stats: { num: number; label: string; color?: string }[] = [
    { num: recap.rounds, label: 'rounds' },
    { num: recap.dealt, label: 'dmg dealt', color: factionColor(0) },
    { num: recap.taken, label: 'dmg taken', color: factionColor(1) },
    { num: recap.fizzles, label: 'fizzles' },
    { num: recap.brawls, label: 'brawls' },
  ];
  // E3 conquest (v1.4 dashboard +2): bases held at the end, credits spent.
  if (conquest) {
    stats.push({ num: conquest.playerBases, label: 'bases held', color: factionColor(0) });
    stats.push({ num: recap.spent, label: 'credits spent' });
  }

  return (
    <div className="banner-recap" data-testid="battle-recap">
      <div className="recap-icon-rows">
        <div className="recap-icon-row">
          <span className="recap-icon-label" style={{ color: factionColor(PLAYER_FACTION) }}>
            your losses
          </span>
          {fallen.length > 0 ? (
            <CasualtyRow row={fallen} label="your fallen units" unitTypes={types} />
          ) : (
            <span className="recap-none">none</span>
          )}
        </div>
        <div className="recap-icon-row">
          <span className="recap-icon-label" style={{ color: factionColor(1) }}>
            enemy destroyed
          </span>
          {destroyed.length > 0 ? (
            <CasualtyRow row={destroyed} label="enemy units destroyed" unitTypes={types} />
          ) : (
            <span className="recap-none">none seen</span>
          )}
        </div>
      </div>
      <div className="recap-grid">
        {stats.map((s) => (
          <div className="summary-cell recap-cell" key={s.label}>
            <span className="summary-num" style={s.color ? { color: s.color } : undefined}>
              {s.num}
            </span>
            <span className="summary-label">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** E3: conquest endgame context for the banner copy + dashboard. */
export type ConquestOutcome = { playerBases: number; enemyBases: number };

export function outcomeText(
  outcome: GameOutcome,
  conquest?: ConquestOutcome | null,
): { title: string; sub: string } {
  const win = outcome.winner === 0;
  const loss = outcome.winner === 1;
  const title = win ? 'VICTORY' : loss ? 'DEFEAT' : null;

  // Conquest reasons (addendum §B.5) — these only arise in conquest mode.
  if (outcome.reason === 'conquest') {
    if (win) return { title: 'VICTORY', sub: 'Nothing left to them. No army, no banners. Conquest.' };
    if (loss) return { title: 'DEFEAT', sub: 'Nothing left to you. The land is theirs.' };
    return { title: 'MUTUAL RUIN', sub: 'Two armies spent, every banner fallen. Nobody holds the land.' };
  }
  if (outcome.reason === 'base-collapse') {
    if (win) return { title: 'VICTORY', sub: 'Their last banner fell rounds ago. The land follows you.' };
    if (loss) return { title: 'DEFEAT', sub: 'Three round ends without a base. The land forgets you.' };
    return { title: 'THE MIST SETTLES', sub: 'Both sides landless. The mist keeps the field.' };
  }
  if (outcome.reason === 'round-limit' && conquest) {
    const counts = `Bases ${conquest.playerBases} to ${conquest.enemyBases}.`;
    if (win) return { title: 'VICTORY', sub: `The horn sounds. ${counts} The ground is yours.` };
    if (loss) return { title: 'DEFEAT', sub: `The horn sounds. ${counts} The ground is theirs.` };
    return { title: 'THE MIST SETTLES', sub: `The horn sounds. ${counts} Even ground. A draw.` };
  }

  // Skirmish copy (unchanged).
  if (title === 'VICTORY') return { title, sub: 'The mist parts. The field is yours.' };
  if (title === 'DEFEAT') return { title, sub: 'Your army is lost to the mist.' };
  if (outcome.reason === 'mutual-annihilation')
    return { title: 'MUTUAL RUIN', sub: 'Nothing remains on either side.' };
  return { title: 'THE MIST SETTLES', sub: 'Forty rounds, and no decision. A draw.' };
}

export function GameOverBanner({
  outcome,
  conquest = null,
  seedSuggestion,
  onRematch,
  onChangeBattlefield,
}: {
  outcome: GameOutcome;
  /** E3: present in conquest mode — base counts feed copy + dashboard. */
  conquest?: ConquestOutcome | null;
  /** Fresh-seed suggestion (UI layer may use wall-clock entropy, §4.3). */
  seedSuggestion: number;
  onRematch: (seed: number) => void;
  onChangeBattlefield: () => void;
}) {
  const [seed, setSeed] = useState(seedSuggestion);
  const { title, sub } = outcomeText(outcome, conquest);
  return (
    <div className="banner-scrim">
      <div className="banner" role="dialog" aria-label="battle over">
        <h2 className={`banner-title banner-${outcome.winner === 0 ? 'win' : outcome.winner === 1 ? 'loss' : 'draw'}`}>
          {title}
        </h2>
        <p className="banner-sub">{sub}</p>
        <BannerRecap conquest={conquest} />
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
