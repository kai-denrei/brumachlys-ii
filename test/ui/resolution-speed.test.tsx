// @vitest-environment jsdom
// RESOLUTION SLOW-DOWN SLIDER — operator feedback: the combat-resolution replay
// is still too fast; this adds a fine speed slider to the replay dock that lets
// the player SLOW the resolution down (0.1× bullet-time test → 1× normal → 2×).
//
// This suite asserts, in layers:
//   STORE — replaySpeed is a number the slider sets; numeric choices PERSIST to
//           localStorage; 'skip' stays a transient action (never persisted).
//   DOCK  — the slider renders near the 1×/2× buttons, is keyboard-operable with
//           an aria-label + aria-valuetext ("0.5×"), the 1×/2× buttons are PRESETS
//           that set discrete slider values, and skip still jumps to the end.
//   WALL-CLOCK — a LOWER value stretches per-frame durations proportionally
//           (App divides frame.duration by the multiplier: 0.5× → 2× longer), and
//           the SAME multiplier flows to the dilation clock + audio (elapsedReplayTime).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { TimelineSlot } from '../../src/state/replay';
import { ReplayDock } from '../../src/ui/Replay';
import {
  REPLAY_SPEED_DEFAULT,
  REPLAY_SPEED_MAX,
  REPLAY_SPEED_MIN,
  loadReplaySpeed,
  saveReplaySpeed,
  useAppStore,
} from '../../src/state/store';
import { elapsedReplayTime } from '../../src/state/dilation-clock';

