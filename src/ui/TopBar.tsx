import { useState } from 'react';
import { createPortal } from 'react-dom';
import { PipelineModal } from './PipelineModal';
import { RulesModal } from './RulesModal';
import { VersionBadge } from './VersionBadge';

/** E3 conquest credits HUD. Planning: available minus committed buys
 * ("◈ 250 − 150 committed"); replay: the frame's creditsAfter feed ticks it. */
export type CreditsHud = { value: number; committed?: number };

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
        {round !== null && <span className="top-bar-round">R{round}</span>}
        {credits && (
          <span className="credits-hud" data-testid="credits-hud">
            ◈ {credits.value}
            {credits.committed ? (
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
