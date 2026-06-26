// @vitest-environment jsdom
// Stage 2 (sequencing §5): the SECOND slider — COMBAT DILATION DEPTH — in the
// replay dock, beside the existing resolution-speed slider. The two coexist and
// persist independently. This knob deepens COMBAT ONLY (it feeds buildReplay's
// beat layout); movement frames stay brisk.
//
//   DOCK  — both sliders render; the dilation slider is keyboard-operable with an
//           aria-label + aria-valuetext ("2.0× deep"); onChange → onDilationDepth.
//   STORE — setDilationDepth clamps into [1.0, 4.0] and persists; both prefs
//           round-trip from localStorage independently.
//   WIRING — commit() passes store.dilationDepth into buildReplay so combat beats
//           scale; the value composes with replaySpeed (separate knobs).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { TimelineSlot } from '../../src/state/replay';
import { ReplayDock } from '../../src/ui/Replay';
import {
  DILATION_DEPTH_DEFAULT,
  DILATION_DEPTH_MAX,
  DILATION_DEPTH_MIN,
  DILATION_DEPTH_STEP,
  loadDilationDepth,
  loadReplaySpeed,
  saveReplaySpeed,
} from '../../src/state/store';

beforeAll(() => {
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
  dilationDepth: DILATION_DEPTH_DEFAULT,
  onDilationDepth: () => {},
  onTogglePause: () => {},
  onSlotTap: () => {},
};

describe('range constants — the second knob is [1.0, 4.0], step 0.1, default 1.6', () => {
  it('exposes the dilation-depth bounds + step', () => {
    expect(DILATION_DEPTH_MIN).toBe(1.0);
    expect(DILATION_DEPTH_MAX).toBe(4.0);
    expect(DILATION_DEPTH_DEFAULT).toBe(1.6);
    expect(DILATION_DEPTH_STEP).toBe(0.1);
  });
});

describe('ReplayDock — both sliders coexist', () => {
  it('renders the dilation-depth slider beside the resolution-speed slider', () => {
    const { getByTestId } = render(<ReplayDock {...baseProps} />);
    const speed = getByTestId('replay-speed-slider') as HTMLInputElement;
    const dilation = getByTestId('replay-dilation-slider') as HTMLInputElement;
    expect(speed).toBeTruthy();
    expect(dilation).toBeTruthy();
    expect(dilation.type).toBe('range');
    expect(dilation.min).toBe(String(DILATION_DEPTH_MIN));
    expect(dilation.max).toBe(String(DILATION_DEPTH_MAX));
    expect(dilation.step).toBe(String(DILATION_DEPTH_STEP));
  });

  it('the dilation slider is keyboard-operable — aria-label + aria-valuetext ("2.0× deep")', () => {
    const { getByTestId } = render(<ReplayDock {...baseProps} dilationDepth={2.0} />);
    const dilation = getByTestId('replay-dilation-slider');
    expect(dilation.getAttribute('aria-label')).toMatch(/combat dilation/i);
    expect(dilation.getAttribute('aria-valuetext')).toBe('2.0× deep');
  });

  it('reflects the current depth on the thumb + readout', () => {
    const { getByTestId, getByText } = render(<ReplayDock {...baseProps} dilationDepth={3.4} />);
    const dilation = getByTestId('replay-dilation-slider') as HTMLInputElement;
    expect(dilation.value).toBe('3.4');
    expect(getByText('3.4× deep')).toBeTruthy();
  });

  it('dragging the slider calls onDilationDepth with the number', () => {
    const onDilationDepth = vi.fn();
    const { getByTestId } = render(
      <ReplayDock {...baseProps} onDilationDepth={onDilationDepth} />,
    );
    fireEvent.change(getByTestId('replay-dilation-slider'), { target: { value: '2.4' } });
    expect(onDilationDepth).toHaveBeenCalledWith(2.4);
  });

  it('is NOT disabled when playback is done — it tunes the NEXT round', () => {
    const { getByTestId } = render(<ReplayDock {...baseProps} done />);
    expect((getByTestId('replay-dilation-slider') as HTMLInputElement).disabled).toBe(false);
  });
});

describe('store — the two prefs persist independently', () => {
  it('setDilationDepth clamps + persists; replaySpeed is untouched', async () => {
    const { useAppStore } = await import('../../src/state/store');
    saveReplaySpeed(0.5);
    useAppStore.getState().setDilationDepth(2.8);
    expect(useAppStore.getState().dilationDepth).toBe(2.8);
    expect(loadDilationDepth()).toBe(2.8);
    // the speed pref is independent (the two knobs coexist)
    expect(loadReplaySpeed()).toBe(0.5);

    useAppStore.getState().setDilationDepth(99);
    expect(useAppStore.getState().dilationDepth).toBe(DILATION_DEPTH_MAX);
    expect(loadDilationDepth()).toBe(DILATION_DEPTH_MAX);
  });
});
