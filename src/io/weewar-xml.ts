// weewar-xml.ts — Weewar map XML parser (spec §4.1 step 1–2), ported from v1.
//
// PARSER CHOICE (P2 decision): v1 used jsdom's DOMParser; II's vitest runs with
// `environment: 'node'` (no DOM). The Weewar map format is rigid machine-written
// XML (flat <map> header tags + a list of self-closing <terrain .../> elements),
// so this port replaces DOMParser with a dependency-free regex scan. This keeps
// the test environment 'node' and adds zero dependencies. The v1 test suite
// passes unchanged against this parser (three-ways: width 17, height 20,
// 190 tiles). Hand-written XML edge cases (nested CDATA, namespaces, attribute
// values containing '>') are out of scope — Weewar exports contain none.
//
// v1 behavioral contract preserved (DECISIONS §B.10–§B.12):
// - tiles are sparse, keyed "x,y" (q = x, r = y).
// - start units with owner faction >= 2 are dropped (one console.warn total).
// - unknown terrain falls back to plains with a warning.
// - unknown unit types are dropped with a warning.
// - base startFaction not in {0,1} collapses to neutral (null).
//
// II extensions over v1:
// - `id` (map id attribute) and `maxPlayers` are parsed (donor selection needs
//   them, spec §4.2).
// - `startUnitPositions` records EVERY faction-0/1 start unit position even when
//   the unit type is unmapped — the donor pipeline anchors force placement on
//   "first base, else first start unit" (§4.1 step 7) and must not lose anchors
//   to roster gaps.
// - TERRAIN_MAP covers the full Weewar tile census (Desert, Bridge, Harbor,
//   Airfield, Repairshop appear in the stash): desert/bridge/airfield/repairshop
//   → plains, harbor → water. Only genuinely unknown types warn.

import type { TerrainKey } from '../board/types';
import type { DonorMap, FactionId } from '../board/donor';

export type Hex = { q: number; r: number };

export type WeewarMap = {
  id: string; // <map id="..."> attribute; '' when absent
  name: string;
  width: number;
  height: number;
  maxPlayers: number;
  initialCredits: number;
  perBaseCredits: number;
  /** Sparse, keyed `${x},${y}`; insertion order = document order. */
  tiles: Map<string, TerrainKey>;
  startingUnits: Array<{ hex: Hex; unitTypeKey: string; faction: FactionId }>;
  startingBases: Array<{ hex: Hex; faction: FactionId | null }>;
  /** All faction-0/1 start-unit positions, document order, even if the unit
   * type is unmapped. Donor anchor source (§4.1 step 7). */
  startUnitPositions: Array<{ x: number; y: number; faction: FactionId }>;
};

// Maps Weewar's terrain-type attribute (case-insensitive) to our TerrainKey.
const TERRAIN_MAP: Record<string, TerrainKey> = {
  plains: 'plains',
  water: 'water',
  mountains: 'mountains',
  woods: 'woods',
  swamp: 'swamp',
  base: 'base',
  // II additions — full stash census (see header note):
  desert: 'plains',
  bridge: 'plains',
  harbor: 'water',
  airfield: 'plains',
  repairshop: 'plains',
};

// Weewar unit-type attribute → our internal key (case-insensitive).
// v1 mapped only Trooper; II maps the land roster (§6.1). Air/naval types
// (Jet, Bomber, Helicopter, Hovercraft, boats, subs) stay unmapped → dropped.
const UNIT_MAP: Record<string, string> = {
  trooper: 'infantry',
  'heavy trooper': 'grenadier',
  raider: 'humvee',
  tank: 'tank',
  'heavy tank': 'heavytank',
  berserker: 'heavytank',
  'light artillery': 'artillery',
  'heavy artillery': 'artillery',
  'assault artillery': 'artillery',
  dfa: 'artillery',
};

