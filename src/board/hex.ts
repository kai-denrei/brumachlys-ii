// hex.ts — hexagonal lattice seeder (Oskar Stålberg "Variant B"). PURE.
// Ported from oskar-procedure src/hex.js. Pure geometry: NO RNG (deterministic
// by construction; the pipeline's `seed` still drives the random dissolve
// downstream in grid.ts).
//
// A triangular point lattice clipped to a hexagonal outline of `rings` rings
// around `center`. Triangular basis:
//   e1 = (spacing, 0)
//   e2 = (spacing/2, spacing·√3/2)
// A lattice node at axial coord (q, r) sits at: center + q·e1 + r·e2.
// Include every (q, r) with hex-distance max(|q|, |r|, |q+r|) ≤ rings.
//
// Ring k contributes 6·k points; total = 1 + 3·rings·(rings+1) (centered
// hexagonal numbers: rings 1→7, 2→19, 3→37, 4→61).

import type { Vec2 } from './types';

const SQRT3 = Math.sqrt(3);

export type HexLatticeParams = { rings: number; spacing?: number; center?: Vec2 };
export type HexLattice = {
  /** Lattice nodes, world units, centered on `center`. */
  points: Vec2[];
  /** Indices (into points) of the outermost ring's nodes. */
  boundary: number[];
};

// Hex (axial) distance from the origin (0,0). For axial coords this is
// max(|q|, |r|, |q+r|) — the cube-coordinate Chebyshev distance.
export function hexDistance(q: number, r: number): number {
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
}

export function hexLattice({ rings, spacing = 0.1, center = [0, 0] }: HexLatticeParams): HexLattice {
  const R = rings | 0;
  if (!(R >= 1)) {
    throw new Error(`hexLattice: rings must be an integer >= 1, got ${rings}`);
  }

  const [cx, cy] = center;
  // Triangular basis vectors.
  const e1x = spacing;
  const e1y = 0;
  const e2x = spacing / 2;
  const e2y = (spacing * SQRT3) / 2;

  const points: Vec2[] = [];
  const boundary: number[] = [];

  // Walk axial coords. For a hexagon of radius R the valid q-range is [-R, R];
  // for each q the r-range is clamped so hex-distance stays ≤ R.
  for (let q = -R; q <= R; q++) {
    const rLo = Math.max(-R, -q - R);
    const rHi = Math.min(R, -q + R);
    for (let r = rLo; r <= rHi; r++) {
      const x = cx + q * e1x + r * e2x;
      const y = cy + q * e1y + r * e2y;
      const idx = points.length;
      points.push([x, y]);
      if (hexDistance(q, r) === R) boundary.push(idx);
    }
  }

  return { points, boundary };
}
