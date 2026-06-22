// @vitest-environment jsdom
// WATERCOLOR unit skin (gear menu → "Watercolor"). The token renders a static
// faction-painted webp as an SVG <image> for ALL 8 unit types and BOTH factions
// — UNTINTED (the faction colour is baked into the art, so no sprite-red filter
// and no factionColor squircle). Icon mode keeps the flat glyph; minimal
// contexts (chips / demoted corner tokens) keep the glyph regardless of mode.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { UnitInstance } from '../../src/core/types';
import { UnitRenderer } from '../../src/ui/skin';

afterEach(cleanup);

function unit(over: Partial<UnitInstance> = {}): UnitInstance {
  return {
    id: 'u1',
    type: 'infantry',
    faction: 1,
    cell: 0,
    count: 10,
    stance: 'aggressive',
    attackedFrom: [],
    ...over,
  };
}

function renderToken(u: UnitInstance, minimal = false) {
  return render(
    <svg>
      <UnitRenderer unit={u} x={0} y={0} size={40} renderMode="watercolor" minimal={minimal} />
    </svg>,
  );
}

const imageOf = (c: HTMLElement) => c.querySelector('.unit-watercolor image');

describe('UnitRenderer — watercolor mode', () => {
  // ALL 8 types × BOTH factions render an <image> whose href points at the
  // faction+type webp under /watercolors/.
  const TYPES = [
    'sniper',
    'humvee',
    'ranger',
    'infantry',
    'grenadier',
    'tank',
    'artillery',
    'heavytank',
  ] as const;

  for (const faction of [0, 1] as const) {
    for (const type of TYPES) {
      it(`faction ${faction} ${type} → an <image> with the right /watercolors/ href`, () => {
        const { container } = renderToken(unit({ faction, type }));
        const img = imageOf(container);
        expect(img).not.toBeNull();
        const href = img!.getAttribute('href') ?? '';
        // Vite (and the vitest transform) resolve the webp import to a URL
        // containing the asset's basename; assert it points at this faction+type.
        expect(href).toMatch(/watercolors/);
        expect(href).toMatch(new RegExp(`f${faction}-${type}`));
        expect(href).toMatch(/\.webp/);
        // UNTINTED: no sprite-red filter, no squircle body.
        expect(img!.getAttribute('style') ?? '').not.toContain('sprite-red');
        expect(container.querySelector('.unit-body')).toBeNull();
        // tap target preserved (selection still lands on the token)
        expect(container.querySelector('.unit-watercolor .unit-hit')).not.toBeNull();
        // count pip still drawn (full token)
        expect(container.querySelector('.unit-count')).not.toBeNull();
      });
    }
  }

  it('data-watercolor-* attributes carry the faction + type', () => {
    const { container } = renderToken(unit({ faction: 0, type: 'tank' }));
    const img = imageOf(container)!;
    expect(img.getAttribute('data-watercolor-faction')).toBe('0');
    expect(img.getAttribute('data-watercolor-type')).toBe('tank');
  });

  // ROUNDED CORNERS: the art is clipped to a rounded-corner rect, and the clip
  // rect carries a non-zero corner radius proportional to the box.
  it('the painting is clipped to a ROUNDED-CORNER rect', () => {
    const { container } = renderToken(unit({ faction: 0, type: 'infantry' }));
    const img = imageOf(container)!;
    const clipRef = img.getAttribute('clip-path') ?? img.getAttribute('clipPath') ?? '';
    expect(clipRef).toMatch(/^url\(#/); // the image is clipped
    const clipRect = container.querySelector('.unit-watercolor clipPath rect')!;
    expect(clipRect).not.toBeNull();
    const rx = parseFloat(clipRect.getAttribute('rx') ?? '0');
    expect(rx).toBeGreaterThan(0); // genuinely rounded, not a square clip
  });

  // FACTION FRAME: a thin border around the rounded box — RED for faction 0
  // (player), BLACK for faction 1 (opponent). Untinted art INSIDE the frame.
  it('faction 0 (player) gets a RED frame around the rounded box', () => {
    const { container } = renderToken(unit({ faction: 0, type: 'infantry' }));
    const frame = container.querySelector('.unit-watercolor-frame')!;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute('stroke')).toBe('#c0392b'); // brick red
    expect(frame.getAttribute('fill')).toBe('none'); // art stays untinted
    expect(parseFloat(frame.getAttribute('rx') ?? '0')).toBeGreaterThan(0); // rounded
    // "slight": a thin stroke relative to the 40px token (well under a tenth).
    expect(parseFloat(frame.getAttribute('stroke-width') ?? '0')).toBeLessThan(40 * 0.1);
  });

  it('faction 1 (opponent) gets a BLACK frame around the rounded box', () => {
    const { container } = renderToken(unit({ faction: 1, type: 'infantry' }));
    const frame = container.querySelector('.unit-watercolor-frame')!;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute('stroke')).toBe('#1a1a1a'); // charcoal black
    expect(frame.getAttribute('fill')).toBe('none');
  });

  it('minimal context keeps the glyph even in watercolor mode (no <image>)', () => {
    const { container } = renderToken(unit({ type: 'tank' }), true);
    expect(imageOf(container)).toBeNull();
    expect(container.querySelector('.unit-body')).not.toBeNull();
  });
});

describe('UnitRenderer — icon mode', () => {
  it('icon mode renders the flat squircle glyph, no watercolor / sprite', () => {
    const { container } = render(
      <svg>
        <UnitRenderer unit={unit({ type: 'tank' })} x={0} y={0} size={40} renderMode="icon" />
      </svg>,
    );
    expect(container.querySelector('.unit-watercolor')).toBeNull();
    expect(container.querySelector('.unit-sprite')).toBeNull();
    expect(container.querySelector('.unit-body')).not.toBeNull();
  });

  it('default (no renderMode prop) is icon — non-board sites stay glyphs', () => {
    const { container } = render(
      <svg>
        <UnitRenderer unit={unit({ type: 'tank' })} x={0} y={0} size={40} />
      </svg>,
    );
    expect(container.querySelector('.unit-watercolor')).toBeNull();
    expect(container.querySelector('.unit-body')).not.toBeNull();
  });
});
