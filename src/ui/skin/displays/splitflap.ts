// displays/splitflap.ts — Split-flap / Solari board, ported from the attached
// standalone (splitflap-standalone.html) and ADAPTED from "auto-animate forever"
// into a value-driven driver.
//
// ORIGINAL behaviour: the standalone ran an endless "arrival cycle" — every cell
// picked a random start char from the previous cycle's seed, cascaded to the
// target, held for `holdMs`, then re-scrambled and arrived again, forever.
//
// THIS adaptation: the board shows a TARGET string (e.g. the round number).
// `setTarget(driver, next, t)` captures the OLD per-column chars and, for each
// column, schedules ONE flip cascade from its old char to its new char (stepping
// forward through the physical drum). After the cascade completes the board HOLDS
// static — NO re-scramble, NO auto-cycle. A column whose char is unchanged does
// not flip. `prefers-reduced-motion` callers pass `animate: false` to snap.
//
// The leaf-fold / seam / settle-bounce / wear / dust fidelity of the original is
// preserved verbatim — only the source of (settled, frac, flipping) per column
// changed from the infinite-cycle clock to the driver below.

import {
  type Rgb,
  type Rng,
  dust,
  hex2rgb,
  mix,
  rgba,
  roundRect,
  stageSize,
} from './core';

// the printable card alphabet (the physical drum order). Space + A-Z + 0-9 +
// a few marks, like a real board — same as the standalone.
const CHARSET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:-/'";
const IDX: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < CHARSET.length; i++) m[CHARSET.charAt(i)] = i;
  return m;
})();
const BOARD_FONT = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";

/** Resolved visual params for the board (preset + overrides). Light "Solari"
 *  defaults harmonised with the paper top bar; `transparent` skips the dark
 *  full-canvas backdrop so the widget sits in the bar, not a black box. */
export interface SplitFlapParams {
  card: string;
  ink: string;
  bg: string;
  flipMs: number;
  bounce: number;
  gap: number;
  radius: number;
  seam: number;
  wear: number;
  misalign: number;
  sticky: number;
  dust: number;
  transparent: boolean;
}

/** Solari light preset — aged off-white card, dark ink, transparent backdrop so
 *  it reads as a small mechanical counter in the light HUD. */
export const SOLARI_LIGHT: SplitFlapParams = {
  card: '#e9e2d2',
  ink: '#1a1713',
  bg: '#0c0b0a', // only used as a compositing reference; never painted (transparent)
  flipMs: 64,
  bounce: 42,
  gap: 14,
  radius: 16,
  seam: 40,
  wear: 16,
  misalign: 8,
  sticky: 0,
  dust: 10,
  transparent: true,
};

function drumIndex(ch: string | undefined): number {
  if (ch === undefined) return 0;
  const idx = IDX[ch];
  return idx != null ? idx : 0;
}

/** forward distance (cards step one way only, wrapping) from a→b. */
function fwdDist(a: number, b: number, len: number): number {
  return (b - a + len) % len;
}

// --- driver ------------------------------------------------------------------

interface ColumnAnim {
  /** drum index this column starts the cascade from (the OLD char). */
  fromIdx: number;
  /** drum index this column lands on (the NEW char). */
  toIdx: number;
  /** cards to flip (fwdDist fromIdx→toIdx); 0 = static, never animates. */
  steps: number;
  /** ms offset before this column begins (left→right cascade stagger). */
  startDelay: number;
  /** sticky multiplier on step duration (>=1), pinned per column. */
  stick: number;
}

export interface SplitFlapDriver {
  /** the currently-displayed target (each char is a column). */
  target: string;
  /** per-column animation, parallel to `target`. */
  cols: ColumnAnim[];
  /** ms timestamp (the shared RAF clock) when the current cascade began. */
  startedAt: number;
  /** whether ANY column is still flipping (cheap settle check for RAF pause). */
  animating: boolean;
}

/** Normalise a value to the drum charset (upper-cased; unknown → space). */
function normalize(s: string): string {
  return (s ?? '').toString().toUpperCase();
}

