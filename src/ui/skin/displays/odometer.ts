// displays/odometer.ts — Mechanical odometer, ported from the attached standalone
// (odometer-standalone.html) and ADAPTED from "count up forever" into a
// value-driven driver.
//
// ORIGINAL behaviour: the standalone derived the displayed value from t —
// `base = start + (t/1000) * unitsPerSec` — so the units wheel spun continuously
// and carried 9→0 into higher wheels, never stopping.
//
// THIS adaptation: the bank DISPLAYS a given numeric value. `setValue(driver,
// next, t)` rolls the drums from the OLD value to the NEW value over ROLL_MS
// (~600 ms, eased), then HOLDS — NOT continuous counting. Reduced-motion callers
// pass animate=false to snap. The displayed value during a roll is the eased
// interpolation old→new, so every intermediate wheel position curls past the lip
// exactly as the original did when carrying.
//
// The cylinder curl / gap shadows / window lip / sheen / vignette fidelity of the
// original render is preserved — only the source of `base` changed from the
// continuous clock to the interpolating driver below.

import {
  type Rng,
  cylinder,
  ease,
  hex2rgb,
  mix,
  rgba,
  stageSize,
  vignette,
} from './core';

const DRUM_FONT = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";

/** Roll duration on a value change (ms). The spec asks for ~600 ms. */
export const ROLL_MS = 600;

export interface OdometerParams {
  digits: number;
  /** true → black digits on a LIGHT drum (the "Brass"/light look). */
  invert: boolean;
  drum: string;
  ink: string;
  bg: string;
  easing: number;
  curve: number;
  gapShadow: number;
  sheen: number;
  align: number;
  worn: number;
  tint: number;
  vignette: number;
  transparent: boolean;
}

/** Light "Brass"-style preset (invert: black digits on a light drum), tuned to
 *  sit transparently in the paper HUD. */
export const BRASS_LIGHT: OdometerParams = {
  digits: 4,
  invert: true,
  drum: '#e9e3d4', // light drum face
  ink: '#181410', // dark engraved digits (invert maps these correctly)
  bg: '#15110b',
  easing: 66,
  curve: 66,
  gapShadow: 44,
  sheen: 34,
  align: 16,
  worn: 14,
  tint: 24,
  vignette: 18,
  transparent: true,
};

// --- driver ------------------------------------------------------------------

export interface OdometerDriver {
  /** value the bank currently rests on (the roll's destination). */
  value: number;
  /** value the active roll started from. */
  fromValue: number;
  /** ms timestamp (shared RAF clock) when the roll began. */
  startedAt: number;
  /** whether a roll is in progress (cheap settle check for RAF pause). */
  animating: boolean;
}

export function createOdometerDriver(initial: number): OdometerDriver {
  const v = Math.max(0, Math.floor(initial || 0));
  return { value: v, fromValue: v, startedAt: 0, animating: false };
}

/** Point the bank at a new value.
 *  - animate=true  → roll the drums from the current value to `next` over
 *    ROLL_MS (eased), then hold.
 *  - animate=false → snap (reduced motion). */
export function setValue(
  d: OdometerDriver,
  next: number,
  t: number,
  animate: boolean,
): void {
  const target = Math.max(0, Math.floor(next || 0));
  if (target === d.value && !d.animating) return;
  // start the roll from wherever the drums VISUALLY are right now (so a value
  // changed mid-roll continues smoothly rather than snapping back).
  d.fromValue = animate ? currentDisplayValue(d, t) : target;
  d.value = target;
  d.startedAt = t;
  d.animating = animate && d.fromValue !== target;
}

/** The fractional odometer value to display at time t (eased old→new during a
 *  roll, exactly `value` once settled). */
function currentDisplayValue(d: OdometerDriver, t: number): number {
  if (!d.animating) return d.value;
  const k = (t - d.startedAt) / ROLL_MS;
  if (k >= 1) return d.value;
  if (k <= 0) return d.fromValue;
  // a soft ease so the bank lets go, rolls, and catches at the detent.
  const e = k * k * (3 - 2 * k); // smoothstep
  return d.fromValue + (d.value - d.fromValue) * e;
}

