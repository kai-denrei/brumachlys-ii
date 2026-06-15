import { useState } from 'react';
import { createPortal } from 'react-dom';
import { PipelineModal } from './PipelineModal';
import { RulesModal } from './RulesModal';
import { VersionBadge } from './VersionBadge';
import { CreditsOdometer, RoundFlap } from './skin';

/** E3 conquest credits HUD. Planning: available minus committed buys
 * ("◈ 250 − 150 committed"); replay: the frame's creditsAfter feed ticks it.
 * v0.9: `income` is the per-turn credit gain (owned bases × perBaseCredits),
 * shown beside the odometer during planning ("+200/turn"). */
export type CreditsHud = { value: number; committed?: number; income?: number };

export function TopBar({
  round,
  phase,
  credits,
  onBack,
}: {
  round: number | null;
  phase: string;
  /** Conquest only — omit in skirmish and on the start screen. */
  credits?: CreditsHud | null;
  onBack?: () => void;
}) {
  // v1.2 tweak 2: rules behind an "i" — self-contained, so every screen that
  // shows the TopBar (start + battle) gets the reference for free.
  const [rulesOpen, setRulesOpen] = useState(false);
  // v0.5.1: the dev pipeline behind a "⌬" — same pattern, same portal.
  const [pipelineOpen, setPipelineOpen] = useState(false);

  return (
    <header className="top-bar">
      {onBack && (
        <button className="top-bar-back" onClick={onBack} aria-label="back to start">
          ‹
        </button>
      )}
      <VersionBadge />
      <span className="top-bar-title">BRUMACHLYS II</span>
      <button
        className="top-bar-info"
        onClick={() => setRulesOpen(true)}
        aria-label="how to play"
      >
        <span className="top-bar-info-glyph">i</span>
      </button>
      <button
        className="top-bar-info top-bar-pipeline"
        onClick={() => setPipelineOpen(true)}
        aria-label="dev pipeline"
      >
        <span className="top-bar-pipeline-glyph">⌬</span>
      </button>
      <span className="top-bar-status">
        {round !== null && (
          <span className="top-bar-round">
            <span className="top-bar-round-r" aria-hidden="true">
              R
            </span>
            {/* RoundFlap carries its own visually-hidden "round N" label. */}
            <RoundFlap value={round} />
          </span>
        )}
        {credits && (
          <span className="credits-hud" data-testid="credits-hud">
            <span className="credits-glyph" aria-hidden="true">
              ◈
            </span>
            <CreditsOdometer value={credits.value} />
            {credits.income ? (
              <span className="credits-income" aria-label={`plus ${credits.income} per turn`}>
                +{credits.income}/turn
              </span>
            ) : credits.committed ? (
              <span className="credits-committed"> − {credits.committed} committed</span>
            ) : null}
          </span>
        )}
        <span className={`phase-chip phase-chip-${phase}`}>{phase}</span>
      </span>
      {/* portal: .top-bar's backdrop-filter would otherwise become the
          containing block for the modal's position:fixed scrim */}
      {rulesOpen && createPortal(<RulesModal onClose={() => setRulesOpen(false)} />, document.body)}
      {pipelineOpen &&
        createPortal(<PipelineModal onClose={() => setPipelineOpen(false)} />, document.body)}
    </header>
  );
}
