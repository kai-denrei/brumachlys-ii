// Seeded deterministic RNG (xorshift32) and FNV-1a hash for tie-breaking.
// Ported near-verbatim from v1 core/rng.ts. Pure: no module-level state,
// no ambient randomness, no clock reads.
//
// Usage:
//   const rng = createRng(seed);
//   rng.next();           // u32
//   rng.nextFloat();      // [0, 1)
//   const snap = rng.clone(); // independent copy at this moment
//
// All resolver-side randomness MUST flow through this (spec §0). Combat is
// deterministic in II v1; the channel is reserved for future stochastic modes.

export type Rng = {
  state: number;
  next: () => number;
  nextFloat: () => number;
  clone: () => Rng;
};

export function createRng(seed: number): Rng {
  if (!Number.isInteger(seed) || (seed | 0) === 0) {
    throw new Error('createRng: seed must be a non-zero 32-bit integer');
  }
  // Force unsigned 32-bit.
  const initial = seed >>> 0;

  const rng = {
    state: initial,
    next(): number {
      let s = rng.state | 0;
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      rng.state = s >>> 0;
      return rng.state;
    },
    nextFloat(): number {
      // Divide by 2^32 to land in [0, 1).
      return rng.next() / 0x100000000;
    },
    clone(): Rng {
      const c = createRng(rng.state === 0 ? 1 : rng.state);
      c.state = rng.state;
      return c;
    },
  };

  return rng;
}

// FNV-1a 32-bit. Pure function. Used for initiative tie-breaking.
// Reference: http://www.isthe.com/chongo/tech/comp/fnv/
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Stable per-round tie-breaker for initiative-equal units (spec §2.2:
// hash(unitId + ":" + round), sort ascending — lower hash acts first).
export function initTieKey(unitId: string, round: number): number {
  return fnv1a32(`${unitId}:${round}`);
}
