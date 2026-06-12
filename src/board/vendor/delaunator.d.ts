// Type declarations for the vendored delaunator 5.1.0 ESM bundle
// (delaunator.js, jsDelivr Rollup+Terser build, copied from oskar-procedure).
// Vendoring decision: keep the minified .js verbatim (proven in oskar-procedure)
// and describe it with this hand-written .d.ts rather than re-typing the source.
// It pulls in robust-predicates.js (same origin) for the orient2d primitive.

export default class Delaunator {
  /** Flat triangle vertex indices: triples (a, b, c) into the input points. */
  triangles: Uint32Array;
  /** Half-edge indices (twin of edge i, or -1 on the hull). */
  halfedges: Int32Array;
  /** Indices of the convex-hull points, counter-clockwise. */
  hull: Uint32Array;
  coords: Float64Array;

  constructor(coords: ArrayLike<number>);

  /** Build from an array of points, default getters read p[0] / p[1]. */
  static from<P>(
    points: ArrayLike<P>,
    getX?: (p: P) => number,
    getY?: (p: P) => number,
  ): Delaunator;

  update(): void;
}
