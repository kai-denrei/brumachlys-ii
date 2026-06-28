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

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { FactionId, GameOutcome, UnitInstance, UnitType } from '../core/types';
import { loadUnits } from '../io/data-loader';
import { outcomeText, type ConquestOutcome } from './text-format';
import type { RoundSummary, Strike, TimelineSlot } from '../state/replay';
import {
  DILATION_DEPTH_DEFAULT,
  DILATION_DEPTH_MAX,
  DILATION_DEPTH_MIN,
  DILATION_DEPTH_STEP,
  PLAYER_FACTION,
  REPLAY_SPEED_DEFAULT,
  REPLAY_SPEED_MAX,
  REPLAY_SPEED_MIN,
  REPLAY_SPEED_STEP,
  useAppStore,
  type ReplaySpeed,
} from '../state/store';
import { CasualtyRow, groupCasualties } from './CasualtyPanel';
import { BarHistogram, Sparkline, UnitRenderer, factionColor, type HistBar, type SparkSeries } from './skin';

// --- timeline strip + speed control (§9.4) -------------------------------------

const SLOT_KIND_BADGE: Record<TimelineSlot['kind'], string> = {
  move: '→',
  volley: '⚔',
  brawl: '✦',
  fizzle: '∅',
  capture: '⚑',
  spawn: '✚',
  promotion: '★',
  interrupt: '✕',
};

/** Format a speed multiplier for the slider's aria-valuetext / preset labels —
 *  e.g. 0.5 → "0.5×", 1 → "1×", 2 → "2×". Trims a trailing ".0". */
function fmtSpeed(v: number): string {
  const s = Number.isInteger(v) ? String(v) : String(Number(v.toFixed(1)));
  return `${s}×`;
}

/** The slider's numeric position for a given speed. 'skip' is a transient action,
 *  not a slider position — fall back to the default so the thumb never goes NaN. */
function sliderValue(speed: ReplaySpeed): number {
  return typeof speed === 'number' ? speed : REPLAY_SPEED_DEFAULT;
}

/** Sequencing §5: format the combat-dilation depth for the second slider's
 *  aria-valuetext / readout — e.g. 1.6 → "1.6× deep", 2 → "2.0× deep". The
 *  ".0" is KEPT (always one decimal) so the depth reads as a continuous knob
 *  distinct from the integer-ish speed multiplier. */
