// E3 — conquest events through the replay builder: the BLIND-BUY FILTER
// (addendum §B.4). Own capture/income/spawn/spawn-failed always show; enemy
// ones only when the affected cell is live-visible at that replay instant;
// enemy income (no cell) never. Frames carry base ownership + the player's
// credits as of that instant; hidden events still advance both silently.

import { describe, expect, it } from 'vitest';
import type { ResolutionEvent, UnitInstance } from '../../src/core/types';
import { buildReplay, type ConquestReplayCtx } from '../../src/state/replay';
import { loadUnits } from '../../src/io/data-loader';
import { lineBoard, makeUnit } from '../core/synthetic';

const types = loadUnits();
const plains = (n: number) => lineBoard(Array(n).fill('plains'));

function build(
  units: UnitInstance[],
  events: ResolutionEvent[],
  conquest: ConquestReplayCtx,
  cells = 12,
) {
  return buildReplay(plains(cells), units, events, types, 0, undefined, conquest);
}

const logText = (script: ReturnType<typeof build>): string =>
  script.log.map((e) => e.segs.map((s) => s.t).join('')).join('\n');

describe('conquest replay — base vision + frame feeds', () => {
  it('an owned base contributes vision to the establishing frame', () => {
    // infantry at 2 sees 0..4; the owned base at 8 watches 6..10 → fog = {5, 11}
    const script = build([makeUnit('pi', 0, 2)], [], { bases: { 8: 0 }, credits: 100 });
    const fog = script.frames[0]!.fog;
    expect(fog.has(5)).toBe(true);
    expect(fog.has(11)).toBe(true);
    expect(fog.has(8)).toBe(false);
    expect(fog.has(6)).toBe(false);
  });

  it('every frame carries ownership + the player credits (skirmish carries neither)', () => {
    const script = build([makeUnit('pi', 0, 2)], [], { bases: { 0: 0, 10: 1 }, credits: 250 });
    expect(script.frames[0]!.bases).toEqual({ 0: 0, 10: 1 });
    expect(script.frames[0]!.credits).toBe(250);

    const skirmish = buildReplay(plains(12), [makeUnit('pi', 0, 2)], [], types, 0);
    expect(skirmish.frames[0]!.bases).toBeUndefined();
    expect(skirmish.frames[0]!.credits).toBeUndefined();
  });
});

describe('conquest replay — capture', () => {
  it('own capture: flag fx, ownership flips on the frame, "raises the colors"', () => {
    const units = [makeUnit('pr', 0, 4, 'ranger'), makeUnit('ei', 1, 11)];
    const events: ResolutionEvent[] = [
      { type: 'capture', unitId: 'pr', cell: 4, from: 1, to: 0 },
    ];
    const script = build(units, events, { bases: { 4: 1 }, credits: 100 });
    expect(script.slots.map((s) => s.kind)).toEqual(['capture']);
    const frame = script.frames[1]!;
    expect(frame.captures).toEqual([{ cell: 4, to: 0 }]);
    expect(frame.bases![4]).toBe(0);
    expect(frame.focus).toEqual([4]);
    expect(logText(script)).toContain('Ranger raises the colors');
  });

  it('enemy capture of a live-visible base shows; a mist capture stays silent but still flips', () => {
    // player infantry at 2 (sees 0..4) + owns base 0; enemy captures cell 4
    // (visible) and cell 10 (mist).
    const units = [makeUnit('pi', 0, 2), makeUnit('e1', 1, 4), makeUnit('e2', 1, 10)];
    const events: ResolutionEvent[] = [
      { type: 'capture', unitId: 'e1', cell: 4, from: null, to: 1 },
      { type: 'capture', unitId: 'e2', cell: 10, from: null, to: 1 },
      { type: 'income', faction: 0, bases: 1, amount: 100, creditsAfter: 200 },
    ];
    const script = build(units, events, { bases: { 0: 0, 4: null, 10: null }, credits: 100 });
    // one capture slot (the visible one) + the income beat
    expect(script.slots.map((s) => s.kind)).toEqual(['capture']);
    expect(logText(script)).toContain('enemy Infantry raises the colors');
    expect(logText(script)).not.toContain('e2');
    // the hidden flip still reaches later frames' ownership record
    const last = script.frames[script.frames.length - 1]!;
    expect(last.bases![10]).toBe(1);
    expect(last.bases![4]).toBe(1);
  });
});

