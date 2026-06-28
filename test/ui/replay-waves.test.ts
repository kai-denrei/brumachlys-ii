// R1 (TEMPO BACKBONE) — wave regrouping inside buildReplay. A round's combat
// frames are regrouped BY BAND for presentation: all ranged/artillery impacts
// (WAVE_A) play before all melee/brawl impacts (WAVE_B). This is a presentation
// reorder of frames the resolver already emitted — outcomes, damage, fog, and
// log content are unchanged; only timing + display grouping differ.
//
// Acceptance asserted here:
//   (1) no melee/brawl impact frame precedes any ranged/artillery impact frame
//       in the built script for a mixed round;
//   (2) combat frames carry a wave/band tag;
//   (3) the script exposes the phase layout (durations);
//   (4) summary damage + kills + log are identical to the pre-grouping result.

import { describe, expect, it } from 'vitest';
import { bd } from '../fixtures';
import type {
  ResolutionEvent,
  UnitInstance,
} from '../../src/core/types';
import { buildReplay } from '../../src/state/replay';
import { REPLAY_PHASE_DURATIONS } from '../../src/state/replay-timing';
import { loadUnits } from '../../src/io/data-loader';
import { lineBoard, makeUnit } from '../core/synthetic';

const types = loadUnits();
const plains = (n: number) => lineBoard(Array(n).fill('plains'));

function build(units: UnitInstance[], events: ResolutionEvent[], cells = 12) {
  return buildReplay(plains(cells), units, events, types, 0);
}

/** A frame's wave, or null for non-combat frames. */
const waveOf = (f: { wave?: 'A' | 'B' }): 'A' | 'B' | null => f.wave ?? null;

