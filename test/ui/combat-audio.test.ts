// @vitest-environment jsdom
// R8 (AUDIO) — the synth + the pure event→cue mapping. Asserts:
//   • the toggle defaults OFF and (through the synth) no AudioContext is touched
//     while off — a spy on the constructor stays uncalled;
//   • the event→cue mapping is correct (artillery→launch, sniper/ranged→fire,
//     melee/burst→impact, lethal floater / SETTLE dissolve→kill, WAVE_A→tick);
//   • fog-hidden events (mist strikes withhold the source ⇒ no projectile) emit
//     no fire/launch cue — only the impact the player actually sees;
//   • everything works with AudioContext STUBBED (no throw) and with it ABSENT
//     (jsdom default — guarded, no-op).
//
// These never weaken any fog/damage assertion — they read the script buildReplay
// already produces (fog-filtered) and assert cues over it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttackBreakdown, ResolutionEvent, UnitInstance } from '../../src/core/types';
import { buildReplay } from '../../src/state/replay';
import {
  CombatAudio,
  cuesForFrame,
  audioAvailable,
  loadAudioPref,
  saveAudioPref,
} from '../../src/ui/audio/combatAudio';
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
  // player = faction 0 (so faction-1 strikes can be fogged / from the mist).
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

// --- the pure event→cue mapping ----------------------------------------------

describe('R8 cuesForFrame — event→cue mapping', () => {
  it('an artillery shot (shell) maps to a LAUNCH cue (+ WAVE_A tick)', () => {
    const units = [makeUnit('pa', 0, 0, 'artillery'), makeUnit('e1', 1, 3, 'infantry')];
    const script = build(units, [attack('pa', 'e1', 0, 3, 5)]);
    const frame = script.frames.find((f) => f.wave === 'A')!;
    expect(frame.projectiles?.some((p) => p.kind === 'shell')).toBe(true);
    const cues = cuesForFrame(frame);
    expect(cues).toContain('launch');
    expect(cues).toContain('tick'); // WAVE_A reinforces dilation
    expect(cues).not.toContain('fire'); // not a tracer
  });

  it('a ranged sniper shot (tracer) maps to a FIRE cue (+ WAVE_A tick)', () => {
    const units = [makeUnit('ps', 0, 0, 'sniper'), makeUnit('e1', 1, 2, 'infantry')];
    const script = build(units, [attack('ps', 'e1', 0, 2, 5)]);
    const frame = script.frames.find((f) => f.wave === 'A')!;
    expect(frame.projectiles?.some((p) => p.kind === 'tracer')).toBe(true);
    const cues = cuesForFrame(frame);
    expect(cues).toContain('fire');
    expect(cues).toContain('tick');
    expect(cues).not.toContain('launch');
  });

  it('a melee/adjacent strike (stab) maps to an IMPACT cue, no WAVE_A tick', () => {
    const units = [makeUnit('pi', 0, 0, 'infantry'), makeUnit('e1', 1, 1, 'infantry')];
    const script = build(units, [attack('pi', 'e1', 0, 1, 5)]);
    const frame = script.frames.find((f) => f.wave === 'B')!;
    expect(frame.projectiles?.some((p) => p.kind === 'stab')).toBe(true);
    const cues = cuesForFrame(frame);
    expect(cues).toContain('impact');
    expect(cues).not.toContain('tick'); // melee is WAVE_B, not dilated
    expect(cues).not.toContain('fire');
    expect(cues).not.toContain('launch');
  });

  it('a lethal blow (kill floater) maps to a KILL cue', () => {
    // sniper drops the infantry to 0 — the floater carries category 'kill'.
    const units = [makeUnit('ps', 0, 0, 'sniper'), makeUnit('e1', 1, 2, 'infantry')];
    const events: ResolutionEvent[] = [
      attack('ps', 'e1', 0, 2, 9, { defenderCountAfter: 0 }),
      { type: 'kill', unitId: 'e1', cell: 2, faction: 1 },
    ];
    const script = build(units, events);
    const frame = script.frames.find((f) => f.wave === 'A')!;
    expect(frame.floaters.some((f) => f.category === 'kill')).toBe(true);
    expect(cuesForFrame(frame)).toContain('kill');
  });

  it('the SETTLE dissolve frame maps to a KILL cue', () => {
    const units = [makeUnit('ps', 0, 0, 'sniper'), makeUnit('e1', 1, 2, 'infantry')];
    const events: ResolutionEvent[] = [
      attack('ps', 'e1', 0, 2, 9, { defenderCountAfter: 0 }),
      { type: 'kill', unitId: 'e1', cell: 2, faction: 1 },
    ];
    const script = build(units, events);
    const settle = script.frames.find((f) => f.settle)!;
    expect(settle.kills.length).toBeGreaterThan(0);
    expect(cuesForFrame(settle)).toContain('kill');
  });

  it('a non-combat (move / establishing) frame emits NO cues', () => {
    const units = [makeUnit('pi', 0, 0, 'infantry')];
    const script = build(
      units,
      [{ type: 'move', unitId: 'pi', from: 0, to: 2, pathTaken: [1, 2] }],
    );
    for (const f of script.frames) {
      if (f.wave === undefined && (f.projectiles?.length ?? 0) === 0) {
        expect(cuesForFrame(f)).toEqual([]);
      }
    }
  });

  it('FOG-HONEST: a mist strike (source withheld) emits no FIRE/LAUNCH — only the impact the player sees', () => {
    // Player infantry at 0 (vision 2). Enemy artillery at 6 (fogged) fires at 0.
    // The player sees the impact on their own unit but NOT the firing position,
    // so the strike is `fromMist` ⇒ no projectile ⇒ no fire/launch cue (the
    // source never leaks through the ear, exactly as it never leaks on screen).
    const units = [makeUnit('pi', 0, 0, 'infantry'), makeUnit('aa', 1, 6, 'artillery')];
    const events: ResolutionEvent[] = [
      attack('aa', 'pi', 6, 0, 3, { defenderCountAfter: 7 }),
    ];
    const script = build(units, events);
    const mistFrame = script.frames.find((f) => f.floaters.some((fl) => fl.mist));
    expect(mistFrame).toBeDefined();
    if (mistFrame) {
      expect(mistFrame.projectiles?.length ?? 0).toBe(0); // source withheld
      const cues = cuesForFrame(mistFrame);
      expect(cues).not.toContain('fire');
      expect(cues).not.toContain('launch');
    }
  });

  it('de-dupes a multi-shot volley to one cue per kind', () => {
    const units = [
      makeUnit('ps', 0, 0, 'sniper'),
      makeUnit('ps2', 0, 1, 'sniper'),
      makeUnit('e1', 1, 3, 'infantry'),
      makeUnit('e2', 1, 4, 'infantry'),
    ];
    const events: ResolutionEvent[] = [
      attack('ps', 'e1', 0, 3, 4),
      attack('ps2', 'e2', 1, 4, 4),
    ];
    const script = build(units, events);
    const frame = script.frames.find((f) => f.wave === 'A')!;
    const cues = cuesForFrame(frame);
    expect(cues.filter((c) => c === 'fire')).toHaveLength(1);
  });
});

