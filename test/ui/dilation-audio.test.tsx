// @vitest-environment jsdom
// Phase 3 (DILATION AUDIO) — the DilationClock rAF wiring: the clock fires the
// dilation-audio cues (whoom + drone-on at SHIFT, one dilationTick per NEW
// clock tick during DILATION, drone-off at the dilation END) from its rAF loop,
// on FORWARD play only. A SCRUB/SEEK/SKIP (cursor jump) re-bases without
// retriggering; a fresh forward replay re-fires cleanly.
//
// The cue scheduling is driven by the PURE elapsed-time model (state/
// dilation-clock.ts). The clock's elapsed t is
//   frameStartTime(frameIdx) + clamp(frameDuration, (now − enteredAt)·speed),
// where enteredAt is re-based on every cursor change. So normal forward play is
// simulated here by ADVANCING the cursor frame-by-frame (rerender) while
// stepping the wall clock in small per-rAF deltas — exactly what the App's
// playback driver does. Audio cannot be heard headless, so this is unit-only by
// design (a MOCK audio API; no AudioContext at all).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, type RenderResult } from '@testing-library/react';
import { DilationClock } from '../../src/ui/skin/DilationClock';
import type { DilationAudioApi } from '../../src/ui/audio/useCombatAudio';
import { dilationActs } from '../../src/state/dilation-clock';
import type { ReplayFrame } from '../../src/state/replay';
import type { Wave } from '../../src/state/replay-timing';

function frame(duration: number, wave?: Wave): ReplayFrame {
  return {
    duration,
    slot: wave ? 0 : -1,
    units: [],
    fog: new Set(),
    discovered: new Set(),
    ignite: [],
    arcs: [],
    floaters: [],
    bursts: [],
    kills: [],
    spawns: [],
    captures: [],
    promotions: [],
    trails: [],
    focus: [],
    ...(wave ? { wave, band: wave === 'A' ? 'ranged' : ('melee' as const) } : {}),
  };
}

// move (frames 0,1) → WAVE_A (frames 2,3) → WAVE_B (4) → settle (5).
// glideEnd = 400; dilEnd = 400 + 1000 = 1400; total = 2400.
const FRAMES: ReplayFrame[] = [
  frame(200),
  frame(200),
  frame(500, 'A'),
  frame(500, 'A'),
  frame(300, 'B'),
  frame(700),
];
const ACTS = dilationActs(FRAMES);

function mockAudio() {
  return {
    whoom: vi.fn(),
    startDrone: vi.fn(),
    stopDrone: vi.fn(),
    dilationTick: vi.fn(),
  } satisfies DilationAudioApi;
}

// A drawing-no-op 2d context so the loop effect doesn't early-return. Gradient
// factories return a stub carrying addColorStop (the bloom draw uses them).
function stub2d(): void {
  const gradient = { addColorStop: () => {} };
  const ctx = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'canvas') return {};
        if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
          return () => gradient;
        }
        return () => {};
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as RenderingContext,
  );
}

// Controllable wall clock + a captured rAF callback we step by hand.
let nowMs = 0;
let rafCb: FrameRequestCallback | null = null;
function installClock(): void {
  nowMs = 0;
  rafCb = null;
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    rafCb = cb;
    return 1 as unknown as number;
  });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
}
/** Run ONE rAF loop iteration at the current wall clock. */
function step(): void {
  const cb = rafCb;
  rafCb = null;
  cb?.(nowMs);
}

type Props = {
  frameIdx: number;
  speed: number | 'skip';
  paused?: boolean;
  audio: DilationAudioApi;
  audioOn: boolean;
};
function el(p: Props) {
  return (
    <DilationClock
      frames={FRAMES}
      frameIdx={p.frameIdx}
      speed={p.speed}
      paused={p.paused ?? false}
      reducedMotion={false}
      audio={p.audio}
      audioOn={p.audioOn}
    />
  );
}

/** Simulate FORWARD playback: park the cursor on `frameIdx` (re-base enteredAt
 *  to the current wall clock) and step the rAF a few times across the frame's
 *  duration, so t advances continuously (small per-rAF deltas) from the frame's
 *  start to near its end — exactly the App's frame-by-frame driver. */
