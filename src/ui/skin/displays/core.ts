// displays/core.ts — shared drawing utilities ported (TypeScript) from the
// dexipurei "standalone" canvas library that the operator attached as the spec
// for the two HUD widgets (split-flap round number + odometer credits).
//
// These are PURE drawing helpers — no DOM lookups, no Math.random in a way that
// flickers per frame (wear is pinned to the seeded `hash`). This file is in the
// `src/ui` layer, where impurity is allowed, but the utilities themselves stay
// side-effect-free so the widgets render identically across frames + re-mounts.
//
// Ported verbatim (re-typed) from:
//   /Users/minikai/Downloads/splitflap-standalone.html
//   /Users/minikai/Downloads/odometer-standalone.html
// (core/rng.js, core/color.js, core/contract.js, core/wear.js, core/fx.js + the
//  odometer's `ease`/`cylinder` geometry helpers).

export type Rgb = [number, number, number];

/** A dpr-aware canvas: the React component stamps `_dpr` on it before render. */
export interface DprCanvas extends HTMLCanvasElement {
  _dpr?: number;
}

/** The seeded helper handed to a render call (matches the standalone contract).
 *  - `rand()` advances a seeded stream (frame-to-frame shimmer)
 *  - `hash(x, y)` is stable per (x, y, seed) — use it for fixed wear. */
export interface Rng {
  seed: number;
  rand: () => number;
  hash: (x: number, y: number) => number;
}

// --- rng.js ------------------------------------------------------------------

/** mulberry32 — the single seeded PRNG. */
export function mulberry32(a: number): () => number {
  a = a >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable per-element hash → [0,1). Same (x, y, seed) ALWAYS yields the same
 *  value, so wear stays pinned across frames + re-renders. */
export function hash(x: number, y: number, seed = 0): number {
  let n =
    (Math.imul(x | 0, 374761393) ^
      Math.imul(y | 0, 668265263) ^
      Math.imul(seed | 0, 2147483647)) |
    0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export function makeRng(seed: number): Rng {
  const s = (seed >>> 0) || 0;
  const rand = mulberry32(s);
  return { seed: s, rand, hash: (x: number, y: number) => hash(x, y, s) };
}

// --- color.js ----------------------------------------------------------------

export function hex2rgb(h: string): Rgb {
  let s = String(h).replace('#', '');
  if (s.length === 3)
    s = s
      .split('')
      .map((c) => c + c)
      .join('');
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

/** linear sRGB interpolation. t in [0,1]. */
export const mix = (a: Rgb, b: Rgb, t: number): Rgb =>
  [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ] as Rgb;

export const rgba = (c: Rgb, a: number): string =>
  `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// --- contract.js -------------------------------------------------------------

/** Logical drawing area of a dpr-aware canvas. The component sizes the backing
 *  store (× dpr) and applies the dpr transform before render, so a module draws
 *  within [0,w] × [0,h] in CSS px. */
export function stageSize(ctx: CanvasRenderingContext2D): {
  w: number;
  h: number;
  dpr: number;
} {
  const cv = ctx.canvas as DprCanvas;
  const dpr = cv._dpr || 1;
  return { w: cv.width / dpr, h: cv.height / dpr, dpr };
}

// --- wear.js -----------------------------------------------------------------

/** Scatter faint dust specks across the panel (light + dark flecks). Stable per
 *  seed via `rng.hash`, so the dust does not crawl frame-to-frame. */
export function dust(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  density: number,
  w: number,
  h: number,
): void {
  if (density <= 0) return;
  const n = Math.floor((density * (w * h)) / 1400);
  ctx.save();
  for (let i = 0; i < n; i++) {
    const x = rng.hash(i + 1, 7) * w;
    const y = rng.hash(i + 3, 11) * h;
    const r = 0.4 + rng.hash(i + 5, 13) * 1.4;
    const light = rng.hash(i, 9) > 0.5;
    ctx.fillStyle = `rgba(${light ? '255,255,255' : '0,0,0'},${0.04 + rng.hash(i + 2, 4) * 0.06})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// --- fx.js -------------------------------------------------------------------

/** Radial darken toward the edges. For the LIGHT HUD we pass a small amount and
 *  a light-leaning shade is applied by the caller's palette — here it stays the
 *  original soft black, kept subtle by a low `amount`. */
export function vignette(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  amount: number,
): void {
  if (amount <= 0) return;
  const g = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.25,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.62,
  );
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${amount * 0.85})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// --- geometry ----------------------------------------------------------------

/** rounded-rectangle path helper. */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** ease a 0..1 progress. amt 0 = linear, 1 = a sharp mechanical snap (slow
 *  detent, fast flip, settle). From the odometer module. */
export function ease(x: number, amt: number): number {
  if (amt <= 0) return x;
  // smootherstep blended toward identity by amt — a sprung detent letting go.
  const s = x * x * x * (x * (x * 6 - 15) + 10);
  return x + (s - x) * amt;
}

/** vertical perspective compression: map a linear offset u (in digit-heights,
 *  0 = window centre) to a screen offset + foreshortening scale, as if printed
 *  on a cylinder of curvature `curv` (0..1). From the odometer module. */
export function cylinder(u: number, curv: number): { y: number; s: number } {
  if (curv <= 0) return { y: u, s: 1 };
  const a = u * Math.PI * curv;
  const y =
    (Math.sin(a) / Math.max(0.0001, Math.sin(Math.PI * 0.5 * curv))) * 0.5;
  const s = Math.max(0.18, Math.cos(a));
  return { y, s };
}
