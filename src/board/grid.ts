// grid.ts — mesh kernel, stages 2–5. PURE (no DOM; unit-tests in Node).
// Ported from oskar-procedure src/grid.js — algorithm, constants and RNG
// consumption order preserved exactly (determinism contract, spec §3.3).
// All coordinates live in normalized [0,1]² space. The whole pipeline is driven
// by mulberry32(seed); no unseeded randomness anywhere.
//
// Pipeline (Oskar Stålberg / andersource "organic grid"):
//   1. poisson seed (poisson.ts) or hex lattice (hex.ts)
//   2. triangulate (vendored delaunator) + drop sliver triangles
//   3. dissolve edges: greedily merge legal triangle pairs into quads
//   4. subdivide every face into quads (shared midpoints -> watertight)
//   4b. normalize winding to CCW
//   5. relax vertices toward squareness (closed-form closest-square fit) —
//      run to completion synchronously (fixed iteration count; the stepper
//      animation API of oskar-procedure was NOT ported, the game has no use
//      for it).
//
// RISK 1 note carried over from oskar-procedure (CW/CCW relaxation ordering):
//   The closed-form `alpha` derivation orders the quad corners CLOCKWISE about
//   the centroid, but stage 4b normalizes stored winding to CCW. Feeding the
//   formula CCW corners makes the relaxation fight itself. Fix: the relaxer
//   reads each quad's corners in REVERSE (CW view) before applying the formula,
//   then maps the per-corner force back to the correct CCW vertex index.
//   Verified by the "relaxation reduces squareness error" test.

import Delaunator from './vendor/delaunator.js';
import type { Vec2 } from './types';
import type { Rng } from './rng';
import { mulberry32 } from './rng';
import { poissonDisk } from './poisson';
import { hexLattice } from './hex';
import { sub, mean, cross, dot, len, dist } from './vec';

export type Quad = [number, number, number, number];
export type Tri = [number, number, number];
export type Seeder = 'poisson' | 'hex';

export type Mesh = {
  vertices: Vec2[];
  /** CCW vertex indices into `vertices`. */
  quads: Quad[];
  seed: number;
  seeder: Seeder;
  /** Vertex indices on the mesh boundary (edges used by exactly one quad). */
  boundary: number[];
};

export type GenerateMeshParams = {
  seed?: number;
  seeder?: Seeder;
  /** Poisson min spacing (drives cell count). */
  r?: number;
  /** Poisson candidate attempts per point. */
  k?: number;
  /** Hex seeder: rings. */
  rings?: number;
  /** Hex seeder: lattice spacing. */
  spacing?: number;
};

export type RelaxParams = {
  SIDE_LENGTH?: number;
  PULL_RATE?: number;
  pinned?: Set<number> | readonly number[] | null;
};

// --- constants -------------------------------------------------------------
const MAX_ANGLE = (Math.PI / 2) * 1.65; // ≈ 148.5°, drop slivers ≥ this
const QUAD_ANGLE_MIN = 0.2 * Math.PI; // 36°
const QUAD_ANGLE_MAX = 0.9 * Math.PI; // 162°

const edgeKey = (a: number, b: number): string => Math.min(a, b) + '-' + Math.max(a, b);

// --- stage 2: triangulate + filter ----------------------------------------
function triangulate(points: Vec2[]): Tri[] {
  const flat = Delaunator.from(points).triangles;
  const tris: Tri[] = [];
  for (let i = 0; i < flat.length; i += 3) {
    tris.push([flat[i]!, flat[i + 1]!, flat[i + 2]!]);
  }
  // Drop sliver triangles: largest angle (opposite the longest edge) ≥ MAX_ANGLE.
  return tris.filter((t) => {
    const d = [
      dist(points[t[0]]!, points[t[1]]!),
      dist(points[t[1]]!, points[t[2]]!),
      dist(points[t[2]]!, points[t[0]]!),
    ].sort((x, y) => x - y);
    const [a, b, c] = d as [number, number, number]; // a ≤ b ≤ c
    if (a < 1e-12 || b < 1e-12) return false; // degenerate -> drop
    let cosLargest = (a * a + b * b - c * c) / (2 * a * b);
    cosLargest = Math.max(-1, Math.min(1, cosLargest));
    return Math.acos(cosLargest) < MAX_ANGLE;
  });
}

