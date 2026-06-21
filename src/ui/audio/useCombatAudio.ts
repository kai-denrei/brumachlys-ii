// useCombatAudio.ts — R8 (AUDIO): the React glue around the CombatAudio synth.
// Owns the toggle state (persisted, OFF by default), the synth instance, and the
// per-frame cue emission. A pure UI side-effect — it reads the replay frame and
// plays cues; it never touches game state, determinism, or the frame data.
//
// Gating contract (acceptance): while the toggle is OFF the synth is NEVER
// created (no AudioContext touched) and nothing plays. Turning it ON unlocks the
// context (this happens inside a user gesture — the toggle click), so the first
// real cue is instant and the browser's autoplay policy is satisfied. Turning it
// OFF disposes the context.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReplayFrame } from '../../state/replay';
import { CombatAudio, loadAudioPref, saveAudioPref } from './combatAudio';

export type CombatAudioApi = {
  /** Current toggle state — true when audio is ON. */
  enabled: boolean;
  /** Flip the toggle. Runs inside the click handler (a user gesture), so turning
   *  ON unlocks the AudioContext here. */
  toggle: () => void;
  /** Emit the cues for a shown replay frame. No-op while OFF. The App calls this
   *  exactly once per advanced frame. */
  playFrame: (frame: ReplayFrame, speed?: number) => void;
};

/** R8: the audio toggle + synth. The synth instance lives in a ref so flipping
 *  the toggle never recreates it; it is created lazily by the synth itself on the
 *  first gesture and disposed when the toggle goes OFF. */
export function useCombatAudio(): CombatAudioApi {
  const [enabled, setEnabled] = useState<boolean>(() => loadAudioPref());
  const synthRef = useRef<CombatAudio | null>(null);

  if (synthRef.current === null) synthRef.current = new CombatAudio();

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      saveAudioPref(next);
      const synth = synthRef.current!;
      if (next) {
        // Turning ON happens inside the click gesture — unlock the context now so
        // the autoplay policy is satisfied and the first cue is instant.
        synth.unlock();
      } else {
        // Turning OFF tears the context down: no AudioContext lingers while off.
        synth.dispose();
      }
      return next;
    });
  }, []);

  // Unmount: drop the context so a left battle doesn't leak an open AudioContext.
  useEffect(() => {
    const synth = synthRef.current;
    return () => synth?.dispose();
  }, []);

  const playFrame = useCallback(
    (frame: ReplayFrame, speed = 1) => {
      if (!enabled) return; // OFF → no synth call at all (no context touched)
      synthRef.current?.playFrame(frame, speed);
    },
    [enabled],
  );

  return { enabled, toggle, playFrame };
}
