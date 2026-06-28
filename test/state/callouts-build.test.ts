// Feature A — combat callouts built INTO the replay script (buildReplay).
// Each source event (path-interrupted / lost-target / capture / kill) emits a
// fog-gated `callout` on the frame at its cell, with a deterministically-picked
// term from the matching table. A mist kill yields NO callout (fog honesty).

import { describe, expect, it } from 'vitest';
import { bd } from '../fixtures';
import type {
  ResolutionEvent,
  UnitInstance,
} from '../../src/core/types';
import { buildReplay } from '../../src/state/replay';
import {
  CALLOUT_TERMS,
  calloutTerm,
  type Callout,
} from '../../src/state/callouts';
import { loadUnits } from '../../src/io/data-loader';
import { lineBoard, makeUnit } from '../core/synthetic';

const types = loadUnits();
const plains = (n: number) => lineBoard(Array(n).fill('plains'));

function build(units: UnitInstance[], events: ResolutionEvent[], cells = 12) {
  return buildReplay(plains(cells), units, events, types, 0);
}

/** Gather every callout across all frames of a script. */
function allCallouts(script: ReturnType<typeof build>): Callout[] {
  return script.frames.flatMap((f) => f.callouts ?? []);
}

describe('buildReplay — every frame carries a callouts array (emptyFx contract)', () => {
  it('default frames have an empty callouts array', () => {
    const script = build([makeUnit('pi', 0, 2)], []);
    for (const f of script.frames) {
      expect(Array.isArray(f.callouts)).toBe(true);
      expect(f.callouts).toEqual([]);
    }
  });
});

describe('buildReplay — path-interrupted → crossing callout (replaces CrossSign)', () => {
  const units = [
    makeUnit('pi', 0, 2),
    makeUnit('pc', 0, 0, 'ranger'),
    makeUnit('ec', 1, 4, 'ranger'),
  ];
  const events: ResolutionEvent[] = [
    { type: 'path-interrupted', unitId: 'pc', crossedWithId: 'ec', cell: 3 },
    { type: 'path-interrupted', unitId: 'ec', crossedWithId: 'pc', cell: 3 },
  ];

  it('emits a crossing callout at the witnessed crossing cell (one per cell)', () => {
    const script = build(units, events);
    const cos = allCallouts(script).filter((c) => c.kind === 'crossing');
    expect(cos.length).toBe(1);
    expect(cos[0]!.cell).toBe(3);
    expect(CALLOUT_TERMS.crossing).toContain(cos[0]!.text);
  });

  it('the crossing term is deterministic for the crossing cell+unit', () => {
    const script = build(units, events);
    const co = allCallouts(script).find((c) => c.kind === 'crossing')!;
    // eventKey = "cross:" + first interrupted unitId + ":" + cell
    expect(co.text).toBe(calloutTerm('crossing', 'cross:pc:3'));
  });

  it('NO legacy literal "path interrupted!" sign survives (the callout IS the sign)', () => {
    const script = build(units, events);
    const signTexts = script.frames.flatMap((f) => f.signs ?? []).map((s) => s.text);
    expect(signTexts).not.toContain('path interrupted!');
  });

  it('a crossing on a DARK cell surfaces no callout (fog secrecy)', () => {
    const dark = [
      makeUnit('pi', 0, 2),
      makeUnit('e1', 1, 7, 'ranger'),
      makeUnit('e2', 1, 9, 'ranger'),
    ];
    const darkEvents: ResolutionEvent[] = [
      { type: 'path-interrupted', unitId: 'e1', crossedWithId: 'e2', cell: 8 },
      { type: 'path-interrupted', unitId: 'e2', crossedWithId: 'e1', cell: 8 },
    ];
    const script = build(dark, darkEvents, 12);
    expect(allCallouts(script)).toEqual([]);
  });
});

describe('buildReplay — lost-target → no-target callout', () => {
  it('a witnessed fizzle emits a no-target callout at the attacker cell', () => {
    const units = [makeUnit('pi', 0, 2, 'ranger')];
    const events: ResolutionEvent[] = [
      { type: 'lost-target', attackerId: 'pi', targetCell: 4 },
    ];
    const script = build(units, events);
    const co = allCallouts(script).find((c) => c.kind === 'no-target');
    expect(co).toBeDefined();
    expect(co!.cell).toBe(2); // the attacker's own cell
    expect(CALLOUT_TERMS['no-target']).toContain(co!.text);
    expect(co!.text).toBe(calloutTerm('no-target', 'lost:pi:4'));
  });

  it('an enemy fizzle the player cannot see surfaces no callout', () => {
    // Enemy ranger at cell 9 fizzles; player infantry at cell 2 (vision 2)
    // sees only cells 0..4 — cell 9 is dark.
    const units = [makeUnit('pi', 0, 2), makeUnit('ei', 1, 9, 'ranger')];
    const events: ResolutionEvent[] = [
      { type: 'lost-target', attackerId: 'ei', targetCell: 7 },
    ];
    const script = build(units, events, 12);
    expect(allCallouts(script).filter((c) => c.kind === 'no-target')).toEqual([]);
  });
});