// --- stage 3: dissolve edges -> merge triangle pairs into quads ------------
// legit(quad): convex (all 4 corner cross-products same sign) AND every
// interior angle in [QUAD_ANGLE_MIN, QUAD_ANGLE_MAX].
function legitQuad(points: Vec2[], quad: Quad): boolean {
  const signs = new Set<number>();
  let minAng = Infinity;
  let maxAng = -Infinity;
  for (let i = 0; i < 4; i++) {
    const prev = points[quad[((i - 1 + 4) % 4) as 0 | 1 | 2 | 3]]!;
    const cur = points[quad[i as 0 | 1 | 2 | 3]]!;
    const next = points[quad[((i + 1) % 4) as 0 | 1 | 2 | 3]]!;
    const d1 = sub(cur, prev);
    const d2 = sub(next, cur);
    signs.add(Math.sign(cross(d1, d2)));
    const l1 = len(d1);
    const l2 = len(d2);
    if (l1 < 1e-12 || l2 < 1e-12) return false;
    let c = dot(d1, d2) / (l1 * l2);
    c = Math.max(-1, Math.min(1, c));
    const ang = Math.acos(c);
    if (ang < minAng) minAng = ang;
    if (ang > maxAng) maxAng = ang;
  }
  return signs.size === 1 && maxAng <= QUAD_ANGLE_MAX && minAng >= QUAD_ANGLE_MIN;
}

function mergeToQuads(
  points: Vec2[],
  triangles: Tri[],
  rng: Rng,
): { triangles: Tri[]; prequads: Quad[] } {
  // mutable copy of triangle list
  const tris: Tri[] = triangles.map((t) => [...t]);
  const prequads: Quad[] = [];
  const tabu = new Set<string>();

  for (;;) {
    // Count interior edges over non-tabu edges.
    const counts = new Map<string, number>();
    for (const t of tris) {
      const es = [edgeKey(t[0], t[1]), edgeKey(t[1], t[2]), edgeKey(t[2], t[0])];
      for (const e of es) {
        if (tabu.has(e)) continue;
        counts.set(e, (counts.get(e) || 0) + 1);
      }
    }
    // Candidates: edges shared by exactly 2 (interior), not tabu.
    const candidates: [number, number][] = [];
    for (const [key, c] of counts) {
      if (c > 1) candidates.push(key.split('-').map(Number) as [number, number]);
    }
    if (candidates.length === 0) break;

    let mergedThisRound = false;
    while (candidates.length > 0) {
      const idx = Math.floor(rng() * candidates.length);
      const [ea, eb] = candidates.splice(idx, 1)[0]!;

      // Find the two triangles sharing edge (ea, eb); collect non-shared verts.
      const mergeIdx: number[] = [];
      const opp: number[] = [];
      for (let i = 0; i < tris.length; i++) {
        const t = tris[i]!;
        if (t.includes(ea) && t.includes(eb)) {
          mergeIdx.push(i);
          for (const v of t) if (v !== ea && v !== eb) opp.push(v);
        }
      }
      if (mergeIdx.length !== 2) continue; // shouldn't happen for interior edges

      // Interleave: [edge.a, opp0, edge.b, opp1] -> correct corner order.
      const candQuad: Quad = [ea, opp[0]!, eb, opp[1]!];

      if (legitQuad(points, candQuad)) {
        prequads.push(candQuad);
        // remove both triangles (higher index first to keep indices valid)
        mergeIdx.sort((x, y) => y - x);
        tris.splice(mergeIdx[0]!, 1);
        tris.splice(mergeIdx[1]!, 1);
        mergedThisRound = true;
        break; // restart outer loop with fresh edge counts
      } else {
        tabu.add(edgeKey(ea, eb));
      }
    }
    if (!mergedThisRound) break; // exhausted candidates without a legal merge
  }

  return { triangles: tris, prequads };
}

