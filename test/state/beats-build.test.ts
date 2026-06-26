// Sequencing pass (§3/§5) — buildReplay now attaches SEQUENCED beats to each
// combat frame: a leading strike + its immediate counter group into ONE beat, an
// independent strike is its own beat, a brawl is one beat, in the resolver's
// natural order. Beats are non-overlapping; dilationDepth scales them; the cap
// collapses the tail; the R7 transport stays correct with the beat-driven frame
// durations. All derived from already-resolved strikes — outcomes/fog unchanged.

import { describe, expect, it } from 'vitest';
import type {
  AttackBreakdown,
  ResolutionEvent,
  UnitInstance,
} from '../../src/core/types';
import { buildReplay, buildBeats, type Strike as _S } from '../../src/state/replay';
import {
  totalDuration,
  frameAtTime,
  frameStartTime,
  MAX_SPOTLIT_BEATS,
  BEAT_BASE_RANGED,
  INTER_BEAT_GAP,
} from '../../src/state/replay-timing';
import { loadUnits } from '../../src/io/data-loader';
import { lineBoard, makeUnit } from '../core/synthetic';

const types = loadUnits();
const plains = (n: number) => lineBoard(Array(n).fill('plains'));

const bd = (over: Partial<AttackBreakdown> = {}): AttackBreakdown => ({
  A: 5, Ta: 0, D: 6, Td: 0, B: 0, vet: 0, p: 0.45, damage: 5,
  gangUp: { total: 0, contributions: [] }, ...over,
});

function build(units: UnitInstance[], events: ResolutionEvent[], depth?: number, cells = 24) {
  return buildReplay(plains(cells), units, events, types, 0, undefined, undefined, undefined, depth);
}

const attack = (
  attackerId: string, defenderId: string,
  attackerCell: number, defenderCell: number, damage: number,
  extra: Partial<Extract<ResolutionEvent, { type: 'attack' }>> = {},
): Extract<ResolutionEvent, { type: 'attack' }> => ({
  type: 'attack', attackerId, defenderId, attackerCell, defenderCell, damage,
  bonusB: 0, defenderCountAfter: 5, counterFired: false, breakdown: bd({ damage }), ...extra,
});

const counter = (
  attackerId: string, defenderId: string,
  attackerCell: number, defenderCell: number, damage: number,
): Extract<ResolutionEvent, { type: 'counter' }> => ({
  type: 'counter', attackerId, defenderId, attackerCell, defenderCell, damage,
  defenderCountAfter: 5, breakdown: bd({ damage }),
});

const waveA = (script: ReturnType<typeof build>) => script.frames.find((f) => f.wave === 'A')!;

describe('§3.1 grouping — N independent strikes → N sequential beats', () => {
  it('three separate ranged strikes become three non-overlapping beats', () => {
    // three snipers at distinct cells, each firing at distance 2 → ranged WAVE_A
    const units = [
      makeUnit('s0', 0, 0, 'sniper'), makeUnit('e0', 1, 2, 'infantry'),
      makeUnit('s1', 0, 4, 'sniper'), makeUnit('e1', 1, 6, 'infantry'),
      makeUnit('s2', 0, 8, 'sniper'), makeUnit('e2', 1, 10, 'infantry'),
    ];
    const script = build(units, [
      attack('s0', 'e0', 0, 2, 5),
      attack('s1', 'e1', 4, 6, 5),
      attack('s2', 'e2', 8, 10, 5),
    ]);
    const a = waveA(script);
    expect(a.beats).toBeDefined();
    expect(a.beats!.length).toBe(3);
    // each beat's activeCells = that strike's attacker+defender
    expect(a.beats![0]!.activeCells).toEqual([0, 2]);
    expect(a.beats![1]!.activeCells).toEqual([4, 6]);
    expect(a.beats![2]!.activeCells).toEqual([8, 10]);
    // sequential, non-overlapping
    for (let k = 1; k < a.beats!.length; k++) {
      expect(a.beats![k]!.start).toBeGreaterThanOrEqual(
        a.beats![k - 1]!.start + a.beats![k - 1]!.dur,
      );
    }
    // frame duration = the laid-out beats' span
    const last = a.beats![a.beats!.length - 1]!;
    expect(a.duration).toBe(last.start + last.dur);
  });
});

