// useAnnouncement — the "Your turn — R{n}" auto-advance announcement, extracted
// verbatim from App.tsx (v1.6 refactor Phase 4). When replay finishes (uiPhase
// 'summary') and the game is NOT over, it closes the summary immediately (the
// transition the old CONTINUE pill used) and shows a brief, non-blocking,
// self-fading pill with a mini recap. A 2200ms JS backstop timer is the SOLE
// lifecycle owner under prefers-reduced-motion (where the CSS fade is disabled
// and opacity stays 1 forever). Game-over closeSummary → 'over' banner is
// deliberate and never auto-dismissed.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState } from '../../core/types';
import { useAppStore } from '../../state/store';

export type AnnouncementState = {
  round: number;
  token: number;
  /** Snapshot of the round's kills/damage/fizzles — shown briefly so the player
   *  can read the recap without blocking their planning input. */
  summarySnap: {
    damageDealt: readonly [number, number];
    killCount: number;
    fizzles: number;
  } | null;
};

export function useAnnouncement(opts: {
  uiPhase: string;
  autopilot: boolean;
  game: GameState | null | undefined;
}): { announcement: AnnouncementState | null; dismissAnnouncement: () => void } {
  const { uiPhase, autopilot, game } = opts;
  const [announcement, setAnnouncement] = useState<AnnouncementState | null>(null);
  // Ref holding the active backstop timer so it can be cleared on early dismiss
  // or when a new announcement replaces an existing one.
  const announcementTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (uiPhase !== 'summary' || autopilot || !game || game.outcome) return;
    // Next round number = game.round (closeSummary has NOT run yet; the core
    // resolver already advanced game.round in commit() before returning).
    const nextRound = game.round;

    // Snapshot the replay summary NOW before closeSummary sets replay → null.
    const replayState = useAppStore.getState().replay;
    const summarySnap = replayState
      ? {
          damageDealt: replayState.script.summary.damageDealt as readonly [number, number],
          killCount: replayState.script.summary.kills.length,
          fizzles: replayState.script.summary.fizzles,
        }
      : null;

    // Transition immediately — no perceptible delay. The announcement overlays
    // the (now-planning) board and fades on its own schedule.
    useAppStore.getState().closeSummary();
    // Clear any previous backstop timer before setting a new announcement.
    if (announcementTimer.current !== null) clearTimeout(announcementTimer.current);
    setAnnouncement((prev) => ({
      round: nextRound,
      token: (prev?.token ?? 0) + 1,
      summarySnap,
    }));
    // Backstop timer: clears the announcement after 2200 ms regardless of CSS.
    // This is the primary dismissal path for prefers-reduced-motion users (where
    // the CSS fade is disabled and opacity stays 1 forever). It also covers normal
    // users in case the animationend event is never fired (detached nodes, etc.).
    announcementTimer.current = setTimeout(() => {
      announcementTimer.current = null;
      setAnnouncement(null);
    }, 2200);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiPhase, autopilot, game?.outcome]);

  // Dismiss the "Your turn" announcement early (tapping it or pressing Enter).
  // Also cancels the pending backstop timer so it doesn't fire on a null state.
  const dismissAnnouncement = useCallback(() => {
    if (announcementTimer.current !== null) {
      clearTimeout(announcementTimer.current);
      announcementTimer.current = null;
    }
    setAnnouncement(null);
  }, []);

  // FIX B: when the phase leaves planning (e.g., commit → 'replay'), clear the
  // announcement state AND cancel its pending backstop timer so the pill never
  // floats over the replay strip or the game-over summary. We track the PREVIOUS
  // phase in a ref so the effect only fires on the transition FROM 'planning',
  // not on the initial mount when uiPhase may already be 'summary' (where the
  // announcement hasn't been set yet and dismiss would race the auto-advance).
  const prevUiPhaseRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevUiPhaseRef.current;
    prevUiPhaseRef.current = uiPhase;
    if (prev === 'planning' && uiPhase !== 'planning') dismissAnnouncement();
  }, [uiPhase, dismissAnnouncement]);

  return { announcement, dismissAnnouncement };
}
