// R4 (PROJECTILE + ATTACK MOTION primitives) — the pure half. buildReplay now
// attaches attack-motion primitives to each combat frame: crawling TRACERS and
// arcing SHELLS in WAVE_A (shared dilated envelope), melee STABS in WAVE_B with
// counters offset by ~75 ms (crossfire). Screen-shake magnitude scales with the
// beat's total damage; artillery is the biggest of the set. All derived from the
// strike data the resolver already emitted — outcomes/fog/damage are untouched.

import { describe, expect, it } from 'vitest';
import type {
  AttackBreakdown,
  ResolutionEvent,
  UnitInstance,
} from '../../src/core/types';
import { buildReplay, shakeMagnitude } from '../../src/state/replay';
import {
  WAVE_A_SHELL_IMPACT,
  WAVE_A_TRACER_IMPACT,
  WAVE_B_COUNTER_OFFSET,
} from '../../src/state/replay-timing';
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

function build(units: UnitInstance[], events: ResolutionEvent[], cells = 14) {
  return buildReplay(plains(cells), units, events, types, 0);
}

const attack = (
  attackerId: string,
  defenderId: string,
  attackerCell: number,
  defenderCell: number,
  damage: number,
  extra: Partial<Extract<ResolutionEvent, { type: 'attack' }>> = {},
): Extract<ResolutionEvent, { type: 'attack' }> => ({
  type: 'attack',
  attackerId,
  defenderId,
  attackerCell,
  defenderCell,
  damage,
  bonusB: 0,
  defenderCountAfter: 5,
  counterFired: false,
  breakdown: bd({ damage }),
  ...extra,
});

/** The first combat frame of the requested wave. */
const waveFrame = (
  script: ReturnType<typeof build>,
  wave: 'A' | 'B',
) => script.frames.find((f) => f.wave === wave);

describe('R4 — ranged tracer (WAVE_A)', () => {
  it('a ranged strike yields a tracer with a crawl window ending ~0.80', () => {
    // sniper at 0 fires at distance 2 → ranged → WAVE_A
    const script = build(
      [makeUnit('ps', 0, 0, 'sniper'), makeUnit('e1', 1, 2, 'infantry')],
      [attack('ps', 'e1', 0, 2, 5)],
    );
    const a = waveFrame(script, 'A')!;
    expect(a.projectiles).toBeDefined();
    const tracer = a.projectiles!.find((p) => p.kind === 'tracer')!;
    expect(tracer).toBeDefined();
    expect(tracer.from).toBe(0);
    expect(tracer.to).toBe(2);
    expect(tracer.impact).toBeCloseTo(WAVE_A_TRACER_IMPACT, 5);
    expect(tracer.impact).toBeCloseTo(0.8, 5);
    // WAVE_A shares the dilated envelope — no per-unit launch delay.
    expect(tracer.delay).toBe(0);
  });
});

describe('R4 — artillery shell (WAVE_A, lands late)', () => {
  it('an artillery strike yields a shell landing late ~0.88', () => {
    // artillery (minRange >= 2) fires 4 → 7 (dist 3) → artillery → WAVE_A
    const script = build(
      [makeUnit('pa', 0, 4, 'artillery'), makeUnit('ea', 1, 7, 'infantry')],
      [attack('pa', 'ea', 4, 7, 6)],
    );
    const a = waveFrame(script, 'A')!;
    const shell = a.projectiles!.find((p) => p.kind === 'shell')!;
    expect(shell).toBeDefined();
    expect(shell.impact).toBeCloseTo(WAVE_A_SHELL_IMPACT, 5);
    expect(shell.impact).toBeCloseTo(0.88, 5);
    // the shell lands LATER than a tracer would
    expect(shell.impact).toBeGreaterThan(WAVE_A_TRACER_IMPACT);
  });

  it('artillery has the BIGGEST shake of the set (at equal damage)', () => {
    expect(shakeMagnitude(9, 'artillery')).toBeGreaterThan(shakeMagnitude(9, 'ranged'));
    expect(shakeMagnitude(9, 'artillery')).toBeGreaterThan(shakeMagnitude(9, 'melee'));
  });
});

