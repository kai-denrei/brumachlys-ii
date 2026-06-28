// text-format.ts — pure UI copy/format helpers extracted from component files
// (v1.6 refactor Phase 1). These were exported from Replay.tsx / RulesModal.tsx
// for tests (a React Fast-Refresh smell), and `fmtRange` was additionally
// copy-pasted into Sheets.tsx and UnitPicker.tsx. Single home, single source.

import type { GameOutcome } from '../core/types';

/** E3: conquest endgame context for the banner copy + dashboard. */
export type ConquestOutcome = { playerBases: number; enemyBases: number };

/** min–max range, collapsed when min = max. En dash, never a hyphen. */
export function fmtRange(min: number, max: number): string {
  return min === max ? String(max) : `${min}–${max}`;
}

export function outcomeText(
  outcome: GameOutcome,
  conquest?: ConquestOutcome | null,
): { title: string; sub: string } {
  const win = outcome.winner === 0;
  const loss = outcome.winner === 1;
  const title = win ? 'VICTORY' : loss ? 'DEFEAT' : null;

  // Conquest reasons (addendum §B.5) — these only arise in conquest mode.
  if (outcome.reason === 'conquest') {
    if (win) return { title: 'VICTORY', sub: 'Nothing left to them. No army, no banners. Conquest.' };
    if (loss) return { title: 'DEFEAT', sub: 'Nothing left to you. The land is theirs.' };
    return { title: 'MUTUAL RUIN', sub: 'Two armies spent, every banner fallen. Nobody holds the land.' };
  }
  if (outcome.reason === 'base-collapse') {
    if (win) return { title: 'VICTORY', sub: 'Their last banner fell rounds ago. The land follows you.' };
    if (loss) return { title: 'DEFEAT', sub: 'Three round ends without a base. The land forgets you.' };
    return { title: 'THE MIST SETTLES', sub: 'Both sides landless. The mist keeps the field.' };
  }
  if (outcome.reason === 'round-limit' && conquest) {
    const counts = `Bases ${conquest.playerBases} to ${conquest.enemyBases}.`;
    if (win) return { title: 'VICTORY', sub: `The horn sounds. ${counts} The ground is yours.` };
    if (loss) return { title: 'DEFEAT', sub: `The horn sounds. ${counts} The ground is theirs.` };
    return { title: 'THE MIST SETTLES', sub: `The horn sounds. ${counts} Even ground. A draw.` };
  }

  // Skirmish copy (unchanged).
  if (title === 'VICTORY') return { title, sub: 'The mist parts. The field is yours.' };
  if (title === 'DEFEAT') return { title, sub: 'Your army is lost to the mist.' };
  if (outcome.reason === 'mutual-annihilation')
    return { title: 'MUTUAL RUIN', sub: 'Nothing remains on either side.' };
  return { title: 'THE MIST SETTLES', sub: 'Forty rounds, and no decision. A draw.' };
}
