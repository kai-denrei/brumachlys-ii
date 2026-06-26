// R6 (DEFERRED DISSOLVE + real SETTLE frame) — the pure builder half. A unit
// killed during the combat WAVES does NOT dissolve at its kill frame: it enters
// a DOOMED visual HOLD (greyed + a death glyph, never a "0") that persists
// through the remaining wave frames, then DISSOLVES in a dedicated SETTLE beat
// appended after the waves. Brawl/crossfire mutual deaths fall TOGETHER in that
// SETTLE beat. The board resaturates in SETTLE (spotlight released), and the
// income/upkeep LEDGER ticks play LAST (after SETTLE).
//
// ADAPTED NOTE (this codebase): posthumous is OFF — a dead unit never acts after
// death. The DOOMED hold is purely the deferred visual FALL, not a deferred
// action; there is no 0-HP-still-attacking state. Casualty accounting /
// outcomes / fog / damage MUST be unchanged from R1–R5; only the TIMING of the
// visible dissolve moves to SETTLE.

import { describe, expect, it } from 'vitest';
import type {
  AttackBreakdown,
  ResolutionEvent,
  UnitInstance,
} from '../../src/core/types';
import { buildReplay, spotlightAt } from '../../src/state/replay';
import { REPLAY_PHASE_DURATIONS } from '../../src/state/replay-timing';
import { loadUnits } from '../../src/io/data-loader';
import { lineBoard, makeUnit } from '../core/synthetic';

const types = loadUnits();
const plains = (n: number) => lineBoard(Array(n).fill('plains'));

const bd = (over: Partial<AttackBreakdown> = {}): AttackBreakdown => ({
  A: 5,
  Ta: 0,
  D: 6,
  Td: 0,
  B: 0,
  vet: 0,
  p: 0.45,
  damage: 5,
  gangUp: { total: 0, contributions: [] },
  ...over,
});

function build(units: UnitInstance[], events: ResolutionEvent[], cells = 12) {
  return buildReplay(plains(cells), units, events, types, 0);
}

/** Index of the appended SETTLE beat (the one frame flagged `settle`). */
const settleIdx = (frames: { settle?: boolean }[]) =>
  frames.findIndex((f) => f.settle === true);

