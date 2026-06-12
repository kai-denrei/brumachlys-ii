import { VersionBadge } from './VersionBadge';

export function TopBar({ round, phase }: { round: number | null; phase: string }) {
  return (
    <header className="top-bar">
      <VersionBadge />
      <span className="top-bar-title">BRUMACHLYS II</span>
      <span className="top-bar-status">
        {round !== null ? `R${round} · ` : ''}
        {phase}
      </span>
    </header>
  );
}