describe('conquest replay — income', () => {
  it('own income emits a HUD tick frame + log line; enemy income shows nothing', () => {
    const units = [makeUnit('pi', 0, 2)];
    const events: ResolutionEvent[] = [
      { type: 'income', faction: 0, bases: 2, amount: 200, creditsAfter: 450 },
      { type: 'income', faction: 1, bases: 3, amount: 300, creditsAfter: 999 },
    ];
    const script = build(units, events, { bases: { 0: 0, 1: 0 }, credits: 250 });
    expect(script.frames.length).toBe(2); // establish + own income tick
    expect(script.frames[1]!.credits).toBe(450);
    expect(logText(script)).toContain('income +200 · ◈ 450');
    expect(logText(script)).not.toContain('999');
  });
});

describe('conquest replay — spawn (blind buys)', () => {
  const spawn = (
    unitId: string,
    typeKey: string,
    cell: number,
    faction: 0 | 1,
    creditsAfter: number,
  ): ResolutionEvent => ({ type: 'spawn', unitId, typeKey, cell, faction, creditsAfter });

  it('own spawn always shows: materialize fx, credits tick, creditsSpent, log', () => {
    const units = [makeUnit('pi', 0, 2)];
    const script = build(units, [spawn('ns', 'sniper', 0, 0, 50)], {
      bases: { 0: 0 },
      credits: 250,
    });
    expect(script.slots.map((s) => s.kind)).toEqual(['spawn']);
    const frame = script.frames[1]!;
    expect(frame.spawns.map((u) => u.id)).toEqual(['ns']);
    // the materializing token is fx-only on its spawn frame
    expect(frame.units.some((u) => u.id === 'ns')).toBe(false);
    expect(frame.credits).toBe(50);
    expect(script.summary.creditsSpent).toBe(types.sniper!.cost); // 200
    expect(logText(script)).toContain('Sniper musters at the base');
  });

  it('enemy spawn on an UNSEEN base is withheld entirely — no slot, frame, or log', () => {
    const units = [makeUnit('pi', 0, 2)];
    const script = build(units, [spawn('es', 'tank', 10, 1, 0)], {
      bases: { 0: 0, 10: 1 },
      credits: 100,
    });
    expect(script.slots.length).toBe(0);
    expect(script.frames.length).toBe(1); // establishing frame only
    expect(script.log.length).toBe(0);
    expect(script.summary.creditsSpent ?? 0).toBe(0); // enemy spend never counted
  });

  it('enemy spawn on a live-visible base shows (the player is watching the cell)', () => {
    const units = [makeUnit('pi', 0, 2)]; // sees 0..4
    const script = build(units, [spawn('es', 'tank', 4, 1, 0)], {
      bases: { 4: 1 },
      credits: 100,
    });
    expect(script.slots.map((s) => s.kind)).toEqual(['spawn']);
    expect(script.frames[1]!.spawns.map((u) => u.id)).toEqual(['es']);
    expect(logText(script)).toContain('enemy Tank musters at the base');
  });
});

describe('conquest replay — spawn-failed', () => {
  it('own failure shows the mandated line + a board pill', () => {
    const units = [makeUnit('pi', 0, 0)]; // standing on own base → occupied
    const events: ResolutionEvent[] = [
      { type: 'spawn-failed', cell: 0, faction: 0, unitTypeKey: 'sniper', reason: 'occupied' },
    ];
    const script = build(units, events, { bases: { 0: 0 }, credits: 250 });
    expect(script.slots.map((s) => s.kind)).toEqual(['fizzle']);
    expect(script.frames[1]!.floaters.map((f) => f.text)).toEqual(['build failed']);
    expect(logText(script)).toContain('build failed — base occupied');
  });

  it('enemy failure in the mist is withheld', () => {
    const units = [makeUnit('pi', 0, 2)];
    const events: ResolutionEvent[] = [
      { type: 'spawn-failed', cell: 10, faction: 1, unitTypeKey: 'tank', reason: 'occupied' },
    ];
    const script = build(units, events, { bases: { 10: 1 }, credits: 100 });
    expect(script.slots.length).toBe(0);
    expect(script.log.length).toBe(0);
  });
});
