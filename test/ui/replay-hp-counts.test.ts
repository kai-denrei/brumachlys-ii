// Bug B (2026-06-28): a unit's on-board count must change ONLY on the frame
// where its own damage is witnessed. The replay builder snapshots per-frame unit
// counts from `sim` while a combat BUCKET applies all its strikes' damage at
// once and the wave-split / regroup then orders the frames for presentation — so
// a unit hit in the WAVE_B half showed its reduced count on the earlier WAVE_A
// frame, and a unit could read its pre-combat count again on a later (greyed)
// frame. The fix re-derives each frame's counts in DISPLAY order from that
// frame's own shown strikes. Invariant asserted here: across the frames a unit
// appears in, its count is unchanged except on frames where it is a defender in
// that frame's slot strikes, where it may only drop.

import { describe, expect, it, vi, beforeAll } from 'vitest';
import { bd } from '../fixtures';
import type { ResolutionEvent, UnitInstance } from '../../src/core/types';
import { buildReplay } from '../../src/state/replay';
import type { ReplayScript } from '../../src/state/replay';
import { loadUnits } from '../../src/io/data-loader';
import { lineBoard, makeUnit } from '../core/synthetic';

const types = loadUnits();
const plains = (n: number) => lineBoard(Array(n).fill('plains'));

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function build(units: UnitInstance[], events: ResolutionEvent[], cells = 12): ReplayScript {
  return buildReplay(plains(cells), units, events, types, 0);
}

const attack = (
  attackerId: string,
  defenderId: string,
  attackerCell: number,
  defenderCell: number,
  damage: number,
  defenderCountAfter: number,
): Extract<ResolutionEvent, { type: 'attack' }> => ({
  type: 'attack',
  attackerId,
  defenderId,
  attackerCell,
  defenderCell,
  damage,
  bonusB: 0,
  defenderCountAfter,
  counterFired: false,
  breakdown: bd({ damage }),
});

/** For unit `id`, across the frames it appears in (display order), assert its
 *  count only changes on a frame where it is a struck defender, and only down. */
function assertCountInvariant(script: ReplayScript, id: string): void {
  let prev: number | undefined;
  script.frames.forEach((f, i) => {
    const u = f.units.find((x) => x.id === id);
    if (!u) return;
    const struckHere =
      f.slot >= 0 &&
      (script.slots[f.slot]?.strikes ?? []).some((s) => s.defenderId === id && s.damage > 0);
    if (prev !== undefined) {
      if (struckHere) {
        expect(u.count, `unit ${id} frame ${i}: count rose on a strike frame`).toBeLessThanOrEqual(prev);
      } else {
        expect(
          u.count,
          `unit ${id} frame ${i} (slot ${f.slot}): count changed ${prev}→${u.count} on a frame where it is NOT struck`,
        ).toBe(prev);
      }
    }
    prev = u.count;
  });
}

describe('Bug B — per-frame unit counts change only when the unit is struck', () => {
  // Mixed round: artillery hits ea (WAVE_A), a separate infantry melee hits em
  // (WAVE_B). The player infantry pi@5 (vision 2) sees both ea@7 and em@6, so
  // both enemies render. em is a bystander on the WAVE_A frame: it must read 10
  // there, NOT its post-combat 5.
  const UNITS: UnitInstance[] = [
    makeUnit('pa', 0, 4, 'artillery'),
    makeUnit('ea', 1, 7, 'infantry'),
    makeUnit('pi', 0, 5, 'infantry'),
    makeUnit('em', 1, 6, 'infantry'),
  ];
  const EVENTS: ResolutionEvent[] = [
    attack('pa', 'ea', 4, 7, 6, 4), // WAVE_A: ea 10 → 4
    attack('pi', 'em', 5, 6, 5, 5), // WAVE_B: em 10 → 5
  ];

  it('the WAVE_B defender reads full HP on the earlier WAVE_A frame (no early drop)', () => {
    const script = build(UNITS, EVENTS);
    assertCountInvariant(script, 'em');
  });

  it('the WAVE_A defender does not revert on later frames (no count rising back up)', () => {
    const script = build(UNITS, EVENTS);
    assertCountInvariant(script, 'ea');
  });

  it('every COMBAT-frame: count is non-increasing across the wave frames a unit appears in', () => {
    // Scoped to wave frames: end-of-round veterancy heals legitimately RAISE the
    // count on a (non-combat) promotion frame — see the promotion test below.
    const script = build(UNITS, EVENTS);
    for (const id of ['pa', 'ea', 'pi', 'em']) {
      let prev = Infinity;
      script.frames.forEach((f, i) => {
        if (f.wave === undefined) return;
        const u = f.units.find((x) => x.id === id);
        if (!u) return;
        expect(u.count, `unit ${id} frame ${i}: HP rose ${prev}→${u.count}`).toBeLessThanOrEqual(prev);
        prev = u.count;
      });
    }
  });
});

describe('Bug B — end-of-round promotion HEAL survives the count re-derivation', () => {
  // pi (player, always visible) takes a 4-dmg melee hit (10→6), then promotes at
  // round end: healedTo 8. The damage-only re-derivation must NOT erase the heal
  // — the promotion frame is non-combat, so its count snapshot is authoritative.
  const UNITS: UnitInstance[] = [makeUnit('pi', 0, 0, 'infantry'), makeUnit('ei', 1, 1, 'infantry')];
  const EVENTS: ResolutionEvent[] = [
    attack('ei', 'pi', 1, 0, 4, 6), // pi 10 → 6
    { type: 'promotion', unitId: 'pi', cell: 0, faction: 0, rank: 1, healedTo: 8 },
  ];

  it('the promotion frame shows the HEALED count (8), not the pre-heal 6', () => {
    const script = build(UNITS, EVENTS);
    const promoIdx = script.frames.findIndex((f) => (f.promotions?.length ?? 0) > 0);
    expect(promoIdx, 'a promotion frame should exist').toBeGreaterThanOrEqual(0);
    // damage was shown (pi dropped to 6 on the combat frame)...
    const combat = script.frames.find((f) => f.wave !== undefined);
    expect(combat?.units.find((u) => u.id === 'pi')?.count).toBe(6);
    // ...and the heal is visible from the promotion frame onward (6 → 8).
    for (let i = promoIdx; i < script.frames.length; i++) {
      const pi = script.frames[i]!.units.find((u) => u.id === 'pi');
      if (pi) expect(pi.count, `pi count on/after promotion frame ${i}`).toBe(8);
    }
  });
});
