// Pure sprite timeline: asset URLs resolve (Vite/vitest), per-unit plan is
// stable, the idle AMBIENT loop is idle-dominant (idle / sit / reload only), and
// motion-driven selection returns the right clip family for move/fire.
import { describe, expect, it } from 'vitest';
import {
  CLIPS,
  FRAME,
  spriteAmbientAt,
  spriteFrameFor,
  unitSpritePlan,
  type ClipKey,
} from '../../src/ui/skin/sprites/sprite-data';

const AMBIENT: ClipKey[] = ['idle', 'sitting', 'sittingRecharge'];
const MOVE: ClipKey[] = ['run', 'roll'];
const FIRE: ClipKey[] = ['standShoot', 'sitShoot', 'lieShoot'];

describe('sprite-data', () => {
  it('every clip resolves to a string asset URL with a real frame count', () => {
    expect(FRAME).toBe(128);
    for (const key of Object.keys(CLIPS) as ClipKey[]) {
      const c = CLIPS[key];
      expect(typeof c.url).toBe('string');
      expect(c.url.length).toBeGreaterThan(0);
      expect(c.frames).toBeGreaterThan(0);
      expect(c.fps).toBeGreaterThan(0);
    }
    expect(CLIPS.idle.frames).toBe(6);
    expect(CLIPS.sitting.frames).toBe(1); // held pose
    expect(CLIPS.run.frames).toBe(12);
    expect(CLIPS.roll.frames).toBe(8);
    expect(CLIPS.lieShoot.frames).toBe(4);
  });

  it('unitSpritePlan is stable per id and picks move=run/roll, fire=a shoot', () => {
    const a = unitSpritePlan('u-7');
    expect(a).toEqual(unitSpritePlan('u-7')); // deterministic
    expect(MOVE).toContain(a.move);
    expect(FIRE).toContain(a.fire);
  });

  it('idle ambient is idle-dominant and never plays a move/fire clip', () => {
    const counts: Record<string, number> = {};
    let total = 0;
    for (let t = 0; t < 120_000; t += 100) {
      const f = spriteAmbientAt('grunt-3', t);
      expect(AMBIENT).toContain(f.clip); // only idle / sitting / sittingRecharge
      expect(f).toEqual(spriteAmbientAt('grunt-3', t)); // pure
      expect(f.frame).toBeGreaterThanOrEqual(0);
      expect(f.frame).toBeLessThan(CLIPS[f.clip].frames);
      counts[f.clip] = (counts[f.clip] ?? 0) + 1;
      total++;
    }
    expect((counts.idle ?? 0) / total).toBeGreaterThan(0.6); // ~80% idle
  });

  it('motion drives the clip family: idle→ambient, move→run/roll, fire→shoot', () => {
    for (const id of ['a', 'soldier-9', 'x']) {
      for (let t = 0; t < 6000; t += 37) {
        expect(AMBIENT).toContain(spriteFrameFor(id, 'idle', t).clip);
        expect(MOVE).toContain(spriteFrameFor(id, 'move', t).clip);
        expect(FIRE).toContain(spriteFrameFor(id, 'fire', t).clip);
        // a moving unit always shows its ONE chosen move style (stable)
        expect(spriteFrameFor(id, 'move', t).clip).toBe(unitSpritePlan(id).move);
        const f = spriteFrameFor(id, 'fire', t);
        expect(f.frame).toBeLessThan(CLIPS[f.clip].frames);
      }
    }
  });
});
