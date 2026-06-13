// TopCta — v0.6 Ask 1/2/5: the round's primary CTA moves front and center,
// a pill-shaped button floating just below the top bar (clear of the casualty
// panel on the left and the skirmish chip on the right; safe-area aware).
//
// - planning: COMMIT n/8 — ALWAYS enabled (Ask 5). With literally zero orders
//   queued (no unit orders, no buys) the tap opens a small inline confirm
//   ("Commit 0 moves?"); with ≥1 order it commits straight away.
// - planning: the group-directive control (Ask 2) sits beside the pill — a
//   compact ⚐ toggle opening a segmented popover: Forward Deploy / Tactical
//   Retreat / Fortify + a clear-all-orders affordance. A subtle chip below
//   names the active directive until orders are individually modified.
// - summary: CONTINUE — same position, same prominence (the sheet keeps the
//   round recap; its primary action lives up here now).
// Replay keeps its own dock at the bottom (speed controls stay there).

import { useEffect, useState } from 'react';
import type { DirectiveKind, DirectiveState } from '../state/store';

export const DIRECTIVE_LABEL: Record<DirectiveKind, string> = {
  'forward-deploy': 'Forward Deploy',
  'tactical-retreat': 'Tactical Retreat',
  fortify: 'Fortify',
};

const DIRECTIVES: readonly DirectiveKind[] = ['forward-deploy', 'tactical-retreat', 'fortify'];

export type TopCtaProps = {
  phase: 'planning';
  /** Own units with ≥1 queued order / own unit total (planning). */
  done?: number;
  total?: number;
  /** Queued buys count — a buys-only round commits without the 0-confirm. */
  buys?: number;
  directive?: DirectiveState;
  /** False until the ai layer exports planDirective (core-agent seam). */
  directivesEnabled?: boolean;
  onCommit?: () => void;
  onDirective?: (kind: DirectiveKind) => void;
  onClearAll?: () => void;
};

export function TopCta({
  phase,
  done = 0,
  total = 0,
  buys = 0,
  directive = null,
  directivesEnabled = false,
  onCommit,
  onDirective,
  onClearAll,
}: TopCtaProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Phase flips / queue changes invalidate any open popover state.
  useEffect(() => {
    setMenuOpen(false);
    setConfirming(false);
  }, [phase]);
  useEffect(() => {
    if (done + buys > 0) setConfirming(false);
  }, [done, buys]);

  const zeroOrders = done === 0 && buys === 0;
  const commit = () => {
    setMenuOpen(false);
    if (zeroOrders && !confirming) {
      setConfirming(true); // Ask 5: confirm only at literally 0 orders
      return;
    }
    setConfirming(false);
    onCommit?.();
  };

  return (
    <div className="top-cta" data-testid="top-cta">
      <div className="top-cta-row">
        <button
          className={`cta-directive-toggle${menuOpen ? ' cta-directive-toggle-open' : ''}`}
          data-testid="directive-toggle"
          aria-label="group directives"
          aria-expanded={menuOpen}
          onClick={() => {
            setConfirming(false);
            setMenuOpen((o) => !o);
          }}
        >
          ⚐
        </button>
        <button className="cta-pill cta-commit" data-testid="commit-button" onClick={commit}>
          COMMIT {done}/{total}
        </button>
      </div>
      {directive && !menuOpen && !confirming && (
        <div className="cta-directive-chip" data-testid="directive-chip">
          {directive.modified ? 'modified' : `directive: ${DIRECTIVE_LABEL[directive.kind]}`}
        </div>
      )}
      {menuOpen && (
        <div className="cta-popover" role="menu" data-testid="directive-menu">
          {DIRECTIVES.map((kind) => (
            <button
              key={kind}
              role="menuitem"
              className={`cta-menu-item${
                directive?.kind === kind && !directive.modified ? ' cta-menu-item-active' : ''
              }`}
              data-directive={kind}
              disabled={!directivesEnabled}
              title={directivesEnabled ? undefined : 'directive planner not available yet'}
              onClick={() => {
                onDirective?.(kind);
                setMenuOpen(false);
              }}
            >
              {DIRECTIVE_LABEL[kind]}
            </button>
          ))}
          <button
            role="menuitem"
            className="cta-menu-item cta-menu-clear"
            data-testid="clear-all-orders"
            onClick={() => {
              onClearAll?.();
              setMenuOpen(false);
            }}
          >
            clear all orders
          </button>
        </div>
      )}
      {confirming && (
        <div className="cta-popover cta-confirm" role="alertdialog" data-testid="commit-confirm">
          <span className="cta-confirm-text">Commit 0 moves?</span>
          <div className="cta-confirm-actions">
            <button className="cta-confirm-go" data-testid="confirm-commit" onClick={commit}>
              Commit
            </button>
            <button
              className="cta-confirm-back"
              data-testid="confirm-back"
              onClick={() => setConfirming(false)}
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
