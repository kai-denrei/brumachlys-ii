// @vitest-environment jsdom
// E3 — game-over banner: conquest outcome copy (conquest / base-collapse /
// round-limit with base counts) + the two conquest dashboard stats.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { EMPTY_RECAP, useAppStore } from '../../src/state/store';
import { GameOverBanner, outcomeText } from '../../src/ui/Replay';

afterEach(cleanup);

describe('outcomeText — conquest copy', () => {
  it('conquest win/loss/draw', () => {
    expect(outcomeText({ winner: 0, reason: 'conquest' }).title).toBe('VICTORY');
    expect(outcomeText({ winner: 0, reason: 'conquest' }).sub).toContain('Conquest');
    expect(outcomeText({ winner: 1, reason: 'conquest' }).title).toBe('DEFEAT');
    expect(outcomeText({ winner: null, reason: 'conquest' }).title).toBe('MUTUAL RUIN');
  });

  it('base collapse names the grace mechanic', () => {
    expect(outcomeText({ winner: 0, reason: 'base-collapse' }).title).toBe('VICTORY');
    const lost = outcomeText({ winner: 1, reason: 'base-collapse' });
    expect(lost.title).toBe('DEFEAT');
    expect(lost.sub).toContain('without a base');
  });

  it('conquest round limit reports the base counts', () => {
    const counts = { playerBases: 3, enemyBases: 1 };
    expect(outcomeText({ winner: 0, reason: 'round-limit' }, counts).sub).toContain(
      'Bases 3 to 1',
    );
    expect(
      outcomeText({ winner: null, reason: 'round-limit' }, { playerBases: 2, enemyBases: 2 }).sub,
    ).toContain('A draw');
    // skirmish round limit keeps the v1 copy
    expect(outcomeText({ winner: null, reason: 'round-limit' }).sub).toContain('Forty rounds');
  });
});

describe('GameOverBanner — conquest dashboard stats', () => {
  it('adds bases held + credits spent in conquest mode only', () => {
    useAppStore.setState({ recap: { ...EMPTY_RECAP, rounds: 9, spent: 525 }, casualties: [] });
    const { getByTestId } = render(
      <GameOverBanner
        outcome={{ winner: 0, reason: 'conquest' }}
        conquest={{ playerBases: 4, enemyBases: 0 }}
        seedSuggestion={1}
        onRematch={() => {}}
        onChangeBattlefield={() => {}}
      />,
    );
    const labels = [...getByTestId('battle-recap').querySelectorAll('.summary-label')].map(
      (el) => el.textContent,
    );
    expect(labels).toContain('bases held');
    expect(labels).toContain('credits spent');
    expect(getByTestId('battle-recap').textContent).toContain('525');

    cleanup();
    const skirmish = render(
      <GameOverBanner
        outcome={{ winner: 0, reason: 'annihilation' }}
        seedSuggestion={1}
        onRematch={() => {}}
        onChangeBattlefield={() => {}}
      />,
    );
    const sLabels = [...skirmish.getByTestId('battle-recap').querySelectorAll('.summary-label')].map(
      (el) => el.textContent,
    );
    expect(sLabels).not.toContain('bases held');
  });
});