// --- the synth: toggle default + lazy/guarded AudioContext -------------------

describe('R8 CombatAudio — toggle default OFF + lazy/guarded context', () => {
  it('the persisted preference defaults OFF when unset', () => {
    expect(loadAudioPref()).toBe(false);
  });

  it('saveAudioPref round-trips', () => {
    saveAudioPref(true);
    expect(loadAudioPref()).toBe(true);
    saveAudioPref(false);
    expect(loadAudioPref()).toBe(false);
  });

  it('jsdom has no AudioContext by default — audioAvailable() is false and play() no-ops', () => {
    // jsdom does not implement WebAudio, so nothing is touched and nothing throws.
    expect(audioAvailable()).toBe(false);
    const synth = new CombatAudio();
    expect(() => synth.play('fire')).not.toThrow();
    expect(() => synth.unlock()).not.toThrow();
    expect(synth.created).toBe(false); // no context ever created
  });

  it('with a STUBBED AudioContext, play() lazily creates exactly one context', () => {
    const ctor = vi.fn(() => makeStubCtx());
    vi.stubGlobal('AudioContext', ctor as unknown as typeof AudioContext);
    const synth = new CombatAudio();

    // Not created until the first cue (lazy, first-gesture contract).
    expect(synth.created).toBe(false);
    expect(ctor).not.toHaveBeenCalled();

    synth.play('fire');
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(synth.created).toBe(true);

    // A second cue REUSES the context — still one construction.
    synth.play('kill');
    expect(ctor).toHaveBeenCalledTimes(1);

    synth.dispose();
    expect(synth.created).toBe(false);
  });

  it('every cue kind builds a voice without throwing (stubbed context)', () => {
    vi.stubGlobal('AudioContext', vi.fn(() => makeStubCtx()) as unknown as typeof AudioContext);
    const synth = new CombatAudio();
    for (const cue of ['fire', 'launch', 'impact', 'kill', 'tick'] as const) {
      expect(() => synth.play(cue)).not.toThrow();
    }
    synth.dispose();
  });

  it('playFrame with the toggle wiring stays a no-op when AudioContext is absent', () => {
    // No stub — jsdom has no AudioContext.
    const synth = new CombatAudio();
    const units = [makeUnit('ps', 0, 0, 'sniper'), makeUnit('e1', 1, 2, 'infantry')];
    const script = build(units, [attack('ps', 'e1', 0, 2, 5)]);
    const frame = script.frames.find((f) => f.wave === 'A')!;
    expect(() => synth.playFrame(frame)).not.toThrow();
    expect(synth.created).toBe(false);
  });
});

// A minimal WebAudio stub — just enough surface for the synth's voices. Every
// node method is a no-op recorder so no real sound is produced (and nothing
// throws under the node graph the synth builds).
function makeStubCtx() {
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  });
  const node = () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  });
  const ctx = {
    state: 'running' as AudioContextState,
    currentTime: 0,
    sampleRate: 44100,
    destination: node(),
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    createGain: vi.fn(() => ({ ...node(), gain: param() })),
    createOscillator: vi.fn(() => ({
      ...node(),
      type: 'sine',
      frequency: param(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    })),
    createBiquadFilter: vi.fn(() => ({
      ...node(),
      type: 'lowpass',
      frequency: param(),
    })),
    createBufferSource: vi.fn(() => ({
      ...node(),
      buffer: null,
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    })),
    createBuffer: vi.fn((_ch: number, len: number) => ({
      getChannelData: vi.fn(() => new Float32Array(len)),
    })),
  };
  return ctx as unknown as AudioContext;
}
