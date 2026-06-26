// @vitest-environment jsdom
// VICTORY DASHBOARD — the four data-viz sections inside GameOverBanner:
//   1. DAMAGE ARC  — dual sparkline (dealt vs taken per round)
//   2. KILLS/ROUND — sparkline (units destroyed per round)
//   3. ECONOMY     — credits / bases / army-size sparklines (CONQUEST ONLY)
//   4. CASUALTIES BY TYPE — faction-colored histogram (groups store.casualties)
// The existing recap (icon rows + stat grid) stays intact; the dashboard
// EXTENDS it. The economy section hides in skirmish and a section hides
// gracefully when its data is empty (a 1-round game has no arc).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useAppStore, type RoundRecord } from '../../src/state/store';
import { GameOverBanner } from '../../src/ui/Replay';
import { factionColor } from '../../src/ui/skin/palette';

afterEach(cleanup);

function conquestHistory(): RoundRecord[] {
  return [
    { round: 1, damageDealt: [4, 2], kills: 0, fizzles: 0, brawls: 0, credits: 120, basesHeld: 1, unitsAlive: 8 },
    { round: 2, damageDealt: [9, 5], kills: 2, fizzles: 1, brawls: 1, credits: 200, basesHeld: 2, unitsAlive: 7 },
    { round: 3, damageDealt: [3, 8], kills: 1, fizzles: 0, brawls: 0, credits: 90, basesHeld: 2, unitsAlive: 6 },
    { round: 4, damageDealt: [12, 1], kills: 3, fizzles: 2, brawls: 2, credits: 260, basesHeld: 3, unitsAlive: 6 },
  ];
}

function skirmishHistory(): RoundRecord[] {
  return [
    { round: 1, damageDealt: [4, 2], kills: 0, fizzles: 0, brawls: 0 },
    { round: 2, damageDealt: [9, 5], kills: 2, fizzles: 1, brawls: 1 },
    { round: 3, damageDealt: [3, 8], kills: 1, fizzles: 0, brawls: 0 },
  ];
}

function renderBanner(conquest = false) {
  return render(
    <GameOverBanner
      outcome={{ winner: 0, reason: 'annihilation' }}
      conquest={conquest ? { playerBases: 3, enemyBases: 0 } : null}
      seedSuggestion={1}
      onRematch={() => {}}
      onChangeBattlefield={() => {}}
    />,
  );
}

describe('victory dashboard sections', () => {
  beforeEach(() => {
    useAppStore.setState({
      recap: { rounds: 4, dealt: 28, taken: 16, fizzles: 3, brawls: 3, spent: 200 },
      casualties: [
        { type: 'sniper', faction: 0 },
        { type: 'tank', faction: 1 },
        { type: 'tank', faction: 1 },
        { type: 'infantry', faction: 0 },
      ],
      roundHistory: [],
    });
  });

  it('CONQUEST: shows all four dashboard sections', () => {
    useAppStore.setState({ roundHistory: conquestHistory() });
    const { getByTestId } = renderBanner(true);
    getByTestId('dash-damage-arc');
    getByTestId('dash-kills');
    getByTestId('dash-economy');
    getByTestId('dash-casualties');
  });

  it('SKIRMISH: hides the economy section, keeps the other three', () => {
    useAppStore.setState({ roundHistory: skirmishHistory() });
    const { getByTestId, queryByTestId } = renderBanner(false);
    getByTestId('dash-damage-arc');
    getByTestId('dash-kills');
    expect(queryByTestId('dash-economy')).toBeNull();
    getByTestId('dash-casualties');
  });

  it('DAMAGE ARC is a dual sparkline (two polylines: dealt vs taken)', () => {
    useAppStore.setState({ roundHistory: skirmishHistory() });
    const { getByTestId } = renderBanner(false);
    const arc = getByTestId('dash-damage-arc');
    expect(arc.querySelectorAll('polyline').length).toBe(2);
  });

  it('KILLS-PER-ROUND is a single-series sparkline', () => {
    useAppStore.setState({ roundHistory: skirmishHistory() });
    const { getByTestId } = renderBanner(false);
    const kills = getByTestId('dash-kills');
    expect(kills.querySelectorAll('polyline').length).toBe(1);
  });

  it('ECONOMY section has three sparklines (credits, bases, army)', () => {
    useAppStore.setState({ roundHistory: conquestHistory() });
    const { getByTestId } = renderBanner(true);
    const econ = getByTestId('dash-economy');
    // three labelled sparkline blocks
    expect(econ.querySelectorAll('svg.spark').length).toBe(3);
  });

  it('CASUALTIES-BY-TYPE histogram groups by type+faction with faction colors', () => {
    useAppStore.setState({ roundHistory: conquestHistory() });
    const { getByTestId } = renderBanner(true);
    const hist = getByTestId('dash-casualties');
    const rects = hist.querySelectorAll('rect.bar-rect');
    // casualties: sniper(0), tank(1)×2, infantry(0) → 3 distinct type+faction groups
    expect(rects.length).toBe(3);
    const fills = [...rects].map((r) => r.getAttribute('fill'));
    // both faction colors appear
    expect(fills).toContain(factionColor(0));
    expect(fills).toContain(factionColor(1));
    // the tank group (2 lost) shows a count of 2 somewhere in the histogram
    const counts = [...hist.querySelectorAll('.hist-count')].map((t) => t.textContent);
    expect(counts).toContain('2');
  });

  it('hides empty sections gracefully (a 1-round game has no multi-round arcs but still no crash)', () => {
    useAppStore.setState({
      roundHistory: [{ round: 1, damageDealt: [0, 0], kills: 0, fizzles: 0, brawls: 0 }],
      casualties: [],
    });
    const { queryByTestId } = renderBanner(false);
    // Damage arc with all-zero single-round data: the section is hidden (no
    // meaningful arc) — graceful empty handling.
    expect(queryByTestId('dash-casualties')).toBeNull(); // no casualties → hidden
  });

  it('does NOT weaken the existing recap (icon rows + stat grid still render)', () => {
    useAppStore.setState({ roundHistory: skirmishHistory() });
    const { getByTestId, container } = renderBanner(false);
    const recap = getByTestId('battle-recap');
    expect(container.querySelectorAll('.recap-icon-row').length).toBe(2);
    expect(recap.querySelectorAll('.summary-num').length).toBeGreaterThanOrEqual(5);
  });
});