// --- render ------------------------------------------------------------------

/** Draw the bank at time t. Mirrors the standalone's per-wheel cylinder render;
 *  `base` now comes from the driver (interpolated value) instead of the
 *  continuous count. Returns whether a roll is still in progress (RAF pause). */
export function renderOdometer(
  ctx: CanvasRenderingContext2D,
  d: OdometerDriver,
  p: OdometerParams,
  t: number,
  rng: Rng,
): boolean {
  const { w, h } = stageSize(ctx);
  const bg = hex2rgb(p.bg);
  const drumBase = hex2rgb(p.invert ? p.ink : p.drum);
  const inkBase = hex2rgb(p.invert ? p.drum : p.ink);
  const inkWarm = mix(inkBase, [255, 196, 120], (p.tint / 100) * 0.5);
  if (!p.transparent) {
    ctx.fillStyle = rgba(bg, 1);
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.clearRect(0, 0, w, h);
  }

  const n = Math.max(1, p.digits | 0);
  const pad = Math.min(w, h) * 0.08;
  const gapFrac = 0.07;

  const aspect = 0.66;
  let dh = h - pad * 2;
  let dw = dh * aspect;
  let gp = dw * gapFrac;
  const maxW = w - pad * 2;
  const total = () => dw * n + gp * (n - 1);
  if (total() > maxW) {
    const s = maxW / total();
    dw *= s;
    dh *= s;
    gp = dw * gapFrac;
  }
  const fontPx = dh * 0.62;
  const curv = p.curve / 100;
  const startX = (w - total()) / 2;
  const midY = h / 2;

  // ---- driver: the value to display (rolling old→new, eased) ----
  let rolling = false;
  let base: number;
  if (d.animating) {
    const k = (t - d.startedAt) / ROLL_MS;
    if (k >= 1) {
      base = d.value;
      d.animating = false;
    } else {
      base = currentDisplayValue(d, t);
      rolling = true;
    }
  } else {
    base = d.value;
  }

  const easeAmt = p.easing / 100;
  const worn = p.worn / 100;
  const alignAmt = p.align / 100;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < n; i++) {
    const place = n - 1 - i; // i=0 is leftmost (highest) place
    const pos = base / Math.pow(10, place);
    const whole = Math.floor(pos);
    // At REST the bank must read as crisp whole digits. The continuous-counter
    // model (`frac = pos - whole`) leaves the higher wheels mid-roll — e.g. value
    // 300 on a 4-wheel bank rolls the thousands wheel to 0.3, showing a permanent
    // HALF digit. So apply the rolling offset (and the wear misalignment) ONLY
    // while a roll is in progress; at rest every wheel snaps to roll 0 so only
    // its center digit shows. (Wear at rest could nudge u past the lip and even
    // skip the center digit, so it's dropped from the resting frame entirely.)
    let roll = 0;
    if (rolling) {
      const rawFrac = pos - whole;
      const flipping =
        rawFrac > 0.62
          ? ease((rawFrac - 0.62) / 0.38, easeAmt) * 0.38 + 0.62
          : rawFrac;
      const frac = place === 0 ? ease(rawFrac, easeAmt * 0.5) : flipping;
      const misalign = (rng.hash(i + 3, 17) - 0.5) * alignAmt * 0.1;
      const highWheel = rng.hash(i + 7, 41) < 0.16 ? -0.06 : 0;
      roll = frac + misalign + highWheel;
    }

    const cx = startX + dw * (i + 0.5) + gp * i;
    const x0 = cx - dw / 2;

    // --- drum face: vertical gradient (lit top → shadowed lip) ---
    const faceG = ctx.createLinearGradient(0, midY - dh / 2, 0, midY + dh / 2);
    faceG.addColorStop(0.0, rgba(mix(drumBase, [0, 0, 0], 0.55), 1));
    faceG.addColorStop(0.5, rgba(drumBase, 1));
    faceG.addColorStop(1.0, rgba(mix(drumBase, [0, 0, 0], 0.62), 1));
    ctx.fillStyle = faceG;
    ctx.fillRect(x0, midY - dh / 2, dw, dh);

    // --- engraved digits: resting digit + curled neighbours ---
    for (let k = -2; k <= 2; k++) {
      const u = k - ((((roll % 1) + 1) % 1));
      if (Math.abs(u) > 0.62) continue;
      const cyl = cylinder(u, curv);
      const dy = cyl.y * dh;
      const digit =
        ((whole + k + (roll >= 1 ? Math.floor(roll) : 0)) % 10 + 10) % 10;
      const lip = 1 - Math.min(1, Math.abs(u) / 0.62);
      const wpaint = 1 - worn * rng.hash(i * 11 + digit, 53) * 0.55;
      const a = (0.18 + 0.82 * lip) * wpaint;
      ctx.save();
      ctx.translate(cx, midY + dy);
      ctx.scale(1, cyl.s);
      ctx.font = `${fontPx}px ${DRUM_FONT}`;
      ctx.fillStyle = rgba(inkWarm, a);
      ctx.fillText(String(digit), 0, 0);
      ctx.restore();
    }

    // --- drum sheen: soft horizontal highlight across the upper third ---
    if (p.sheen > 0) {
      const sy = midY - dh * (0.1 + 0.04 * rng.hash(i + 5, 29));
      const sheenG = ctx.createLinearGradient(
        0,
        sy - dh * 0.18,
        0,
        sy + dh * 0.18,
      );
      const sa = (p.sheen / 100) * 0.22;
      sheenG.addColorStop(0, rgba([255, 255, 255], 0));
      sheenG.addColorStop(0.5, rgba([255, 255, 255], sa));
      sheenG.addColorStop(1, rgba([255, 255, 255], 0));
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = sheenG;
      ctx.fillRect(x0, midY - dh / 2, dw, dh);
      ctx.restore();
    }

    // --- inter-drum gap shadow: dark seam down each side ---
    if (p.gapShadow > 0) {
      const gw = Math.max(2, dw * 0.1);
      const ga = (p.gapShadow / 100) * 0.7;
      for (const sx of [x0, x0 + dw - gw]) {
        const seamG = ctx.createLinearGradient(sx, 0, sx + gw, 0);
        const lead = sx === x0;
        seamG.addColorStop(lead ? 0 : 1, rgba([0, 0, 0], ga));
        seamG.addColorStop(lead ? 1 : 0, rgba([0, 0, 0], 0));
        ctx.fillStyle = seamG;
        ctx.fillRect(sx, midY - dh / 2, gw, dh);
      }
    }

    // --- window lip: top/bottom shadow bars (digit looks cropped) ---
    const lipH = dh * 0.1;
    const topG = ctx.createLinearGradient(
      0,
      midY - dh / 2,
      0,
      midY - dh / 2 + lipH,
    );
    topG.addColorStop(0, rgba([0, 0, 0], 0.85));
    topG.addColorStop(1, rgba([0, 0, 0], 0));
    ctx.fillStyle = topG;
    ctx.fillRect(x0, midY - dh / 2, dw, lipH);
    const botG = ctx.createLinearGradient(
      0,
      midY + dh / 2 - lipH,
      0,
      midY + dh / 2,
    );
    botG.addColorStop(0, rgba([0, 0, 0], 0));
    botG.addColorStop(1, rgba([0, 0, 0], 0.85));
    ctx.fillStyle = botG;
    ctx.fillRect(x0, midY + dh / 2 - lipH, dw, lipH);
  }

  // --- frame: a hairline bezel around the whole bank ---
  ctx.strokeStyle = rgba(mix(bg, [255, 255, 255], 0.22), 0.5);
  ctx.lineWidth = Math.max(1, dw * 0.02);
  ctx.strokeRect(
    startX - gp,
    midY - dh / 2 - gp,
    total() + gp * 2,
    dh + gp * 2,
  );

  vignette(ctx, w, h, p.vignette / 100);

  return rolling;
}