describe('§3.1 grouping — a counter groups with its strike (one beat)', () => {
  it('an attack + its immediate counter is a SINGLE beat carrying both cells', () => {
    // sniper s0 (cell 0) hits ranger e0 (cell 2) at distance 2; e0 counters back.
    const units = [makeUnit('s0', 0, 0, 'sniper'), makeUnit('e0', 1, 2, 'ranger')];
    const script = build(units, [
      attack('s0', 'e0', 0, 2, 4, { counterFired: true }),
      counter('e0', 's0', 2, 0, 3),
    ]);
    const a = waveA(script);
    expect(a.beats!.length).toBe(1); // strike + counter = ONE beat
    // the beat's activeCells include both ends of the exchange
    expect(new Set(a.beats![0]!.activeCells)).toEqual(new Set([0, 2]));
    // the strike list still carries two strikes (the slot's breakdown)
    expect(script.slots.find((s) => s.kind === 'volley')!.strikes.length).toBe(2);
  });
});

describe('§3.1 grouping — a brawl-exchange is one beat', () => {
  it('a brawl (strike + return) is a single beat', () => {
    const units = [makeUnit('pt', 0, 2, 'tank'), makeUnit('ei', 1, 2, 'infantry')];
    const exchange: ResolutionEvent = {
      type: 'brawl-exchange', cell: 2,
      higherInitId: 'ei', lowerInitId: 'pt',
      higherInitDamageDealt: 4, lowerInitDamageDealt: 5,
      higherInitCountAfter: 5, lowerInitCountAfter: 6,
      higherInitBreakdown: bd({ damage: 4 }), lowerInitBreakdown: bd({ damage: 5 }),
    };
    const script = build(units, [exchange]);
    const brawl = script.frames.find((f) => f.bursts.length > 0)!;
    expect(brawl.beats!.length).toBe(1);
    expect(brawl.beats![0]!.activeCells).toEqual([2]); // same-cell brawl
  });
});

describe('§3.2 cap — the tail past MAX_SPOTLIT_BEATS collapses into one remainder', () => {
  it('N > MAX_SPOTLIT_BEATS strikes → MAX_SPOTLIT_BEATS + 1 beats (last is the remainder)', () => {
    const n = MAX_SPOTLIT_BEATS + 4; // 12 strikes
    const units: UnitInstance[] = [];
    const events: ResolutionEvent[] = [];
    for (let k = 0; k < n; k++) {
      const sc = k * 3; // shooter cells 0,3,6,...
      const dc = sc + 2; // distance 2 → RANGED (sniper minRange 1) → WAVE_A
      units.push(makeUnit(`s${k}`, 0, sc, 'sniper'));
      units.push(makeUnit(`e${k}`, 1, dc, 'infantry'));
      events.push(attack(`s${k}`, `e${k}`, sc, dc, 3));
    }
    const a = waveA(build(units, events, undefined, n * 3 + 4));
    // head beats are individual; the tail is collapsed to ONE remainder beat
    expect(a.beats!.length).toBe(MAX_SPOTLIT_BEATS + 1);
    const remainder = a.beats![a.beats!.length - 1]!;
    // the remainder's activeCells are the union of the collapsed tail (8 cells)
    expect(remainder.activeCells.length).toBe((n - MAX_SPOTLIT_BEATS) * 2);
    // the remainder is faster than a normal head beat
    expect(remainder.dur).toBeLessThan(a.beats![0]!.dur);
  });
});

describe('§5 dilationDepth scales combat beats — NOT movement frames', () => {
  it('a deeper depth lengthens the combat frame but leaves move frames identical', () => {
    const units = [
      makeUnit('s0', 0, 0, 'sniper'), makeUnit('e0', 1, 2, 'infantry'),
      makeUnit('m', 0, 6),
    ];
    const events: ResolutionEvent[] = [
      { type: 'move', unitId: 'm', from: 6, to: 7, pathTaken: [7] },
      attack('s0', 'e0', 0, 2, 5),
    ];
    const shallow = build(units, events, 1.0);
    const deep = build(units, events, 3.0);
    // movement frame duration is unchanged by depth
    const moveShallow = shallow.frames.find((f) => f.trails.length > 0)!;
    const moveDeep = deep.frames.find((f) => f.trails.length > 0)!;
    expect(moveDeep.duration).toBe(moveShallow.duration);
    // combat frame duration scales with depth
    expect(waveA(deep).duration).toBeGreaterThan(waveA(shallow).duration);
    expect(waveA(deep).duration).toBe(waveA(shallow).duration * 3);
  });
});

