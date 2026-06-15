// RoundFlap.tsx — a compact canvas split-flap (Solari) board showing the round
// number. Faithful port of the attached standalone, adapted to show a REAL value
// and flip ONCE on change (see splitflap.ts driver), then hold static.
//
// Pattern (shared with CreditsOdometer): a dpr-aware canvas sized to a compact
// HUD box, a requestAnimationFrame loop that PAUSES once the flip settles (no CPU
// burn while idle) and resumes when the value next changes, RAF cleanup on
// unmount, prefers-reduced-motion honoured (snap, no flip), and a visually-hidden
// accessible label ("round 3") so screen readers + tests can read the value.
//
// src/ui is the impure layer — DOM, RAF, matchMedia are all fair game here.

import { useEffect, useRef } from 'react';
import { type DprCanvas, makeRng } from './core';
import {
  SOLARI_LIGHT,
  createSplitFlapDriver,
  renderSplitFlap,
  setTarget,
} from './splitflap';

/** Stable wear seed — pinned so the worn-card variance does not crawl. */
const FLAP_SEED = 0x5031a2;
/** Per-digit width / box height for the compact HUD (CSS px) — defaults. */
const DIGIT_W = 22;
const BOX_H = 32;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function RoundFlap({
  value,
  digitW = DIGIT_W,
  boxH = BOX_H,
}: {
  value: number;
  /** Override per-digit CSS width (px). Defaults to ${DIGIT_W}. */
  digitW?: number;
  /** Override box height (px). Defaults to ${BOX_H}. */
  boxH?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const driverRef = useRef(createSplitFlapDriver(String(value)));
  const rafRef = useRef<number | null>(null);
  const prevValueRef = useRef<number>(value);
  // The RAF loop — created once the canvas mounts, re-armed on each value change
  // only while a flip is in progress (it self-cancels when the board settles).
  const startLoopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current as DprCanvas | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    // jsdom (test env) returns null — render is a no-op there; the visually-
    // hidden label below is what tests assert against, so this degrades cleanly.
    if (!ctx) return;

    const rng = makeRng(FLAP_SEED);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas._dpr = dpr;
    sizeCanvas(canvas, value, digitW, boxH);

    const draw = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const animating = renderSplitFlap(ctx, driverRef.current, SOLARI_LIGHT, t, rng);
      rafRef.current = animating ? requestAnimationFrame(draw) : null;
    };
    const startLoop = () => {
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(draw);
    };
    startLoopRef.current = startLoop;
    startLoop(); // initial paint; self-cancels once settled

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      startLoopRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // value change → flip once (or snap under reduced motion), then hold.
  useEffect(() => {
    if (prevValueRef.current === value) return;
    prevValueRef.current = value;
    const canvas = canvasRef.current as DprCanvas | null;
    if (canvas) sizeCanvas(canvas, value, digitW, boxH); // widen for an extra digit (R9 → R10)
    setTarget(
      driverRef.current,
      String(value),
      typeof performance !== 'undefined' ? performance.now() : Date.now(),
      SOLARI_LIGHT,
      !prefersReducedMotion(),
    );
    startLoopRef.current?.();
  }, [value]);

  return (
    <span className="round-flap" data-testid="round-flap">
      <canvas ref={canvasRef} aria-hidden="true" className="round-flap-canvas" />
      <span className="visually-hidden" aria-label={`round ${value}`}>
        round {value}
      </span>
    </span>
  );
}

/** Size the dpr-aware canvas to fit `value`'s digits (only touches width when it
 *  actually changes, so a same-length update is free). */
function sizeCanvas(
  canvas: DprCanvas,
  value: number,
  digitW: number = DIGIT_W,
  boxH: number = BOX_H,
): void {
  const dpr = canvas._dpr || 1;
  const digits = Math.max(1, String(value).length);
  const cssW = digitW * digits;
  const wantW = Math.round(cssW * dpr);
  if (canvas.width !== wantW) {
    canvas.width = wantW;
    canvas.style.width = `${cssW}px`;
  }
  const wantH = Math.round(boxH * dpr);
  if (canvas.height !== wantH) {
    canvas.height = wantH;
    canvas.style.height = `${boxH}px`;
  }
}
