// board-projection.ts — project a Board's cell polygons into an SVG viewBox.
// Pure given its inputs. Extracted from RulesModal so the rules figure and the
// build-dashboard mini-map share one projection. The defaults (240×200, pad 6)
// reproduce RulesModal's prior local projectCells exactly: same scale, offsets,
// and y-flip (board is y-up, SVG is y-down).
import type { Board, CellId, Vec2 } from '../../board/types';

export function projectBoard(
  board: Board,
  viewW = 240,
  viewH = 200,
  pad = 6,
): { pts: Map<CellId, [number, number][]>; toSvg: (p: Vec2) => [number, number] } {
  const cells = [...board.cells.values()];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cells) {
    for (const [x, y] of c.polygon) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const W = viewW - pad * 2, H = viewH - pad * 2;
  const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
  const s = Math.min(W / spanX, H / spanY);
  const offX = pad + (W - spanX * s) / 2;
  const offY = pad + (H - spanY * s) / 2;
  // Board is y-up; SVG is y-down — flip y.
  const toSvg = (p: Vec2): [number, number] => [
    offX + (p[0] - minX) * s,
    offY + (maxY - p[1]) * s,
  ];
  const pts = new Map<CellId, [number, number][]>();
  for (const c of cells) pts.set(c.id, c.polygon.map(toSvg));
  return { pts, toSvg };
}
