// rng.ts — mulberry32: a small, fast, seedable PRNG. PURE.
// Ported from oskar-procedure src/rng.js. (The game core gets its own rng in
// src/core/rng.ts at P3 — this copy is the board kernel's internal stream.)
//
// Returns a function () -> float in [0, 1). Same seed => same sequence.
// NOTE: oskar-procedure's `randomSeed()` (wall-clock-based) is intentionally
// NOT ported — fresh seeds are the UI layer's job (spec §4.3).

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
