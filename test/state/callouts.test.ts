// Feature A — combat callouts: the deterministic flavor-term picker
// (state/callouts.ts). PURE: term = TABLE[ fnv1a32(eventKey) % TABLE.length ].
// Scrubbing/replaying the same event MUST show the same term (no Math.random).

import { describe, expect, it } from 'vitest';
import {
  CALLOUT_TERMS,
  calloutTerm,
  type CalloutKind,
} from '../../src/state/callouts';
import { fnv1a32 } from '../../src/core/rng';

describe('callout term tables (verbatim from the spec §2.1)', () => {
  it('carries the exact crossing / path-interrupted terms', () => {
    expect(CALLOUT_TERMS.crossing).toEqual([
      'CONTACT!',
      'Skirmish!',
      'Engage!',
      'Meeting Engagement!',
    ]);
  });

  it('carries the exact no-target (lost-target) terms', () => {
    expect(CALLOUT_TERMS['no-target']).toEqual([
      'No Target!',
      'SNAFU!',
      'WTF!',
      'MIA!',
      'DUSTWUN!',
      'Out of Position!',
    ]);
  });

  it('carries the exact base-captured terms', () => {
    expect(CALLOUT_TERMS.captured).toEqual([
      'CAPT!',
      'Captured!',
      'All your Bases Are Belong To Us!',
    ]);
  });

  it('carries the exact enemy-destroyed terms', () => {
    expect(CALLOUT_TERMS['kill-enemy']).toEqual([
      'Tango Down!',
      'Target Down!',
      'Kill Confirmed!',
      'Hit!',
      'Neutralized!',
      'Destroyed!',
    ]);
  });

  it('carries the own-destroyed terms with a <unit type> slot', () => {
    // The own table holds a literal placeholder; calloutTerm interpolates it.
    expect(CALLOUT_TERMS['kill-own']).toEqual(['{type} Down!', 'KIA!', 'MIA!']);
  });
});

describe('calloutTerm — deterministic FNV pick', () => {
  it('is a pure function of (kind, eventKey): same key → same term', () => {
    const a = calloutTerm('kill-enemy', 'kill:e7:12');
    const b = calloutTerm('kill-enemy', 'kill:e7:12');
    expect(a).toBe(b);
  });

  it('uses exactly TABLE[ fnv1a32(eventKey) % TABLE.length ]', () => {
    const key = 'cross:pc:3';
    const table = CALLOUT_TERMS.crossing;
    const expected = table[fnv1a32(key) % table.length];
    expect(calloutTerm('crossing', key)).toBe(expected);
  });

  it('distinct event keys can vary across the table (not a constant)', () => {
    // Sweep many keys for the no-target table (6 entries) and confirm the
    // picker is not pinned to one slot — determinism without degeneracy.
    const picks = new Set<string>();
    for (let i = 0; i < 200; i++) {
      picks.add(calloutTerm('no-target', `lost:u${i}:cell${i}`));
    }
    expect(picks.size).toBeGreaterThan(1);
  });

  it('interpolates <unit type> for the own-destroyed table when the slot is picked', () => {
    // Find a key that lands on the "{type} Down!" slot (index 0) and confirm
    // the unit name is substituted; a key that lands elsewhere is untouched.
    const table = CALLOUT_TERMS['kill-own'];
    const slot0 = table.findIndex((t) => t.includes('{type}'));
    let keyOnSlot0: string | null = null;
    for (let i = 0; i < 500 && keyOnSlot0 === null; i++) {
      const k = `kill:p${i}:5`;
      if (fnv1a32(k) % table.length === slot0) keyOnSlot0 = k;
    }
    expect(keyOnSlot0).not.toBeNull();
    expect(calloutTerm('kill-own', keyOnSlot0!, 'Sniper')).toBe('Sniper Down!');
  });

  it('a name is only interpolated when present; tables without {type} ignore it', () => {
    // The enemy table never has a placeholder — passing a name changes nothing.
    const withName = calloutTerm('kill-enemy', 'kill:e1:2', 'Tank');
    const without = calloutTerm('kill-enemy', 'kill:e1:2');
    expect(withName).toBe(without);
    expect(withName).not.toContain('Tank');
  });

  it('covers every CalloutKind', () => {
    const kinds: CalloutKind[] = [
      'crossing',
      'no-target',
      'captured',
      'kill-own',
      'kill-enemy',
    ];
    for (const k of kinds) {
      expect(typeof calloutTerm(k, `${k}:x`)).toBe('string');
      expect(calloutTerm(k, `${k}:x`).length).toBeGreaterThan(0);
    }
  });
});