describe('§3 fog honesty — a mist beat withholds the source cell from activeCells', () => {
  it('a fire-from-the-mist strike spotlights only the defender', () => {
    // Player infantry at cell 2 (vision 2 → sees 0..4). Enemy artillery at cell
    // 10 (fogged, well outside vision) fires at the player → fire from the mist.
    const units = [makeUnit('pd', 0, 2, 'infantry'), makeUnit('ea', 1, 10, 'artillery')];
    const script = build(units, [attack('ea', 'pd', 10, 2, 4)]);
    const a = waveA(script);
    // the beat exists and its activeCells contain ONLY the witnessed defender
    expect(a.beats!.length).toBe(1);
    expect(a.beats![0]!.activeCells).toEqual([2]);
    expect(a.beats![0]!.activeCells).not.toContain(0); // firing cell never leaks
    // a mist strike has no projectile in its beat
    expect(a.beats![0]!.projectiles.length).toBe(0);
  });
});

describe('R7 transport stays correct with beat-driven frame durations', () => {
  it('totalDuration = Σ frame durations; frameAtTime/frameStartTime round-trip', () => {
    const units = [
      makeUnit('s0', 0, 0, 'sniper'), makeUnit('e0', 1, 2, 'infantry'),
      makeUnit('s1', 0, 4, 'sniper'), makeUnit('e1', 1, 6, 'infantry'),
    ];
    const script = build(units, [attack('s0', 'e0', 0, 2, 5), attack('s1', 'e1', 4, 6, 5)], 2.0);
    const total = totalDuration(script.frames);
    expect(total).toBeGreaterThan(0);
    // frameStartTime is the inverse of frameAtTime at frame boundaries
    for (let i = 0; i < script.frames.length; i++) {
      const start = frameStartTime(script.frames, i);
      expect(frameAtTime(script.frames, start)).toBe(i);
      // a point inside the frame maps back to the same frame
      const mid = start + script.frames[i]!.duration / 2;
      expect(frameAtTime(script.frames, mid)).toBe(i);
    }
    // past the end pins to the last frame
    expect(frameAtTime(script.frames, total + 1000)).toBe(script.frames.length - 1);
  });

  it('projectiles per-beat union equals the frame.projectiles list', () => {
    const units = [
      makeUnit('s0', 0, 0, 'sniper'), makeUnit('e0', 1, 2, 'infantry'),
      makeUnit('s1', 0, 4, 'sniper'), makeUnit('e1', 1, 6, 'infantry'),
    ];
    const a = waveA(build(units, [attack('s0', 'e0', 0, 2, 5), attack('s1', 'e1', 4, 6, 5)]));
    const fromBeats = a.beats!.flatMap((b) => b.projectiles);
    expect(fromBeats.length).toBe(a.projectiles!.length);
  });
});

describe('determinism — same turn → identical beats (no Math.random)', () => {
  it('two builds of the same events produce identical beats', () => {
    const units = [makeUnit('s0', 0, 0, 'sniper'), makeUnit('e0', 1, 2, 'infantry')];
    const ev = [attack('s0', 'e0', 0, 2, 5)];
    const x = waveA(build(units, ev, 1.7));
    const y = waveA(build([...units], [...ev], 1.7));
    expect(x.beats).toEqual(y.beats);
  });
});

describe('buildBeats helper (direct)', () => {
  it('groups, caps, and scales without touching strike data', () => {
    const strikes: _S[] = [];
    // 10 independent ranged strikes
    for (let k = 0; k < 10; k++) {
      strikes.push({
        kind: 'attack', attackerId: `a${k}`, attackerType: 'sniper',
        attackerCell: k * 2, attackerFaction: 0,
        defenderId: `d${k}`, defenderType: 'infantry', defenderCell: k * 2 + 1,
        defenderFaction: 1, damage: 3, fromMist: false, breakdown: bd(),
      });
    }
    const { beats } = buildBeats(strikes, 'ranged', plains(24), types, 1.0);
    expect(beats.length).toBe(MAX_SPOTLIT_BEATS + 1); // capped
    expect(beats[0]!.dur).toBe(BEAT_BASE_RANGED);
    expect(beats[1]!.start).toBe(BEAT_BASE_RANGED + INTER_BEAT_GAP);
  });
});
