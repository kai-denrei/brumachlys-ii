// test/fixtures.ts — shared test-kit (v1.6 refactor Phase 2).
// One home for fixtures that were copy-pasted across many test files. Every
// value here is BYTE-IDENTICAL to the per-file copies it replaces (verified by
// hashing the originals before consolidating) — no assertion was weakened and
// no replay/combat/AI vector was re-baselined. Use `assertByteIdentical` when
// refactoring a fixture to prove the output didn't drift.

import type { AttackBreakdown } from '../src/core/types';

export { makeUnit, lineBoard, syntheticBoard } from './core/synthetic';

/** Canonical AttackBreakdown fixture (was duplicated verbatim in 11 test
 *  files across test/state and test/ui — the 2 "outliers" differed only in
 *  source line-wrapping, not values). */
export const bd = (over: Partial<AttackBreakdown> = {}): AttackBreakdown => ({
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

/** Determinism seam (spec §11.3): throw unless two fixture outputs serialize
 *  to byte-identical JSON. Guards against a fixture refactor silently changing
 *  a value (the "reseed-masking" failure mode the deban log warns about). */
export function assertByteIdentical(a: unknown, b: unknown, name = 'fixture'): void {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${name} not byte-identical:\n  a=${sa}\n  b=${sb}`);
}