// --- stage 4: subdivide every face into quads ------------------------------
// Shared midpoints keep the mesh watertight (canonical min-max edge key).
function subdivide(points: Vec2[], faces: readonly (Tri | Quad)[]): {
  vertices: Vec2[];
  quads: Quad[];
} {
  const vertices: Vec2[] = points.map((p) => [...p]); // own the arrays
  const midCache = new Map<string, number>(); // edgeKey -> vertex index

  const midpointIndex = (a: number, b: number): number => {
    const key = edgeKey(a, b);
    let mi = midCache.get(key);
    if (mi === undefined) {
      const m: Vec2 = [
        (vertices[a]![0] + vertices[b]![0]) / 2,
        (vertices[a]![1] + vertices[b]![1]) / 2,
      ];
      mi = vertices.length;
      vertices.push(m);
      midCache.set(key, mi);
    }
    return mi;
  };

  const quads: Quad[] = [];
  for (const face of faces) {
    const n = face.length; // 3 (triangle) or 4 (quad)
    const centroid = mean(face.map((vi) => vertices[vi]!));
    const ci = vertices.length;
    vertices.push(centroid);

    // edges around the face, in order
    const edges: [number, number][] = [];
    for (let i = 0; i < n; i++) edges.push([face[i]!, face[(i + 1) % n]!]);

    // For each corner: [corner, mid(edge meeting it on one side), centroid,
    // mid(edge meeting it on the other side)]. edge j and edge j+1 share corner.
    for (let j = 0; j < n; j++) {
      const e1 = edges[j]!;
      const e2 = edges[(j + 1) % n]!;
      const m1 = midpointIndex(e1[0], e1[1]);
      const m2 = midpointIndex(e2[0], e2[1]);
      // common vertex of e1 and e2 = the corner
      let corner = e1[0];
      if (!e2.includes(corner)) corner = e1[1];
      quads.push([corner, m1, ci, m2]);
    }
  }

  return { vertices, quads };
}

// --- stage 4b: normalize winding to CCW ------------------------------------
// Signed area > 0 == CCW (standard math convention, y up). Reverse if CW.
function normalizeWinding(vertices: Vec2[], quads: Quad[]): void {
  for (const q of quads) {
    let signed = 0;
    for (let i = 0; i < 4; i++) {
      const cur = vertices[q[i as 0 | 1 | 2 | 3]]!;
      const nxt = vertices[q[((i + 1) % 4) as 0 | 1 | 2 | 3]]!;
      signed += cur[0] * nxt[1] - nxt[0] * cur[1];
    }
    if (signed < 0) q.reverse(); // was CW -> make CCW
  }
}

// --- stage 1: seed dispatch ------------------------------------------------
// Produce the input point set for stages 2–5. The pipeline is seed-agnostic:
// these are just [x,y] points. `rng` is the mulberry32 stream so the Poisson
// path stays deterministic (the hex path is deterministic by construction and
// doesn't consume rng — the random dissolve in mergeToQuads does).
function seedPoints(
  rng: Rng,
  { seeder = 'poisson', r = 0.1, k = 30, rings = 4, spacing = 0.1 }: GenerateMeshParams,
): Vec2[] {
  if (seeder === 'hex') {
    return hexLattice({ rings, spacing }).points;
  }
  // default: poisson
  return poissonDisk(rng, { r, k });
}

// --- public: generateMesh --------------------------------------------------
// Runs stages 1–4b. PRE-relax mesh.
export function generateMesh(params: GenerateMeshParams = {}): Mesh {
  const { seed = 0, seeder = 'poisson' } = params;
  const rng = mulberry32(seed);
  const points = seedPoints(rng, { ...params, seeder });
  const triangles = triangulate(points);
  const { triangles: leftover, prequads } = mergeToQuads(points, triangles, rng);
  const faces: (Tri | Quad)[] = [...leftover, ...prequads];
  const { vertices, quads } = subdivide(points, faces);
  normalizeWinding(vertices, quads);
  const boundary = [...boundaryVertices({ quads })];
  return { vertices, quads, seed, seeder, boundary };
}