describe('R4 — bullet-time shared envelope (WAVE_A co-animation)', () => {
  it('multiple WAVE_A projectiles co-animate (all delay 0, not sequenced)', () => {
    // three snipers fire at range in the same round → three tracers in flight on
    // the same dilated clock (shared envelope), NOT staggered per-unit.
    const units = [
      makeUnit('s1', 0, 0, 'sniper'),
      makeUnit('e1', 1, 2, 'infantry'),
      makeUnit('s2', 0, 4, 'sniper'),
      makeUnit('e2', 1, 6, 'infantry'),
      makeUnit('s3', 0, 8, 'sniper'),
      makeUnit('e3', 1, 10, 'infantry'),
    ];
    const events: ResolutionEvent[] = [
      attack('s1', 'e1', 0, 2, 4),
      attack('s2', 'e2', 4, 6, 4),
      attack('s3', 'e3', 8, 10, 4),
    ];
    const script = build(units, events, 12);
    // all WAVE_A projectiles across the round
    const aProj = script.frames
      .filter((f) => f.wave === 'A')
      .flatMap((f) => f.projectiles ?? []);
    expect(aProj.length).toBe(3);
    expect(aProj.every((p) => p.kind === 'tracer')).toBe(true);
    // shared envelope: NONE is launch-delayed (they fly together)
    expect(aProj.every((p) => p.delay === 0)).toBe(true);
  });
});

