// HudCluster.tsx — v0.9: the prominent top-LEFT HUD overlay that lives fixed
// over the board area (not inside the top bar). Shows:
//   • Round number (big split-flap canvas)
//   • Credits + income/committed line (big odometer canvas) — conquest only
//
// The CasualtyPanel stacks BELOW this cluster (controlled by the parent layout).
// The cluster only renders on the battle screen (callers omit it on start screen).
//
// Sizes: DIGIT_W/BOX_H are scaled up vs the old bar-embedded widget defaults so
// these stat readouts feel like primary HUD elements, not bar footnotes.

import { CreditsOdometer, RoundFlap } from './skin';
import type { CreditsHud } from './TopBar';

// Bigger canvas params — ~1.7× the old bar-embedded sizes.
const CLUSTER_FLAP_DIGIT_W = 36;
const CLUSTER_FLAP_BOX_H = 52;
const CLUSTER_ODO_DIGIT_W = 28;
const CLUSTER_ODO_BOX_H = 52;

export function HudCluster({
  round,
  credits,
}: {
  round: number;
  /** Conquest only — omit (or pass null) in skirmish. */
  credits?: CreditsHud | null;
}) {
  return (
    <div className="hud-cluster" data-testid="hud-cluster" aria-label="HUD">
      {/* Round row */}
      <div className="hud-cluster-round">
        <span className="hud-cluster-round-r" aria-hidden="true">R</span>
        {/* RoundFlap carries its own visually-hidden "round N" a11y label. */}
        <RoundFlap value={round} digitW={CLUSTER_FLAP_DIGIT_W} boxH={CLUSTER_FLAP_BOX_H} />
      </div>
      {/* Credits row — conquest only */}
      {credits && (
        <div className="credits-hud" data-testid="credits-hud">
          <span className="credits-glyph" aria-hidden="true">◈</span>
          <CreditsOdometer
            value={credits.value}
            digitW={CLUSTER_ODO_DIGIT_W}
            boxH={CLUSTER_ODO_BOX_H}
          />
          {credits.income ? (
            <span className="credits-income" aria-label={`plus ${credits.income} per turn`}>
              +{credits.income}/turn
            </span>
          ) : credits.committed ? (
            <span className="credits-committed"> − {credits.committed} committed</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