function playFrame(r: RenderResult, p: Props, frameIdx: number): void {
  // enteredAt is captured (= nowMs) by the re-base effect on this rerender.
  const enteredAt = nowMs;
  r.rerender(el({ ...p, frameIdx }));
  const dur = FRAMES[frameIdx]!.duration;
  // a handful of small steps across the frame (each Δt well under the jump
  // threshold), ending just shy of the frame's end.
  for (let off = 0; off <= dur; off += 60) {
    nowMs = enteredAt + off;
    step();
  }
}

beforeEach(() => {
  installClock();
  stub2d();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Phase 3 DilationClock audio — toggle gate', () => {
  it('audioOn=false → NO cue is ever scheduled (the synth surface is untouched)', () => {
    const audio = mockAudio();
    const p: Props = { frameIdx: 0, speed: 1, audio, audioOn: false };
    const r = render(el(p));
    for (let i = 0; i < FRAMES.length; i++) playFrame(r, p, i);
    expect(audio.whoom).not.toHaveBeenCalled();
    expect(audio.startDrone).not.toHaveBeenCalled();
    expect(audio.dilationTick).not.toHaveBeenCalled();
    expect(audio.stopDrone).not.toHaveBeenCalled();
  });

  it('no audio prop → no throw across the whole timeline', () => {
    const r = render(
      <DilationClock frames={FRAMES} frameIdx={0} speed={1} paused={false} reducedMotion={false} />,
    );
    expect(() => {
      for (let i = 0; i < FRAMES.length; i++) {
        const enteredAt = nowMs;
        r.rerender(
          <DilationClock
            frames={FRAMES}
            frameIdx={i}
            speed={1}
            paused={false}
            reducedMotion={false}
          />,
        );
        for (let off = 0; off <= FRAMES[i]!.duration; off += 60) {
          nowMs = enteredAt + off;
          step();
        }
      }
    }).not.toThrow();
  });

  it('reduced-motion → static paint, NO rAF, NO cues', () => {
    const audio = mockAudio();
    render(
      <DilationClock
        frames={FRAMES}
        frameIdx={2}
        speed={1}
        paused
        reducedMotion
        audio={audio}
        audioOn
      />,
    );
    expect(rafCb).toBeNull(); // reduced-motion never schedules a loop
    expect(audio.whoom).not.toHaveBeenCalled();
    expect(audio.startDrone).not.toHaveBeenCalled();
    expect(audio.dilationTick).not.toHaveBeenCalled();
  });
});

describe('Phase 3 DilationClock audio — forward-play cue→act mapping', () => {
  it('SHIFT fires whoom + drone ONCE; each NEW tick fires one dilationTick; the END releases the drone', () => {
    const audio = mockAudio();
    const p: Props = { frameIdx: 0, speed: 1, audio, audioOn: true };
    const r = render(el(p));

    // GLIDE frames (0,1): nothing fires before glideEnd (400).
    playFrame(r, p, 0);
    playFrame(r, p, 1);
    expect(audio.whoom).not.toHaveBeenCalled();
    expect(audio.startDrone).not.toHaveBeenCalled();

    // WAVE_A frame 2 (starts at glideEnd=400) → cross into SHIFT: whoom + drone.
    playFrame(r, p, 2);
    expect(audio.whoom).toHaveBeenCalledTimes(1);
    expect(audio.startDrone).toHaveBeenCalledTimes(1);
    // ticks begin accruing in the dilation window.
    expect(audio.dilationTick.mock.calls.length).toBeGreaterThan(0);

    // WAVE_A frame 3 — more ticks, but NO re-whoom / re-drone.
    playFrame(r, p, 3);
    expect(audio.whoom).toHaveBeenCalledTimes(1);
    expect(audio.startDrone).toHaveBeenCalledTimes(1);

    // each fired tick index is unique + strictly increasing (forward, no re-fire).
    const idxs = audio.dilationTick.mock.calls.map((c) => c[0] as number);
    expect(new Set(idxs).size).toBe(idxs.length);
    for (let i = 1; i < idxs.length; i++) expect(idxs[i]!).toBeGreaterThan(idxs[i - 1]!);
    // the denominator passed is the act's tick count.
    for (const c of audio.dilationTick.mock.calls) expect(c[1]).toBe(ACTS.ticks.length);

    // RELEASE: WAVE_B then settle (past dilEnd=1400) → drone dropped, once.
    playFrame(r, p, 4);
    playFrame(r, p, 5);
    expect(audio.stopDrone).toHaveBeenCalledTimes(1);
  });

  it('dilationTick pitches DOWN as it slows — the fired index rises from 0 toward the slow end', () => {
    const audio = mockAudio();
    const p: Props = { frameIdx: 0, speed: 1, audio, audioOn: true };
    const r = render(el(p));
    for (let i = 0; i < FRAMES.length; i++) playFrame(r, p, i);
    const idxs = audio.dilationTick.mock.calls.map((c) => c[0] as number);
    expect(idxs.length).toBeGreaterThanOrEqual(2);
    expect(idxs[0]).toBe(0); // first fired index is 0 (the SOURCE pitches DOWN from i=0)
    expect(idxs[idxs.length - 1]!).toBeGreaterThan(idxs[0]!); // climbs toward the slow end
  });
});