describe('R4 — melee stab (WAVE_B) + crossfire counter offset', () => {
  it('a melee strike yields a stab', () => {
    // adjacent infantry 5 → 6 (dist 1) → melee → WAVE_B
    const script = build(
      [makeUnit('pi', 0, 5, 'infantry'), makeUnit('em', 1, 6, 'infantry')],
      [attack('pi', 'em', 5, 6, 5)],
    );
    const b = waveFrame(script, 'B')!;
    const stab = b.projectiles!.find((p) => p.kind === 'stab')!;
    expect(stab).toBeDefined();
    expect(stab.from).toBe(5);
    expect(stab.to).toBe(6);
    // the leading strike fires immediately (no crossfire delay)
    expect(stab.delay).toBe(0);
  });

  it('a counter carries the ~75 ms crossfire offset from the strike it answers', () => {
    // adjacent attack with a counter → two stabs, the answering one offset 75 ms
    const script = build(
      [makeUnit('pi', 0, 5, 'infantry'), makeUnit('em', 1, 6, 'infantry')],
      [
        attack('pi', 'em', 5, 6, 5, { counterFired: true }),
        {
          type: 'counter',
          attackerId: 'em',
          defenderId: 'pi',
          attackerCell: 6,
          defenderCell: 5,
          damage: 3,
          defenderCountAfter: 7,
          breakdown: bd({ damage: 3 }),
        },
      ],
    );
    const b = waveFrame(script, 'B')!;
    const stabs = b.projectiles!.filter((p) => p.kind === 'stab');
    expect(stabs.length).toBe(2);
    const lead = stabs.find((p) => p.from === 5)!;
    const counter = stabs.find((p) => p.from === 6)!;
    expect(lead.delay).toBe(0);
    expect(counter.delay).toBe(WAVE_B_COUNTER_OFFSET);
    expect(counter.delay).toBe(75);
  });

  it('a brawl return is offset too (crossfire reads as two motions)', () => {
    const units = [makeUnit('pt', 0, 3, 'tank'), makeUnit('ei', 1, 3, 'infantry')];
    const events: ResolutionEvent[] = [
      {
        type: 'brawl-exchange',
        cell: 3,
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
    const script = build(units, events, 6);
    const b = waveFrame(script, 'B')!;
    const stabs = b.projectiles!.filter((p) => p.kind === 'stab');
    expect(stabs.length).toBe(2);
    // exactly one of the pair (the return) is offset; the lead is immediate.
    const delays = stabs.map((p) => p.delay).sort((x, y) => x - y);
    expect(delays).toEqual([0, WAVE_B_COUNTER_OFFSET]);
  });
});

describe('R4 — screen-shake scales with damage', () => {
  it('shake magnitude is monotonic in total damage', () => {
    expect(shakeMagnitude(2, 'melee')).toBeGreaterThan(0);
    expect(shakeMagnitude(8, 'melee')).toBeGreaterThan(shakeMagnitude(2, 'melee'));
    expect(shakeMagnitude(0, 'melee')).toBe(0);
  });

  it('a heavier volley shakes the board more than a lighter one (built frames)', () => {
    const light = build(
      [makeUnit('pi', 0, 5, 'infantry'), makeUnit('em', 1, 6, 'infantry')],
      [attack('pi', 'em', 5, 6, 2)],
    );
    const heavy = build(
      [makeUnit('pi', 0, 5, 'infantry'), makeUnit('em', 1, 6, 'infantry')],
      [attack('pi', 'em', 5, 6, 9)],
    );
    const lb = waveFrame(light, 'B')!;
    const hb = waveFrame(heavy, 'B')!;
    expect(hb.shake!).toBeGreaterThan(lb.shake!);
  });

  it('the artillery beat shakes harder than a same-damage melee beat', () => {
    const arty = build(
      [makeUnit('pa', 0, 4, 'artillery'), makeUnit('ea', 1, 7, 'infantry')],
      [attack('pa', 'ea', 4, 7, 6)],
    );
    const melee = build(
      [makeUnit('pi', 0, 5, 'infantry'), makeUnit('em', 1, 6, 'infantry')],
      [attack('pi', 'em', 5, 6, 6)],
    );
    expect(waveFrame(arty, 'A')!.shake!).toBeGreaterThan(waveFrame(melee, 'B')!.shake!);
  });
});

describe('R4 — mist strikes withhold the projectile (source never leaks)', () => {
  it('a fire-from-the-mist strike shows the impact but no projectile', () => {
    // enemy sniper (maxRange 2) fires from a fogged cell at the player's unit.
    // The player's defender is an artillery (vision 1), so the firing cell 0 (at
    // distance 2) is outside its vision → the strike is shown (defender visible)
    // but MIST: the firing position is withheld and no projectile is emitted.
    const units = [
      makeUnit('es', 1, 0, 'sniper'), // enemy, beyond the defender's vision
      makeUnit('mine', 0, 2, 'artillery'), // player's defender, vision 1
    ];
    const events: ResolutionEvent[] = [attack('es', 'mine', 0, 2, 4)];
    const script = build(units, events, 4);
    const a = waveFrame(script, 'A');
    // The strike is WAVE_A (ranged). It is shown (defender is the player's), but
    // mist → no projectile is emitted (the firing position never leaks).
    if (a) {
      expect((a.projectiles ?? []).length).toBe(0);
    }
    // damage still applied to the player's unit (outcome unchanged)
    expect(script.summary.damageDealt[1]).toBe(4);
  });
});

describe('R4 — outcomes unchanged (projectiles are presentation only)', () => {
  it('damage, kills, and fog are identical with the projectile layer present', () => {
    const units = [
      makeUnit('ps', 0, 0, 'sniper'),
      makeUnit('e1', 1, 2, 'infantry'),
      makeUnit('pi', 0, 5, 'infantry'),
      makeUnit('em', 1, 6, 'infantry'),
    ];
    const events: ResolutionEvent[] = [
      attack('ps', 'e1', 0, 2, 5),
      attack('pi', 'em', 5, 6, 5),
    ];
    const script = build(units, events, 8);
    expect(script.summary.damageDealt).toEqual([10, 0]);
    expect(script.summary.kills).toEqual([]);
  });
});
