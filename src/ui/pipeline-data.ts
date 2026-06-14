// Pipeline data — the dev pipeline tab's single source of truth (v0.5.1
// operator ask). PURE DATA: the modal renders whatever is here, so a future
// release ships its row by appending an entry and touching nothing else.
// Copy style matches the rules modal: laconic, telegraphic, hyphen free
// (en dashes and middle dots only) — shared test constraint.

export type PipelineStatus = 'shipped' | 'building' | 'next';

export type PipelineEntry = {
  /** Release label ("v1 · 0.2.0", "0.5.x", "next"). */
  version: string;
  /** Ship date, null while unscheduled. */
  date: string | null;
  status: PipelineStatus;
  /** One line theme for the release. */
  title: string;
  /** Laconic one liners. */
  items: string[];
  /** Short git SHA (7 chars). When set, a GitHub commit link is rendered next
   *  to the version label. Leave undefined for unshipped entries. */
  commit?: string;
};

/** Chronological, the parking lot last. Append new releases at the bottom
 *  of the shipped block. */
export const PIPELINE: PipelineEntry[] = [
  {
    version: 'v1 · 0.2.0',
    date: 'Jun 12',
    status: 'shipped',
    title: 'spec to playable in one day',
    items: [
      'procedural donor boards',
      'weewar combat with angle gang up',
      'fair fog AI',
      'fog honest replay',
      'GitHub Pages pipeline',
    ],
    commit: '8be1448',
  },
  {
    version: '0.3.x',
    date: 'Jun 12',
    status: 'shipped',
    title: 'the feel pass',
    items: [
      'vacancy moves · pass through fix',
      'real unit icons · rules modal',
      'skirmish log · hover cards',
      'replay feel: stagger, trails, casualty recap',
    ],
    commit: 'b72f4e7',
  },
  {
    version: '0.4.0',
    date: 'Jun 13',
    status: 'shipped',
    title: 'discovery fog',
    items: ['dark / memory / live tiers', 'silhouette previews'],
    commit: 'c898151',
  },
  {
    version: '0.5.x',
    date: 'Jun 13',
    status: 'shipped',
    title: 'CONQUEST',
    items: [
      'bases · credits · blind production · capture',
      'win modes · economy AI · mode select',
      'idle pulse · victory dashboard',
    ],
    commit: '76d9fe7',
  },
  {
    version: '0.8.x',
    date: 'Jun 14',
    status: 'shipped',
    title: 'veterancy · deliberate capture · faster resolution',
    items: [
      'veterancy ranks: xp · promotion · pips',
      'deliberate opt in base capture',
      'simultaneous replay: all moves then all combats',
      'size adaptive maps: small to large',
      'refreshed bases · capture claim animation',
      'auto advance turns · Enter to commit',
    ],
    commit: 'c1f61ca',
  },
  {
    version: '0.9.x',
    date: 'Jun 14',
    status: 'shipped',
    title: 'capture fix · propose then confirm · area denial',
    items: [
      'base art now always matches a capturable base',
      'propose then confirm moves · active unit halo',
      'ranged area denial: fire on an empty tile',
      'kill count · xp · rank in the unit card',
      'credit value of losses · clearer phase rules',
      'board holds steady when the speed control toggles',
      'health colored counts · enemy movement friction',
      'expandable casualties · tile adjacency guide',
    ],
    commit: 'd9fabf0',
  },
  {
    version: 'next',
    date: null,
    status: 'next',
    title: 'meta observation and balance passes',
    items: [
      'then, from the parking lot:',
      'air and naval rosters',
      'alternate combat resolution modes',
      'hot seat · PWA',
    ],
  },
];

/** Test count shown in the footer. DOCUMENTED CHOICE: hardcoded at release
 *  time rather than read at build time — the number is release identity
 *  (like the version), not a live metric, and a build step reading vitest
 *  output would couple the bundle to the test runner. Update alongside the
 *  version bump; the pipeline test pins it to this constant, not to the
 *  live suite. */
export const TEST_COUNT = 772;