describe('R6 buildReplay — deferred dissolve: DOOMED hold then SETTLE dissolve', () => {
  it('a unit killed in a wave does NOT dissolve on its kill frame (no kills until SETTLE)', () => {
    // Sniper at 0 kills the enemy infantry at 2 (ranged, WAVE_A).
    const units = [makeUnit('ps', 0, 0, 'sniper'), makeUnit('e1', 1, 2, 'infantry')];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'ps',
        defenderId: 'e1',
        attackerCell: 0,
        defenderCell: 2,
        damage: 10,
        bonusB: 0,
        defenderCountAfter: 0,
        counterFired: false,
        breakdown: bd({ damage: 10 }),
      },
      { type: 'kill', unitId: 'e1', cell: 2, faction: 1 },
    ];
    const script = build(units, events);
    const si = settleIdx(script.frames);
    expect(si).toBeGreaterThan(0); // a SETTLE beat exists
    // No wave/combat frame carries the dissolve (kills) anymore.
    for (let i = 0; i < si; i++) {
      expect(script.frames[i]!.kills).toEqual([]);
    }
    // The dissolve lands on the SETTLE beat.
    expect(script.frames[si]!.kills.map((k) => k.id)).toEqual(['e1']);
  });

  it('the killed unit shows DOOMED (snapshot) on the wave frame after its death — never a 0-count token', () => {
    const units = [makeUnit('ps', 0, 0, 'sniper'), makeUnit('e1', 1, 2, 'infantry')];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'ps',
        defenderId: 'e1',
        attackerCell: 0,
        defenderCell: 2,
        damage: 10,
        bonusB: 0,
        defenderCountAfter: 0,
        counterFired: false,
        breakdown: bd({ damage: 10 }),
      },
      { type: 'kill', unitId: 'e1', cell: 2, faction: 1 },
    ];
    const script = build(units, events);
    const waveFrame = script.frames.find((f) => f.wave !== undefined)!;
    // The dead unit rides `doomed` (a snapshot), NOT `units` (living only).
    expect(waveFrame.doomed?.map((u) => u.id)).toEqual(['e1']);
    expect(waveFrame.units.some((u) => u.id === 'e1')).toBe(false);
    // It dissolves later, in SETTLE — not on this wave frame.
    expect(waveFrame.kills).toEqual([]);
  });

  it('DOOMED persists through ALL remaining wave frames (killed in A, still doomed in B)', () => {
    // ps (sniper) kills e1 at range (WAVE_A). pi (infantry) strikes em adjacent
    // (WAVE_B) — a later wave beat. The A-wave casualty must still read DOOMED
    // on the B-wave frame, then dissolve in SETTLE.
    const units = [
      makeUnit('ps', 0, 0, 'sniper'),
      makeUnit('e1', 1, 2, 'infantry'),
      makeUnit('pi', 0, 5, 'infantry'),
      makeUnit('em', 1, 6, 'infantry'),
    ];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'ps',
        defenderId: 'e1',
        attackerCell: 0,
        defenderCell: 2,
        damage: 10,
        bonusB: 0,
        defenderCountAfter: 0,
        counterFired: false,
        breakdown: bd({ damage: 10 }),
      },
      { type: 'kill', unitId: 'e1', cell: 2, faction: 1 },
      {
        type: 'attack',
        attackerId: 'pi',
        defenderId: 'em',
        attackerCell: 5,
        defenderCell: 6,
        damage: 5,
        bonusB: 0,
        defenderCountAfter: 5,
        counterFired: false,
        breakdown: bd({ damage: 5 }),
      },
    ];
    const script = build(units, events);
    const waveB = script.frames.find((f) => f.wave === 'B')!;
    // e1 (killed in WAVE_A) is still DOOMED while the WAVE_B beat plays.
    expect(waveB.doomed?.some((u) => u.id === 'e1')).toBe(true);
    // It still does not dissolve until SETTLE.
    expect(waveB.kills).toEqual([]);
    const si = settleIdx(script.frames);
    expect(script.frames[si]!.kills.map((k) => k.id)).toContain('e1');
  });

  it('a doomed snapshot carries its real cell + faction (so it renders in place)', () => {
    const units = [makeUnit('ps', 0, 0, 'sniper'), makeUnit('e1', 1, 2, 'infantry')];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'ps',
        defenderId: 'e1',
        attackerCell: 0,
        defenderCell: 2,
        damage: 10,
        bonusB: 0,
        defenderCountAfter: 0,
        counterFired: false,
        breakdown: bd({ damage: 10 }),
      },
      { type: 'kill', unitId: 'e1', cell: 2, faction: 1 },
    ];
    const script = build(units, events);
    const doomed = script.frames.find((f) => (f.doomed?.length ?? 0) > 0)!.doomed![0]!;
    expect(doomed.id).toBe('e1');
    expect(doomed.cell).toBe(2);
    expect(doomed.faction).toBe(1);
    expect(doomed.type).toBe('infantry');
  });
});

