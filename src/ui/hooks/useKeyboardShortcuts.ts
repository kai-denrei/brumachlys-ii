// useKeyboardShortcuts — global Enter/Escape handlers for the battle screen,
// extracted verbatim from App.tsx (v1.6 refactor Phase 4). Behavior is
// unchanged; this only moves the two window-listener effects out of the
// 1686-line App component so the orchestrator shrinks.
//
// ENTER priority order (deliberate, documented — spec #6):
//   1. text field focused → ignore (don't interfere with form inputs).
//   2. "Your turn" announcement visible → dismiss it ("proceed").
//   3. a PENDING MOVE proposal exists → COMMIT that proposal and STOP. Enter
//      validates the pending proposal FIRST; a second Enter (no pending
//      proposal) commits the round. One predictable "confirm what I'm pointing
//      at" key.
//   4. no pending proposal, planning, ≥1 order/buy queued → COMMIT the round
//      (mirrors the non-zero branch of the CTA pill; the zero-orders path needs
//      the explicit COMMIT-pill confirm, which Enter intentionally does not open).
// ESCAPE: clear a pending MOVE proposal, else deselect (the calm reset).

import { useEffect } from 'react';
import type { GameState } from '../../core/types';
import { useAppStore } from '../../state/store';

export function useKeyboardShortcuts(opts: {
  /** The "Your turn" announcement (truthy ⇒ Enter dismisses it first). */
  announcement: unknown;
  dismissAnnouncement: () => void;
  uiPhase: string;
  game: GameState | null | undefined;
}): void {
  const { announcement, dismissAnnouncement, uiPhase, game } = opts;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter') return;
      // (1) Ignore if a text field is focused.
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      // (2) Dismiss the "Your turn" announcement first — Enter = "proceed".
      if (announcement) {
        dismissAnnouncement();
        return;
      }
      if (uiPhase === 'planning' && game && !game.outcome) {
        const state = useAppStore.getState();
        // (3) Pending MOVE proposal → commit it and STOP (don't fall through to
        // round-commit). One Enter confirms the proposal; a second commits.
        if (state.pendingMove) {
          e.preventDefault();
          state.commitPendingMove();
          return;
        }
        // (4) No pending proposal → commit the round if anything is queued.
        const hasOrders =
          Object.keys(state.orders).length > 0 || Object.keys(state.buys).length > 0;
        if (hasOrders) {
          e.preventDefault();
          state.commit();
        }
        // Zero-orders case: the user must use the COMMIT pill (confirm dialog).
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [uiPhase, game, announcement, dismissAnnouncement]);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      const state = useAppStore.getState();
      if (state.pendingMove) {
        state.clearPendingMove();
        return;
      }
      // No pending proposal: deselect (the calm reset).
      if (state.selectedUnitId) state.selectUnit(null);
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);
}
