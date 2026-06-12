// rounded.ts — soft-pebble polygon path (spec §10.1): each corner is cut and
// replaced by a quadratic bezier through the original vertex; cut distance is
// clamped to shortest-edge/3 so tight corners on small edges never overlap.
// Pure geometry on screen-space points.

export type Pt = readonly [number, number];

/** SVG path (`M … Q … Z`) for `points` with rounded corners. Points are
 * screen-space; winding doesn't matter. Degenerate rings (<3 pts) → ''. */
export function roundedPolygonPath(points: readonly Pt[]): string {
  const n = points.length;
  if (n < 3) return '';

  const edgeLen: number[] = [];
  let shortest = Infinity;
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    edgeLen.push(len);
    if (len > 1e-9 && len < shortest) shortest = len;
  }
  if (!isFinite(shortest)) return '';
  const radius = shortest / 3;

  const fmt = (v: number) => (Math.round(v * 100) / 100).toString();
  let d = '';
  for (let i = 0; i < n; i++) {
    const prev = points[(i + n - 1) % n]!;
    const v = points[i]!;
    const next = points[(i + 1) % n]!;
    const inLen = edgeLen[(i + n - 1) % n]!;
    const outLen = edgeLen[i]!;
    // Cut distance: never more than half of either adjacent edge, never more
    // than shortest-edge/3.
    const dIn = Math.min(radius, inLen / 2);
    const dOut = Math.min(radius, outLen / 2);
    const tIn = inLen > 1e-9 ? dIn / inLen : 0;
    const tOut = outLen > 1e-9 ? dOut / outLen : 0;
    const p1: Pt = [v[0] + (prev[0] - v[0]) * tIn, v[1] + (prev[1] - v[1]) * tIn];
    const p2: Pt = [v[0] + (next[0] - v[0]) * tOut, v[1] + (next[1] - v[1]) * tOut];
    if (i === 0) d += `M${fmt(p1[0])} ${fmt(p1[1])}`;
    else d += `L${fmt(p1[0])} ${fmt(p1[1])}`;
    d += `Q${fmt(v[0])} ${fmt(v[1])} ${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return d + 'Z';
}

/** Polygon centroid (vertex mean — good enough for decoration anchoring). */
export function ringCentroid(points: readonly Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
  }
  return [x / points.length, y / points.length];
}

/** Mean vertex distance from the centroid — a cell's visual radius, used to
 * scale terrain decorations to the cell. */
export function ringRadius(points: readonly Pt[], centroid: Pt = ringCentroid(points)): number {
  let r = 0;
  for (const p of points) r += Math.hypot(p[0] - centroid[0], p[1] - centroid[1]);
  return r / points.length;
}