function fmtDepth(v: number): string {
  return `${v.toFixed(1)}× deep`;
}

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
  frameIdx,
  frameCount,
  elapsedMs,
  totalMs,
  speed,
  paused,
  done,
  onSpeed,
  dilationDepth = DILATION_DEPTH_DEFAULT,
  onDilationDepth = () => {},
  onTogglePause,
  onSlotTap,
  onSeekFrame,
  onSeekTime,
  onScrubStart,
  onRecenter,
  audioOn,
  onToggleAudio,
}: {
  slots: readonly TimelineSlot[];
  activeSlot: number;
  /** R7 (SEEK / SCRUB): the playback cursor (current frame index). */
  frameIdx: number;
  /** R7: total frames in the script — the scrubber's frame upper bound. */
  frameCount: number;
  /** R7: elapsed time (ms at 1×) at the current frame's start — the scrubber
   *  thumb position when seeking by time. */
  elapsedMs: number;
  /** R7: the round's total run length (ms at 1×) — the scrubber's time bound. */
  totalMs: number;
  speed: ReplaySpeed;
  paused: boolean;
  /** Playback finished — the strip stays browsable under the summary. */
  done: boolean;
  onSpeed: (s: ReplaySpeed) => void;
  /** Sequencing §5: the COMBAT DILATION DEPTH (second knob) — scales combat beat
   *  durations only ([1.0, 4.0], deeper = slower combat). Independent of speed;
   *  the two compose. Takes effect on the NEXT resolved round (the laid-out
   *  beats bake it in at build time), so the slider tunes how deep the next
   *  combat dilates. */
  dilationDepth?: number;
  /** Sequencing §5: set the combat dilation depth (clamped + persisted by the
   *  store). The slider's onChange. */
  onDilationDepth?: (depth: number) => void;
  onTogglePause: () => void;
  onSlotTap: (slot: number) => void;
  /** R7 (SEEK): step the cursor to a specific FRAME (keyboard arrow keys — one
   *  frame per arrow). Pure cursor move: no resolver re-run, no state mutation. */
  onSeekFrame?: (idx: number) => void;
  /** R7 (SEEK): map an elapsed TIME (ms) to a frame and move the cursor there —
   *  the scrubber's drag path (continuous time → frame via cumulative durations).
   *  Pure cursor move; agrees with the slot strip (the resolved frame's slot
   *  becomes active). */
  onSeekTime?: (ms: number) => void;
  /** R7 (SCRUB): the user grabbed the scrubber — pauses playback so the dragged
   *  frame holds (releasing leaves it paused; the play control resumes). */
  onScrubStart?: () => void;
  /** Non-null while auto-follow is suspended by a manual pan (P9) — shows the
   *  recenter button that hands the camera back to the replay. */
  onRecenter?: (() => void) | null;
  /** R8 (AUDIO): current state of the synth-cue toggle (OFF by default). */
  audioOn?: boolean;
  /** R8 (AUDIO): flip the synth-cue toggle. Runs inside the click gesture so
   *  turning ON unlocks the AudioContext (browser autoplay policy). Absent ⇒ the
   *  control is not rendered. */
  onToggleAudio?: () => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const lastFrame = Math.max(0, frameCount - 1);
  const scrubEnabled = !!onSeekTime && frameCount > 1 && totalMs > 0;

  // R7: arrow keys step EXACTLY one frame (the natural granularity that aligns
  // with the slot strip), overriding the slider's native time-step. Left/Down =
  // previous frame, Right/Up = next. Home/End jump to the ends. Other keys fall
  // through to the slider's default behavior.
  function onScrubKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    onScrubStart?.();
    const key = e.key;
    let next: number | null = null;
    if (key === 'ArrowLeft' || key === 'ArrowDown') next = frameIdx - 1;
    else if (key === 'ArrowRight' || key === 'ArrowUp') next = frameIdx + 1;
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = lastFrame;
    if (next !== null) {
      e.preventDefault();
      onSeekFrame?.(next);
    }
  }

  // Keep the active slot in view as playback advances.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const el = strip.querySelector<HTMLElement>(`[data-slot="${activeSlot}"]`);
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeSlot]);

  return (
    <footer className="replay-dock" data-testid="replay-dock">
      {/* R7 (SCRUBBER): a draggable timeline slider spanning the whole replay.
          The thumb tracks elapsed TIME (ms at 1×); dragging maps that time to a
          frame via the cumulative frame durations (onSeekTime), so the seek is a
          pure cursor move — no resolver re-run, no state mutation — and the
          resolved frame's slot becomes the active slot (scrubber + strip agree).
          Grabbing it PAUSES playback so the dragged frame holds; the play control
          resumes (releasing leaves it paused — the cleaner UX). Arrow keys step
          EXACTLY one frame (onScrubKeyDown); an aria-label + aria-valuetext make
          it screen-reader operable. */}
      <input
        type="range"
        className="replay-scrub"
        data-testid="replay-scrub"
        min={0}
        max={Math.max(1, Math.round(totalMs))}
        step={1}
        value={Math.min(Math.round(elapsedMs), Math.max(1, Math.round(totalMs)))}
        disabled={!scrubEnabled}
        aria-label="replay scrubber — seek through the round"
        aria-valuetext={`frame ${Math.min(frameIdx, lastFrame) + 1} of ${frameCount}`}
        // Pause the moment the user grabs the slider (mouse/touch), so the
        // scrubbed frame holds rather than fighting the advance loop.
        onPointerDown={onScrubStart}
        onKeyDown={onScrubKeyDown}
        onChange={(e) => onSeekTime?.(Number(e.target.value))}
      />
      <div className="replay-dock-row">
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
        {/* R8 (AUDIO): the synth-cue toggle — OFF by default. Pressed reads
            on/off via aria-pressed; turning ON unlocks the AudioContext inside
            this click (autoplay policy). */}
        {onToggleAudio && (
          <button
            className={`replay-button replay-audio${audioOn ? ' replay-button-active' : ''}`}
            data-testid="replay-audio-toggle"
            onClick={onToggleAudio}
            aria-label={audioOn ? 'mute combat audio' : 'enable combat audio'}
            aria-pressed={!!audioOn}
          >
            {audioOn ? '♪' : '♪̸'}
          </button>
        )}
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
        {/* RESOLUTION SLOW-DOWN SLIDER: the FINE control (operator feedback —
            the replay is still too fast). Emphasises SLOWER (0.1× bullet-time →
            1× → 2×); a LOWER value stretches the whole resolution (the App
            divides each frame duration by it, and the same value drives the
            dilation clock + audio). Keyboard-operable — an aria-label +
            aria-valuetext ("0.5×") name the multiplier. The 1×/2× buttons are
            PRESETS that snap it to discrete values; skip stays special. */}
        <div className="replay-speed">
          <input
            type="range"
            className="replay-speed-slider"
            data-testid="replay-speed-slider"
            min={REPLAY_SPEED_MIN}
            max={REPLAY_SPEED_MAX}
            step={REPLAY_SPEED_STEP}
            value={sliderValue(speed)}
            disabled={done}
            aria-label="resolution speed — slow the replay down"
            aria-valuetext={fmtSpeed(sliderValue(speed))}
            onChange={(e) => onSpeed(Number(e.target.value))}
          />
          <span className="replay-speed-readout" aria-hidden="true">
            {fmtSpeed(sliderValue(speed))}
          </span>
        </div>
        {/* SECOND SLIDER (sequencing §5): COMBAT DILATION DEPTH — a knob SEPARATE
            from the resolution-speed slider above. It deepens COMBAT ONLY (the
            laid-out beat windows scale by it; movement frames stay brisk — the
            fast→slow contrast). Range 1.0× (shallow) → 4.0× (deep); the two knobs
            compose (effective per-beat wall time = beatDur(depth)/speed). It feeds
            buildReplay, so a change takes effect on the next resolved round.
            Keyboard-operable — aria-label + aria-valuetext ("2.0× deep") name the
            depth. NOT disabled when playback is done (it tunes the NEXT round). */}
        <div className="replay-dilation">
          <input
            type="range"
            className="replay-dilation-slider"
            data-testid="replay-dilation-slider"
            min={DILATION_DEPTH_MIN}
            max={DILATION_DEPTH_MAX}
            step={DILATION_DEPTH_STEP}
            value={dilationDepth}
            aria-label="combat dilation — deepen combat slow-motion (shallow → deep)"
            aria-valuetext={fmtDepth(dilationDepth)}
            onChange={(e) => onDilationDepth(Number(e.target.value))}
          />
          <span className="replay-dilation-readout" aria-hidden="true">
            {fmtDepth(dilationDepth)}
          </span>
        </div>
        {/* 1×/2× presets (snap the slider) + skip (jump to end). A preset reads
            "active" when the slider sits exactly on its value. */}
        {([1, 2, 'skip'] as const).map((s) => (
          <button
            key={String(s)}
            className={`replay-button${speed === s ? ' replay-button-active' : ''}`}
            onClick={() => onSpeed(s)}
            disabled={done}
            aria-label={s === 'skip' ? 'skip to end' : `set speed ${s}×`}
          >
            {s === 'skip' ? '≫' : `${s}×`}
          </button>
        ))}
      </div>
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
          {/* v0.8: veterancy bonus is folded into A — itemize it so the math is never invisible. */}
          {b.vet > 0 && (
            <tr className="bd-gangup-row">
              <td className="bd-term" />
              <td className="bd-label">↳ veterancy</td>
              <td className="bd-value">+{b.vet}</td>
            </tr>
          )}
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
                  <span className="summary-kill-value" style={{ color: factionColor(faction) }}>
                    {'◈ '}
                    {killsFor(faction).reduce((acc, k) => acc + (unitTypes[k.type]?.cost ?? 0), 0)}
                  </span>
                </div>
              ) : null,
            )}
          </div>
        )}
        {summary.kills.length === 0 && summary.damageDealt[0] + summary.damageDealt[1] === 0 && (
          <p className="sheet-empty">Quiet round. The mist gives nothing away.</p>
        )}
        {/* v0.6 Ask 1: the primary CONTINUE action moved to the top-center
            CTA pill (TopCta) — the sheet keeps the recap, scrim/✕ still close. */}
      </div>
    </div>
  );
}

