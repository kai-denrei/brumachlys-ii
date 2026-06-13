// @vitest-environment jsdom
// v0.7 Item 4 — start-screen opponent archetype selector + store wiring.
// The selector lists ARCHETYPES (from the ai registry, or the greedy fallback
// when it hasn't landed) in BOTH modes, defaults to DEFAULT_ARCHETYPE, and
// writes archetypeKey into the store; commit() routes the SELECTED archetype's
// planner through planRound.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import {
  archetypeList,
  defaultArchetypeKey,
  archetypePlanner,
  useAppStore,
} from '../../src/state/store';
import { greedyPlanner } from '../../src/ai';
import { StartScreen } from '../../src/ui/StartScreen';

afterEach(cleanup);

describe('opponent archetype selector (v0.7 Item 4)', () => {
  beforeEach(() => {
    useAppStore.setState({
      screen: 'start',
      mode: 'conquest',
      archetypeKey: defaultArchetypeKey(),
    });
  });

  it('archetypeList is non-empty and defaultArchetypeKey is one of them', () => {
    const list = archetypeList();
    expect(list.length).toBeGreaterThan(0);
    const keys = list.map((a) => a.key);
    expect(keys).toContain(defaultArchetypeKey());
    for (const a of list) {
      expect(typeof a.label).toBe('string');
      expect(typeof a.blurb).toBe('string');
    }
  });

  it('renders the selector with the default selected and writes the store on pick', () => {
    const { getByTestId } = render(<StartScreen />);
    const sel = getByTestId('opponent-select');
    const cards = [...sel.querySelectorAll('.opponent-card')];
    expect(cards.length).toBe(archetypeList().length);
    const selected = sel.querySelector('.opponent-card-selected')!;
    expect(selected.getAttribute('data-archetype')).toBe(defaultArchetypeKey());

    // picking another (or the same when only one) writes the store
    const last = cards[cards.length - 1] as HTMLButtonElement;
    fireEvent.click(last);
    expect(useAppStore.getState().archetypeKey).toBe(last.getAttribute('data-archetype'));
  });

  it('the selector is available in skirmish too', () => {
    useAppStore.setState({ mode: 'skirmish' });
    const { getByTestId } = render(<StartScreen />);
    expect(getByTestId('opponent-select')).toBeTruthy();
  });

  it('archetypePlanner falls back to greedyPlanner for an unknown key', () => {
    // before the ai registry lands, every key resolves to greedy
    expect(archetypePlanner('does-not-exist')).toBe(greedyPlanner);
  });

  it('commit() instantiates the selected archetype planner (no throw, advances round)', () => {
    useAppStore.setState({ screen: 'start', mode: 'conquest', archetypeKey: defaultArchetypeKey() });
    useAppStore.getState().startBattle();
    const before = useAppStore.getState().game!.round;
    useAppStore.getState().commit();
    expect(useAppStore.getState().uiPhase).toBe('replay');
    expect(useAppStore.getState().game!.round).toBe(before + 1);
  });
});
