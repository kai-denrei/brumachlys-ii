import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { archetypeList, useAppStore, type UnitRenderMode } from '../state/store';
import { VersionBadge } from './VersionBadge';

// Code-split: both modals open on demand (rare taps), so keep them out of the
// initial bundle (v1.6 refactor Phase 5).
const PipelineModal = lazy(() =>
  import('./PipelineModal').then((m) => ({ default: m.PipelineModal })),
);
const RulesModal = lazy(() => import('./RulesModal').then((m) => ({ default: m.RulesModal })));

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

/** Gear-menu options: label + the mode each selects. Order = visual order. */
const RENDER_MODE_OPTIONS: readonly { mode: UnitRenderMode; label: string }[] = [
  { mode: 'icon', label: 'Icons' },
  { mode: 'anim', label: 'Animated' },
  { mode: 'watercolor', label: 'Watercolor' },
];

/** The game-settings menu: a ⚙ button opening a small popover with two
 *  sections — APPEARANCE (the Icons / Animated / Watercolor unit skin, an
 *  aria-checked menuitemradio set) and DEBUG / TEST (a "Full Auto (P1 bot)"
 *  menuitemcheckbox that self-plays the game). The active skin is highlighted
 *  (aria-checked); Full Auto reflects store.fullAuto. Keyboard-operable: Escape
 *  closes; the menu items are real buttons (Tab/Enter/Space). Selecting a skin
 *  closes the menu; toggling Full Auto keeps it open (so the player sees the
 *  state flip and the game start moving underneath). */
function SettingsMenu() {
  const unitRenderMode = useAppStore((s) => s.unitRenderMode);
  const setUnitRenderMode = useAppStore((s) => s.setUnitRenderMode);
  const fullAuto = useAppStore((s) => s.fullAuto);
  const toggleFullAuto = useAppStore((s) => s.toggleFullAuto);
  const p1ArchetypeKey = useAppStore((s) => s.p1ArchetypeKey);
  const setP1Archetype = useAppStore((s) => s.setP1Archetype);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // The P1-bot archetype options — from the ai registry (greedy fallback).
  const archetypes = archetypeList();

  // Close on Escape or an outside pointer-down (lightweight popover dismissal).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  return (
    <div className="top-bar-gear-root" ref={rootRef}>
      <button
        className={`top-bar-gear${open ? ' top-bar-gear-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label="game settings"
        aria-haspopup="menu"
        aria-expanded={open}
        title="game settings"
      >
        <span className="top-bar-gear-glyph" aria-hidden="true">
          ⚙
        </span>
      </button>
      {open && (
        <div className="top-bar-gear-menu" role="menu" aria-label="game settings options">
          <div className="top-bar-gear-section-label" role="presentation">
            Appearance
          </div>
          {RENDER_MODE_OPTIONS.map(({ mode, label }) => {
            const active = unitRenderMode === mode;
            return (
              <button
                key={mode}
                className={`top-bar-gear-item${active ? ' top-bar-gear-item-active' : ''}`}
                role="menuitemradio"
                aria-checked={active}
                aria-label={label}
                onClick={() => {
                  setUnitRenderMode(mode);
                  setOpen(false);
                }}
              >
                {label}
              </button>
            );
          })}
          <div className="top-bar-gear-separator" role="separator" />
          <div className="top-bar-gear-section-label" role="presentation">
            Debug / Test
          </div>
          <button
            className={`top-bar-gear-item top-bar-gear-item-check${
              fullAuto ? ' top-bar-gear-item-active' : ''
            }`}
            role="menuitemcheckbox"
            aria-checked={fullAuto}
            aria-label="Full Auto (P1 bot)"
            onClick={() => toggleFullAuto()}
          >
            <span className="top-bar-gear-check" aria-hidden="true">
              {fullAuto ? '☑' : '☐'}
            </span>
            Full Auto (P1 bot)
          </button>
          {/* FULL AUTO: the P1 bot's archetype (conquest self-play). A radio
              set mirroring the opponent picker — changing it takes effect on
              the next round. Keyboard-operable; the menu stays open. */}
          <div className="top-bar-gear-subsection-label" role="presentation">
            P1 bot style
          </div>
          <div
            className="top-bar-gear-radiogroup"
            role="group"
            aria-label="P1 bot archetype"
          >
            {archetypes.map((a) => {
              const active = p1ArchetypeKey === a.key;
              return (
                <button
                  key={a.key}
                  className={`top-bar-gear-item top-bar-gear-item-radio${
                    active ? ' top-bar-gear-item-active' : ''
                  }`}
                  role="menuitemradio"
                  aria-checked={active}
                  aria-label={`P1 bot: ${a.label}`}
                  data-p1-archetype={a.key}
                  onClick={() => setP1Archetype(a.key)}
                >
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

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
      {/* Phase chip + the gear (game-settings menu: appearance + debug), right side. */}
      <span className="top-bar-status">
        <SettingsMenu />
        <span className={`phase-chip phase-chip-${phase}`}>{phase}</span>
      </span>
      {/* portal: .top-bar's backdrop-filter would otherwise become the
          containing block for the modal's position:fixed scrim */}
      {rulesOpen &&
        createPortal(
          <Suspense fallback={null}>
            <RulesModal onClose={() => setRulesOpen(false)} />
          </Suspense>,
          document.body,
        )}
      {pipelineOpen &&
        createPortal(
          <Suspense fallback={null}>
            <PipelineModal onClose={() => setPipelineOpen(false)} />
          </Suspense>,
          document.body,
        )}
    </header>
  );
}