describe('buildReplay — kill → own/enemy callout (faction-routed)', () => {
  it('an enemy kill the player witnesses emits an enemy-destroyed callout', () => {
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
    ];
    const script = build(units, events);
    const co = allCallouts(script).find((c) => c.kind === 'kill-enemy');
    expect(co).toBeDefined();
    expect(co!.cell).toBe(3);
    expect(CALLOUT_TERMS['kill-enemy']).toContain(co!.text);
    expect(co!.text).toBe(calloutTerm('kill-enemy', 'kill:re:3'));
  });

  it('an OWN kill emits an own-destroyed callout, interpolating the unit name', () => {
    // Enemy infantry kills the player's ranger. The own table may pick the
    // "{type} Down!" slot → the display name is interpolated.
    const units = [makeUnit('pr', 0, 2, 'ranger'), makeUnit('ei', 1, 3)];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'ei',
        defenderId: 'pr',
        attackerCell: 3,
        defenderCell: 2,
        damage: 9,
        bonusB: 0,
        defenderCountAfter: 0,
        counterFired: false,
        breakdown: bd({ damage: 9 }),
      },
      { type: 'kill', unitId: 'pr', cell: 2, faction: 0 },
    ];
    const script = build(units, events);
    const co = allCallouts(script).find((c) => c.kind === 'kill-own');
    expect(co).toBeDefined();
    expect(co!.cell).toBe(2);
    const name = types['ranger']!.name;
    expect(co!.text).toBe(calloutTerm('kill-own', 'kill:pr:2', name));
  });

  it('a MIST kill (defender unseen) yields NO callout (fog honesty)', () => {
    // Enemy ranger at cell 6 fires from beyond vision and kills the player's
    // far infantry at cell 5 — wait, own kills always show. Use an ENEMY kill
    // whose defender the player cannot see: enemy kills its own ally off-screen.
    // Player infantry at cell 2 sees 0..4. An enemy attacks an enemy? Not a real
    // case — instead: an enemy unit at cell 9 is killed by the player's artillery
    // beyond vision but the DEFENDER cell (9) is dark. The kill of an unseen unit
    // is not shown (the player learns nothing) → no callout.
    const units = [
      makeUnit('pa', 0, 2, 'artillery'),
      makeUnit('ev', 1, 9, 'ranger'),
    ];
    const events: ResolutionEvent[] = [
      // No shown strike on ev; a bare kill of an unseen enemy stays silent.
      { type: 'kill', unitId: 'ev', cell: 9, faction: 1 },
    ];
    const script = build(units, events, 12);
    expect(allCallouts(script).filter((c) => c.kind.startsWith('kill'))).toEqual([]);
  });
});

describe('buildReplay — capture → captured callout (alongside the capture FX)', () => {
  it('a witnessed own capture emits a captured callout at the base cell', () => {
    const units = [makeUnit('pc', 0, 2, 'ranger')];
    const events: ResolutionEvent[] = [
      { type: 'capture', unitId: 'pc', cell: 3, from: null, to: 0, unitConsumed: true },
    ];
    // Conquest ctx so capture events flow.
    const script = buildReplay(
      plains(12),
      units,
      events,
      types,
      0,
      undefined,
      { bases: { 3: null }, credits: 100 },
    );
    const co = allCallouts(script).find((c) => c.kind === 'captured');
    expect(co).toBeDefined();
    expect(co!.cell).toBe(3);
    expect(CALLOUT_TERMS.captured).toContain(co!.text);
    expect(co!.text).toBe(calloutTerm('captured', 'capture:3:0'));
    // The existing capture FX still rides the same frame.
    const capFrame = script.frames.find((f) => (f.captures?.length ?? 0) > 0)!;
    expect(capFrame.captures.some((c) => c.cell === 3)).toBe(true);
    expect(capFrame.callouts?.some((c) => c.kind === 'captured')).toBe(true);
  });
});

describe('buildReplay — determinism across rebuilds (scrub/replay stability)', () => {
  it('rebuilding the SAME round yields identical callout terms', () => {
    const units = () => [makeUnit('pi', 0, 2), makeUnit('re', 1, 3, 'ranger')];
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
    ];
    const a = allCallouts(build(units(), events)).map((c) => `${c.kind}:${c.cell}:${c.text}`);
    const b = allCallouts(build(units(), events)).map((c) => `${c.kind}:${c.cell}:${c.text}`);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