describe('Phase 3 DilationClock audio — FORWARD-ONLY (scrub/seek does not retrigger)', () => {
  it('a SEEK into the dilation window does NOT fire whoom/drone or machine-gun the skipped ticks', () => {
    const audio = mockAudio();
    const p: Props = { frameIdx: 0, speed: 1, audio, audioOn: true };
    const r = render(el(p));
    // play the glide a little.
    playFrame(r, p, 0);
    expect(audio.whoom).not.toHaveBeenCalled();

    // SCRUB: jump the cursor straight to a frame deep inside DILATION (frame 3
    // starts at 900) and PAUSE — the re-base puts t at 900 discontinuously.
    nowMs += 100;
    r.rerender(el({ ...p, frameIdx: 3, paused: true }));
    step(); // first loop after the jump → t≈900, |Δt|≫JUMP_MS → SYNC, no fire.
    step();
    expect(audio.whoom).not.toHaveBeenCalled(); // shift was skipped, not re-fired
    expect(audio.startDrone).not.toHaveBeenCalled();
    expect(audio.dilationTick).not.toHaveBeenCalled(); // skipped ticks NOT replayed
  });

  it('a SCRUB BACKWARD does not re-fire and a fresh FORWARD replay re-fires cleanly', () => {
    const audio = mockAudio();
    const p: Props = { frameIdx: 0, speed: 1, audio, audioOn: true };
    const r = render(el(p));
    // forward through the SHIFT once.
    playFrame(r, p, 0);
    playFrame(r, p, 1);
    playFrame(r, p, 2);
    expect(audio.whoom).toHaveBeenCalledTimes(1);
    expect(audio.startDrone).toHaveBeenCalledTimes(1);

    // SCRUB BACKWARD to a glide frame (cursor jump back) — no re-fire on the jump.
    nowMs += 100;
    r.rerender(el({ ...p, frameIdx: 0, paused: true }));
    step();
    step();
    expect(audio.whoom).toHaveBeenCalledTimes(1); // a backward jump fires nothing

    // REPLAY forward from the top → the cues re-fire cleanly (trackers reset by
    // the t≈0 sync, then a smooth forward pass re-crosses the SHIFT).
    nowMs += 100;
    const p2: Props = { ...p, paused: false };
    r.rerender(el({ ...p2, frameIdx: 0 }));
    playFrame(r, p2, 0);
    playFrame(r, p2, 1);
    playFrame(r, p2, 2);
    expect(audio.whoom).toHaveBeenCalledTimes(2);
    expect(audio.startDrone).toHaveBeenCalledTimes(2);
  });

  it('a SKIP (speed="skip") jumps t to the end and does NOT fire the per-tick cues', () => {
    const audio = mockAudio();
    const p: Props = { frameIdx: 0, speed: 'skip', audio, audioOn: true };
    render(el(p));
    // 'skip' pins t to totalDuration; every loop sees the END (jump from -1 on
    // the first sample → SYNC), so per-tick cues never fire.
    step();
    nowMs += 60;
    step();
    expect(audio.dilationTick).not.toHaveBeenCalled();
    expect(audio.whoom).not.toHaveBeenCalled();
    expect(audio.startDrone).not.toHaveBeenCalled();
  });
});
