// Property test: run demoteSlot over real generated boards (every cell, stepping
// toward every neighbour) and assert the demoted SQUARE token never spills past
// an edge of a cell that could hold it, and never lands outside its own polygon.
// The synthetic fixtures in move-demote.test.tsx can't span the real cell-shape
// distribution; this does. (The pre-fix radial-inset version spilled on ~62% of
// placements and landed outside ~3%; the centroid + edge-clamp version drives
// both to zero except on slivers physically smaller than a 1/4 token.)
import { describe, expect, it } from 'vitest';
import { generateUniformBoard } from '../../src/board/generate';
import { demoteSlot, DEMOTE_SCALE } from '../../src/ui/board-geometry';

type P = [number, number];

function distToEdges(p: P, poly: readonly P[]): number {
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const len2 = abx * abx + aby * aby || 1e-12;
    let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t));
    if (d < min) min = d;
  }
  return min;
}
function inPolygon(p: P, poly: readonly P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]![0], yi = poly[i]![1], xj = poly[j]![0], yj = poly[j]![1];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

describe('demoteSlot on real boards', () => {
  it('never spills past an edge / never lands outside the polygon', () => {
    let placements = 0;
    let spills = 0;
    let fittableSpills = 0; // spill on a cell whose centroid COULD clear → a real bug
    let outside = 0;
    const centroidOf = (poly: readonly P[]): P => {
      let x = 0, y = 0;
      for (const p of poly) { x += p[0]; y += p[1]; }
      return [x / poly.length, y / poly.length];
    };
    for (let seed = 1; seed <= 10; seed++) {
      const board = generateUniformBoard(seed, 80);
      const cells = [...board.cells.values()];
      for (const cell of cells) {
        // tokenSize = 0.62 × median neighbour spacing (world), matching Board.
        const gaps = cell.neighbors
          .map((n) => board.cells.get(n))
          .filter(Boolean)
          .map((n) => Math.hypot(n!.center[0] - cell.center[0], n!.center[1] - cell.center[1]));
        if (gaps.length === 0) continue;
        gaps.sort((a, b) => a - b);
        const tokenSize = gaps[Math.floor(gaps.length / 2)]! * 0.62;
        const halfCorner = ((tokenSize * DEMOTE_SCALE) / 2) * Math.SQRT2;
        for (const nId of cell.neighbors) {
          const n = board.cells.get(nId);
          if (!n) continue;
          const s = demoteSlot(cell.polygon as P[], n.center as P, tokenSize);
          const p: P = [s.x, s.y];
          placements++;
          if (!inPolygon(p, cell.polygon as P[])) outside++;
          else if (distToEdges(p, cell.polygon as P[]) < halfCorner - 1e-6) {
            spills++;
            // Was the cell big enough to hold the token at all? (max interior
            // clearance ≈ centroid's distance to the nearest edge.)
            if (distToEdges(centroidOf(cell.polygon as P[]), cell.polygon as P[]) >= halfCorner) {
              fittableSpills++;
            }
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `[demote probe] placements=${placements} spills=${spills} fittableSpills=${fittableSpills} outside=${outside}`,
    );
    expect(placements).toBeGreaterThan(1000);
    expect(outside).toBe(0); // never lands in a neighbour cell
    expect(fittableSpills).toBe(0); // never spills on a cell that could hold the token
    expect(spills / placements).toBeLessThan(0.03); // residual = genuinely-too-tight slivers
  });
});
