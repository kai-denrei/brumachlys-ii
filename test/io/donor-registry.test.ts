// donor-registry.test.ts — guards registry/bundle drift: the ?raw imports must
// resolve (vitest runs them through the same Vite transform the app uses) and
// the registry must list exactly the XMLs bundled in data/maps/.

import { describe, expect, it, vi, beforeAll } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DONOR_ENTRIES, loadDonor } from '../../src/io/donor-registry';

const MAPS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/maps');

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {}); // unmapped air/naval units
});

describe('donor-registry', () => {
  it('lists exactly the 5 XMLs bundled in data/maps/', () => {
    const files = readdirSync(MAPS_DIR)
      .filter((f) => f.endsWith('.xml'))
      .map((f) => f.replace(/\.xml$/, ''))
      .sort();
    expect([...DONOR_ENTRIES.map((e) => e.id)].sort()).toEqual(files);
  });

  it('every entry parses to a DonorMap whose name matches the registry', () => {
    for (const entry of DONOR_ENTRIES) {
      const donor = loadDonor(entry.id);
      expect(donor.id).toBe(entry.id);
      expect(donor.name).toBe(entry.name);
      expect(donor.tiles.length).toBeGreaterThan(0);
    }
  });

  it('unknown id throws with the bundled list', () => {
    expect(() => loadDonor('nope')).toThrow(/unknown donor id/);
  });
});
