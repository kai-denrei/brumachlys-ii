// combatAudio.ts — R8 (AUDIO), the final combat-readability phase. A tiny
// WebAudio SYNTH with ZERO assets: every cue is built from oscillators + gain
// envelopes at play time, so nothing is fetched and nothing is bundled.
//
// THE CONTRACT (spec §11, adaptation plan R8):
//   • Distinct synth cues for the four combat verbs the eye struggles to
//     sequence — ranged/sniper FIRE, artillery LAUNCH, IMPACT, and a separate
//     gold-moment KILL tone — plus a soft per-hit TICK during WAVE A that
//     reinforces the time-dilation through the ear (and optionally the analog
//     clock crossing a tick mark).
//   • Created on the FIRST user gesture (the resolve/commit trigger or the first
//     played frame), per browser autoplay policy — the AudioContext is LAZY.
//   • Gated behind a toggle that defaults OFF; while OFF no AudioContext is ever
//     created and no sound plays.
//   • A pure UI side-effect — it reads the replay script + cursor, never writes
//     game state, never affects determinism/outcomes/the frame data. It lives in
//     ui/ (NOT core/board/ai), so purity is unaffected.
//   • Fog-honest: cues derive from the SAME shown FX the frame already carries
//     (projectiles/floaters/bursts are pre-filtered through the player's fog in
//     state/replay.ts), so a hidden event is never voiced.
//   • Guarded for environments without AudioContext (jsdom / tests): every entry
//     point no-ops rather than throwing.
//
// The `cuesForFrame` mapper is PURE and exported on its own so the event→cue
// mapping is unit-testable with no AudioContext at all.

import type { ReplayFrame } from '../../state/replay';

/** The distinct combat cues (spec §11). Each maps to one synth voice. */
export type CombatCue =
  | 'fire' // ranged / sniper shot — a sharp high blip
  | 'launch' // artillery shell leaving the tube — a low rising whoomp
  | 'impact' // a round / shell landing — a noisy thud
  | 'kill' // the lethal blow — a separate gold-moment chime
  | 'tick'; // WAVE_A per-hit / clock-tick — a soft dilation tick

/** A jsdom-safe handle to whichever AudioContext constructor exists. */
type AudioCtor = typeof AudioContext;

function audioContextCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: AudioCtor;
    webkitAudioContext?: AudioCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** R8: is a WebAudio synth even possible in this environment? FALSE under jsdom /
 *  Node (no AudioContext) — every play path then no-ops. PURE probe (no ctx). */
export function audioAvailable(): boolean {
  return audioContextCtor() !== null;
}

// --- R8: the PURE event→cue mapper -------------------------------------------
// Derive the cue list for ONE shown replay frame from the FX it already carries.
// Fog-honesty is inherited for free: projectiles exist only for source-revealed
// (non-mist) strikes, and floaters/bursts only for shown combat — a hidden event
// contributes no FX, hence no cue. NOTHING here reads game state or mutates the
// frame; it is a read-only projection, so it is safe to call every frame.
//
// Mapping (spec §11):
//   • a `shell`  projectile      → 'launch' (artillery leaving the tube)
//   • a `tracer` projectile      → 'fire'   (ranged / sniper shot)
//   • a `stab`   projectile      → 'impact' (melee connects — no separate "fire")
//   • a brawl `burst`            → 'impact' (the clash lands)
//   • a `kill` floater OR a SETTLE-frame dissolve (frame.kills) → 'kill'
//   • each WAVE_A shown strike   → a 'tick' (per-hit dilation reinforcement)
//
// De-duped per kind so a five-sniper volley voices ONE 'fire', not five (the
// synth caps simultaneous voices anyway, but de-duping keeps the read clean).
export function cuesForFrame(frame: ReplayFrame): CombatCue[] {
  const cues = new Set<CombatCue>();

  for (const p of frame.projectiles ?? []) {
    if (p.kind === 'shell') cues.add('launch');
    else if (p.kind === 'tracer') cues.add('fire');
    else cues.add('impact'); // stab — the melee blow lands
  }

  // A brawl clash burst reads as an impact (the projectiles already cover the
  // ranged/melee motions; bursts are the same-cell mutual clash).
  if ((frame.bursts?.length ?? 0) > 0) cues.add('impact');

  // KILL — the gold moment. A lethal floater carries category 'kill' on the beat
  // the killing blow lands; the SETTLE frame carries the dissolve (frame.kills).
  const lethalFloater = (frame.floaters ?? []).some((f) => f.category === 'kill');
  if (lethalFloater || (frame.kills?.length ?? 0) > 0) cues.add('kill');

  // WAVE_A per-hit ticks (spec §11): reinforce the dilation through the ear. One
  // tick for a WAVE_A combat frame that landed at least one shown strike (a
  // projectile is the witnessed-strike proxy; a mist beat has none → no tick, so
  // ticks stay fog-honest too).
  if (frame.wave === 'A' && (frame.projectiles?.length ?? 0) > 0) cues.add('tick');

  return [...cues];
}