// --- stage 5: relaxation ---------------------------------------------------
// Closed-form closest-square fit. See RISK 1 note at top of file: the formula
// is derived for CLOCKWISE corner order, so we read each (CCW-stored) quad's
// corners reversed before applying it.
export function relaxStep(
  mesh: Pick<Mesh, 'vertices' | 'quads'>,
  { SIDE_LENGTH = 0.06, PULL_RATE = 0.3, pinned = null }: RelaxParams = {},
): number {
  const { vertices, quads } = mesh;
  const r = SIDE_LENGTH / Math.SQRT2;
  const pinnedSet = toPinnedSet(pinned);

  // accumulate per-vertex force
  const forces: Vec2[] = vertices.map(() => [0, 0]);

  for (const quad of quads) {
    // CW view of the CCW-stored quad (risk 1).
    const cw = [quad[0], quad[3], quad[2], quad[1]] as const;
    const corners = cw.map((vi) => vertices[vi]!);
    const c = mean(corners);
    // centered corners q0..q3
    const q = corners.map((p) => sub(p, c)) as [Vec2, Vec2, Vec2, Vec2];

    let denom = q[0][0] - q[1][1] - q[2][0] + q[3][1];
    const num = q[0][1] + q[1][0] - q[2][1] - q[3][0];

    const s = Math.sign(denom) || 1;
    denom = s * Math.max(1e-10, Math.abs(denom));

    let alpha = Math.atan(num / denom);
    if (Math.cos(alpha) * denom + Math.sin(alpha) * num < 0) alpha += Math.PI;

    const ca = Math.cos(alpha);
    const sa = Math.sin(alpha);
    const target: [Vec2, Vec2, Vec2, Vec2] = [
      [r * ca, r * sa],
      [r * sa, -r * ca],
      [-r * ca, -r * sa],
      [-r * sa, r * ca],
    ];

    for (let i = 0; i < 4; i++) {
      const f = sub(target[i as 0 | 1 | 2 | 3], q[i as 0 | 1 | 2 | 3]);
      const vi = cw[i as 0 | 1 | 2 | 3];
      forces[vi]![0] += f[0];
      forces[vi]![1] += f[1];
    }
  }

  // apply forces, measure total displacement. PINNED vertices stay fixed.
  let totalDisp = 0;
  for (let v = 0; v < vertices.length; v++) {
    if (pinnedSet && pinnedSet.has(v)) continue;
    const dx = forces[v]![0] * PULL_RATE;
    const dy = forces[v]![1] * PULL_RATE;
    vertices[v]![0] += dx;
    vertices[v]![1] += dy;
    totalDisp += Math.hypot(dx, dy);
  }
  return totalDisp;
}

// Boundary vertices = endpoints of edges used by exactly ONE quad (a watertight
// mesh has 2 quads per interior edge, 1 per boundary edge).
export function boundaryVertices({ quads }: Pick<Mesh, 'quads'>): Set<number> {
  const count = new Map<string, number>();
  for (const q of quads) {
    for (let i = 0; i < 4; i++) {
      const a = q[i as 0 | 1 | 2 | 3];
      const b = q[((i + 1) % 4) as 0 | 1 | 2 | 3];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      count.set(key, (count.get(key) || 0) + 1);
    }
  }
  const bset = new Set<number>();
  for (const [key, c] of count) {
    if (c === 1) {
      const [a, b] = key.split('-') as [string, string];
      bset.add(+a);
      bset.add(+b);
    }
  }
  return bset;
}

function toPinnedSet(pinned: Set<number> | readonly number[] | null | undefined): Set<number> | null {
  if (!pinned) return null;
  return pinned instanceof Set ? pinned : new Set(pinned);
}

// Run relaxation to completion, synchronously (spec §3.1 stage 5: fixed
// iteration count, no animation). Returns the final-step displacement.
export function relax(
  mesh: Pick<Mesh, 'vertices' | 'quads'>,
  { n_iters = 100, ...params }: RelaxParams & { n_iters?: number } = {},
): number {
  let disp = 0;
  for (let i = 0; i < n_iters; i++) disp = relaxStep(mesh, params);
  return disp;
}