export function createSplitFlapDriver(initial: string): SplitFlapDriver {
  const target = normalize(initial);
  return {
    target,
    cols: [...target].map((ch) => ({
      fromIdx: drumIndex(ch),
      toIdx: drumIndex(ch),
      steps: 0,
      startDelay: 0,
      stick: 1,
    })),
    startedAt: 0,
    animating: false,
  };
}

/** Point the board at a new target.
 *  - animate=true  → each changed column flips ONCE from its old char to the new
 *    char (forward through the drum), staggered left→right; then holds.
 *  - animate=false → snap (reduced motion): no flip, columns land immediately.
 *  Length changes (e.g. 9 → 10 digits) reset cleanly: new columns animate from a
 *  blank, removed columns drop. */
export function setTarget(
  d: SplitFlapDriver,
  next: string,
  t: number,
  p: SplitFlapParams,
  animate: boolean,
): void {
  const nextTarget = normalize(next);
  if (nextTarget === d.target && !d.animating) return;

  const oldChars = [...d.target];
  const newChars = [...nextTarget];
  const flipMs = Math.max(8, p.flipMs);
  const stickyP = p.sticky / 100;
  const n = newChars.length;

  const cols: ColumnAnim[] = newChars.map((ch, i) => {
    const toIdx = drumIndex(ch);
    // a column that existed before flips from its OLD char; a brand-new column
    // (string grew) flips in from a blank space so the growth reads mechanically.
    const oldCh = i < oldChars.length ? oldChars[i] : ' ';
    const fromIdx = drumIndex(oldCh);
    let steps = fwdDist(fromIdx, toIdx, CHARSET.length);
    if (!animate) steps = 0; // snap: land instantly
    // stagger: rightmost columns start a touch later (sweep reads left→right).
    const startDelay = animate ? (i / Math.max(1, n)) * flipMs * 2.2 : 0;
    // sticky cards land a frame late — pinned per column index so it's stable.
    const stick = animate && hashStick(i) < stickyP ? 1.4 : 1;
    return { fromIdx, toIdx, steps, startDelay, stick };
  });

  d.target = nextTarget;
  d.cols = cols;
  d.startedAt = t;
  d.animating = animate && cols.some((c) => c.steps > 0);
}

