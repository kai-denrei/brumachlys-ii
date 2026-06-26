// CountFlap — the unit count pip's HP readout as a small split-flap card. When
// a unit is HIT during replay, the pip HOLDS its old count, then folds DOWN
// through the intermediate values (8→7→6→5) to the new count — the flap punctu-
// ates the impact spark so a hit READS as a loss. Reuses the split-flap *feel*
// (RoundFlap) but native SVG/CSS so it pans/zooms/clips with the board for free;
// no canvas. Unarmed (no hit this frame) it renders the static numeral exactly
// like before. The downward fold lives in CSS (.count-flap-card); the value
// stepping is driven here by timers off the witnessed-impact time (flipAtMs).
//
// Determinism: the flip is a pure function of the frame — buildHpFlips computes
// (fromCount, toCount, flipAtMs) deterministically from the script + cursor (no
// wall-clock), and the token re-arms via a per-frame keyed remount (flipKey), so
// landing on a frame always replays the identical flip. The timers here schedule
// off mount, exactly like every other FX in this layer (the CSS --proj-delay
// projectile tracks, recoil, the shell trail) — replay-pause halts frame advance,
// not in-frame FX, so this stays consistent. prefers-reduced-motion snaps.
import { useEffect, useState } from 'react';

/** ms between successive value flaps as the count ticks down (the split-flap
 *  cascade tempo). */
const STEP_MS = 90;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** count → ink colour, matching the static pip: high = black, mid = amber,
 *  low = red (the count doubles as a health readout). */
function gradeColor(n: number): string {
  return n >= 8 ? '#1a1a1a' : n >= 5 ? '#d97706' : '#dc2626';
}

export function CountFlap({
  fromCount,
  toCount,
  flipAtMs,
  pipR,
}: {
  /** pre-hit count (held until the impact lands). */
  fromCount: number;
  /** post-hit count (the settled value). */
  toCount: number;
  /** frame-relative ms at which the witnessed shot lands → the fold begins. */
  flipAtMs: number;
  /** pip radius — the numeral geometry is derived from it (matches the static pip). */
  pipR: number;
}) {
  const steps = Math.max(0, Math.round(fromCount - toCount));
  const reduce = prefersReducedMotion();
  const instant = reduce || steps === 0;
  const [idx, setIdx] = useState(instant ? steps : 0);

  useEffect(() => {
    if (instant) {
      setIdx(steps);
      return;
    }
    setIdx(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= steps; i++) {
      const at = flipAtMs + (i - 1) * STEP_MS;
      timers.push(setTimeout(() => setIdx(i), Math.max(0, at)));
    }
    return () => timers.forEach((t) => clearTimeout(t));
  }, [instant, steps, flipAtMs]);

  const value = fromCount - idx;
  const animating = !reduce && idx > 0;

  return (
    <text
      key={idx}
      className={animating ? 'count-flap-card' : undefined}
      y={pipR * 0.06}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={pipR * 1.35}
      fontWeight={700}
      fill={gradeColor(value)}
    >
      {value}
    </text>
  );
}
