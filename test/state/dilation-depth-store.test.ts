// Sequencing §5 — the COMBAT DILATION-DEPTH store knob: value + persistence +
// clamp. A second control independent of replaySpeed; it scales combat beat
// durations only. Persisted to localStorage "brumachlys.dilationDepth", clamped
// to [1.0, 4.0] on load + save, default 1.6×. (Spec §9.)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadDilationDepth,
  saveDilationDepth,
  DILATION_DEPTH_DEFAULT,
  DILATION_DEPTH_MIN,
  DILATION_DEPTH_MAX,
} from '../../src/state/store';

const KEY = 'brumachlys.dilationDepth';

// A minimal in-memory localStorage for node env (the store reads global localStorage).
class MemStore {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemStore());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadDilationDepth', () => {
  it('defaults to 1.6× when unset', () => {
    expect(loadDilationDepth()).toBe(DILATION_DEPTH_DEFAULT);
    expect(DILATION_DEPTH_DEFAULT).toBe(1.6);
  });

  it('reads a valid persisted value', () => {
    localStorage.setItem(KEY, '2.5');
    expect(loadDilationDepth()).toBe(2.5);
  });

  it('clamps an out-of-range stored value into [1.0, 4.0]', () => {
    localStorage.setItem(KEY, '9');
    expect(loadDilationDepth()).toBe(DILATION_DEPTH_MAX);
    localStorage.setItem(KEY, '0.1');
    expect(loadDilationDepth()).toBe(DILATION_DEPTH_MIN);
  });

  it('falls back to the default on garbage / NaN', () => {
    localStorage.setItem(KEY, 'not-a-number');
    expect(loadDilationDepth()).toBe(DILATION_DEPTH_DEFAULT);
  });
});

describe('saveDilationDepth', () => {
  it('persists a clamped value (round-trips through load)', () => {
    saveDilationDepth(2.2);
    expect(loadDilationDepth()).toBe(2.2);
  });

  it('clamps an out-of-range value before persisting', () => {
    saveDilationDepth(100);
    expect(loadDilationDepth()).toBe(DILATION_DEPTH_MAX);
    expect(localStorage.getItem(KEY)).toBe(String(DILATION_DEPTH_MAX));
  });
});

describe('storage unavailable / blocked — try/caught', () => {
  it('load returns the default when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
    });
    expect(loadDilationDepth()).toBe(DILATION_DEPTH_DEFAULT);
    // save swallows the error (no throw)
    expect(() => saveDilationDepth(2.0)).not.toThrow();
  });

  it('load returns the default when localStorage is undefined', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadDilationDepth()).toBe(DILATION_DEPTH_DEFAULT);
  });
});

describe('store setter — setDilationDepth clamps + persists', () => {
  it('clamps the value into range and writes it to the store + storage', async () => {
    const { useAppStore } = await import('../../src/state/store');
    useAppStore.getState().setDilationDepth(3.3);
    expect(useAppStore.getState().dilationDepth).toBe(3.3);
    expect(loadDilationDepth()).toBe(3.3);

    useAppStore.getState().setDilationDepth(99);
    expect(useAppStore.getState().dilationDepth).toBe(DILATION_DEPTH_MAX);
  });
});
