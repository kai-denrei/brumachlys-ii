// @vitest-environment jsdom
// v0.9 radar overlay — unit-level tests:
//   1. UnitRenderer renders the radar pip for own units only when onRadar is
//      passed; does NOT render it for minimal tokens or when omitted.
//   2. The active state inverts the pip fill to faction color.
//   3. The overlay payload (distances) is correct for a tiny synthetic board
//      (matches graphDistance contract: diagonal = 1, same cell = 0).

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { graphDistance } from '../../src/board/geometry';
import type { Board } from '../../src/board/types';
import type { UnitInstance } from '../../src/core/types';
import { visibleCells } from '../../src/core/fog';
import { UnitRenderer } from '../../src/ui/skin/UnitRenderer';
import { factionColor } from '../../src/ui/skin/palette';

afterEach(cleanup);

function makeUnit(over: Partial<UnitInstance> = {}): UnitInstance {
  return {
    id: 'u1',
    type: 'infantry',
    faction: 0,
    cell: 1,
    count: 8,
    stance: 'aggressive',
    attackedFrom: [],
    ...over,
  };
}

// Minimal 3-cell linear board: 1 — 2 — 3 (cell 2 is in the middle).
// graphDistance(1, 3) = 2; graphDistance(1, 2) = 1; graphDistance(1, 1) = 0.
function makeBoard(): Board {
  return {
    cells: new Map([
      [1, { id: 1, center: [0, 0], polygon: [], neighbors: [2], terrain: 'plains' }],
      [2, { id: 2, center: [1, 0], polygon: [], neighbors: [1, 3], terrain: 'plains' }],
      [3, { id: 3, center: [2, 0], polygon: [], neighbors: [2], terrain: 'plains' }],
    ]),
  } as unknown as Board;
}

// Unit types stub: infantry with vision=2 (sees all 3 cells).
const TYPES = {
  infantry: { vision: 2, movement: 3, minRange: 1, maxRange: 1, cost: 75, armorType: 'personnel', name: 'Infantry' } as any,
};

// ── UnitRenderer radar pip ────────────────────────────────────────────────────

describe('UnitRenderer radar pip', () => {
  it('NOT rendered when onRadar is absent', () => {
    const { container } = render(
      <svg>
        <UnitRenderer unit={makeUnit()} x={0} y={0} size={40} />
      </svg>,
    );
    expect(container.querySelector('.unit-radar')).toBeNull();
  });

  it('NOT rendered when minimal=true even if onRadar is passed', () => {
    const { container } = render(
      <svg>
        <UnitRenderer unit={makeUnit()} x={0} y={0} size={40} minimal onRadar={() => {}} />
      </svg>,
    );
    expect(container.querySelector('.unit-radar')).toBeNull();
  });

  it('rendered when onRadar is provided and not minimal', () => {
    const { container } = render(
      <svg>
        <UnitRenderer unit={makeUnit()} x={0} y={0} size={40} onRadar={() => {}} />
      </svg>,
    );
    expect(container.querySelector('.unit-radar')).not.toBeNull();
  });

  it('inactive state: pip background is white (#fff), NOT faction color', () => {
    const { container } = render(
      <svg>
        <UnitRenderer unit={makeUnit()} x={0} y={0} size={40} onRadar={() => {}} radarActive={false} />
      </svg>,
    );
    const circle = container.querySelector('.unit-radar > circle')!;
    expect(circle.getAttribute('fill')).toBe('#fff');
  });

  it('active state: pip background fills with faction color, class set', () => {
    const unit = makeUnit({ faction: 0 });
    const { container } = render(
      <svg>
        <UnitRenderer unit={unit} x={0} y={0} size={40} onRadar={() => {}} radarActive />
      </svg>,
    );
    const pip = container.querySelector('.unit-radar')!;
    expect(pip.classList.contains('unit-radar-active')).toBe(true);
    const circle = container.querySelector('.unit-radar > circle')!;
    expect(circle.getAttribute('fill')).toBe(factionColor(0));
  });

  it('clicking the radar pip calls onRadar without bubbling to the token', () => {
    const radarFn = vi.fn();
    const tapFn = vi.fn();
    const { container } = render(
      <svg>
        <UnitRenderer unit={makeUnit()} x={0} y={0} size={40} onRadar={radarFn} onTap={tapFn} />
      </svg>,
    );
    const pip = container.querySelector('.unit-radar')! as HTMLElement;
    fireEvent.click(pip);
    expect(radarFn).toHaveBeenCalledOnce();
    expect(tapFn).not.toHaveBeenCalled();
  });
});

// ── Overlay payload computation ───────────────────────────────────────────────

describe('radar overlay payload — distance correctness', () => {
  it('graphDistance on the 3-cell board is 0/1/2 as expected', () => {
    const board = makeBoard();
    expect(graphDistance(board, 1, 1)).toBe(0);
    expect(graphDistance(board, 1, 2)).toBe(1);
    expect(graphDistance(board, 1, 3)).toBe(2);
  });

  it('visibleCells for infantry at cell 1 (vision=2) sees all 3 cells', () => {
    const board = makeBoard();
    const unit = makeUnit({ cell: 1 });
    const visible = visibleCells(board, [unit], 0, TYPES);
    expect(visible.has(1)).toBe(true);
    expect(visible.has(2)).toBe(true);
    expect(visible.has(3)).toBe(true);
  });

  it('computed distances Map matches graphDistance for every visible cell', () => {
    const board = makeBoard();
    const unit = makeUnit({ cell: 1 });
    const vision = visibleCells(board, [unit], 0, TYPES);
    // Replicate exactly the App.tsx useMemo computation.
    const distances = new Map<number, number>();
    for (const cell of vision) {
      distances.set(cell, graphDistance(board, unit.cell, cell));
    }
    expect(distances.get(1)).toBe(0);
    expect(distances.get(2)).toBe(1);
    expect(distances.get(3)).toBe(2);
  });
});