// --- R8: the WebAudio synth --------------------------------------------------
// Lazy: the AudioContext is created on the FIRST cue (or explicit unlock), never
// before — and only when audio is ON. Voices are capped so a dense beat never
// stacks into a wall of sound. Every method is a no-op when audio is unavailable
// (jsdom) or the context could not be created.

/** Max simultaneous voices — a dense beat de-bounces down to this ceiling. */
const MAX_VOICES = 6;
/** Per-cue minimum spacing (ms): a second cue of the SAME kind inside this
 *  window is dropped, so a rapid 2× replay can't machine-gun one voice. */
const CUE_DEBOUNCE_MS: Record<CombatCue, number> = {
  fire: 40,
  launch: 60,
  impact: 50,
  kill: 80,
  tick: 30,
};

export class CombatAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private active = 0;
  private lastAt: Partial<Record<CombatCue, number>> = {};

  /** Lazily create (or resume) the AudioContext. Called on the first gesture /
   *  first cue. Returns the live context, or null if audio is unavailable or the
   *  context could not be created (jsdom guard — never throws). */
  private ensure(): AudioContext | null {
    if (this.ctx) {
      // Autoplay policy: a context created before a gesture may start suspended.
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const Ctor = audioContextCtor();
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32; // headroom — never clips on a dense beat
      this.master.connect(this.ctx.destination);
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
      return this.ctx;
    } catch {
      this.ctx = null;
      this.master = null;
      return null;
    }
  }

  /** Unlock the context on a user gesture (commit/resolve trigger or first play)
   *  WITHOUT making a sound — primes it so the first real cue is instant. No-op
   *  when audio is unavailable. */
  unlock(): void {
    this.ensure();
  }

  /** True once a context exists — TESTS assert this stays false while the toggle
   *  is OFF (the App must not call any play/unlock path then). */
  get created(): boolean {
    return this.ctx !== null;
  }

  /** Tear down the context (toggle → OFF, or unmount). Safe to call repeatedly. */
  dispose(): void {
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.active = 0;
    this.lastAt = {};
    if (ctx) void ctx.close().catch(() => {});
  }

  /** Play a single cue. Lazily creates the context on the first call. De-bounces
   *  repeats of the same cue and caps simultaneous voices. No-op (never throws)
   *  when audio is unavailable. The `speed` (replay multiplier) shortens the
   *  envelopes so a 2× pass sounds tighter, never lagging behind the visuals. */
  play(cue: CombatCue, speed = 1): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const ms = now * 1000;
    const last = this.lastAt[cue];
    if (last !== undefined && ms - last < CUE_DEBOUNCE_MS[cue]) return;
    if (this.active >= MAX_VOICES) return;
    this.lastAt[cue] = ms;
    try {
      this.voice(ctx, this.master, cue, now, speed > 0 ? speed : 1);
    } catch {
      // A failed voice must never break playback.
    }
  }

  /** Play every cue for a shown frame (the App's per-frame entry point). Reads
   *  the PURE cuesForFrame mapping — fog-honest by construction. No-op when off /
   *  unavailable. */
  playFrame(frame: ReplayFrame, speed = 1): void {
    if (!audioAvailable()) return;
    for (const cue of cuesForFrame(frame)) this.play(cue, speed);
  }

  /** Build + schedule one synth voice. Pure oscillator/gain envelopes — ZERO
   *  assets. Each cue is a distinct timbre so the ear can tell them apart. */
  private voice(
    ctx: AudioContext,
    out: GainNode,
    cue: CombatCue,
    t0: number,
    speed: number,
  ): void {
    const dur = this.cueDuration(cue) / speed;
    const g = ctx.createGain();
    g.connect(out);
    this.active += 1;
    const release = () => {
      this.active = Math.max(0, this.active - 1);
    };

    if (cue === 'impact') {
      // IMPACT — a short noise thud through a low-pass: a round/shell landing.
      const buffer = this.noiseBuffer(ctx, dur);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(900, t0);
      lp.frequency.exponentialRampToValueAtTime(180, t0 + dur);
      src.connect(lp);
      lp.connect(g);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.9, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.onended = release;
      src.start(t0);
      src.stop(t0 + dur);
      return;
    }

    // Tonal cues — one oscillator with a pitch sweep + AD envelope.
    const osc = ctx.createOscillator();
    osc.connect(g);
    const env = (peak: number, attack = 0.005) => {
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    };

    if (cue === 'fire') {
      // FIRE — a bright, fast downward blip (a snap of a rifle/sniper round).
      osc.type = 'square';
      osc.frequency.setValueAtTime(1320, t0);
      osc.frequency.exponentialRampToValueAtTime(540, t0 + dur);
      env(0.5);
    } else if (cue === 'launch') {
      // LAUNCH — a low RISING whoomp (the shell leaving the tube, then arcing).
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(110, t0);
      osc.frequency.exponentialRampToValueAtTime(330, t0 + dur);
      env(0.6, 0.02);
    } else if (cue === 'kill') {
      // KILL — a clean gold-moment chime (a higher, longer, bell-like sine).
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t0);
      osc.frequency.exponentialRampToValueAtTime(1320, t0 + dur * 0.4);
      env(0.55, 0.008);
    } else {
      // TICK — a soft, short dilation tick (a felt mallet, low triangle).
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, t0);
      env(0.22);
    }

    osc.onended = release;
    osc.start(t0);
    osc.stop(t0 + dur);
  }

  private cueDuration(cue: CombatCue): number {
    switch (cue) {
      case 'fire':
        return 0.12;
      case 'launch':
        return 0.22;
      case 'impact':
        return 0.16;
      case 'kill':
        return 0.5;
      case 'tick':
        return 0.05;
    }
  }

  /** A short white-noise buffer for the impact thud (built at play time — still
   *  zero assets, it's synthesised here). */
  private noiseBuffer(ctx: AudioContext, dur: number): AudioBuffer {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
}

// --- R8: the toggle (OFF by default, persisted) ------------------------------
// localStorage-backed so the player's choice survives reloads. OFF by default —
// the first time the game runs there is no key, so audio is silent until the
// player turns it on. Guarded for environments without localStorage (jsdom can
// have it, Node may not).

const AUDIO_PREF_KEY = 'brumachlys.audio';

/** Read the persisted audio preference. Defaults to FALSE (off) when unset or
 *  when storage is unavailable. PURE-ish (reads storage only). */
export function loadAudioPref(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(AUDIO_PREF_KEY) === 'on';
  } catch {
    return false;
  }
}

/** Persist the audio preference. No-op when storage is unavailable. */
export function saveAudioPref(on: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(AUDIO_PREF_KEY, on ? 'on' : 'off');
  } catch {
    // storage blocked (private mode etc.) — preference simply won't persist.
  }
}
