// CreditsOdometer.tsx — a compact canvas mechanical odometer showing available
// credits. Faithful port of the attached standalone, adapted to DISPLAY a value
// and ROLL the drums on change over ~600 ms (see odometer.ts driver), then hold —
// NOT continuous counting.
//
// Same canvas/RAF/cleanup/a11y pattern as RoundFlap: dpr-aware compact canvas, a
// RAF loop that pauses once the roll settles, RAF cleanup on unmount, prefers-
// reduced-motion honoured (snap), visually-hidden label ("credits 300").

import { useEffect, useRef } from 'react';
import { type DprCanvas, makeRng } from './core';
import {
  BRASS_LIGHT,
  createOdometerDriver,
  renderOdometer,
  setValue,
} from './odometer';

/** Stable wear seed for the drum wear (pinned so it does not crawl). */
const ODO_SEED = 0x0d0e7e;
/** Per-digit width / box height for the compact HUD (CSS px). */
const DIGIT_W = 18;
const BOX_H = 32;
/** Minimum drum count — credits never read narrower than this. */
const MIN_DIGITS = 3;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Drum count to show a value (grows with magnitude, floored at MIN_DIGITS). */
function digitsFor(value: number): number {
  return Math.max(MIN_DIGITS, String(Math.max(0, Math.floor(value))).length);
}

export function CreditsOdometer({ value }: { value: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const driverRef = useRef(createOdometerDriver(value));
  const rafRef = useRef<number | null>(null);
  const prevValueRef = useRef<number>(value);
  const paramsRef = useRef({ ...BRASS_LIGHT, digits: digitsFor(value) });
  const startLoopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current as DprCanvas | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    // jsdom returns null — the visually-hidden label is the test-visible value.
    if (!ctx) return;

    const rng = makeRng(ODO_SEED);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas._dpr = dpr;
    sizeCanvas(canvas, paramsRef.current.digits);

    const draw = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const rolling = renderOdometer(ctx, driverRef.current, paramsRef.current, t, rng);
      rafRef.current = rolling ? requestAnimationFrame(draw) : null;
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

  // value change → roll once (or snap under reduced motion), then hold.
  useEffect(() => {
    if (prevValueRef.current === value) return;
    prevValueRef.current = value;
    // grow the drum count if the new value needs more places.
    const want = digitsFor(value);
    if (want !== paramsRef.current.digits) {
      paramsRef.current = { ...paramsRef.current, digits: want };
      const canvas = canvasRef.current as DprCanvas | null;
      if (canvas) sizeCanvas(canvas, want);
    }
    setValue(
      driverRef.current,
      value,
      typeof performance !== 'undefined' ? performance.now() : Date.now(),
      !prefersReducedMotion(),
    );
    startLoopRef.current?.();
  }, [value]);

  return (
    <span className="credits-odometer" data-testid="credits-odometer">
      <canvas ref={canvasRef} aria-hidden="true" className="credits-odometer-canvas" />
      <span className="visually-hidden" aria-label={`credits ${value}`}>
        credits {value}
      </span>
    </span>
  );
}

/** Size the dpr-aware canvas for `digits` drums (only touches dims on change). */
function sizeCanvas(canvas: DprCanvas, digits: number): void {
  const dpr = canvas._dpr || 1;
  const cssW = DIGIT_W * digits;
  const wantW = Math.round(cssW * dpr);
  if (canvas.width !== wantW) {
    canvas.width = wantW;
    canvas.style.width = `${cssW}px`;
  }
  const wantH = Math.round(BOX_H * dpr);
  if (canvas.height !== wantH) {
    canvas.height = wantH;
    canvas.style.height = `${BOX_H}px`;
  }
}
