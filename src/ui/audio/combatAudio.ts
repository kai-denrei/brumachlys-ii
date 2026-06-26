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
  // Phase 3 (DILATION AUDIO): a lazy convolver IMPULSE RESPONSE shared by the
  // dilation `whoom` + decelerating ticks (built once on first dilation cue —
  // still zero assets, it's synthesised here like the SOURCE's IR buffer).
  private ir: AudioBuffer | null = null;
  // The SUSTAINED low drone (~46 Hz sine) — the module's first sustained voice.
  // Tracked so stopDrone() releases it and dispose() never leaks an oscillator.
  private drone: { osc: OscillatorNode; gain: GainNode } | null = null;

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

  /** Tear down the context (toggle → OFF, or unmount). Safe to call repeatedly.
   *  Phase 3: also stops the sustained drone so disposing never leaks a running
   *  oscillator, and drops the convolver IR (rebuilt lazily next time). */
  dispose(): void {
    this.stopDrone();
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.active = 0;
    this.lastAt = {};
    this.ir = null;
    this.drone = null;
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

  // --- Phase 3 (DILATION AUDIO): the bullet-time clock voices ----------------
  // The Swiss-railway dilation clock fires these from its rAF on FORWARD play
  // only (never scrub/seek). All synthesised — zero assets — and all no-op when
  // audio is unavailable (jsdom) or the context could not be created. Ported
  // from the SOURCE: whoom() (saw 420→55 Hz + reverb), dilationTick() (square
  // pitched-down + MORE reverb as it slows), startDrone()/stopDrone() (~46 Hz
  // sine). They share the lazy convolver IR built here.

  /** Lazily build + cache the convolver impulse response (the SOURCE's noise
   *  burst with a (1−i/len)^2.6 decay). UI layer — Math.random is allowed here
   *  (the purity guard covers core/board/ai only). */
  private impulse(ctx: AudioContext): AudioBuffer | null {
    if (this.ir) return this.ir;
    try {
      const len = Math.max(1, Math.floor(ctx.sampleRate * 1.6));
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
      }
      this.ir = buf;
      return buf;
    } catch {
      return null;
    }
  }

  /** A fresh convolver node wired to the shared IR (one per voice — convolvers
   *  are cheap and a shared one can't overlap tails cleanly). Null if the IR
   *  could not be built. */
  private reverb(ctx: AudioContext): ConvolverNode | null {
    const ir = this.impulse(ctx);
    if (!ir) return null;
    const c = ctx.createConvolver();
    c.buffer = ir;
    return c;
  }

  /** WHOOM — the SHIFT handover swoop (saw 420→55 Hz over ~0.5 s) with a reverb
   *  tail. One-shot; fired once when forward play crosses INTO the shift act.
   *  `speed` (replay multiplier) tightens the envelope so a 2× pass swoops
   *  faster. No-op when audio is unavailable / off. */
  whoom(speed = 1): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const spd = speed > 0 ? speed : 1;
    try {
      const n = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(420, n);
      o.frequency.exponentialRampToValueAtTime(55, n + 0.5 / spd);
      g.gain.setValueAtTime(0.0001, n);
      g.gain.exponentialRampToValueAtTime(0.16, n + 0.05 / spd);
      g.gain.exponentialRampToValueAtTime(0.001, n + 0.6 / spd);
      o.connect(g);
      g.connect(this.master);
      // reverb tail (shared IR) into a wet send.
      const cv = this.reverb(ctx);
      if (cv) {
        const w = ctx.createGain();
        w.gain.value = 0.5;
        g.connect(cv);
        cv.connect(w);
        w.connect(this.master);
      }
      o.start(n);
      o.stop(n + 0.65 / spd);
    } catch {
      // a failed voice must never break playback.
    }
  }

  /** DILATION TICK — the decelerating bullet-time click. A square pitched DOWN
   *  and reverbed MORE as i/total rises (time grinding to a crawl). Distinct
   *  from the per-hit `tick` cue (felt-mallet triangle): this is the CLOCK's
   *  mechanical second-hand click. Fired once per NEW clock-tick index on
   *  forward play. No-op when off / unavailable. */
  dilationTick(i: number, total: number, speed = 1): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const spd = speed > 0 ? speed : 1;
    const denom = Math.max(1, total - 1);
    const frac = Math.max(0, Math.min(1, i / denom));
    try {
      const n = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      // ticks LOWER as time grinds (220 → 150 Hz across the window).
      const fHz = 220 + (150 - 220) * frac;
      o.type = 'square';
      o.frequency.setValueAtTime(fHz, n);
      o.frequency.exponentialRampToValueAtTime(fHz * 0.6, n + 0.06 / spd);
      g.gain.setValueAtTime(0.14, n);
      g.gain.exponentialRampToValueAtTime(0.001, n + 0.1 / spd);
      o.connect(g);
      g.connect(this.master);
      // MORE reverb as it slows (0.25 → 0.7 wet).
      const cv = this.reverb(ctx);
      if (cv) {
        const w = ctx.createGain();
        w.gain.value = 0.25 + (0.7 - 0.25) * frac;
        g.connect(cv);
        cv.connect(w);
        w.connect(this.master);
      }
      o.start(n);
      o.stop(n + 0.12 / spd);
    } catch {
      // a failed voice must never break playback.
    }
  }

  /** Start the SUSTAINED low drone (~46 Hz sine, gain fades IN). The dilation
   *  bed under the slow-mo beat. Idempotent — a second call releases the prior
   *  drone first so only ONE ever runs. No-op when off / unavailable. */
  startDrone(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    this.stopDrone();
    try {
      const n = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 46;
      g.gain.setValueAtTime(0.0001, n);
      g.gain.exponentialRampToValueAtTime(0.05, n + 0.4);
      o.connect(g);
      g.connect(this.master);
      o.start(n);
      this.drone = { osc: o, gain: g };
    } catch {
      this.drone = null;
    }
  }

  /** Release the sustained drone (gain fades OUT, then the oscillator stops).
   *  Safe to call when no drone runs. */
  stopDrone(): void {
    const d = this.drone;
    this.drone = null;
    if (!d) return;
    try {
      const ctx = this.ctx;
      const n = ctx ? ctx.currentTime : 0;
      d.gain.gain.exponentialRampToValueAtTime(0.0001, n + 0.3);
      d.osc.stop(n + 0.35);
    } catch {
      // already stopped / context gone — nothing to release.
    }
  }

  /** True while the sustained drone is running — TESTS assert its lifecycle
   *  (started once at dilation, stopped at the end + on dispose). */
  get droneActive(): boolean {
    return this.drone !== null;
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
