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
  },
  {
    version: '0.4.0',
    date: 'Jun 13',
    status: 'shipped',
    title: 'discovery fog',
    items: ['dark / memory / live tiers', 'silhouette previews'],
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
export const TEST_COUNT = 561;