describe('R6 buildReplay — the real SETTLE beat', () => {
  it('appends exactly one SETTLE beat, wired to REPLAY_PHASE_DURATIONS.SETTLE', () => {
    const units = [makeUnit('ps', 0, 0, 'sniper'), makeUnit('e1', 1, 2, 'infantry')];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'ps',
        defenderId: 'e1',
        attackerCell: 0,
        defenderCell: 2,
        damage: 10,
        bonusB: 0,
        defenderCountAfter: 0,
        counterFired: false,
        breakdown: bd({ damage: 10 }),
      },
      { type: 'kill', unitId: 'e1', cell: 2, faction: 1 },
    ];
    const script = build(units, events);
    const settles = script.frames.filter((f) => f.settle === true);
    expect(settles.length).toBe(1);
    expect(settles[0]!.duration).toBe(REPLAY_PHASE_DURATIONS.SETTLE);
    // The SETTLE beat is a bookkeeping/transition beat, not a timeline slot.
    expect(settles[0]!.slot).toBe(-1);
    // It is NOT a wave frame (so the spotlight is released by then).
    expect(settles[0]!.wave).toBeUndefined();
  });

  it('the SETTLE beat lands AFTER every wave frame', () => {
    const units = [
      makeUnit('ps', 0, 0, 'sniper'),
      makeUnit('e1', 1, 2, 'infantry'),
      makeUnit('pi', 0, 5, 'infantry'),
      makeUnit('em', 1, 6, 'infantry'),
    ];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'ps',
        defenderId: 'e1',
        attackerCell: 0,
        defenderCell: 2,
        damage: 5,
        bonusB: 0,
        defenderCountAfter: 5,
        counterFired: false,
        breakdown: bd({ damage: 5 }),
      },
      {
        type: 'attack',
        attackerId: 'pi',
        defenderId: 'em',
        attackerCell: 5,
        defenderCell: 6,
        damage: 5,
        bonusB: 0,
        defenderCountAfter: 5,
        counterFired: false,
        breakdown: bd({ damage: 5 }),
      },
    ];
    const script = build(units, events);
    const si = settleIdx(script.frames);
    const lastWave = script.frames.map((f) => f.wave !== undefined).lastIndexOf(true);
    expect(si).toBeGreaterThan(lastWave);
  });

  it('a combat-less round gets NO SETTLE beat (nothing to settle / resaturate)', () => {
    const script = build([makeUnit('pi', 0, 2)], []);
    expect(settleIdx(script.frames)).toBe(-1);
  });

  it('the spotlight RELEASES on the SETTLE beat — resaturation is a visible playback beat', () => {
    // R6 fixes the R2 caveat: a combat-final round must resaturate ON the SETTLE
    // beat, not only at the planning transition. The last wave frame is still
    // spotlit; the SETTLE frame (and after) is released → full colour.
    const units = [makeUnit('ps', 0, 0, 'sniper'), makeUnit('e1', 1, 2, 'infantry')];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'ps',
        defenderId: 'e1',
        attackerCell: 0,
        defenderCell: 2,
        damage: 5,
        bonusB: 0,
        defenderCountAfter: 5,
        counterFired: false,
        breakdown: bd({ damage: 5 }),
      },
    ];
    const script = build(units, events);
    const lastWave = script.frames.map((f) => f.wave !== undefined).lastIndexOf(true);
    const si = settleIdx(script.frames);
    expect(si).toBe(lastWave + 1); // SETTLE is the FIRST post-wave frame
    expect(spotlightAt(script, lastWave).active).toBe(true); // still spotlit
    expect(spotlightAt(script, si).active).toBe(false); // resaturated in SETTLE
  });
});

describe('R6 buildReplay — mutual deaths fall together in SETTLE', () => {
  it('a brawl mutual annihilation dissolves BOTH units on the same SETTLE beat', () => {
    // A forced-crossing 1v1: both sides drop to 0 in one brawl exchange.
    const units = [makeUnit('pt', 0, 2, 'tank'), makeUnit('ei', 1, 2, 'infantry')];
    const events: ResolutionEvent[] = [
      {
        type: 'brawl-exchange',
        cell: 2,
        higherInitId: 'ei',
        lowerInitId: 'pt',
        higherInitDamageDealt: 10,
        lowerInitDamageDealt: 10,
        higherInitCountAfter: 0, // ei dies
        lowerInitCountAfter: 0, // pt dies
        higherInitBreakdown: bd({ damage: 10 }),
        lowerInitBreakdown: bd({ damage: 10 }),
      },
      { type: 'kill', unitId: 'pt', cell: 2, faction: 0 },
      { type: 'kill', unitId: 'ei', cell: 2, faction: 1 },
    ];
    const script = build(units, events);
    const si = settleIdx(script.frames);
    // Both fall TOGETHER, on the one SETTLE beat.
    expect(script.frames[si]!.kills.map((k) => k.id).sort()).toEqual(['ei', 'pt']);
    // Before SETTLE: both are DOOMED on the brawl frame, neither dissolved.
    const brawl = script.frames.find((f) => f.bursts.length > 0)!;
    expect(brawl.doomed?.map((u) => u.id).sort()).toEqual(['ei', 'pt']);
    expect(brawl.kills).toEqual([]);
  });
});

