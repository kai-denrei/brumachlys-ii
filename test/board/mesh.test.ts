// mesh.test.ts — kernel pipeline tests ported from oskar-procedure
// tests/grid.test.mjs (node:test → vitest). Validate the full pipeline:
//   poisson seed -> triangulate+filter -> merge -> subdivide -> winding -> relax
// over several seeds, plus the two surfaced risks:
//   risk 1 — relaxation must REDUCE a squareness-error metric (CW/CCW ordering).
//   risk 2 — subdivided mesh must be watertight (interior edges shared by exactly 2 quads).

import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/board/rng';
import { poissonDisk } from '../../src/board/poisson';
import { generateMesh, relax, type Mesh, type Quad } from '../../src/board/grid';
import { sub } from '../../src/board/vec';
import type { Vec2 } from '../../src/board/types';

const SEEDS = [1, 42, 1337, 2024, 7];

// --- helpers ---------------------------------------------------------------

const isFinitePt = (p: Vec2) => Number.isFinite(p[0]) && Number.isFinite(p[1]);
const allFinite = (vertices: Vec2[]) => vertices.every(isFinitePt);

function polyArea(pts: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

const quadPts = (mesh: Mesh, quad: Quad): Vec2[] => quad.map((vi) => mesh.vertices[vi]!);

// Squareness error: mean over quads of variance of the 4 edge lengths
// PLUS mean over corners of |interior angle - 90deg|. Lower = more square.
function squarenessError(mesh: Mesh): number {
  let total = 0;
  for (const q of mesh.quads) {
    const p = quadPts(mesh, q);
    const lens: number[] = [];
    for (let i = 0; i < 4; i++) {
      const d = sub(p[(i + 1) % 4]!, p[i]!);
      lens.push(Math.hypot(d[0], d[1]));
    }
    const meanLen = (lens[0]! + lens[1]! + lens[2]! + lens[3]!) / 4;
    let varLen = 0;
    for (const l of lens) varLen += (l - meanLen) ** 2;
    varLen /= 4;
    let angErr = 0;
    for (let i = 0; i < 4; i++) {
      const a = sub(p[(i - 1 + 4) % 4]!, p[i]!);
      const b = sub(p[(i + 1) % 4]!, p[i]!);
      const la = Math.hypot(a[0], a[1]);
      const lb = Math.hypot(b[0], b[1]);
      if (la < 1e-12 || lb < 1e-12) continue;
      let c = (a[0] * b[0] + a[1] * b[1]) / (la * lb);
      c = Math.max(-1, Math.min(1, c));
      angErr += Math.abs(Math.acos(c) - Math.PI / 2);
    }
    total += varLen + angErr * 0.001;
  }
  return total / Math.max(1, mesh.quads.length);
}

// --- tests -----------------------------------------------------------------

describe('poisson', () => {
  it('deterministic, in-bounds (inset), several points', () => {
    const pts = poissonDisk(mulberry32(42), { r: 0.1, k: 30 });
    expect(pts.length).toBeGreaterThan(5);
    for (const p of pts) {
      expect(isFinitePt(p)).toBe(true);
      // inset: ·0.85 + 0.075 maps [0,1] -> [0.075, 0.925]
      expect(p[0]).toBeGreaterThanOrEqual(0.075 - 1e-9);
      expect(p[0]).toBeLessThanOrEqual(0.925 + 1e-9);
      expect(p[1]).toBeGreaterThanOrEqual(0.075 - 1e-9);
      expect(p[1]).toBeLessThanOrEqual(0.925 + 1e-9);
    }
    expect(poissonDisk(mulberry32(42), { r: 0.1, k: 30 })).toEqual(pts);
  });
});

describe.each(SEEDS)('mesh pipeline (seed %i)', (seed) => {
  it('all faces are quads after subdivision', () => {
    const mesh = generateMesh({ seed });
    expect(mesh.quads.length).toBeGreaterThan(0);
    for (const q of mesh.quads) {
      expect(q.length).toBe(4);
      for (const vi of q) {
        expect(Number.isInteger(vi) && vi >= 0 && vi < mesh.vertices.length).toBe(true);
      }
    }
  });

  it('no NaN/Infinite coords before and after relax', () => {
    const mesh = generateMesh({ seed });
    expect(allFinite(mesh.vertices)).toBe(true);
    relax(mesh, { n_iters: 100 });
    expect(allFinite(mesh.vertices)).toBe(true);
  });

  it('no zero-area quads after relax', () => {
    const mesh = generateMesh({ seed });
    relax(mesh, { n_iters: 100 });
    const SIDE_LENGTH = 0.06;
    const eps = (SIDE_LENGTH / 10) ** 2; // 1% of target square area
    for (const q of mesh.quads) {
      expect(polyArea(quadPts(mesh, q))).toBeGreaterThan(eps);
    }
  });

  it('watertight: interior edges shared by exactly 2 quads', () => {
    const mesh = generateMesh({ seed });
    const counts = new Map<string, number>();
    for (const q of mesh.quads) {
      for (let i = 0; i < 4; i++) {
        const a = q[i]!;
        const b = q[(i + 1) % 4]!;
        const key = Math.min(a, b) + '-' + Math.max(a, b);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    for (const c of counts.values()) {
      expect(c === 1 || c === 2).toBe(true);
    }
  });

  it('relaxation reduces squareness error', () => {
    const mesh = generateMesh({ seed });
    const before = squarenessError(mesh);
    relax(mesh, { n_iters: 100 });
    const after = squarenessError(mesh);
    expect(after).toBeLessThan(before);
    expect(Number.isFinite(after)).toBe(true);
  });
});

describe('mesh determinism & winding', () => {
  it('same seed -> identical mesh; different seeds -> different', () => {
    const a = generateMesh({ seed: 42 });
    const b = generateMesh({ seed: 42 });
    expect(a.vertices).toEqual(b.vertices);
    expect(a.quads).toEqual(b.quads);

    const c = generateMesh({ seed: 43 });
    const differs =
      JSON.stringify(c.vertices) !== JSON.stringify(a.vertices) ||
      JSON.stringify(c.quads) !== JSON.stringify(a.quads);
    expect(differs).toBe(true);
  });

  it('all quads CCW (positive signed area)', () => {
    const mesh = generateMesh({ seed: 42 });
    for (const q of mesh.quads) {
      const p = quadPts(mesh, q);
      let signed = 0;
      for (let i = 0; i < 4; i++) {
        const cur = p[i]!;
        const nxt = p[(i + 1) % 4]!;
        signed += cur[0] * nxt[1] - nxt[0] * cur[1];
      }
      expect(signed).toBeGreaterThan(0);
    }
  });
});