// --- game-over banner + New Battle (§2.8, §9.6, §4.3) ------------------------------

// --- v1.5 VICTORY DASHBOARD (data visualizations) --------------------------------
// Four compact, scrollable sections appended to the banner recap, all from the
// store's fog-filtered accumulators (roundHistory + casualties). Each section
// hides gracefully when its data is empty (a 1-round game has no multi-round
// arc; an empty casualty list hides the histogram). The economy section appears
// in CONQUEST only. FOG HONESTY rides the data layer (see RoundRecord) — these
// are pure reads/plots of already-filtered numbers.

/** One labelled sparkline block in the dashboard. */
function DashSpark({
  label,
  series,
  ariaLabel,
}: {
  label: string;
  series: SparkSeries[];
  ariaLabel: string;
}) {
  return (
    <div className="dash-spark-block">
      <span className="dash-spark-label">{label}</span>
      <Sparkline series={series} ariaLabel={ariaLabel} />
    </div>
  );
}

/** Legend swatch (a colored dot + text) for the dual damage arc. */
function DashLegend({ color, text }: { color: string; text: string }) {
  return (
    <span className="dash-legend-item">
      <span className="dash-legend-dot" style={{ background: color }} aria-hidden="true" />
      {text}
    </span>
  );
}

/** The four data-viz sections. Reads roundHistory + casualties from the store.
 * Mobile-first + scrollable (the .victory-dashboard scroll container). */
