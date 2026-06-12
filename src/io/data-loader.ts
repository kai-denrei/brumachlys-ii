// Loads JSON registries (units.json, terrain.json) into typed shapes.
// Ported from v1 io/data-loader.ts. In Vite (and vitest via the Vite
// pipeline), JSON imports are first-class — this is mostly a typing wrapper.
// `resolveJsonModule` is on, so both `npm run build` (tsc) and node-env
// vitest resolve these imports.

import type { TerrainKey } from '../board/types';
import type { TerrainType, UnitType } from '../core/types';
import unitsJson from '../../data/units.json';
import terrainJson from '../../data/terrain.json';

export function loadUnits(): Record<string, UnitType> {
  // The JSON shape matches UnitType — asserted via the type checker at the
  // call sites; the registry is authored against spec §6.1/§6.2 and pinned
  // by test/core/data.test.ts.
  return unitsJson as unknown as Record<string, UnitType>;
}

export function loadTerrain(): Record<TerrainKey, TerrainType> {
  return terrainJson as unknown as Record<TerrainKey, TerrainType>;
}
