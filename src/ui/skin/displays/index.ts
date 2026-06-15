// src/ui/skin/displays — canvas HUD widgets (split-flap round, odometer credits)
// ported from the dexipurei standalone library and adapted to show real values
// that animate on CHANGE (flip / roll once, then hold). See the per-file headers.

export { RoundFlap } from './RoundFlap';
export { CreditsOdometer } from './CreditsOdometer';

// driver + render exports (mostly for tests / future skins)
export {
  SOLARI_LIGHT,
  createSplitFlapDriver,
  renderSplitFlap,
  setTarget,
} from './splitflap';
export type { SplitFlapDriver, SplitFlapParams } from './splitflap';
export {
  BRASS_LIGHT,
  ROLL_MS,
  createOdometerDriver,
  renderOdometer,
  setValue,
} from './odometer';
export type { OdometerDriver, OdometerParams } from './odometer';
