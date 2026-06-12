// @vitest-environment jsdom
// v1.1 Feature D — skirmish log.
//
// Part 1: the log LINES are built inside buildReplay from the same
// fog-filtered simulation as the frames (never the raw event log):
//   • fromMist strikes log as "−N from the mist" with NO attacker name/cell;
//   • AI moves/kills wholly outside player vision produce NO line at all;
//   • lines carry atFrame anchors so they append AS the replay plays.
// Part 2: the SkirmishLog component — gating by upToFrame, newest-at-bottom
// round blocks, collapse to a "+" chip and back.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { AttackBreakdown, ResolutionEvent, UnitInstance } from '../../src/core/types';
import { buildReplay, type ReplayLogEntry } from '../../src/state/replay';
import { loadUnits } from '../../src/io/data-loader';
import { lineBoard, makeUnit } from '../core/synthetic';
import { SkirmishLog } from '../../src/ui/SkirmishLog';

afterEach(cleanup);

const types = loadUnits();
const plains = (n: number) => lineBoard(Array(n).fill('plains'));

const bd = (over: Partial<AttackBreakdown> = {}): AttackBreakdown => ({
  A: 5,
  Ta: 0,
  D: 6,
  Td: 0,
  B: 0,
  p: 0.45,
  damage: 5,
  gangUp: { total: 0, contributions: [] },
  ...over,
});

function build(units: UnitInstance[], events: ResolutionEvent[], cells = 12) {
  return buildReplay(plains(cells), units, events, types, 0);
}

const textOf = (e: ReplayLogEntry): string => e.segs.map((s) => s.t).join('');

describe('skirmish log lines — fog honesty (built from the replay feed)', () => {
  it('a visible exchange logs "attacker → defender −N / counter −M"', () => {
    const units = [makeUnit('pi', 0, 2), makeUnit('re', 1, 3, 'ranger')];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'pi',
        defenderId: 're',
        attackerCell: 2,
        defenderCell: 3,
        damage: 5,
        bonusB: 0,
        defenderCountAfter: 5,
        counterFired: true,
        breakdown: bd(),
      },
      {
        type: 'counter',
        attackerId: 're',
        defenderId: 'pi',
        attackerCell: 3,
        defenderCell: 2,
        damage: 4,
        defenderCountAfter: 6,
        breakdown: bd({ damage: 4 }),
      },
    ];
    const script = build(units, events);
    expect(script.log.map(textOf)).toEqual(['Infantry → Ranger −5 / counter −4']);
    // anchored to the volley frame (after the establishing frame)
    expect(script.log[0]!.atFrame).toBe(1);
  });

  it('fromMist strike logs the damage with NO attacker name — "from the mist"', () => {
    // Player infantry at 0 (vision 2); enemy artillery at 6 — invisible.
    const units = [makeUnit('pi', 0, 0), makeUnit('art', 1, 6, 'artillery')];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'art',
        defenderId: 'pi',
        attackerCell: 6,
        defenderCell: 0,
        damage: 4,
        bonusB: 0,
        defenderCountAfter: 6,
        counterFired: false,
        breakdown: bd({ damage: 4 }),
      },
    ];
    const script = build(units, events);
    expect(script.log).toHaveLength(1);
    const line = textOf(script.log[0]!);
    expect(line).toBe('Infantry −4 from the mist');
    expect(line).not.toContain('Artillery');
    expect(line).not.toContain('6'); // no attacker cell either
    // the mist fragment is tagged for the terminal's mist styling
    expect(script.log[0]!.segs.some((s) => s.f === 'mist')).toBe(true);
  });

  it('AI moves and kills wholly outside player vision produce NO lines', () => {
    // Player at 0 (vision 2); everything at cells 8..10 is deep in the mist.
    const units = [makeUnit('pi', 0, 0), makeUnit('e1', 1, 8), makeUnit('e2', 1, 10, 'tank')];
    const events: ResolutionEvent[] = [
      { type: 'move', unitId: 'e1', from: 8, to: 9, pathTaken: [9] },
      { type: 'kill', unitId: 'e2', cell: 10, faction: 1 },
    ];
    const script = build(units, events);
    expect(script.log).toEqual([]);
  });

  it('a VISIBLE AI move logs "enemy <name> on the move"; own moves stay silent', () => {
    const units = [makeUnit('pi', 0, 2), makeUnit('et', 1, 4, 'tank')];
    const events: ResolutionEvent[] = [
      { type: 'move', unitId: 'pi', from: 2, to: 3, pathTaken: [3] },
      { type: 'move', unitId: 'et', from: 4, to: 5, pathTaken: [5] },
    ];
    const script = build(units, events);
    expect(script.log.map(textOf)).toEqual(['enemy Tank on the move']);
  });

  it("the player's own vacancy-failed bounce logs a fall-back line; AI truncations never log", () => {
    const units = [makeUnit('pi', 0, 2), makeUnit('et', 1, 4, 'tank')];
    const events: ResolutionEvent[] = [
      { type: 'move', unitId: 'pi', from: 2, to: 3, pathTaken: [3] },
      { type: 'path-truncated', unitId: 'pi', planned: 4, actual: 3, reason: 'vacancy-failed' },
      { type: 'move', unitId: 'et', from: 4, to: 5, pathTaken: [5] },
      { type: 'path-truncated', unitId: 'et', planned: 6, actual: 5, reason: 'enemy-contact' },
    ];
    const script = build(units, events);
    const lines = script.log.map(textOf);
    expect(lines).toContain('Infantry falls back — tile never cleared');
    expect(lines.filter((l) => l.includes('Tank'))).toEqual(['enemy Tank on the move']);
  });

  it('shown kills and fizzles log with faction wording', () => {
    const units = [makeUnit('pi', 0, 2), makeUnit('re', 1, 3, 'ranger')];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'pi',
        defenderId: 're',
        attackerCell: 2,
        defenderCell: 3,
        damage: 5,
        bonusB: 0,
        defenderCountAfter: 0,
        counterFired: false,
        breakdown: bd(),
      },
      { type: 'kill', unitId: 're', cell: 3, faction: 1 },
      { type: 'lost-target', attackerId: 'pi', targetCell: 5 },
    ];
    const script = build(units, events);
    const lines = script.log.map(textOf);
    expect(lines).toContain('enemy Ranger destroyed');
    expect(lines).toContain('Infantry holds fire — target lost');
  });
});

