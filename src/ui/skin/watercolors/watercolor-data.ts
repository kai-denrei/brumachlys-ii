// watercolor-data.ts — the WATERCOLOR unit skin (gear menu → "Watercolor").
// Static, hand-painted faction art for ALL 8 unit types and BOTH factions.
// Unlike the animated sprite skin (sprites/), these are single still images, so
// there is no ticker / frame logic — just a faction+type → bundled-URL lookup.
//
// The faction COLOUR is baked into the art (f0 = coral side, f1 = blue side),
// so the renderer draws them UNTINTED — no SVG filter, no factionColor(). Vite
// resolves each webp import to a bundled, base-path-aware /watercolors/ URL.

import f0artillery from './f0-artillery.webp';
import f0grenadier from './f0-grenadier.webp';
import f0heavytank from './f0-heavytank.webp';
import f0humvee from './f0-humvee.webp';
import f0infantry from './f0-infantry.webp';
import f0ranger from './f0-ranger.webp';
import f0sniper from './f0-sniper.webp';
import f0tank from './f0-tank.webp';
import f1artillery from './f1-artillery.webp';
import f1grenadier from './f1-grenadier.webp';
import f1heavytank from './f1-heavytank.webp';
import f1humvee from './f1-humvee.webp';
import f1infantry from './f1-infantry.webp';
import f1ranger from './f1-ranger.webp';
import f1sniper from './f1-sniper.webp';
import f1tank from './f1-tank.webp';

import type { FactionId } from '../../../core/types';

/** The 8 unit-type keys the watercolor set ships art for (the standard army). */
export const WATERCOLOR_KEYS = [
  'sniper',
  'humvee',
  'ranger',
  'infantry',
  'grenadier',
  'tank',
  'artillery',
  'heavytank',
] as const;

export type WatercolorKey = (typeof WATERCOLOR_KEYS)[number];

/** faction → unit-type key → bundled webp URL. Both factions, all 8 types. */
const WATERCOLORS: Record<FactionId, Record<WatercolorKey, string>> = {
  0: {
    sniper: f0sniper,
    humvee: f0humvee,
    ranger: f0ranger,
    infantry: f0infantry,
    grenadier: f0grenadier,
    tank: f0tank,
    artillery: f0artillery,
    heavytank: f0heavytank,
  },
  1: {
    sniper: f1sniper,
    humvee: f1humvee,
    ranger: f1ranger,
    infantry: f1infantry,
    grenadier: f1grenadier,
    tank: f1tank,
    artillery: f1artillery,
    heavytank: f1heavytank,
  },
};

/** Resolve the watercolor art URL for a faction + unit type. Returns null for an
 *  unknown type (a roster key with no watercolor) so the renderer can fall back
 *  to the glyph rather than render a broken <image>. */
export function watercolorUrl(faction: FactionId, type: string): string | null {
  const byType = WATERCOLORS[faction];
  if (!byType) return null;
  return (byType as Record<string, string>)[type] ?? null;
}
