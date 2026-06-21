// ModeToggle.tsx — Phase 7 Task 7.2: a persistent two-state segmented control
// that flips the conquest planning view between Map (the board, move troops)
// and Economy (the full-screen build dashboard). Always visible during the
// planning phase — on the board AND while the dashboard is open — so the player
// can switch with a single thumb tap. Layered above the dashboard scrim by the
// caller's fixed-position wrapper class (.mode-toggle).
//
// Each segment is a real <button> carrying an aria-label and aria-pressed that
// reflects the active mode (so it announces correctly to assistive tech); the
// active one is visually highlighted via the -active modifier class.

export type AppMode = 'map' | 'economy';

export function ModeToggle({
  mode,
  onSelect,
}: {
  mode: AppMode;
  onSelect: (mode: AppMode) => void;
}) {
  return (
    <div className="mode-toggle" data-testid="mode-toggle" role="group" aria-label="view mode">
      <button
        type="button"
        className={`mode-toggle-seg${mode === 'map' ? ' mode-toggle-seg-active' : ''}`}
        aria-label="move troops"
        aria-pressed={mode === 'map'}
        title="Map — move troops"
        onClick={() => onSelect('map')}
      >
        {/* Map glyph — a simple hex board silhouette. */}
        <svg viewBox="-12 -12 24 24" className="mode-toggle-icon" aria-hidden="true">
          <polygon
            points="0,-9 7.8,-4.5 7.8,4.5 0,9 -7.8,4.5 -7.8,-4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <polygon
            points="0,-4 3.5,-2 3.5,2 0,4 -3.5,2 -3.5,-2"
            fill="currentColor"
          />
        </svg>
      </button>
      <button
        type="button"
        className={`mode-toggle-seg${mode === 'economy' ? ' mode-toggle-seg-active' : ''}`}
        aria-label="build economy"
        aria-pressed={mode === 'economy'}
        title="Economy — build"
        onClick={() => onSelect('economy')}
      >
        {/* Economy glyph — the credit mark (U+25C8). */}
        <span className="mode-toggle-glyph" aria-hidden="true">
          ◈
        </span>
      </button>
    </div>
  );
}
