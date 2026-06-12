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
  return (
    <header className="top-bar">
      {onBack && (
        <button className="top-bar-back" onClick={onBack} aria-label="back to start">
          ‹
        </button>
      )}
      <VersionBadge />
      <span className="top-bar-title">BRUMACHLYS II</span>
      <span className="top-bar-status">
        {round !== null ? `R${round} · ` : ''}
        {phase}
      </span>
    </header>
  );
}