// a tiny stable hash for the per-column sticky decision (independent of seed so
// the same column index reads consistently; not visual wear, just timing salt).
function hashStick(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// --- render ------------------------------------------------------------------

/** Draw the board at time `t`, using the driver's cascade state. Mirrors the
 *  standalone's per-cell leaf-fold render; the (settled, frac, flipping) values
 *  now come from the driver instead of the infinite arrival cycle.
 *  Returns whether the board is still animating (so the RAF loop can pause). */
export function renderSplitFlap(
  ctx: CanvasRenderingContext2D,
  d: SplitFlapDriver,
  p: SplitFlapParams,
  t: number,
  rng: Rng,
): boolean {
  const { w, h } = stageSize(ctx);
  const cardC = hex2rgb(p.card);
  const inkC = hex2rgb(p.ink);
  const bgC = hex2rgb(p.bg);
  if (!p.transparent) {
    ctx.fillStyle = rgba(bgC, 1);
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.clearRect(0, 0, w, h);
  }

  const chars = [...d.target];
  const n = Math.max(1, chars.length);
  const flipMs = Math.max(8, p.flipMs);

  // --- fit a row of cells to the stage (real flap cells are taller, ~0.66:1) ---
  const aspect = 0.66;
  const pad = Math.min(w, h) * 0.08;
  const gapPx = p.gap / 100;
  let cellH = h - pad * 2;
  let cellW = cellH * aspect;
  let gp = cellW * gapPx;
  const maxW = w - pad * 2;
  const total = (k: number) => cellW * k + gp * (k - 1);
  if (total(n) > maxW) {
    const s = maxW / total(n);
    cellH *= s;
    cellW *= s;
    gp = cellW * gapPx;
  }
  const startX = (w - total(n)) / 2;
  const y0 = (h - cellH) / 2;
  const fontPx = cellH * 0.58;
  const half = cellH / 2;
  const rad = Math.min(cellW, cellH) * (p.radius / 100) * 0.5;

  const bounceA = p.bounce / 100;
  const wearA = p.wear / 100;
  const misA = p.misalign / 100;
  const seamA = p.seam / 100;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${fontPx}px ${BOARD_FONT}`;

  let stillAnimating = false;

  for (let i = 0; i < n; i++) {
    const col = d.cols[i] ?? {
      fromIdx: drumIndex(chars[i]),
      toIdx: drumIndex(chars[i]),
      steps: 0,
      startDelay: 0,
      stick: 1,
    };
    const cx = startX + cellW * (i + 0.5) + gp * i;
    const cyTop = y0;
    const mid = y0 + half;

    // ---- driver cascade: how far has THIS column flipped at time t ----
    const localT = t - d.startedAt - col.startDelay;
    let settled: number;
    let frac: number;
    let flipping: boolean;
    if (col.steps <= 0) {
      settled = 0;
      frac = 0;
      flipping = false; // static column (unchanged char or snap)
    } else if (localT <= 0) {
      settled = 0;
      frac = 0;
      flipping = true; // waiting on its stagger delay
      stillAnimating = true;
    } else {
      const stepMs = flipMs * col.stick;
      const done = localT / stepMs;
      if (done >= col.steps) {
        settled = col.steps;
        frac = 0;
        flipping = false; // seated
      } else {
        settled = Math.floor(done);
        frac = done - settled;
        flipping = true;
        stillAnimating = true;
      }
    }

    const DLEN = CHARSET.length;
    const curIdx = (col.fromIdx + settled) % DLEN;
    const nextIdx = (col.fromIdx + settled + 1) % DLEN;
    const curCh = CHARSET.charAt(curIdx);
    const nextCh = CHARSET.charAt(flipping ? nextIdx : curIdx);

    // settle overshoot: on the seated card, a small decaying bounce.
    let restAng = 0;
    if (!flipping && bounceA > 0 && col.steps > 0) {
      const since = localT - col.steps * flipMs * col.stick;
      if (since >= 0 && since < 220) {
        const b = 1 - since / 220;
        restAng = Math.sin(since * 0.06) * b * b * bounceA * 0.2;
        if (since < 220) stillAnimating = true; // bounce keeps the loop alive briefly
      }
    }

    // per-cell lived-in: aged tint variance + a tiny static misalignment.
    const tint = mix(cardC, [0, 0, 0], wearA * 0.16 * rng.hash(i + 1, 3));
    const tintWarm = mix(tint, [120, 96, 60], wearA * 0.1 * rng.hash(i + 5, 7));
    const mx = (rng.hash(i + 11, 13) - 0.5) * misA * cellW * 0.04;
    const my = (rng.hash(i + 17, 19) - 0.5) * misA * cellH * 0.04;

    ctx.save();
    ctx.translate(mx, my);

    const cardBody = (fill: string) => {
      roundRect(ctx, cx - cellW / 2, cyTop, cellW, cellH, rad);
      ctx.fillStyle = fill;
      ctx.fill();
    };
    const clipHalf = (top: boolean) => {
      ctx.beginPath();
      if (top) ctx.rect(cx - cellW, cyTop - 2, cellW * 2, half + 2);
      else ctx.rect(cx - cellW, mid, cellW * 2, half + 2);
      ctx.clip();
    };
    const glyph = (cardCh: string, fill: string) => {
      ctx.fillStyle = fill;
      ctx.fillText(cardCh, cx, mid);
    };

    const bodyFill = rgba(tintWarm, 1);
    const inkFill = rgba(
      mix(inkC, tintWarm, wearA * 0.12 * rng.hash(i + 23, 29)),
      1,
    );

    // 1) BOTTOM leaf = lower half of the NEXT card mid-flip, else current.
    ctx.save();
    clipHalf(false);
    cardBody(bodyFill);
    glyph(flipping ? nextCh : curCh, inkFill);
    ctx.restore();

    // 2) STATIC top leaf = top half of the CURRENT card (next revealed behind).
    ctx.save();
    clipHalf(true);
    cardBody(bodyFill);
    glyph(flipping ? nextCh : curCh, inkFill);
    ctx.restore();

    // 3) FOLDING leaf: current card's TOP half rotates down about the seam.
    if (flipping) {
      const e = restAng ? 0 : frac;
      const sweep = Math.min(1, e);
      const sc = Math.cos((sweep * Math.PI) / 2);
      const fast = flipMs <= 60 ? 1 : 0;
      const shade = 0.35 + 0.65 * sc;
      ctx.save();
      ctx.translate(cx, mid);
      ctx.scale(1, Math.max(0.001, sc));
      ctx.translate(-cx, -mid);
      ctx.save();
      clipHalf(true);
      cardBody(rgba(mix(tintWarm, bgC, 1 - shade), 1));
      glyph(curCh, rgba(mix(inkC, bgC, 1 - shade), 1));
      ctx.restore();
      if (fast && sc > 0.2) {
        ctx.globalAlpha = 0.18;
        ctx.save();
        clipHalf(true);
        cardBody(rgba(mix(tintWarm, bgC, 0.4), 1));
        ctx.restore();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    // 4) settle bounce: nudge the seated top leaf with the overshoot.
    if (restAng) {
      ctx.save();
      ctx.translate(cx, mid);
      ctx.scale(1, Math.max(0.9, 1 - Math.abs(restAng)));
      ctx.translate(-cx, -mid);
      ctx.save();
      clipHalf(true);
      cardBody(bodyFill);
      glyph(curCh, inkFill);
      ctx.restore();
      ctx.restore();
    }

    // 5) seam: dark split line + a faint shadow the top leaf casts.
    ctx.fillStyle = rgba([0, 0, 0], 0.55 * seamA);
    ctx.fillRect(
      cx - cellW / 2,
      mid - Math.max(1, cellH * 0.012),
      cellW,
      Math.max(1.5, cellH * 0.024),
    );
    if (seamA > 0) {
      const sg = ctx.createLinearGradient(0, mid, 0, mid + cellH * 0.14);
      sg.addColorStop(0, rgba([0, 0, 0], 0.3 * seamA));
      sg.addColorStop(1, rgba([0, 0, 0], 0));
      ctx.save();
      clipHalf(false);
      ctx.fillStyle = sg;
      ctx.fillRect(cx - cellW / 2, mid, cellW, cellH * 0.16);
      ctx.restore();
    }

    // 6) card edge: thin worn outline + a top sheen so the stock reads physical.
    roundRect(ctx, cx - cellW / 2, cyTop, cellW, cellH, rad);
    ctx.lineWidth = Math.max(0.5, cellW * 0.01);
    ctx.strokeStyle = rgba(
      mix(tintWarm, [0, 0, 0], 0.5),
      0.4 + wearA * 0.3 * rng.hash(i + 41, 43),
    );
    ctx.stroke();
    const sheen = ctx.createLinearGradient(0, cyTop, 0, cyTop + cellH * 0.4);
    sheen.addColorStop(0, rgba([255, 255, 255], 0.1));
    sheen.addColorStop(1, rgba([255, 255, 255], 0));
    ctx.save();
    roundRect(ctx, cx - cellW / 2, cyTop, cellW, cellH, rad);
    ctx.clip();
    ctx.fillStyle = sheen;
    ctx.fillRect(cx - cellW / 2, cyTop, cellW, cellH * 0.4);
    ctx.restore();

    ctx.restore();
  }

  // settled dust over the whole board (stable per seed; never opaque).
  dust(ctx, rng, p.dust / 50, w, h);

  d.animating = stillAnimating;
  return stillAnimating;
}

// re-export for callers that only want the type-narrowing helper.
export type { Rgb };
