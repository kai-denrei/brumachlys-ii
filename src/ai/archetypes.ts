// Selectable AI archetypes (v0.7) — a registry of named personalities the UI
// offers when the player picks an opponent. PURE: each archetype is just a
// `createGreedyPlanner(...)` instance with a distinct weight profile; the
// engine, determinism, and fog-fairness are unchanged.
//
// THE SEAM: the UI consumes exactly { key, label, blurb, planner } per entry,
// the ARCHETYPES array, DEFAULT_ARCHETYPE, and the archetype() lookup. Do not
// reshape without coordinating — a concurrent agent wires the selector to this.
//
// Design discipline:
//   • `balanced` MUST behave identically to the tuned default greedyPlanner
//     (it wraps the very same instance) — the acceptance suites pin that.
//   • Every other archetype is a LEGIBLE deviation: its weights produce a
//     personality a player can name from one game. They all remain functional
//     opponents (each beats do-nothing decisively — see archetypes.test.ts).
//   • Blurbs carry NO HYPHENS (consistency with the rules modal's copy).

import { createGreedyPlanner, greedyPlanner } from './planner-greedy';
import type { OrderPlanner } from './planner';

export type ArchetypeKey = 'balanced' | 'vanguard' | 'swarm' | 'marksman' | 'warden';

export type Archetype = {
  key: ArchetypeKey;
  /** Short UI name, e.g. "Vanguard". */
  label: string;
  /** One laconic line, NO HYPHENS, e.g. "always pushes forward". */
  blurb: string;
  /** A createGreedyPlanner(...) instance carrying this archetype's weights. */
  planner: OrderPlanner;
};

export const ARCHETYPES: readonly Archetype[] = [
  {
    key: 'balanced',
    label: 'Balanced',
    blurb: 'the tuned all rounder',
    // The exact tuned default — same instance the acceptance suites pin.
    planner: greedyPlanner,
  },
  {
    key: 'vanguard',
    label: 'Vanguard',
    blurb: 'always pushes forward',
    // Tempo over caution: triple the march weight, halve damage-taken caution,
    // and crank capture hunger so it races objectives through covering fire.
    // Buys lean cheap+fast (low personnel floor still keeps capture boots; the
    // counter-comp line already favors ranger/infantry/humvee at this wealth).
    planner: createGreedyPlanner(
      { advance: 0.9, damageTaken: 0.4 },
      { capturePressure: 5.0, advancePressure: 8.0, captureBonus: 14.0, personnelFloor: 0.4 },
    ),
  },
  {
    key: 'swarm',
    label: 'Swarm',
    blurb: 'fields cheap infantry',
    // Overwhelm by numbers: infantryBias collapses the buy line to pure cheap
    // infantry, a high personnel floor + raised caps let the tide grow far
    // past a normal force, and a touch of extra advance pushes the mass
    // forward onto bases.
    planner: createGreedyPlanner(
      { advance: 0.45 },
      {
        infantryBias: 1.0,
        personnelFloor: 0.9,
        maxForce: 28,
        forcePerBase: 4.0,
        richFloor: 100000,
      },
    ),
  },
  {
    key: 'marksman',
    label: 'Marksman',
    blurb: 'ranged and patient',
    // Standoff and trade: rangedBias leads buys with snipers and artillery,
    // higher caution keeps the range lines (kites rather than charges), and a
    // gentler advance lets it capture opportunistically instead of lunging.
    planner: createGreedyPlanner(
      { advance: 0.2, damageTaken: 1.1, threatConcentration: 0.4 },
      { rangedBias: 1.0, personnelFloor: 0.45 },
    ),
  },
  {
    key: 'warden',
    label: 'Warden',
    blurb: 'holds ground and garrisons',
    // Defensive: a real defendBase weight garrisons threatened own bases and
    // covers them (the known finding — defendBase > ~0.25 freezes greedy-vs-
    // greedy mirrors — is fine here: warden is a vs-HUMAN personality, and its
    // vs-do-nothing acceptance still wins). High caution, low advance, a sturdy
    // grenadier-friendly buy line via the armored counter-comp default.
    planner: createGreedyPlanner(
      { advance: 0.15, damageTaken: 1.2, terrainArmorBonus: 0.6 },
      { defendBase: 0.6, captureBonus: 8.0 },
    ),
  },
];

export const DEFAULT_ARCHETYPE: ArchetypeKey = 'balanced';

const BY_KEY = new Map<ArchetypeKey, Archetype>(ARCHETYPES.map((a) => [a.key, a]));

/** Look up an archetype by key. Throws on an unknown key. */
export function archetype(key: ArchetypeKey): Archetype {
  const a = BY_KEY.get(key);
  if (!a) throw new Error(`unknown archetype: ${key}`);
  return a;
}
