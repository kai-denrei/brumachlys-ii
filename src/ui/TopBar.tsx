import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../state/store';
import { PipelineModal } from './PipelineModal';
import { RulesModal } from './RulesModal';
import { VersionBadge } from './VersionBadge';

/** E3 conquest credits HUD. Planning: available minus committed buys
 * ("◈ 250 − 150 committed"); replay: the frame's creditsAfter feed ticks it.
 * v0.9: `income` is the per-turn credit gain (owned bases × perBaseCredits),
 * shown beside the odometer during planning ("+200/turn"). */
export type CreditsHud = {
  value: number;
  committed?: number;
  income?: number;
  /** Conquest planning: per-turn upkeep and net (income − upkeep). */
  upkeep?: number;
  net?: number;
};

export function TopBar({
  phase,
  onBack,
}: {
  /** round and credits moved to HudCluster (top-left fixed overlay). */
  phase: string;
  onBack?: () => void;
}) {
  // v1.2 tweak 2: rules behind an "i" — self-contained, so every screen that
  // shows the TopBar (start + battle) gets the reference for free.
  const [rulesOpen, setRulesOpen] = useState(false);
  // v0.5.1: the dev pipeline behind a "⌬" — same pattern, same portal.
  const [pipelineOpen, setPipelineOpen] = useState(false);
  // PoC "anim" toggle: animated infantry sprites on the board vs flat glyphs.
  const spritesOn = useAppStore((s) => s.spritesOn);
  const toggleSprites = useAppStore((s) => s.toggleSprites);

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
      {/* Phase chip + the PoC "anim" sprite toggle, right side. */}
      <span className="top-bar-status">
        <button
          className={`top-bar-anim${spritesOn ? ' top-bar-anim-on' : ''}`}
          onClick={toggleSprites}
          aria-pressed={spritesOn}
          aria-label={`animated sprites ${spritesOn ? 'on' : 'off'}`}
          title="toggle animated unit sprites"
        >
          anim
        </button>
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