function VictoryDashboard({ conquest }: { conquest?: ConquestOutcome | null }) {
  const roundHistory = useAppStore((s) => s.roundHistory);
  const casualties = useAppStore((s) => s.casualties);
  const types = useMemo(() => loadUnits(), []);
  const colorA = factionColor(PLAYER_FACTION);
  const colorB = factionColor(1);

  // Damage arc: a section needs ≥1 round AND some damage to be worth plotting.
  const dealt = roundHistory.map((r) => r.damageDealt[0]);
  const taken = roundHistory.map((r) => r.damageDealt[1]);
  const kills = roundHistory.map((r) => r.kills);
  const anyDamage = dealt.some((v) => v > 0) || taken.some((v) => v > 0);
  const anyKills = kills.some((v) => v > 0);

  // Economy (conquest only): present when the records carry the fields.
  const econ = !!conquest && roundHistory.some((r) => r.credits !== undefined);
  const credits = roundHistory.map((r) => r.credits ?? 0);
  const bases = roundHistory.map((r) => r.basesHeld ?? 0);
  const army = roundHistory.map((r) => r.unitsAlive ?? 0);

  // Casualties by type+faction → histogram bars (reuse groupCasualties, the same
  // grouping the icon rows / CasualtyModal use, so they agree). Player groups
  // first (red), then enemy (blue); each ordered by descending count.
  const bars: HistBar[] = useMemo(() => {
    const fallen = casualties.filter((c) => c.faction === PLAYER_FACTION);
    const destroyed = casualties.filter((c) => c.faction !== PLAYER_FACTION);
    const toBars = (groups: ReturnType<typeof groupCasualties>, color: string): HistBar[] =>
      [...groups]
        .sort((a, b) => b.count - a.count)
        .map((g) => ({
          type: g.type,
          faction: g.faction,
          count: g.count,
          color,
          label: types[g.type]?.name ?? g.type,
        }));
    return [
      ...toBars(groupCasualties(fallen, types), colorA),
      ...toBars(groupCasualties(destroyed, types), colorB),
    ];
  }, [casualties, types, colorA, colorB]);

  // Nothing to show at all → render nothing (keeps a 0-round banner clean).
  if (!anyDamage && !anyKills && !econ && bars.length === 0) return null;

  return (
    <div className="victory-dashboard" data-testid="victory-dashboard">
      {anyDamage && (
        <section className="dash-section" data-testid="dash-damage-arc">
          <div className="dash-section-head">
            <span className="dash-section-title">damage arc</span>
            <span className="dash-legend">
              <DashLegend color={colorA} text="dealt" />
              <DashLegend color={colorB} text="taken" />
            </span>
          </div>
          <Sparkline
            series={[
              { points: dealt, color: colorA },
              { points: taken, color: colorB },
            ]}
            ariaLabel={`damage per round — dealt vs taken over ${roundHistory.length} rounds`}
          />
        </section>
      )}

      {anyKills && (
        <section className="dash-section" data-testid="dash-kills">
          <div className="dash-section-head">
            <span className="dash-section-title">kills per round</span>
          </div>
          <Sparkline
            series={[{ points: kills, color: '#8d8675' }]}
            ariaLabel={`units destroyed each round over ${roundHistory.length} rounds`}
          />
        </section>
      )}

      {econ && (
        <section className="dash-section dash-economy" data-testid="dash-economy">
          <div className="dash-section-head">
            <span className="dash-section-title">economy</span>
          </div>
          <div className="dash-economy-grid">
            <DashSpark label="credits" series={[{ points: credits, color: '#C8A45B' }]} ariaLabel="player credits per round" />
            <DashSpark label="bases" series={[{ points: bases, color: colorA }]} ariaLabel="player bases held per round" />
            <DashSpark label="army" series={[{ points: army, color: colorA }]} ariaLabel="player army size per round" />
          </div>
        </section>
      )}

      {bars.length > 0 && (
        <section className="dash-section" data-testid="dash-casualties">
          <div className="dash-section-head">
            <span className="dash-section-title">casualties by type</span>
            <span className="dash-legend">
              <DashLegend color={colorA} text="yours" />
              <DashLegend color={colorB} text="enemy" />
            </span>
          </div>
          <BarHistogram bars={bars} ariaLabel="units lost by type — yours vs enemy" />
        </section>
      )}
    </div>
  );
}

