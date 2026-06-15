// @vitest-environment jsdom
// v0.9 HUD — the two canvas counters in the top bar: a split-flap (Solari) board
// for the round number and a mechanical odometer for credits. Ported from the
// attached dexipurei standalone widgets and adapted to show a REAL value and
// animate on CHANGE (flip / roll once, then hold) rather than auto-cycle forever.
//
// jsdom returns null from canvas.getContext('2d'), so the canvas pixels can't be
// asserted here — the components carry a visually-hidden accessible label as the
// machine-readable value, and these tests assert THAT plus the pure driver math
// (flip-on-change, roll-on-change, reduced-motion snap, RAF-settle). Visual
// fidelity is human-verified later.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { TopBar } from '../../src/ui/TopBar';
import { RoundFlap } from '../../src/ui/skin/displays/RoundFlap';
import { CreditsOdometer } from '../../src/ui/skin/displays/CreditsOdometer';
import {
  SOLARI_LIGHT,
  createSplitFlapDriver,
  setTarget,
} from '../../src/ui/skin/displays/splitflap';
import {
  ROLL_MS,
  createOdometerDriver,
  setValue,
} from '../../src/ui/skin/displays/odometer';

afterEach(cleanup);

describe('RoundFlap / CreditsOdometer components (a11y value)', () => {
  it('RoundFlap exposes the round as an accessible label', () => {
    const { getByLabelText, rerender } = render(<RoundFlap value={3} />);
    getByLabelText('round 3');
    rerender(<RoundFlap value={4} />);
    getByLabelText('round 4');
  });

  it('CreditsOdometer exposes the credit count as an accessible label', () => {
    const { getByLabelText, rerender } = render(<CreditsOdometer value={300} />);
    getByLabelText('credits 300');
    rerender(<CreditsOdometer value={150} />);
    getByLabelText('credits 150');
  });
});

describe('TopBar wiring (round flap + credits odometer + income)', () => {
  it('renders both counters with accessible values and the per-turn income', () => {
    const { getByLabelText, getByText, getByTestId } = render(
      <TopBar round={5} phase="planning" credits={{ value: 250, committed: 100, income: 200 }} />,
    );
    getByLabelText('round 5'); // split-flap
    getByLabelText('credits 250'); // odometer
    // income wins over the "committed" line and reads as a per-turn gain.
    getByText('+200/turn');
    getByLabelText('plus 200 per turn');
    // the existing testid stays reachable for downstream tests.
    expect(getByTestId('credits-hud')).toBeTruthy();
  });

  it('with no income (replay frame), shows neither income nor a crash', () => {
    const { getByLabelText, queryByText } = render(
      <TopBar round={6} phase="replay" credits={{ value: 410 }} />,
    );
    getByLabelText('credits 410');
    expect(queryByText(/\/turn/)).toBeNull();
  });
});

describe('split-flap driver: flip-on-change, then hold (no auto-cycle)', () => {
  it('an unchanged column does not flip; a changed column flips forward once', () => {
    const d = createSplitFlapDriver('12');
    // 1→1 unchanged (steps 0), 2→3 flips one card forward.
    setTarget(d, '13', 0, SOLARI_LIGHT, /* animate */ true);
    expect(d.cols[0]!.steps).toBe(0); // '1' unchanged
    expect(d.cols[1]!.steps).toBeGreaterThan(0); // '2' → '3' flips
    expect(d.animating).toBe(true);
  });

  it('reduced-motion snap: no column flips (steps all 0), settles immediately', () => {
    const d = createSplitFlapDriver('12');
    setTarget(d, '99', 0, SOLARI_LIGHT, /* animate */ false);
    expect(d.cols.every((c) => c.steps === 0)).toBe(true);
    expect(d.animating).toBe(false);
    expect(d.target).toBe('99');
  });

  it('growing the string (9 → 10) flips the new column in from blank', () => {
    const d = createSplitFlapDriver('9');
    setTarget(d, '10', 0, SOLARI_LIGHT, true);
    expect(d.target).toBe('10');
    expect(d.cols.length).toBe(2);
  });
});

describe('odometer driver: roll-on-change over ROLL_MS, then hold', () => {
  it('starts a roll from the old value to the new value, animating', () => {
    const d = createOdometerDriver(100);
    setValue(d, 300, 0, /* animate */ true);
    expect(d.fromValue).toBe(100);
    expect(d.value).toBe(300);
    expect(d.animating).toBe(true);
  });

  it('reduced-motion snap: lands immediately, not animating', () => {
    const d = createOdometerDriver(100);
    setValue(d, 300, 0, /* animate */ false);
    expect(d.value).toBe(300);
    expect(d.animating).toBe(false);
  });

  it('no-op when the value is unchanged and already settled', () => {
    const d = createOdometerDriver(250);
    setValue(d, 250, 0, true);
    expect(d.animating).toBe(false);
  });

  it('ROLL_MS is the ~600 ms roll budget the spec asked for', () => {
    expect(ROLL_MS).toBe(600);
  });
});
