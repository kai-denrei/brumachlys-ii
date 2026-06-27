// useAutopilot — the dev/demo Full-Auto driver, extracted verbatim from App.tsx
// (v1.6 refactor Phase 4). When store.fullAuto is on, the existing greedy bot
// self-plays: commit the planning round after 200ms, close the summary after
// 250ms (faster than the normal auto-advance, to keep the demo moving). No new
// AI — it just fires the existing commitAutopilot / closeSummary store actions
// on a timer.

import { useEffect } from 'react';
import type { GameState } from '../../core/types';
import { useAppStore } from '../../state/store';

export function useAutopilot(opts: {
  autopilot: boolean;
  uiPhase: string;
  game: GameState | null | undefined;
}): void {
  const { autopilot, uiPhase, game } = opts;
  useEffect(() => {
    if (!autopilot || !game) return;
    if (uiPhase === 'planning' && !game.outcome) {
      const t = setTimeout(() => useAppStore.getState().commitAutopilot(), 200);
      return () => clearTimeout(t);
    }
    // autopilot still closes summary — but in normal play the auto-advance
    // (useAnnouncement) handles it; autopilot just fires faster for the demo.
    if (uiPhase === 'summary') {
      const t = setTimeout(() => useAppStore.getState().closeSummary(), 250);
      return () => clearTimeout(t);
    }
  }, [autopilot, uiPhase, game]);
}
