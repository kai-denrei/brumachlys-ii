// @vitest-environment jsdom
// R8 (AUDIO) — the toggle CONTROL in the ReplayDock + the useCombatAudio hook's
// gating contract. Asserts:
//   • the dock renders an audio toggle with an aria-label and aria-pressed;
//   • it is not rendered when no handler is wired;
//   • clicking it calls the handler;
//   • the hook defaults OFF and touches NO AudioContext while off (a constructor
//     spy stays uncalled); flipping ON unlocks (constructs) the context inside
//     the gesture, flipping OFF disposes it.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import type { TimelineSlot } from '../../src/state/replay';
import { ReplayDock } from '../../src/ui/Replay';
import { useCombatAudio } from '../../src/ui/audio/useCombatAudio';

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

const slots: TimelineSlot[] = [
  { kind: 'move', actorType: 'infantry', actorFaction: 0, strikes: [] },
];
const baseProps = {
  slots,
  activeSlot: 0,
  frameIdx: 0,
  frameCount: 2,
  elapsedMs: 0,
  totalMs: 100,
  speed: 1 as const,
  paused: false,
  done: false,
  onSpeed: () => {},
  onTogglePause: () => {},
  onSlotTap: () => {},
};

describe('R8 — audio toggle control in the ReplayDock', () => {
  it('renders the toggle with an aria-label and OFF aria-pressed by default', () => {
    const { getByTestId } = render(
      <ReplayDock {...baseProps} audioOn={false} onToggleAudio={() => {}} />,
    );
    const btn = getByTestId('replay-audio-toggle');
    expect(btn.getAttribute('aria-label')).toMatch(/audio/i);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('reads ON via aria-pressed when enabled', () => {
    const { getByTestId } = render(
      <ReplayDock {...baseProps} audioOn onToggleAudio={() => {}} />,
    );
    expect(getByTestId('replay-audio-toggle').getAttribute('aria-pressed')).toBe('true');
  });

  it('is NOT rendered when no toggle handler is wired', () => {
    const { queryByTestId } = render(<ReplayDock {...baseProps} />);
    expect(queryByTestId('replay-audio-toggle')).toBeNull();
  });

  it('clicking the toggle calls the handler', () => {
    const onToggle = vi.fn();
    const { getByTestId } = render(
      <ReplayDock {...baseProps} audioOn={false} onToggleAudio={onToggle} />,
    );
    fireEvent.click(getByTestId('replay-audio-toggle'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe('R8 — useCombatAudio gating: default OFF, no context while off', () => {
  it('defaults OFF and never constructs an AudioContext while off', () => {
    const ctor = vi.fn(() => makeStubCtx());
    vi.stubGlobal('AudioContext', ctor as unknown as typeof AudioContext);

    const { result } = renderHook(() => useCombatAudio());
    expect(result.current.enabled).toBe(false);

    // playFrame while OFF must not touch the context.
    act(() => {
      result.current.playFrame({ projectiles: [{ kind: 'tracer', from: 0, to: 1, faction: 0, impact: 0.8, delay: 0 }], floaters: [], bursts: [], kills: [], wave: 'A' } as never, 1);
    });
    expect(ctor).not.toHaveBeenCalled();
  });

  it('flipping ON unlocks (constructs) the context, flipping OFF disposes it', () => {
    const close = vi.fn(() => Promise.resolve());
    const ctor = vi.fn(() => makeStubCtx({ close }));
    vi.stubGlobal('AudioContext', ctor as unknown as typeof AudioContext);

    const { result } = renderHook(() => useCombatAudio());

    act(() => result.current.toggle()); // ON — unlock() constructs inside gesture
    expect(result.current.enabled).toBe(true);
    expect(ctor).toHaveBeenCalledTimes(1);

    act(() => result.current.toggle()); // OFF — dispose() closes the context
    expect(result.current.enabled).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('persists the preference across hook instances', () => {
    vi.stubGlobal('AudioContext', vi.fn(() => makeStubCtx()) as unknown as typeof AudioContext);
    const first = renderHook(() => useCombatAudio());
    act(() => first.result.current.toggle()); // turn ON → persisted to storage
    first.unmount();

    const second = renderHook(() => useCombatAudio());
    expect(second.result.current.enabled).toBe(true);
  });
});

function makeStubCtx(over: Partial<Record<string, unknown>> = {}) {
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  });
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const ctx = {
    state: 'running' as AudioContextState,
    currentTime: 0,
    sampleRate: 44100,
    destination: node(),
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    createGain: vi.fn(() => ({ ...node(), gain: param() })),
    createOscillator: vi.fn(() => ({ ...node(), type: 'sine', frequency: param(), start: vi.fn(), stop: vi.fn(), onended: null })),
    createBiquadFilter: vi.fn(() => ({ ...node(), type: 'lowpass', frequency: param() })),
    createBufferSource: vi.fn(() => ({ ...node(), buffer: null, start: vi.fn(), stop: vi.fn(), onended: null })),
    createBuffer: vi.fn((_ch: number, len: number) => ({ getChannelData: vi.fn(() => new Float32Array(len)) })),
    ...over,
  };
  return ctx as unknown as AudioContext;
}
