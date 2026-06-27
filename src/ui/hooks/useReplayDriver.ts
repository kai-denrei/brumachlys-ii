// useReplayDriver — the replay playback transport, extracted verbatim from
// App.tsx (v1.6 refactor Phase 4): the frame cursor (frameIdx) + paused +
// breakdownSlot, the frame-advance loop, and the seek/scrub callbacks.
//
// Playback is a PURE function of (resolvedTurn, t): the board render is already a
// pure read of frameIdx, so seeking is JUST moving the cursor — no resolver
// re-run, no game-state mutation (spec §3 / §12.5). The advance loop calls
// finishReplay ONLY when it walks PAST the last frame on its timer (or on
// 'skip'); a seek (forward OR backward) merely clamps frameIdx in-range, so it
// can never re-trigger the summary/finish. A new script restarts the transport
// at frame 0 (the caller resets its own transient replay-visual state separately
// on the same [script] change).

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { ReplayScript } from '../../state/replay';
import type { ReplaySpeed } from '../../state/store';
import { clampFrame, frameAtTime } from '../../state/replay-timing';

export function useReplayDriver(opts: {
  uiPhase: string;
  script: ReplayScript | null;
  replaySpeed: ReplaySpeed;
  finishReplay: () => void;
}): {
  frameIdx: number;
  paused: boolean;
  setPaused: Dispatch<SetStateAction<boolean>>;
  breakdownSlot: number | null;
  setBreakdownSlot: Dispatch<SetStateAction<number | null>>;
  seekToFrame: (idx: number) => void;
  seekToTime: (ms: number) => void;
  onScrubStart: () => void;
} {
  const { uiPhase, script, replaySpeed, finishReplay } = opts;
  const [frameIdx, setFrameIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [breakdownSlot, setBreakdownSlot] = useState<number | null>(null);

  // New script → restart the transport (driver state only).
  useEffect(() => {
    setFrameIdx(0);
    setPaused(false);
    setBreakdownSlot(null);
  }, [script]);

  // Frame-advance loop.
  useEffect(() => {
    if (uiPhase !== 'replay' || !script) return;
    if (replaySpeed === 'skip') {
      setFrameIdx(script.frames.length - 1);
      finishReplay();
      return;
    }
    if (paused || breakdownSlot !== null) return;
    const frame = script.frames[frameIdx];
    if (!frame) {
      finishReplay();
      return;
    }
    const t = setTimeout(() => {
      if (frameIdx + 1 >= script.frames.length) finishReplay();
      else setFrameIdx(frameIdx + 1);
    }, frame.duration / replaySpeed);
    return () => clearTimeout(t);
  }, [uiPhase, script, frameIdx, paused, breakdownSlot, replaySpeed, finishReplay]);

  // R7 (SEEK): move the cursor to any frame in [0, len-1]; map an elapsed time to
  // a frame via cumulative durations. Both clamp to the script bounds.
  const seekToFrame = useCallback(
    (idx: number) => {
      if (!script) return;
      setFrameIdx(clampFrame(idx, script.frames.length));
    },
    [script],
  );
  const seekToTime = useCallback(
    (ms: number) => {
      if (!script) return;
      setFrameIdx(frameAtTime(script.frames, ms));
    },
    [script],
  );
  // R7 (SCRUB): grabbing the scrubber pauses playback so the dragged frame holds
  // (it never fights the advance loop, which early-returns while paused).
  const onScrubStart = useCallback(() => {
    if (uiPhase === 'replay') setPaused(true);
  }, [uiPhase]);

  return {
    frameIdx,
    paused,
    setPaused,
    breakdownSlot,
    setBreakdownSlot,
    seekToFrame,
    seekToTime,
    onScrubStart,
  };
}
