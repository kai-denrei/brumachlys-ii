// palette.ts — Townscaper pastel palette, spec §10.1 EXACTLY. The skin layer's
// single source of color truth; test/ui/skin.test.tsx pins these hexes against
// the spec table. Game components never hardcode colors.

import type { TerrainKey } from '../../board/types';
import type { FactionId } from '../../core/types';

export const PALETTE = {
  paper: '#F2EEE3',
  plains: '#CBE3A8',
  woods: '#9CCB9F',
  woodsDots: '#5E9B72',
  mountains: '#CFC8BC',
  mountainRidge: '#A89F90',
  swamp: '#B7C4A0',
  swampDash: '#93A37F',
  water: '#A8D4E8',
  base: '#E8D7A8',
  factionA: '#E8806B',
  factionB: '#7B8BD9',
  fogWash: 'rgba(255,255,255,0.55)',
} as const;

export function terrainFill(terrain: TerrainKey): string {
  switch (terrain) {
    case 'plains':
      return PALETTE.plains;
    case 'woods':
      return PALETTE.woods;
    case 'mountains':
      return PALETTE.mountains;
    case 'swamp':
      return PALETTE.swamp;
    case 'water':
      return PALETTE.water;
    case 'base':
      return PALETTE.base;
  }
}

export function factionColor(faction: FactionId): string {
  return faction === 0 ? PALETTE.factionA : PALETTE.factionB;
}

// --- color math (skin-internal) ----------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Darken a hex color by `amount` (0..1). Spec §10.1: cell strokes are the
 * fill darkened ~12%. */
export function darken(hex: string, amount = 0.12): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

/** Linear mix from `a` toward `b` by t (0..1). Base cells tint toward owner. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** Desaturate toward luminance by t (0..1) — the fog-mist treatment's
 * "slight desaturation" half (the white wash is the other half). */
export function desaturate(hex: string, t: number): string {
  const [r, g, b] = hexToRgb(hex);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return rgbToHex(r + (lum - r) * t, g + (lum - g) * t, b + (lum - b) * t);
}