describe('SkirmishLog component', () => {
  const entry = (atFrame: number, text: string): ReplayLogEntry => ({
    atFrame,
    segs: [{ t: text }],
  });

  it('streams live lines gated by upToFrame; history rounds always render', () => {
    const history = [{ round: 1, entries: [entry(0, 'old line')] }];
    const live = {
      round: 2,
      entries: [entry(1, 'early'), entry(5, 'late')],
      upToFrame: 2,
    };
    const { container } = render(<SkirmishLog history={history} live={live} defaultOpen />);
    const body = container.querySelector('.skirmish-body')!;
    expect(body.textContent).toContain('old line');
    expect(body.textContent).toContain('round 1');
    expect(body.textContent).toContain('round 2');
    expect(body.textContent).toContain('early');
    expect(body.textContent).not.toContain('late'); // not played yet
  });

  it('collapses to a 44px "+" chip and reopens', () => {
    const { container } = render(<SkirmishLog history={[]} live={null} defaultOpen />);
    expect(container.querySelector('[data-testid="skirmish-log"]')).not.toBeNull();
    fireEvent.click(container.querySelector('.skirmish-collapse')!);
    expect(container.querySelector('[data-testid="skirmish-log"]')).toBeNull();
    const chip = container.querySelector('.skirmish-chip')!;
    expect(chip).not.toBeNull();
    fireEvent.click(chip);
    expect(container.querySelector('[data-testid="skirmish-log"]')).not.toBeNull();
  });

  it('starts collapsed when defaultOpen is false (phone width)', () => {
    const { container } = render(
      <SkirmishLog history={[]} live={null} defaultOpen={false} />,
    );
    expect(container.querySelector('[data-testid="skirmish-log"]')).toBeNull();
    expect(container.querySelector('.skirmish-chip')).not.toBeNull();
  });

  it('mist segments render with the mist styling class', () => {
    const live = {
      round: 1,
      entries: [{ atFrame: 0, segs: [{ t: 'Infantry −4 ' }, { t: 'from the mist', f: 'mist' as const }] }],
      upToFrame: 0,
    };
    const { container } = render(<SkirmishLog history={[]} live={live} defaultOpen />);
    expect(container.querySelector('.log-f-mist')!.textContent).toBe('from the mist');
  });
});
