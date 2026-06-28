// useBeatClock — the §4 FOCAL SPOTLIGHT sub-frame clock, extracted verbatim from
// App.tsx (v1.6 refactor Phase 4). While a COMBAT frame is on screen it tracks
// elapsed time WITHIN the frame (rAF, mirroring the DilationClock's
// elapsedReplayTime base + re-based enteredAt) and publishes the active beat's
// cells via activeCellsAt(frame.beats, tWithinFrame). Between beats / in a gap /
// before the first / after the last beat ⇒ null (the board restores). Skipped
// under prefers-reduced-motion and on the 'skip' fast jump.
//
// DETERMINISM — wall-clock-from-mount: enteredAt is snapshotted when the effect
// (re)runs; elapsedReplayTime maps (frames, frameIdx, speed, paused, now,
// enteredAt) → elapsed, so a given (turn, t) always yields the same spotlight.
// Do NOT add a per-effect replay-time clock; this is the single sub-frame timing
// source the spotlight has.

import { useEffect, useState } from 'react';
import type { CellId } from '../../board/types';
import type { ReplayScript } from '../../state/replay';
import type { ReplaySpeed } from '../../state/store';
import { activeCellsAt, frameStartTime } from '../../state/replay-timing';
import { elapsedReplayTime } from '../../state/dilation-clock';

export function useBeatClock(opts: {
  uiPhase: string;
  script: ReplayScript | null;
  frameIdx: number;
  paused: boolean;
  replaySpeed: ReplaySpeed;
}): readonly CellId[] | null {
  const { uiPhase, script, frameIdx, paused, replaySpeed } = opts;
  const [focalCells, setFocalCells] = useState<readonly CellId[] | null>(null);

  const replayActiveForBeats = uiPhase !== 'planning' && script !== null;
  useEffect(() => {
    if (!replayActiveForBeats || !script) {
      setFocalCells(null);
      return;
    }
    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frame = script.frames[Math.min(frameIdx, script.frames.length - 1)];
    const beats = frame?.beats;
    // Non-combat frame (no beats), reduced-motion, or skip → no per-beat dim.
    if (reduce || replaySpeed === 'skip' || !beats || beats.length === 0) {
      setFocalCells(null);
      return;
    }
    if (typeof requestAnimationFrame !== 'function') {
      // jsdom / no rAF: settle on the first beat's cells (deterministic).
      setFocalCells(beats[0]!.activeCells);
      return;
    }
    const enteredAt = typeof performance !== 'undefined' ? performance.now() : 0;
    const base = frameStartTime(script.frames, frameIdx);
    let raf = 0;
    let last: string | null = null;
    const loop = () => {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      const elapsed = elapsedReplayTime(
        script.frames,
        frameIdx,
        replaySpeed,
        paused,
        now,
        enteredAt,
      );
      const tWithinFrame = elapsed - base; // ms into THIS frame at 1× speed
      const cells = activeCellsAt(beats, tWithinFrame);
      // non-empty = the active beat's cells; EMPTY = a between-beats gap (board
      // restores); null (initial) = clock not engaged (reduced-motion / non-combat).
      const key = cells.join(',');
      if (key !== last) {
        last = key;
        setFocalCells(cells);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayActiveForBeats, script, frameIdx, paused, replaySpeed]);

  return focalCells;
}
