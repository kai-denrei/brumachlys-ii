import { useState } from 'react';
import { createPortal } from 'react-dom';
import { RulesModal } from './RulesModal';
import { VersionBadge } from './VersionBadge';

export function TopBar({
  round,
  phase,
  onBack,
}: {
  round: number | null;
  phase: string;
  onBack?: () => void;
}) {
  // v1.2 tweak 2: rules behind an "i" — self-contained, so every screen that
  // shows the TopBar (start + battle) gets the reference for free.
  const [rulesOpen, setRulesOpen] = useState(false);

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
      <span className="top-bar-status">
        {round !== null && <span className="top-bar-round">R{round}</span>}
        <span className={`phase-chip phase-chip-${phase}`}>{phase}</span>
      </span>
      {/* portal: .top-bar's backdrop-filter would otherwise become the
          containing block for the modal's position:fixed scrim */}
      {rulesOpen && createPortal(<RulesModal onClose={() => setRulesOpen(false)} />, document.body)}
    </header>
  );
}