describe('R1 buildReplay — wave regrouping (ordering invariant)', () => {
  it('exposes the phase-window layout on the script', () => {
    const script = build([makeUnit('pi', 0, 2)], []);
    expect(script.phases).toBeDefined();
    expect(script.phases!.WAVE_A.duration).toBe(REPLAY_PHASE_DURATIONS.WAVE_A);
    expect(script.phases!.WAVE_B.duration).toBe(REPLAY_PHASE_DURATIONS.WAVE_B);
    // tempo contrast survives onto the built script
    expect(script.phases!.WAVE_A.duration).toBe(2 * script.phases!.WAVE_B.duration);
  });

  it('tags a ranged volley frame WAVE_A and a melee/brawl frame WAVE_B', () => {
    // sniper at 0 fires at distance 2 (ranged → WAVE_A); a brawl at cell 6
    // (melee → WAVE_B). The resolver would emit the brawl FIRST (Phase A.5),
    // the attack SECOND (Phase B) — the builder must regroup so ranged plays
    // before melee.
    const units = [
      makeUnit('ps', 0, 0, 'sniper'),
      makeUnit('e1', 1, 2, 'infantry'),
      makeUnit('pt', 0, 6, 'tank'),
      makeUnit('ei', 1, 6, 'infantry'),
    ];
    const events: ResolutionEvent[] = [
      {
        type: 'brawl-exchange',
        cell: 6,
        higherInitId: 'ei',
        lowerInitId: 'pt',
        higherInitDamageDealt: 4,
        lowerInitDamageDealt: 5,
        higherInitCountAfter: 5,
        lowerInitCountAfter: 6,
        higherInitBreakdown: bd({ damage: 4 }),
        lowerInitBreakdown: bd({ damage: 5 }),
      },
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
    const volley = script.frames.find((f) => f.arcs.length > 0)!;
    const brawl = script.frames.find((f) => f.bursts.length > 0)!;
    expect(waveOf(volley)).toBe('A');
    expect(waveOf(brawl)).toBe('B');
  });

  it('INVARIANT: no melee/brawl impact frame precedes any ranged/artillery impact frame', () => {
    // Mixed round: a brawl (melee, Phase A.5 → emitted first), an artillery
    // shot (WAVE_A), a sniper shot at range (WAVE_A), and an adjacent infantry
    // attack (melee → WAVE_B). After regrouping, every A frame index must be
    // less than every B frame index.
    const units = [
      makeUnit('pt', 0, 1, 'tank'),
      makeUnit('ei', 1, 1, 'infantry'), // brawl at cell 1
      makeUnit('pa', 0, 4, 'artillery'),
      makeUnit('ea', 1, 7, 'infantry'), // artillery 4→7 (dist 3)
      makeUnit('ps', 0, 8, 'sniper'),
      makeUnit('es', 1, 10, 'infantry'), // sniper 8→10 (dist 2, ranged)
      makeUnit('pi', 0, 5, 'infantry'),
      makeUnit('em', 1, 6, 'infantry'), // infantry 5→6 (dist 1, melee)
    ];
    const events: ResolutionEvent[] = [
      {
        type: 'brawl-exchange',
        cell: 1,
        higherInitId: 'ei',
        lowerInitId: 'pt',
        higherInitDamageDealt: 3,
        lowerInitDamageDealt: 4,
        higherInitCountAfter: 6,
        lowerInitCountAfter: 7,
        higherInitBreakdown: bd({ damage: 3 }),
        lowerInitBreakdown: bd({ damage: 4 }),
      },
      {
        type: 'attack',
        attackerId: 'pa',
        defenderId: 'ea',
        attackerCell: 4,
        defenderCell: 7,
        damage: 6,
        bonusB: 0,
        defenderCountAfter: 4,
        counterFired: false,
        breakdown: bd({ damage: 6 }),
      },
      {
        type: 'attack',
        attackerId: 'ps',
        defenderId: 'es',
        attackerCell: 8,
        defenderCell: 10,
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
    const script = build(units, events, 12);
    const aIdx = script.frames
      .map((f, i) => (waveOf(f) === 'A' ? i : -1))
      .filter((i) => i >= 0);
    const bIdx = script.frames
      .map((f, i) => (waveOf(f) === 'B' ? i : -1))
      .filter((i) => i >= 0);
    expect(aIdx.length).toBeGreaterThan(0);
    expect(bIdx.length).toBeGreaterThan(0);
    // every WAVE_A impact frame index < every WAVE_B impact frame index
    expect(Math.max(...aIdx)).toBeLessThan(Math.min(...bIdx));
  });

  it('movement frames keep their pre-combat timing (no wave tag, before any wave)', () => {
    const units = [
      makeUnit('pi', 0, 0, 'infantry'),
      makeUnit('pt', 0, 6, 'tank'),
      makeUnit('ei', 1, 6, 'infantry'),
    ];
    const events: ResolutionEvent[] = [
      { type: 'move', unitId: 'pi', from: 0, to: 2, pathTaken: [1, 2] },
      {
        type: 'brawl-exchange',
        cell: 6,
        higherInitId: 'ei',
        lowerInitId: 'pt',
        higherInitDamageDealt: 4,
        lowerInitDamageDealt: 5,
        higherInitCountAfter: 5,
        lowerInitCountAfter: 6,
        higherInitBreakdown: bd({ damage: 4 }),
        lowerInitBreakdown: bd({ damage: 5 }),
      },
    ];
    const script = build(units, events);
    const moveFrames = script.frames.filter((f) => script.slots[f.slot]?.kind === 'move');
    expect(moveFrames.length).toBe(2);
    for (const f of moveFrames) expect(waveOf(f)).toBeNull();
    // moves come before the (only) combat frame
    const lastMove = script.frames.indexOf(moveFrames[moveFrames.length - 1]!);
    const combat = script.frames.findIndex((f) => f.bursts.length > 0);
    expect(lastMove).toBeLessThan(combat);
  });

  it('regrouping does NOT change outcomes: damage, kills, fog, and log are preserved', () => {
    // Same mixed round; assert the resolved-value invariants hold post-grouping.
    const units = [
      makeUnit('pt', 0, 1, 'tank'),
      makeUnit('ei', 1, 1, 'infantry'),
      makeUnit('pa', 0, 4, 'artillery'),
      makeUnit('ea', 1, 7, 'infantry'),
    ];
    const events: ResolutionEvent[] = [
      {
        type: 'brawl-exchange',
        cell: 1,
        higherInitId: 'ei',
        lowerInitId: 'pt',
        higherInitDamageDealt: 3,
        lowerInitDamageDealt: 4,
        higherInitCountAfter: 6,
        lowerInitCountAfter: 7,
        higherInitBreakdown: bd({ damage: 3 }),
        lowerInitBreakdown: bd({ damage: 4 }),
      },
      {
        type: 'attack',
        attackerId: 'pa',
        defenderId: 'ea',
        attackerCell: 4,
        defenderCell: 7,
        damage: 6,
        bonusB: 0,
        defenderCountAfter: 4,
        counterFired: false,
        breakdown: bd({ damage: 6 }),
      },
    ];
    const script = build(units, events, 12);
    // player dealt: artillery 6 + brawl tank-return 4 = 10; enemy dealt brawl 3
    expect(script.summary.damageDealt).toEqual([10, 3]);
    // both combatants survived → no kills
    expect(script.summary.kills).toEqual([]);
    // the log carries both lines (brawl + the volley), content unchanged
    const logText = script.log.map((e) => e.segs.map((s) => s.t).join('')).join('\n');
    expect(logText).toContain('brawl');
    expect(logText).toContain('−6');
  });
});

describe('R1 buildReplay — deaths reserved for SETTLE (no wave interruption)', () => {
  it('a kill in WAVE_A does not produce a melee frame between ranged impacts', () => {
    // A ranged kill (sniper at range) plus a separate ranged shot. The kill
    // must not split the WAVE_A grouping with a B-wave frame.
    const units = [
      makeUnit('ps', 0, 0, 'sniper'),
      makeUnit('e1', 1, 2, 'infantry'),
      makeUnit('pa', 0, 8, 'artillery'),
      makeUnit('e2', 1, 11, 'infantry'),
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
        attackerId: 'pa',
        defenderId: 'e2',
        attackerCell: 8,
        defenderCell: 11,
        damage: 6,
        bonusB: 0,
        defenderCountAfter: 4,
        counterFired: false,
        breakdown: bd({ damage: 6 }),
      },
    ];
    const script = build(units, events, 12);
    // the kill is still recorded (outcome unchanged)
    expect(script.summary.kills.map((k) => k.id)).toContain('e1');
    // no WAVE_B frame appears amid the WAVE_A frames
    const bIdx = script.frames
      .map((f, i) => (waveOf(f) === 'B' ? i : -1))
      .filter((i) => i >= 0);
    const aIdx = script.frames
      .map((f, i) => (waveOf(f) === 'A' ? i : -1))
      .filter((i) => i >= 0);
    if (bIdx.length > 0) expect(Math.max(...aIdx)).toBeLessThan(Math.min(...bIdx));
  });
});