/** v1.4 battle recap dashboard inside the banner: rounds fought, the two
 * chess-style icon rows (CasualtyPanel's exact vocabulary — fallen vs enemy
 * destroyed), and the fog-honest battle totals. Data comes straight from the
 * store: `casualties` (witnessed kills only — a mist kill never lands there)
 * and `recap` (accumulated per round from the fog-filtered replay summaries;
 * see BattleRecap in state/store.ts for the field-by-field honesty argument).
 * Card style matches the round-summary sheet (.summary-cell), compacted so
 * the banner stays inside a 390×844 viewport without scrolling.
 * v1.5: the VICTORY DASHBOARD's data-viz sections (damage arc / kills /
 * economy / casualties-by-type) are appended below the stat grid. */
function BannerRecap({ conquest }: { conquest?: ConquestOutcome | null }) {
  const recap = useAppStore((s) => s.recap);
  const casualties = useAppStore((s) => s.casualties);
  const types = useMemo(() => loadUnits(), []);
  const fallen = casualties.filter((c) => c.faction === PLAYER_FACTION);
  const destroyed = casualties.filter((c) => c.faction !== PLAYER_FACTION);

  const creditSum = (list: typeof fallen) =>
    list.reduce((acc, c) => acc + (types[c.type]?.cost ?? 0), 0);
  const valueLost = creditSum(fallen);
  const valueDestroyed = creditSum(destroyed);

  const stats: { num: number | string; label: string; color?: string }[] = [
    { num: recap.rounds, label: 'rounds' },
    { num: recap.dealt, label: 'dmg dealt', color: factionColor(0) },
    { num: recap.taken, label: 'dmg taken', color: factionColor(1) },
    { num: recap.fizzles, label: 'fizzles' },
    { num: recap.brawls, label: 'brawls' },
    { num: `◈ ${valueLost}`, label: 'value lost', color: factionColor(0) },
    { num: `◈ ${valueDestroyed}`, label: 'value destroyed', color: factionColor(1) },
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
      <VictoryDashboard conquest={conquest} />
    </div>
  );
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
  // v0.6 Ask 7 (banner verbs): victory = a brief ripple/burst behind the
  // modal; defeat = the scrim darkens; draw keeps the plain scrim. Pure CSS
  // (≤500 ms, reduced-motion cuts to the end state).
  const verdict = outcome.winner === 0 ? 'win' : outcome.winner === 1 ? 'loss' : 'draw';
  return (
    <div className={`banner-scrim banner-scrim-${verdict}`}>
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