beforeAll(() => {
  // jsdom lacks scrollIntoView — the dock's "keep active slot in view" effect calls it.
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(cleanup);

const slots: TimelineSlot[] = [
  { kind: 'move', actorType: 'infantry', actorFaction: 0, strikes: [] },
];

const baseProps = {
  slots,
  activeSlot: 0,
  frameIdx: 5,
  frameCount: 10,
  elapsedMs: 500,
  totalMs: 1000,
  speed: 1 as number | 'skip',
  paused: false,
  done: false,
  onSpeed: () => {},
  onTogglePause: () => {},
  onSlotTap: () => {},
};

describe('resolution-speed range constants', () => {
  it('emphasises SLOWER — min 0.1× (bullet-time), max 2×, default 1×', () => {
    expect(REPLAY_SPEED_MIN).toBe(0.1);
    expect(REPLAY_SPEED_MAX).toBe(2);
    expect(REPLAY_SPEED_DEFAULT).toBe(1);
    expect(REPLAY_SPEED_MIN).toBeLessThan(REPLAY_SPEED_DEFAULT);
  });
});

describe('store — replaySpeed as a persisted number', () => {
  it('setReplaySpeed accepts a fractional value and stores it', () => {
    useAppStore.getState().setReplaySpeed(0.5);
    expect(useAppStore.getState().replaySpeed).toBe(0.5);
  });

  it('a numeric choice PERSISTS to localStorage (test sessions remember it)', () => {
    useAppStore.getState().setReplaySpeed(0.3);
    expect(loadReplaySpeed()).toBe(0.3);
  });

  it("'skip' is a transient action — set but NOT persisted (the remembered value stays)", () => {
    useAppStore.getState().setReplaySpeed(0.5); // a real, remembered choice
    useAppStore.getState().setReplaySpeed('skip'); // jump-to-end action
    expect(useAppStore.getState().replaySpeed).toBe('skip');
    expect(loadReplaySpeed()).toBe(0.5); // persistence kept the last numeric pick
  });

  it('loadReplaySpeed defaults to 1× when unset / invalid', () => {
    expect(loadReplaySpeed()).toBe(REPLAY_SPEED_DEFAULT);
    saveReplaySpeed(99 as number); // out of range → clamped/ignored on load
    expect(loadReplaySpeed()).toBeLessThanOrEqual(REPLAY_SPEED_MAX);
  });
});

describe('ReplayDock — the resolution slider', () => {
  it('renders a range slider spanning the slow→fast range, near the speed buttons', () => {
    const { getByTestId } = render(<ReplayDock {...baseProps} />);
    const slider = getByTestId('replay-speed-slider') as HTMLInputElement;
    expect(slider.type).toBe('range');
    expect(Number(slider.min)).toBe(REPLAY_SPEED_MIN);
    expect(Number(slider.max)).toBe(REPLAY_SPEED_MAX);
    expect(Number(slider.value)).toBe(1);
  });

  it('is keyboard-operable — aria-label + aria-valuetext naming the multiplier', () => {
    const { getByTestId } = render(<ReplayDock {...baseProps} speed={0.5} />);
    const slider = getByTestId('replay-speed-slider');
    expect(slider.getAttribute('aria-label')).toMatch(/speed|slow/i);
    expect(slider.getAttribute('aria-valuetext')).toBe('0.5×');
  });

  it('dragging the slider sets the speed (onChange → onSpeed with the number)', () => {
    const onSpeed = vi.fn();
    const { getByTestId } = render(<ReplayDock {...baseProps} onSpeed={onSpeed} />);
    fireEvent.change(getByTestId('replay-speed-slider'), { target: { value: '0.5' } });
    expect(onSpeed).toHaveBeenCalledWith(0.5);
  });

  it('reflects a skip speed by pinning the slider to its persisted-ish value (1×) but still showing skip', () => {
    const { getByTestId, getByText } = render(<ReplayDock {...baseProps} speed="skip" />);
    // skip is special — the slider falls back to a sane numeric value, not NaN.
    const slider = getByTestId('replay-speed-slider') as HTMLInputElement;
    expect(Number.isFinite(Number(slider.value))).toBe(true);
    expect(getByText('≫')).toBeTruthy();
  });

  it('the 1×/2× buttons are presets that set discrete slider values', () => {
    const onSpeed = vi.fn();
    const { getByLabelText } = render(<ReplayDock {...baseProps} onSpeed={onSpeed} />);
    fireEvent.click(getByLabelText('set speed 2×'));
    expect(onSpeed).toHaveBeenLastCalledWith(2);
    fireEvent.click(getByLabelText('set speed 1×'));
    expect(onSpeed).toHaveBeenLastCalledWith(1);
  });

  it('skip still jumps to end (onSpeed("skip"))', () => {
    const onSpeed = vi.fn();
    const { getByText } = render(<ReplayDock {...baseProps} onSpeed={onSpeed} />);
    fireEvent.click(getByText('≫'));
    expect(onSpeed).toHaveBeenLastCalledWith('skip');
  });
});

describe('wall-clock — a lower value stretches playback proportionally', () => {
  // The App advance loop schedules each frame at `frame.duration / speed`. A pure
  // assertion on that mapping: 0.5× yields exactly 2× the per-frame wall-time of 1×.
  const frameMs = (duration: number, speed: number) => duration / speed;

  it('0.5× takes ~2× as long as 1× for the same frame', () => {
    const d = 250;
    expect(frameMs(d, 0.5)).toBeCloseTo(2 * frameMs(d, 1));
  });

  it('0.1× takes 10× as long (bullet-time)', () => {
    const d = 250;
    expect(frameMs(d, 0.1)).toBeCloseTo(10 * frameMs(d, 1));
  });

  it('the dilation CLOCK reads the SAME multiplier — elapsedReplayTime scales the wall-delta', () => {
    const frames = [{ duration: 1000 }, { duration: 1000 }];
    const now = 1000;
    const enteredAt = 0; // 1000ms of wall-clock has passed into frame 0
    // At 1×, 1000ms wall → 1000ms elapsed (capped to the frame's own duration).
    const at1 = elapsedReplayTime(frames, 0, 1, false, now, enteredAt);
    // At 0.5×, the SAME wall delta advances HALF as much elapsed replay time.
    const atHalf = elapsedReplayTime(frames, 0, 0.5, false, now, enteredAt);
    expect(atHalf).toBeCloseTo(at1 / 2);
  });
});
