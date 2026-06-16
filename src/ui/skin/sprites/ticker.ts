// ticker.ts — one shared rAF clock for every animated sprite on the board.
// Subscribers receive a monotonic elapsed-ms `t`. The loop runs only while ≥1
// sprite is mounted, and is skipped entirely under prefers-reduced-motion
// (subscribers get a single t=0 tick → a static first frame) or when rAF is
// unavailable (tests / SSR). One loop for N sprites — not N timers.

type Tick = (t: number) => void;

const subs = new Set<Tick>();
let raf = 0;
let t0 = 0;

function reducedMotion(): boolean {
  try {
    return (
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

function loop(now: number): void {
  if (t0 === 0) t0 = now;
  const t = now - t0;
  subs.forEach((cb) => cb(t));
  raf = requestAnimationFrame(loop);
}

/** Subscribe to the shared clock; returns an unsubscribe. */
export function subscribeSprite(cb: Tick): () => void {
  if (typeof requestAnimationFrame !== 'function' || reducedMotion()) {
    cb(0); // static first frame (no animation loop)
    return () => {};
  }
  subs.add(cb);
  if (raf === 0) raf = requestAnimationFrame(loop);
  return () => {
    subs.delete(cb);
    if (subs.size === 0 && raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
      t0 = 0;
    }
  };
}
