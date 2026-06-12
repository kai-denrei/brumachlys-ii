// @vitest-environment jsdom
// v1.4 — battle recap dashboard: store accumulation of fog-filtered round
// summaries (dealt/taken/fizzles/brawls/rounds), the brawl-chain counter, and
// the banner dashboard rendering (icon rows in CasualtyPanel vocabulary +
// stat grid). FOG HONESTY is by construction: the recap accumulates ONLY the
// replay script's summary/slots, which state/replay.ts already filtered
// through the player's fog (witnessed kills, shown strikes, seen fizzles).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { CellId } from '../../src/board/types';
import type { FactionId } from '../../src/core/types';
import type { ReplayScript, Strike, TimelineSlot } from '../../src/state/replay';
import { EMPTY_RECAP, countWitnessedBrawls, useAppStore } from '../../src/state/store';
import { GameOverBanner } from '../../src/ui/Replay';

afterEach(cleanup);

const s = () => useAppStore.getState();

function brawlStrike(cell: CellId, att: string, def: string): Strike {
  return {
    kind: 'brawl',
    attackerId: att,
    attackerType: 'infantry',
    attackerCell: cell,
    attackerFaction: 0,
    defenderId: def,
    defenderType: 'infantry',
    defenderCell: cell,
    defenderFaction: 1,
    damage: 3,
    fromMist: false,
    breakdown: {
      A: 8,
      Ta: 0,
      D: 4,
      Td: 0,
      B: 0,
      gangUp: { total: 0, contributions: [] },
      p: 0.7,
      damage: 3,
    },
  };
}

function slot(kind: TimelineSlot['kind'], strikes: Strike[] = []): TimelineSlot {
  return { kind, actorType: 'infantry', actorFaction: 0, strikes };
}

function script(over: Partial<ReplayScript> = {}): ReplayScript {
  return {
    slots: [],
    frames: [],
    log: [],
    discovered: new Set<CellId>(),
    summary: { kills: [], damageDealt: [0, 0], fizzles: 0 },
    ...over,
  };
}

describe('countWitnessedBrawls (v1.4)', () => {
  it('consecutive slots of the SAME brawl (cell + pair) count once', () => {
    const slots = [
      slot('brawl', [brawlStrike(5, 'a', 'x')]),
      slot('brawl', [brawlStrike(5, 'a', 'x')]), // follow-up exchange
      slot('brawl', [brawlStrike(5, 'a', 'x')]),
    ];
    expect(countWitnessedBrawls(slots)).toBe(1);
  });

  it('different cell or pair = different brawl; other slot kinds break a chain', () => {
    const slots = [
      slot('brawl', [brawlStrike(5, 'a', 'x')]),
      slot('brawl', [brawlStrike(7, 'b', 'y')]), // other brawl
      slot('move'),
      slot('brawl', [brawlStrike(7, 'b', 'y')]), // chain broken → new brawl
      slot('volley', [brawlStrike(9, 'c', 'z')]),
      slot('fizzle'),
    ];
    expect(countWitnessedBrawls(slots)).toBe(3);
  });

  it('empty timeline = no brawls', () => {
    expect(countWitnessedBrawls([])).toBe(0);
  });
});

describe('battle recap accumulation (v1.4)', () => {
  beforeEach(() => {
    useAppStore.setState({
      screen: 'battle',
      uiPhase: 'summary',
      game: null,
      battleLog: [],
      casualties: [],
      recap: EMPTY_RECAP,
    });
  });

  it('closeSummary folds the round summary into the battle-long recap', () => {
    useAppStore.setState({
      replay: {
        round: 3,
        script: script({
          summary: {
            kills: [{ id: 'x', type: 'tank', faction: 1 as FactionId }],
            damageDealt: [9, 4],
            fizzles: 2,
          },
          slots: [slot('brawl', [brawlStrike(5, 'a', 'x')]), slot('brawl', [brawlStrike(5, 'a', 'x')])],
        }),
      },
    });
    s().closeSummary();
    expect(s().recap).toEqual({ rounds: 3, dealt: 9, taken: 4, fizzles: 2, brawls: 1, spent: 0 });

    // Next round accumulates; rounds tracks the LAST resolved round.
    useAppStore.setState({
      uiPhase: 'summary',
      replay: {
        round: 4,
        script: script({ summary: { kills: [], damageDealt: [2, 7], fizzles: 1 } }),
      },
    });
    s().closeSummary();
    expect(s().recap).toEqual({ rounds: 4, dealt: 11, taken: 11, fizzles: 3, brawls: 1, spent: 0 });
  });

  it('accrues on the game-over close too (summary → banner path)', () => {
    useAppStore.setState({
      game: {
        round: 6,
        phase: 'over',
        board: { cells: new Map(), seed: 0, donorMapId: 't' },
        units: {},
        pendingOrders: { 0: [], 1: [] },
        rngSeed: 1,
        log: [],
        outcome: { winner: 0, reason: 'annihilation' },
      },
      replay: {
        round: 5,
        script: script({ summary: { kills: [], damageDealt: [6, 1], fizzles: 0 } }),
      },
    });
    s().closeSummary();
    expect(s().uiPhase).toBe('over');
    expect(s().recap).toEqual({ rounds: 5, dealt: 6, taken: 1, fizzles: 0, brawls: 0, spent: 0 });
  });

  it('resets on a new battle', () => {
    useAppStore.setState({ recap: { rounds: 9, dealt: 50, taken: 40, fizzles: 3, brawls: 2, spent: 0 } });
    s().rematch(42);
    expect(s().recap).toEqual(EMPTY_RECAP);
  });
});

describe('GameOverBanner dashboard (v1.4)', () => {
  beforeEach(() => {
    useAppStore.setState({
      recap: { rounds: 12, dealt: 73, taken: 58, fizzles: 4, brawls: 3, spent: 0 },
      casualties: [
        { type: 'sniper', faction: 0 },
        { type: 'tank', faction: 1 },
        { type: 'tank', faction: 1 },
      ],
    });
  });

  it('victory keeps its line and shows the populated dashboard', () => {
    const { container, getByTestId, getByText } = render(
      <GameOverBanner
        outcome={{ winner: 0, reason: 'annihilation' }}
        seedSuggestion={1}
        onRematch={() => {}}
        onChangeBattlefield={() => {}}
      />,
    );
    getByText('The mist parts. The field is yours.');
    const recap = getByTestId('battle-recap');
    const nums = [...recap.querySelectorAll('.summary-num')].map((el) => el.textContent);
    expect(nums).toEqual(['12', '73', '58', '4', '3']);
    // icon rows: 1 fallen + 2 enemy destroyed (chess style, repeats repeat)
    expect(container.querySelectorAll('.recap-icon-row').length).toBe(2);
    expect(recap.querySelectorAll('.casualty-icon').length).toBe(3);
  });

  it('draw keeps its line; empty rows say so instead of vanishing', () => {
    useAppStore.setState({ casualties: [] });
    const { getByTestId, getByText } = render(
      <GameOverBanner
        outcome={{ winner: null, reason: 'round-limit' }}
        seedSuggestion={1}
        onRematch={() => {}}
        onChangeBattlefield={() => {}}
      />,
    );
    getByText('Forty rounds, and no decision. A draw.');
    const recap = getByTestId('battle-recap');
    expect(recap.querySelectorAll('.casualty-icon').length).toBe(0);
    expect(recap.querySelectorAll('.recap-none').length).toBe(2);
  });
});
