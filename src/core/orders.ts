// Order types (spec §2.3). Orders are immutable plan data.
// Max one move + one attack + one stance per unit per round; the P4 resolver
// re-checks legality at execution time, the P7 order-entry UI gates input.

import type { CellId } from '../board/types';
import type { Stance } from './types';

export type Order =
  | { kind: 'move'; unitId: string; path: CellId[] } // destination cells only, start excluded
  | { kind: 'attack'; unitId: string; targetCell: CellId }
  | { kind: 'stance'; unitId: string; stance: Stance };
