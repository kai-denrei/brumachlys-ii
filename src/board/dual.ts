// dual.ts — dual-cell extraction. Ported from oskar-procedure src/dual.js. PURE.
//
// A dual cell exists for each PRIMARY vertex with >= 3 incident quads (an
// interior vertex). Its polygon is the centroids of the incident quads, sorted
// by angle around the vertex (ascending atan2 == CCW in math convention).
// Boundary vertices (< 3 incident quads) have no complete dual cell and are
// skipped.
//
// Port deviations from oskar-procedure:
// - Returns { cells, byVertex } instead of an array with a bolted-on
//   `.byVertex` property (typed-TS hygiene; same data).
// - hitTestVertex / pointInPolygon NOT ported — UI-side concern, comes back
//   with the render layer if needed (P6).

import type { Vec2 } from './types';
import type { Mesh } from './grid';
import type { HalfEdgeMesh } from './halfedge';

export type DualCell = {
  /** Index of the surrounded primary vertex in mesh.vertices. */
  vertexIndex: number;
  /** Ordered (CCW) polygon: centroids of the incident quads. */
  centroids: Vec2[];
  /** The primary vertex position. */
  center: Vec2;
};

export type DualCells = {
  /** In generation order (ascending vertexIndex). */
  cells: DualCell[];
  byVertex: Map<number, DualCell>;
};

function centroidOfFaceVerts(vertices: Vec2[], vidx: number[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const vi of vidx) {
    x += vertices[vi]![0];
    y += vertices[vi]![1];
  }
  return [x / vidx.length, y / vidx.length];
}

export function extractDualCells(
  mesh: Pick<Mesh, 'vertices'>,
  halfEdge: HalfEdgeMesh,
): DualCells {
  const { vertices } = mesh;
  const cells: DualCell[] = [];
  const byVertex = new Map<number, DualCell>();

  for (let v = 0; v < vertices.length; v++) {
    const faces = halfEdge.facesAroundVertex(v);
    if (faces.length < 3) continue; // boundary vertex: no complete dual cell

    const center = vertices[v]!;
    // centroid of each incident quad
    const centroids = faces.map((f) =>
      centroidOfFaceVerts(vertices, halfEdge.verticesOfFace(f)),
    );

    // sort by angle around the vertex -> ordered (CCW) polygon
    centroids.sort(
      (a, b) =>
        Math.atan2(a[1] - center[1], a[0] - center[0]) -
        Math.atan2(b[1] - center[1], b[0] - center[0]),
    );

    const cell: DualCell = { vertexIndex: v, centroids, center };
    cells.push(cell);
    byVertex.set(v, cell);
  }

  return { cells, byVertex };
}