export function parseWeewarMap(xmlString: string): WeewarMap {
  const xml = xmlString.replace(/<!--[\s\S]*?-->/g, '');

  const mapMatch = /<map\b([^>]*)>([\s\S]*?)<\/map>/.exec(xml);
  if (!mapMatch) {
    throw new Error('parseWeewarMap: missing <map> root element');
  }
  const mapAttrs = parseAttrs(mapMatch[1]!);
  const body = mapMatch[2]!;

  const id = mapAttrs['id'] ?? '';
  const name = childText(body, 'name')?.trim() ?? 'Untitled';
  const width = parseIntStrict(childText(body, 'width'), 0);
  const height = parseIntStrict(childText(body, 'height'), 0);
  const maxPlayers = parseIntStrict(childText(body, 'maxPlayers'), 0);
  const initialCredits = parseIntStrict(childText(body, 'initialCredits'), 0);
  const perBaseCredits = parseIntStrict(childText(body, 'perBaseCredits'), 0);

  const tiles = new Map<string, TerrainKey>();
  const startingUnits: WeewarMap['startingUnits'] = [];
  const startingBases: WeewarMap['startingBases'] = [];
  const startUnitPositions: WeewarMap['startUnitPositions'] = [];
  let droppedFactionUnits = 0;

  const terrainRe = /<terrain\b([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = terrainRe.exec(body)) !== null) {
    const attrs = parseAttrs(m[1]!);
    const x = parseIntStrict(attrs['x'], 0);
    const y = parseIntStrict(attrs['y'], 0);
    const typeRaw = attrs['type'] ?? 'Plains';
    const typeKey = typeRaw.toLowerCase();

    let terrain: TerrainKey;
    if (typeKey in TERRAIN_MAP) {
      terrain = TERRAIN_MAP[typeKey]!;
    } else {
      console.warn(
        `parseWeewarMap: unknown terrain "${typeRaw}" at (${x},${y}); defaulting to plains.`,
      );
      terrain = 'plains';
    }

    // v1 spec §5.2: q = x, r = y.
    tiles.set(`${x},${y}`, terrain);

    const startUnitRaw = attrs['startUnit'];
    const startUnitOwnerRaw = attrs['startUnitOwner'];
    if (startUnitRaw && startUnitOwnerRaw !== undefined) {
      const ownerNum = Number.parseInt(startUnitOwnerRaw, 10);
      if (Number.isFinite(ownerNum) && ownerNum >= 2) {
        droppedFactionUnits++;
      } else if (ownerNum === 0 || ownerNum === 1) {
        startUnitPositions.push({ x, y, faction: ownerNum });
        const unitTypeKey = UNIT_MAP[startUnitRaw.toLowerCase()];
        if (unitTypeKey) {
          startingUnits.push({
            hex: { q: x, r: y },
            unitTypeKey,
            faction: ownerNum as FactionId,
          });
        } else {
          console.warn(
            `parseWeewarMap: unknown unit type "${startUnitRaw}" at (${x},${y}); dropping.`,
          );
        }
      }
    }

    if (terrain === 'base') {
      // v1 DECISIONS §B.12: any startFaction not in {0,1} collapses to neutral.
      const baseFaction = coerceFaction(attrs['startFaction']);
      startingBases.push({ hex: { q: x, r: y }, faction: baseFaction });
    }
  }

  if (droppedFactionUnits > 0) {
    console.warn(
      `parseWeewarMap: dropped ${droppedFactionUnits} starting unit(s) belonging to faction >= 2 (2-faction game).`,
    );
  }

  return {
    id,
    name,
    width,
    height,
    maxPlayers,
    initialCredits,
    perBaseCredits,
    tiles,
    startingUnits,
    startingBases,
    startUnitPositions,
  };
}

/** Adapt a parsed Weewar map to the board-facing DonorMap (spec §4.1 input).
 * src/board never sees XML — only this plain object. */
export function toDonorMap(map: WeewarMap): DonorMap {
  return {
    id: map.id !== '' ? map.id : map.name,
    name: map.name,
    tiles: [...map.tiles.entries()].map(([key, terrain]) => {
      const [x, y] = key.split(',').map(Number) as [number, number];
      return { x, y, terrain };
    }),
    bases: map.startingBases.map((b) => ({ x: b.hex.q, y: b.hex.r, faction: b.faction })),
    startUnits: map.startUnitPositions.map((u) => ({ x: u.x, y: u.y, faction: u.faction })),
  };
}

export function coerceFaction(raw: string | null | undefined): FactionId | null {
  if (raw === '0') return 0;
  if (raw === '1') return 1;
  return null;
}

// --- minimal XML helpers (rigid machine-written format; see header) ---------

/** First `<tag>text</tag>` occurrence in `body`, entity-decoded. */
function childText(body: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body);
  return m ? decodeEntities(m[1]!) : null;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    attrs[m[1]!] = decodeEntities(m[2]!);
  }
  return attrs;
}

function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseIntStrict(raw: string | null | undefined, fallback: number): number {
  if (raw == null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}