describe('R6 buildReplay — outcomes/casualties/fog/damage are UNCHANGED', () => {
  it('casualty accounting (summary.kills) is identical to the resolved order', () => {
    const units = [makeUnit('ps', 0, 0, 'sniper'), makeUnit('e1', 1, 2, 'infantry')];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'ps',
        defenderId: 'e1',
        attackerCell: 0,
        defenderCell: 2,
        damage: 10,
        bonusB: 0,
        defenderCountAfter: 0,
        counterFired: false,
        breakdown: bd({ damage: 10 }),
      },
      { type: 'kill', unitId: 'e1', cell: 2, faction: 1 },
    ];
    const script = build(units, events);
    // Casualty rows are unchanged: the kill is recorded exactly once.
    expect(script.summary.kills).toEqual([{ id: 'e1', type: 'infantry', faction: 1 }]);
    // Damage is unchanged.
    expect(script.summary.damageDealt).toEqual([10, 0]);
    // The dissolved set in SETTLE matches the casualty rows (no duplicates).
    const si = settleIdx(script.frames);
    expect(script.frames[si]!.kills.map((k) => k.id)).toEqual(['e1']);
  });

  it('FOG: a kill the player cannot see is NOT shown — no doomed, no SETTLE dissolve, no SETTLE beat', () => {
    // AI-on-AI off in the dark (synthetic). The player witnesses nothing, so the
    // round has no shown combat — and therefore no SETTLE beat at all.
    const units = [
      makeUnit('pi', 0, 0), // vision 2 → sees 0..2 only
      makeUnit('a1', 1, 9, 'infantry'),
      makeUnit('a2', 1, 10, 'infantry'),
    ];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'a1',
        defenderId: 'a2',
        attackerCell: 9,
        defenderCell: 10,
        damage: 10,
        bonusB: 0,
        defenderCountAfter: 0,
        counterFired: false,
        breakdown: bd({ damage: 10 }),
      },
      { type: 'kill', unitId: 'a2', cell: 10, faction: 1 },
    ];
    const script = build(units, events);
    expect(script.summary.kills.length).toBe(0); // learns nothing
    expect(settleIdx(script.frames)).toBe(-1); // no witnessed combat → no SETTLE
    for (const f of script.frames) {
      expect(f.doomed ?? []).toEqual([]);
      expect(f.kills).toEqual([]);
    }
  });

  it('a doomed unit is excluded from `units` on every frame (it is dead, not living)', () => {
    const units = [makeUnit('ps', 0, 0, 'sniper'), makeUnit('e1', 1, 2, 'infantry')];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'ps',
        defenderId: 'e1',
        attackerCell: 0,
        defenderCell: 2,
        damage: 10,
        bonusB: 0,
        defenderCountAfter: 0,
        counterFired: false,
        breakdown: bd({ damage: 10 }),
      },
      { type: 'kill', unitId: 'e1', cell: 2, faction: 1 },
    ];
    const script = build(units, events);
    // From the kill frame onward, the dead unit never reappears in `units`.
    const killFrameIdx = script.frames.findIndex((f) => (f.doomed?.length ?? 0) > 0);
    for (let i = killFrameIdx; i < script.frames.length; i++) {
      expect(script.frames[i]!.units.some((u) => u.id === 'e1')).toBe(false);
    }
  });
});

describe('R6 buildReplay — ledger ticks LAST (after SETTLE)', () => {
  it('income / upkeep frames come AFTER the SETTLE beat', () => {
    // Conquest mode: a combat kill, then end-of-round income + upkeep. The
    // ledger must tick AFTER the board settles (dissolve + resaturate).
    const board = plains(12);
    const units = [makeUnit('ps', 0, 0, 'sniper'), makeUnit('e1', 1, 2, 'infantry')];
    const events: ResolutionEvent[] = [
      {
        type: 'attack',
        attackerId: 'ps',
        defenderId: 'e1',
        attackerCell: 0,
        defenderCell: 2,
        damage: 10,
        bonusB: 0,
        defenderCountAfter: 0,
        counterFired: false,
        breakdown: bd({ damage: 10 }),
      },
      { type: 'kill', unitId: 'e1', cell: 2, faction: 1 },
      { type: 'income', faction: 0, bases: 1, amount: 5, creditsAfter: 15 },
      { type: 'upkeep', faction: 0, units: 1, amount: 2, creditsAfter: 13 },
    ];
    const script = buildReplay(board, units, events, types, 0, undefined, {
      bases: {},
      credits: 10,
    });
    const si = settleIdx(script.frames);
    expect(si).toBeGreaterThan(0);
    // The credits HUD ticks come after SETTLE. Find the income/upkeep frames by
    // the credits change they carry (slot -1 bookkeeping beats following SETTLE).
    const incomeIdx = script.frames.findIndex((f, i) => i > si && f.credits === 15);
    const upkeepIdx = script.frames.findIndex((f, i) => i > si && f.credits === 13);
    expect(incomeIdx).toBeGreaterThan(si);
    expect(upkeepIdx).toBeGreaterThan(incomeIdx);
    // The dissolve still happened on the SETTLE beat, before the ledger.
    expect(script.frames[si]!.kills.map((k) => k.id)).toEqual(['e1']);
  });
});
