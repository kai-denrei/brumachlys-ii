// @vitest-environment jsdom
// Skin smoke tests: palette pinned to spec §10.1 EXACTLY, CellRenderer emits
// rounded (Q-command) paths + deterministic textures, fog treatment, unit
// tokens carry faction colors / glyphs / stance strokes (§10.2).

import { describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { afterEach } from 'vitest';
import type { Cell } from '../../src/board/types';
import type { UnitInstance } from '../../src/core/types';
import {
  CellRenderer,
  DARK_COVER_OPACITY,
  MEMORY_DESATURATION,
  PALETTE,
  UnitRenderer,
  desaturate,
  roundedPolygonPath,
} from '../../src/ui/skin';

afterEach(cleanup);

const toScreen = (p: readonly [number, number]): [number, number] => [p[0] * 100, -p[1] * 100];

function makeCell(terrain: Cell['terrain'], id = 3): Cell {
  return {
    id,
    center: [0.5, 0.5],
    polygon: [
      [0.2, 0.2],
      [0.8, 0.2],
      [0.9, 0.6],
      [0.5, 0.9],
      [0.1, 0.6],
    ],
    neighbors: [],
    terrain,
  };
}

function makeUnit(over: Partial<UnitInstance> = {}): UnitInstance {
  return {
    id: 'u1',
    type: 'tank',
    faction: 0,
    cell: 3,
    count: 10,
    stance: 'aggressive',
    attackedFrom: [],
    ...over,
  };
}

describe('palette (spec §10.1 pinned)', () => {
  it('matches the spec hex table exactly', () => {
    expect(PALETTE.paper).toBe('#F2EEE3');
    expect(PALETTE.plains).toBe('#CBE3A8');
    expect(PALETTE.woods).toBe('#9CCB9F');
    expect(PALETTE.woodsDots).toBe('#5E9B72');
    expect(PALETTE.mountains).toBe('#CFC8BC');
    expect(PALETTE.mountainRidge).toBe('#A89F90');
    expect(PALETTE.swamp).toBe('#B7C4A0');
    expect(PALETTE.swampDash).toBe('#93A37F');
    expect(PALETTE.water).toBe('#A8D4E8');
    expect(PALETTE.base).toBe('#E8D7A8');
    expect(PALETTE.factionA).toBe('#E8806B');
    expect(PALETTE.factionB).toBe('#7B8BD9');
    expect(PALETTE.fogWash).toBe('rgba(255,255,255,0.55)');
    // E1 discovery tiers (addendum §A)
    expect(PALETTE.darkCover).toBe('#2A2622');
    expect(PALETTE.memoryWash).toBe('rgba(255,255,255,0.35)');
  });
});

describe('roundedPolygonPath', () => {
  it('emits quadratic (Q) corner commands, one per vertex, closed', () => {
    const d = roundedPolygonPath([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect((d.match(/Q/g) ?? []).length).toBe(4);
  });

  it('is deterministic and degenerate-safe', () => {
    const ring: [number, number][] = [
      [0, 0],
      [50, 5],
      [60, 60],
    ];
    expect(roundedPolygonPath(ring)).toBe(roundedPolygonPath(ring));
    expect(roundedPolygonPath([[0, 0]])).toBe('');
  });
});

describe('CellRenderer', () => {
  it('renders a rounded path with the spec plains fill and darkened stroke', () => {
    const { container } = render(
      <svg>
        <CellRenderer cell={makeCell('plains')} toScreen={toScreen} />
      </svg>,
    );
    const path = container.querySelector('.cell path')!;
    expect(path.getAttribute('d')).toContain('Q');
    expect(path.getAttribute('fill')).toBe(PALETTE.plains);
    // stroke = fill darkened ~12%, i.e. NOT the fill itself
    expect(path.getAttribute('stroke')).not.toBe(PALETTE.plains);
    expect(path.getAttribute('stroke')).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('woods cells get deterministic dot-cluster textures', () => {
    const a = render(
      <svg>
        <CellRenderer cell={makeCell('woods', 7)} toScreen={toScreen} />
      </svg>,
    );
    const dotsA = [...a.container.querySelectorAll('.cell-texture circle')];
    expect(dotsA.length).toBeGreaterThanOrEqual(6); // 2–3 clusters × 3 dots
    expect(dotsA[0]!.getAttribute('fill')).toBe(PALETTE.woodsDots);
    const coordsA = dotsA.map((c) => c.getAttribute('cx') + ',' + c.getAttribute('cy'));
    a.unmount();
    const b = render(
      <svg>
        <CellRenderer cell={makeCell('woods', 7)} toScreen={toScreen} />
      </svg>,
    );
    const coordsB = [...b.container.querySelectorAll('.cell-texture circle')].map(
      (c) => c.getAttribute('cx') + ',' + c.getAttribute('cy'),
    );
    expect(coordsB).toEqual(coordsA); // no Math.random in render
  });

  it('mountains get a ridge stroke, swamps get dashes', () => {
    const m = render(
      <svg>
        <CellRenderer cell={makeCell('mountains')} toScreen={toScreen} />
      </svg>,
    );
    expect(m.container.querySelector('.cell-texture path')!.getAttribute('stroke')).toBe(
      PALETTE.mountainRidge,
    );
    const s = render(
      <svg>
        <CellRenderer cell={makeCell('swamp')} toScreen={toScreen} />
      </svg>,
    );
    const dashes = s.container.querySelectorAll('.cell-texture line');
    expect(dashes.length).toBe(3);
    expect(dashes[0]!.getAttribute('stroke')).toBe(PALETTE.swampDash);
  });

  // --- E1 discovery tiers (addendum §A — styling PINNED) -----------------------

  it('memory tier: desaturated 0.55 fill + 0.35 white wash, texture greyed', () => {
    const { container } = render(
      <svg>
        <CellRenderer cell={makeCell('woods')} toScreen={toScreen} tier="memory" />
      </svg>,
    );
    expect(container.querySelector('.cell-memory')).not.toBeNull();
    const wash = container.querySelector('.memory-wash')!;
    expect(wash.getAttribute('fill')).toBe(PALETTE.memoryWash); // rgba(...,0.35)
    // fill = woods desaturated by exactly MEMORY_DESATURATION (0.55)
    const body = container.querySelector('.cell > path')!;
    expect(body.getAttribute('fill')).toBe(desaturate(PALETTE.woods, MEMORY_DESATURATION));
    expect(MEMORY_DESATURATION).toBe(0.55);
    // remembered terrain keeps its texture, greyed
    expect(container.querySelector('.cell-texture')!.getAttribute('opacity')).toBe('0.45');
  });

  it('dark tier: near-black #2A2622 cover at 0.92, NO terrain detail leaks', () => {
    const { container } = render(
      <svg>
        <CellRenderer cell={makeCell('woods')} toScreen={toScreen} tier="dark" />
      </svg>,
    );
    expect(container.querySelector('.cell-dark')).not.toBeNull();
    const cover = container.querySelector('.dark-cover')!;
    expect(cover.getAttribute('fill')).toBe('#2A2622');
    expect(Number(cover.getAttribute('opacity'))).toBe(0.92);
    expect(PALETTE.darkCover).toBe('#2A2622');
    expect(DARK_COVER_OPACITY).toBe(0.92);
    // no texture, no terrain fill: the base path is paper, not woods green
    expect(container.querySelector('.cell-texture')).toBeNull();
    expect(container.querySelector('.cell > path')!.getAttribute('fill')).toBe(PALETTE.paper);
  });

  it('dark tier hides base tint — bases must not glow through the dark', () => {
    const { container } = render(
      <svg>
        <CellRenderer cell={makeCell('base')} toScreen={toScreen} tier="dark" baseTintFaction={0} />
      </svg>,
    );
    expect(container.querySelector('.cell > path')!.getAttribute('fill')).toBe(PALETTE.paper);
  });

  it('igniting live cell carries the fading cover (dark → live, ~0.4 s CSS)', () => {
    const { container } = render(
      <svg>
        <CellRenderer cell={makeCell('plains')} toScreen={toScreen} tier="live" igniting />
      </svg>,
    );
    const cover = container.querySelector('.dark-cover-ignite')!;
    expect(cover).not.toBeNull();
    expect(cover.getAttribute('fill')).toBe(PALETTE.darkCover);
    // live underneath: normal terrain fill
    expect(container.querySelector('.cell > path')!.getAttribute('fill')).toBe(PALETTE.plains);
  });

  it('silhouette: paper-tone mesh, no terrain color, no texture (start previews)', () => {
    const { container } = render(
      <svg>
        <CellRenderer cell={makeCell('woods')} toScreen={toScreen} silhouette />
      </svg>,
    );
    expect(container.querySelector('.cell-silhouette')).not.toBeNull();
    expect(container.querySelector('.cell > path')!.getAttribute('fill')).toBe(PALETTE.paper);
    expect(container.querySelector('.cell-texture')).toBeNull();
  });
});

describe('UnitRenderer (§10.2)', () => {
  it('renders a faction-colored squircle with white stroke and a count pip', () => {
    const { container } = render(
      <svg>
        <UnitRenderer unit={makeUnit()} x={0} y={0} size={24} />
      </svg>,
    );
    const body = container.querySelector('.unit-body')!;
    expect(body.getAttribute('fill')).toBe(PALETTE.factionA);
    expect(body.getAttribute('rx')).not.toBeNull(); // squircle corners
    expect(container.querySelector('.unit-count text')!.textContent).toBe('10');
  });

  it('faction 1 tokens are indigo', () => {
    const { container } = render(
      <svg>
        <UnitRenderer unit={makeUnit({ faction: 1 })} x={0} y={0} size={24} />
      </svg>,
    );
    expect(container.querySelector('.unit-body')!.getAttribute('fill')).toBe(PALETTE.factionB);
  });

  it('stance maps to stroke style: solid / double / dashed', () => {
    const agg = render(
      <svg>
        <UnitRenderer unit={makeUnit()} x={0} y={0} size={24} />
      </svg>,
    );
    expect(agg.container.querySelector('.unit-body')!.getAttribute('stroke-dasharray')).toBeNull();
    expect(agg.container.querySelector('.unit-stroke-inner')).toBeNull();

    const def = render(
      <svg>
        <UnitRenderer unit={makeUnit({ id: 'u2', stance: 'defensive' })} x={0} y={0} size={24} />
      </svg>,
    );
    expect(def.container.querySelector('.unit-stroke-inner')).not.toBeNull();

    const hold = render(
      <svg>
        <UnitRenderer unit={makeUnit({ id: 'u3', stance: 'hold-fire' })} x={0} y={0} size={24} />
      </svg>,
    );
    expect(
      hold.container.querySelector('.unit-body')!.getAttribute('stroke-dasharray'),
    ).not.toBeNull();
  });

  it('has a distinct glyph for each of the 8 roster types', () => {
    const types = [
      'sniper',
      'humvee',
      'ranger',
      'infantry',
      'grenadier',
      'tank',
      'artillery',
      'heavytank',
    ];
    const markup = types.map((type) => {
      const { container, unmount } = render(
        <svg>
          <UnitRenderer unit={makeUnit({ id: type, type })} x={0} y={0} size={24} />
        </svg>,
      );
      const token = container.querySelector('.unit-token')!;
      const html = token.innerHTML;
      unmount();
      return html;
    });
    expect(new Set(markup).size).toBe(8);
  });
});
