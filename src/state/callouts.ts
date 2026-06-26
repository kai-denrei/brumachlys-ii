// callouts.ts — Feature A (callouts + dilation-clock design §2): the combat
// CALLOUT term tables + the deterministic flavor-term picker.
//
// A callout is a transient military-font pop-up that fires at a combat event on
// the BOARD (path-interrupted crossing, lost-target fizzle, base capture, unit
// kill). The flavor word is chosen DETERMINISTICALLY from a per-kind table by a
// stable hash of the event — so scrubbing/replaying the SAME event always shows
// the SAME word (spec §1: NO Math.random; playback is a function of (turn, t)).
//
// PURE: this module is `state/`-resident but takes no ambient input — it is a
// table + a hash, unit-testable without a DOM. The hash is the SAME FNV-1a util
// the resolver uses for initiative tie-breaks (core/rng.ts), so the pick is
// stable, portable, and shares the codebase's one deterministic-choice channel.

import type { CellId } from '../board/types';
import { fnv1a32 } from '../core/rng';

/** The event a callout announces. Drives which term table is sampled and the
 *  render styling (own vs enemy kills read differently). */
export type CalloutKind =
  | 'crossing' // path-interrupted (forced crossing) — replaces the CrossSign text
  | 'no-target' // lost-target fizzle
  | 'captured' // a base flipped
  | 'kill-own' // a PLAYER unit destroyed
  | 'kill-enemy'; // an enemy unit destroyed

/** A board-anchored callout pop-up for one frame: the cell it fires at, the
 *  resolved flavor `text`, and its `kind` (styling). Built fog-gated in
 *  buildReplay, rendered by ReplayFx (floats up + fades). */
export type Callout = {
  cell: CellId;
  text: string;
  kind: CalloutKind;
};

/** Verbatim term tables (spec §2.1). The own-destroyed table holds a `{type}`
 *  placeholder that calloutTerm interpolates with the unit's display name. */
export const CALLOUT_TERMS: Readonly<Record<CalloutKind, readonly string[]>> = {
  crossing: ['CONTACT!', 'Skirmish!', 'Engage!', 'Meeting Engagement!'],
  'no-target': [
    'No Target!',
    'SNAFU!',
    'WTF!',
    'MIA!',
    'DUSTWUN!',
    'Out of Position!',
  ],
  captured: ['CAPT!', 'Captured!', 'All your Bases Are Belong To Us!'],
  'kill-own': ['{type} Down!', 'KIA!', 'MIA!'],
  'kill-enemy': [
    'Tango Down!',
    'Target Down!',
    'Kill Confirmed!',
    'Hit!',
    'Neutralized!',
    'Destroyed!',
  ],
};

/** PURE: pick the flavor term for a callout deterministically —
 *  `TABLE[ fnv1a32(eventKey) % TABLE.length ]`. The same `eventKey` always
 *  yields the same term (scrub/replay stability); distinct keys spread across
 *  the table. `unitName` interpolates a `{type}` placeholder (own-kill table);
 *  tables without the placeholder ignore it. */
export function calloutTerm(
  kind: CalloutKind,
  eventKey: string,
  unitName?: string,
): string {
  const table = CALLOUT_TERMS[kind];
  const term = table[fnv1a32(eventKey) % table.length]!;
  return unitName !== undefined ? term.replace('{type}', unitName) : term;
}
