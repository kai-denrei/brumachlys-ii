// donor-registry.ts — the bundled donor maps (spec §4.2), imported as raw XML
// strings via Vite `?raw`. UI-FACING: the start screen's map picker reads this
// list; src/board never sees raw XML (it receives parsed DonorMap objects).
// Node-env tests read the same files from data/maps/ with fs instead of
// importing this module.
//
// The first five were curated by scripts/scan-donors.mjs (criteria: maxPlayers
// == 2, 150–500 tiles, ≥1 base per faction, connectivity guard passed first try
// at seed 7; ranked by tile count ≈300, squareness, base count). 10701 "Tai
// Chi" was evaluated and does NOT qualify: its donor land splits into 3
// components (122/44/44 tiles) — it can never satisfy the §4.1 ≥80% guard.
//
// v0.8: three SMALL weewar maps were added (5 "Aruba" 59t, 52560 "Aruba
// Alternative" 47t, 65292 "smallest map" — only 6 tiles, 4 of them bases).
// These fall far below the original 150-tile curation floor, so the donor
// pipeline is now size-adaptive: meshTargetFor subdivides tiny donors harder to
// reach PLAYABLE_FLOOR_CELLS, and the placeability probe / starting force scale
// to the board (adaptiveForceSizeFor). All three regenerate into connected,
// playable boards (≥60 cells, two distinct anchors, full 16-unit conquest game)
// across seeds 1..16 — see test/board/donor.test.ts.

import vietFort from '../../data/maps/55480.xml?raw';
import puddles from '../../data/maps/33564.xml?raw';
import valleyRoad from '../../data/maps/53316.xml?raw';
import showdown from '../../data/maps/63319.xml?raw';
import spoonerHell from '../../data/maps/34069.xml?raw';
import smallestMap from '../../data/maps/65292.xml?raw';
import arubaAlt from '../../data/maps/52560.xml?raw';
import aruba from '../../data/maps/5.xml?raw';

import type { DonorMap } from '../board/donor';
import { parseWeewarMap, toDonorMap } from './weewar-xml';

export type DonorEntry = {
  /** Weewar map id (= data/maps/<id>.xml). */
  id: string;
  /** Display name for the map picker. */
  name: string;
  xml: string;
  /** Curated seed adopted the FIRST time this donor is picked (a known "good
   *  layout"). Omitted → the picker keeps whatever seed is in the box. The
   *  store fills it once per session, so a player's later seed edits stand. */
  defaultSeed?: number;
};

/** Bundled donors, picker order. */
export const DONOR_ENTRIES: readonly DonorEntry[] = [
  { id: '55480', name: 'vietFort', xml: vietFort },
  { id: '33564', name: 'Puddles', xml: puddles },
  { id: '53316', name: 'Valley Road', xml: valleyRoad },
  { id: '63319', name: '1v1 Showdown JMK', xml: showdown },
  { id: '34069', name: 'spooner hell', xml: spoonerHell },
  { id: '65292', name: 'smallest map', xml: smallestMap },
  { id: '52560', name: 'Aruba Alternative', xml: arubaAlt },
  { id: '5', name: 'Aruba', xml: aruba, defaultSeed: 25837 },
];

/** Parse a bundled donor by id. Throws on unknown id. */
export function loadDonor(id: string): DonorMap {
  const entry = DONOR_ENTRIES.find((e) => e.id === id);
  if (!entry) {
    throw new Error(`loadDonor: unknown donor id "${id}" (bundled: ${DONOR_ENTRIES.map((e) => e.id).join(', ')})`);
  }
  return toDonorMap(parseWeewarMap(entry.xml));
}
