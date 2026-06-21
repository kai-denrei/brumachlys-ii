// @vitest-environment jsdom
// R7 (SEEK / SCRUB transport) — the ReplayDock scrubber. Asserts the slider
// renders, dragging seeks by TIME (mapping through cumulative frame durations),
// arrow keys step exactly one FRAME, grabbing it pauses (scrub-start), the
// scrubber agrees with the slot strip, and play/pause/speed/skip stay present.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { FactionId, UnitInstance } from '../../src/core/types';
import type { TimelineSlot } from '../../src/state/replay';
import { ReplayDock } from '../../src/ui/Replay';

// jsdom has no scrollIntoView — the dock's "keep active slot in view" effect
// calls it. Stub it so the effect is a no-op under test.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

function unit(id: string, faction: FactionId, type = 'infantry'): UnitInstance {
  return { id, type, faction, cell: 0, count: 10, stance: 'aggressive', attackedFrom: [] };
}

function moveSlot(actor: UnitInstance): TimelineSlot {
  return { kind: 'move', actorType: actor.type, actorFaction: actor.faction, strikes: [] };
}

// Three slots so the strip + scrubber have something to agree on.
const slots: TimelineSlot[] = [
  moveSlot(unit('a', 0)),
  moveSlot(unit('b', 1)),
  moveSlot(unit('c', 0)),
];

// Frame cursor runs 0..9 (frameCount 10); total run length 1000ms at 1×.
const baseProps = {
  slots,
  activeSlot: 1,
  frameIdx: 5,
  frameCount: 10,
  elapsedMs: 500,
  totalMs: 1000,
  speed: 1 as const,
  paused: false,
  done: false,
  onSpeed: () => {},
  onTogglePause: () => {},
  onSlotTap: () => {},
};

describe('R7 scrubber rendering', () => {
  it('renders a range slider spanning the whole replay', () => {
    const { getByTestId } = render(<ReplayDock {...baseProps} onSeekTime={() => {}} onSeekFrame={() => {}} />);
    const scrub = getByTestId('replay-scrub') as HTMLInputElement;
    expect(scrub.type).toBe('range');
    expect(scrub.min).toBe('0');
    expect(scrub.max).toBe('1000'); // totalMs
    expect(scrub.value).toBe('500'); // elapsedMs
    expect(scrub.getAttribute('aria-label')).toMatch(/scrub/i);
  });

  it('exposes an aria-valuetext naming the current frame (a11y)', () => {
    const { getByTestId } = render(<ReplayDock {...baseProps} onSeekTime={() => {}} onSeekFrame={() => {}} />);
    const scrub = getByTestId('replay-scrub');
    // frameIdx 5 → "frame 6 of 10"
    expect(scrub.getAttribute('aria-valuetext')).toBe('frame 6 of 10');
  });

  it('keeps play/pause, speed (1×/2×) and skip controls present', () => {
    const { getByLabelText, getByText } = render(
      <ReplayDock {...baseProps} onSeekTime={() => {}} onSeekFrame={() => {}} />,
    );
    expect(getByLabelText('pause')).toBeTruthy();
    expect(getByText('1×')).toBeTruthy();
    expect(getByText('2×')).toBeTruthy();
    expect(getByText('≫')).toBeTruthy(); // skip
  });

  it('disables the scrubber when there is nothing to seek (single frame)', () => {
    const { getByTestId } = render(
      <ReplayDock {...baseProps} frameCount={1} totalMs={500} onSeekTime={() => {}} onSeekFrame={() => {}} />,
    );
    expect((getByTestId('replay-scrub') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('R7 scrubber seeking', () => {
  it('dragging seeks by TIME — onChange forwards the slider ms to onSeekTime', () => {
    const onSeekTime = vi.fn();
    const { getByTestId } = render(
      <ReplayDock {...baseProps} onSeekTime={onSeekTime} onSeekFrame={() => {}} />,
    );
    fireEvent.change(getByTestId('replay-scrub'), { target: { value: '750' } });
    expect(onSeekTime).toHaveBeenCalledWith(750);
  });

  it('grabbing the scrubber pauses playback (scrub-start on pointer down)', () => {
    const onScrubStart = vi.fn();
    const { getByTestId } = render(
      <ReplayDock {...baseProps} onSeekTime={() => {}} onSeekFrame={() => {}} onScrubStart={onScrubStart} />,
    );
    fireEvent.pointerDown(getByTestId('replay-scrub'));
    expect(onScrubStart).toHaveBeenCalled();
  });

  it('arrow keys step EXACTLY one frame (Right = next, Left = previous)', () => {
    const onSeekFrame = vi.fn();
    const { getByTestId } = render(
      <ReplayDock {...baseProps} frameIdx={5} onSeekTime={() => {}} onSeekFrame={onSeekFrame} />,
    );
    const scrub = getByTestId('replay-scrub');
    fireEvent.keyDown(scrub, { key: 'ArrowRight' });
    expect(onSeekFrame).toHaveBeenLastCalledWith(6);
    fireEvent.keyDown(scrub, { key: 'ArrowLeft' });
    expect(onSeekFrame).toHaveBeenLastCalledWith(4);
  });

  it('Home/End jump the cursor to the ends', () => {
    const onSeekFrame = vi.fn();
    const { getByTestId } = render(
      <ReplayDock {...baseProps} frameIdx={5} frameCount={10} onSeekTime={() => {}} onSeekFrame={onSeekFrame} />,
    );
    const scrub = getByTestId('replay-scrub');
    fireEvent.keyDown(scrub, { key: 'Home' });
    expect(onSeekFrame).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(scrub, { key: 'End' });
    expect(onSeekFrame).toHaveBeenLastCalledWith(9); // frameCount-1
  });

  it('keyboard seek also pauses (scrub-start fires on key down)', () => {
    const onScrubStart = vi.fn();
    const { getByTestId } = render(
      <ReplayDock {...baseProps} onSeekTime={() => {}} onSeekFrame={() => {}} onScrubStart={onScrubStart} />,
    );
    fireEvent.keyDown(getByTestId('replay-scrub'), { key: 'ArrowRight' });
    expect(onScrubStart).toHaveBeenCalled();
  });
});

describe('R7 scrubber agrees with the slot strip', () => {
  it('the active slot is highlighted and the scrubber thumb reflects the same cursor', () => {
    const { container, getByTestId } = render(
      <ReplayDock {...baseProps} activeSlot={2} frameIdx={9} elapsedMs={900} onSeekTime={() => {}} onSeekFrame={() => {}} />,
    );
    // strip: slot 2 is active
    const active = container.querySelector('.timeline-slot-active');
    expect(active?.getAttribute('data-slot')).toBe('2');
    // scrubber: thumb at the matching elapsed time, aria names the frame
    expect((getByTestId('replay-scrub') as HTMLInputElement).value).toBe('900');
    expect(getByTestId('replay-scrub').getAttribute('aria-valuetext')).toBe('frame 10 of 10');
  });
});
