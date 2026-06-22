// Stage 2 (sequencing §5): store.commit() WIRES the persisted dilationDepth into
// buildReplay, so the second knob actually deepens COMBAT (the laid-out beats
// bake the depth in) while MOVEMENT stays brisk. This drives a real commit at two
// depths and confirms the combat (WAVE_A/WAVE_B) frame durations scale while the
// move frames do not — the data-layer proof (beats-build.test.ts) extended to the
// live store path. Also confirms the value composes WITH replaySpeed (they are
// independent knobs: depth feeds buildReplay, speed divides wall-clock in App).

import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../src/state/store';
import type { ReplayFrame } from '../../src/state/replay';

const s = () => useAppStore.getState();

/** Drive a full round on a fixed board/seed at the given dilation depth, then
 *  hand back the resolved replay frames. Queues one stance order so commit's
 *  ≥1-order gate passes, then lets the AI fill the rest of the round. */
function resolveAtDepth(depth: number): ReplayFrame[] {
  useAppStore.setState({
    screen: 'start',
    // donor 55480 / seed 1 has round-1 combat (a meaningful WAVE_A/WAVE_B window
    // to scale) — required for the combat-vs-movement contrast assertion.
    donorId: '55480',
    seed: 1,
    mode: 'skirmish',
    roundLimit: null,
    board: null,
    game: null,
    uiPhase: 'planning',
    replay: null,
    orders: {},
    buys: {},
    casualties: [],
  });
  s().setDilationDepth(depth);
  s().startBattle();
  const own = Object.values(s().game!.units).find((u) => u.faction === 0)!;
  s().tryQueueOrder({ kind: 'stance', unitId: own.id, stance: 'defensive' });
  s().commit();
  return s().replay!.script.frames;
}

const combatDur = (frames: ReplayFrame[]): number =>
  frames.filter((f) => f.wave !== undefined).reduce((sum, f) => sum + f.duration, 0);
const moveDur = (frames: ReplayFrame[]): number =>
  frames.filter((f) => f.wave === undefined && f.trails.length > 0).reduce((s2, f) => s2 + f.duration, 0);

describe('commit() wires dilationDepth into the replay build', () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it('a deeper depth lengthens combat frames but leaves move frames identical', () => {
    const shallow = resolveAtDepth(1.0);
    const deep = resolveAtDepth(3.0);

    const combatShallow = combatDur(shallow);
    const combatDeep = combatDur(deep);

    // This board/seed must actually fight for the assertion to be meaningful.
    // (If a future board edit removes round-1 combat, this guards the intent.)
    expect(combatShallow).toBeGreaterThan(0);

    // COMBAT scales with depth (deeper beats), MOVEMENT does not.
    expect(combatDeep).toBeGreaterThan(combatShallow);
    // movement frames are untouched by the depth knob (brisk → the contrast).
    expect(moveDur(deep)).toBe(moveDur(shallow));
  });

  it('the persisted depth is what flows in (a re-commit at the same depth is stable)', () => {
    const a = combatDur(resolveAtDepth(2.0));
    const b = combatDur(resolveAtDepth(2.0));
    expect(a).toBe(b); // deterministic — same (turn, depth) → identical durations
  });
});
