// board-geometry.ts — pure camera + token-layout math extracted from Board.tsx
// (v1.6 refactor Phase 1): these are non-component, deterministic helpers that
// were exported from the Board component file purely for tests, which made every
// edit to Board.tsx invalidate React Fast-Refresh. Hosting them here keeps the
// component file component-only. UI-layer module — may import pure board/skin
// helpers (e.g. Pt); pure board/core/ai must NOT import this.

import { type Pt } from './skin/rounded';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

export type View = { k: number; tx: number; ty: number };

export function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

type Box = { x: number; y: number; width: number; height: number };

/** P9 auto-follow camera math (pure — exported for tests). The view that
 * frames `pts` (board screen-space points) with `margin` around them: keeps
 * the current zoom when the framed box fits at it (zooms OUT only), pans so
 * the box center sits at the viewBox center. Returns null when the expanded
 * box is already fully inside the current viewport — the calm rule: never
 * micro-pan while the action is comfortably on screen. */
export function computeFollowView(
  pts: readonly Pt[],
  view: View,
  bbox: Box,
  margin: number,
): View | null {
  if (pts.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  minX -= margin;
  minY -= margin;
  maxX += margin;
  maxY += margin;
  // Current viewport in board screen coords.
  const vx0 = (bbox.x - view.tx) / view.k;
  const vy0 = (bbox.y - view.ty) / view.k;
  const vx1 = vx0 + bbox.width / view.k;
  const vy1 = vy0 + bbox.height / view.k;
  if (minX >= vx0 && maxX <= vx1 && minY >= vy0 && maxY <= vy1) return null;
  const fitK = Math.min(bbox.width / (maxX - minX), bbox.height / (maxY - minY));
  const k = fitK < view.k ? clampZoom(fitK) : view.k; // zoom out only if needed
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { k, tx: bbox.x + bbox.width / 2 - k * cx, ty: bbox.y + bbox.height / 2 - k * cy };
}

// --- v1.3 Tweak A: co-located token stagger ---------------------------------
// During replay two units can transiently share a cell (vacancy walk-ins,
// brawl frames). Whenever 2+ tokens occupy one cell in a rendered frame they
// spread within it: 2 = small up-left / down-right diagonal, 3+ = a ring;
// staggered tokens shrink to 0.8 so both silhouettes read. Slot assignment is
// by unitId hash (stable ranking), so tokens never swap corners between
// frames; the offsets ride the token transform, which the 0.25s CSS
// transition already animates — the spread/merge glides.

export type StaggerSlot = { dx: number; dy: number; scale: number };

function unitIdHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return h;
}

/** Pure (exported for tests): within-cell offsets for `unitIds` sharing a
 * cell. Deterministic in the SET of ids — frame order doesn't matter. */
export function staggerLayout(
  unitIds: readonly string[],
  tokenSize: number,
): Map<string, StaggerSlot> {
  const out = new Map<string, StaggerSlot>();
  if (unitIds.length <= 1) {
    for (const id of unitIds) out.set(id, { dx: 0, dy: 0, scale: 1 });
    return out;
  }
  const ranked = [...unitIds].sort((a, b) => {
    const ha = unitIdHash(a);
    const hb = unitIdHash(b);
    return ha !== hb ? ha - hb : a < b ? -1 : 1;
  });
  if (ranked.length === 2) {
    // Diagonal pair: up-left / down-right, ~touching at 0.8 scale (0.30 — the
    // v1.3 visual pass found 0.27 left the corners overlapping the count pip).
    const d = tokenSize * 0.3;
    out.set(ranked[0]!, { dx: -d, dy: -d, scale: 0.8 });
    out.set(ranked[1]!, { dx: d, dy: d, scale: 0.8 });
    return out;
  }
  // 3+: ring, first slot at 12 o'clock.
  const r = tokenSize * 0.42;
  ranked.forEach((id, k) => {
    const t = -Math.PI / 2 + (2 * Math.PI * k) / ranked.length;
    out.set(id, { dx: Math.cos(t) * r, dy: Math.sin(t) * r, scale: 0.8 });
  });
  return out;
}

// --- once a move is decided: tuck the start-cell token into a corner ---------
// A unit whose MOVE order is queued shrinks to a quarter and seats itself in the
// polygon corner that best faces its first step. Two payoffs: the cell CENTER
// clears (so an occupied base stays tappable — build a fresh unit on it without
// the occupant swallowing the tap), and the planning board reads at a glance —
// full-size centered tokens still need an order, small corner tokens are already
// moving. The symmetric counterpart of the idle pulse (which marks the UN-ordered
// units); the two are mutually exclusive per unit.

/** Demoted token edge length as a fraction of a full token ("1/4th the size"). */
export const DEMOTE_SCALE = 0.25;

export type DemoteSlot = { x: number; y: number; scale: number };

/** Mean of the ring's vertices — strictly interior for these (star-)convex dual
 * cells, unlike `cell.center` (the raw lattice vertex, which can sit OUTSIDE the
 * polygon on boundary cells). The placement origin, so the token never starts
 * from an exterior point. */
function polygonCentroid(poly: readonly Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p[0];
    y += p[1];
  }
  return [x / poly.length, y / poly.length];
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby || 1e-12;
  let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t));
}

/** Distance from `p` to the nearest polygon EDGE. */
function distToEdges(p: Pt, poly: readonly Pt[]): number {
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = distToSegment(p, poly[i]!, poly[(i + 1) % poly.length]!);
    if (d < min) min = d;
  }
  return min;
}

/** Pure (exported for tests): screen-space placement of an ordered unit's
 * demoted token. `polygon`/`nextStep` are already projected to screen coords.
 * Picks the polygon vertex whose bearing from the CENTROID best matches the step
 * direction, then seats the token as far toward that vertex as it can while
 * keeping its full (square) extent clear of every edge — so it sits IN the
 * corner yet never spills into a neighbour cell. The token is a square, so the
 * clearance protects its corner reach (half-extent ×√2), not just a radial
 * inset; a sharp cell corner would otherwise let a flat side poke through. A
 * cell too tight for the token, or a degenerate step, falls back to the
 * centroid. */
export function demoteSlot(
  polygon: readonly Pt[],
  nextStep: Pt,
  tokenSize: number,
  scale: number = DEMOTE_SCALE,
): DemoteSlot {
  if (polygon.length === 0) return { x: nextStep[0], y: nextStep[1], scale };
  const c = polygonCentroid(polygon);
  const dx = nextStep[0] - c[0];
  const dy = nextStep[1] - c[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: c[0], y: c[1], scale };
  const dirX = dx / len;
  const dirY = dy / len;
  // Corner whose bearing from the centroid best matches the step direction.
  let best = polygon[0]!;
  let bestDot = -Infinity;
  for (const v of polygon) {
    const vx = v[0] - c[0];
    const vy = v[1] - c[1];
    const vlen = Math.hypot(vx, vy);
    if (vlen < 1e-6) continue;
    const dot = (vx * dirX + vy * dirY) / vlen; // cos∠(vertex bearing, step)
    if (dot > bestDot) {
      bestDot = dot;
      best = v;
    }
  }
  // Bisect along centroid→vertex for the farthest seat whose square still clears
  // every edge. If even the centroid is tighter than the clearance (token bigger
  // than the cell), centre it.
  const clearance = ((tokenSize * scale) / 2) * Math.SQRT2 + tokenSize * 0.06;
  const at = (t: number): Pt => [c[0] + (best[0] - c[0]) * t, c[1] + (best[1] - c[1]) * t];
  if (distToEdges(c, polygon) < clearance) return { x: c[0], y: c[1], scale };
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (distToEdges(at(mid), polygon) >= clearance) lo = mid;
    else hi = mid;
  }
  const seat = at(lo);
  return { x: seat[0], y: seat[1], scale };
}
