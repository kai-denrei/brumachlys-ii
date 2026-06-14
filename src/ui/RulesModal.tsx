// RulesModal — v1.2 tweak 2: the full rule reference behind the TopBar "i".
// Full-screen scrollable sheet, same family as the bottom sheets. All roster
// and terrain numbers are pulled from data/units.json at runtime so the
// tables can never drift from the game. Copy style: laconic, telegraphic,
// and deliberately hyphen free (en dashes for ranges only) — tested.

import { useMemo } from 'react';
import type { TerrainKey } from '../board/types';
import type { UnitInstance, UnitType } from '../core/types';
import { IMPASSABLE } from '../core/pathing';
import { loadUnits } from '../io/data-loader';
import { UnitRenderer } from './skin';

const TERRAIN_ORDER: TerrainKey[] = ['plains', 'woods', 'mountains', 'swamp', 'water', 'base'];
const TERRAIN_NAME: Record<TerrainKey, string> = {
  plains: 'Plains',
  woods: 'Woods',
  mountains: 'Mountains',
  swamp: 'Swamp',
  water: 'Water',
  base: 'Base',
};

/** min–max range, collapsed when min = max. En dash, never a hyphen. */
export function fmtRange(min: number, max: number): string {
  return min === max ? String(max) : `${min}–${max}`;
}

/** +2 / 0 / −2 — typographic minus (U+2212), keeping the modal hyphen free. */
function fmtBonus(v: number): string {
  if (v > 0) return `+${v}`;
  if (v < 0) return `−${-v}`;
  return '0';
}

function fmtCost(cost: number): string {
  return cost >= IMPASSABLE ? '—' : String(cost);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rules-section">
      <h3 className="rules-h">{title}</h3>
      {children}
    </section>
  );
}

/** A throwaway unit instance so the roster table renders the real token art
 * through the skin (minimal mode: no count pip, no stance stroke). */
const iconUnit = (type: string): UnitInstance => ({
  id: `rules-${type}`,
  type,
  faction: 0,
  cell: 0,
  count: 1,
  stance: 'aggressive',
  attackedFrom: [],
});

export function RulesModal({ onClose }: { onClose: () => void }) {
  const types = useMemo(() => loadUnits(), []);
  const roster = useMemo(
    () => Object.values(types).sort((a, b) => b.initiative - a.initiative),
    [types],
  );
  // Terrain effects are uniform within a class — any personnel/vehicle pair
  // represents its class (same trick as the long press info sheet).
  const personnel = roster.find((t) => t.armorType === 'personnel') as UnitType;
  const vehicle = roster.find((t) => t.armorType === 'armored') as UnitType;

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div
        className="rules-modal"
        role="dialog"
        aria-label="rules"
        data-testid="rules-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grab" />
        <div className="sheet-header">
          <span className="sheet-title">HOW TO PLAY</span>
          <button className="sheet-close" onClick={onClose} aria-label="close rules">
            ✕
          </button>
        </div>
        <div className="rules-body">
          <Section title="The round">
            <p>
              Plan, commit, watch. Both sides plan at once. On commit every order resolves
              together in initiative order (highest first) within each phase:
            </p>
            <ol className="rules-phases">
              <li><b>Stances</b> — take effect first.</li>
              <li><b>Movement</b> — all units move at once; blocked or bounced moves stop short.</li>
              <li>
                <b>Brawls</b> — any cell where both factions end movement together: they trade
                full blows, exchange after exchange, until one side is gone. Stances are
                ignored. Distinct from fire phase combat.
              </li>
              <li>
                <b>Fire</b> — ranged and direct combat. A unit with an attack order fires at its
                target. A unit on <b>aggressive</b> stance with no order automatically fires at
                the nearest visible enemy in range — this is when an idle ranged unit fires automatically.
                The defender returns fire (counter) in the same beat unless holding fire or
                out of counter range.
              </li>
              <li>
                <b>Capture</b> — a personnel unit ordered to capture, standing on a foreign or
                neutral base, claims it and is spent. Vehicles never capture.
              </li>
              <li>
                <b>Veterancy</b> — units that killed and survived gain rank: a heal of +2 and a
                damage bonus per rank.
              </li>
              <li>
                <b>Income · Spawns</b> (Conquest only) — each owned base pays credits, then
                queued recruits appear.
              </li>
            </ol>
            <p>Per unit per round: one move, one attack, one stance.</p>
          </Section>

          <Section title="Stances">
            <p>
              <b>Aggressive</b> — fires at the nearest visible enemy in range, returns fire.
              <br />
              <b>Defensive</b> — fires only on order, returns fire, +1 armor.
              <br />
              <b>Hold fire</b> — never fires, never returns fire.
              <br />
              An explicit attack order fires in any stance except hold fire.
            </p>
          </Section>

          <Section title="Movement">
            <p>
              Each unit spends a movement budget; terrain charges per cell entered (table below).
              Pass through friends freely, but never end on one: the mover stops one cell short.
              Exception: a friend already ordered away vacates, so its cell can be taken (the
              vacancy move). A visible enemy blocks the path; bumping into one mid path stops the
              mover one cell short. A move that ENDS on an enemy completes into its cell — a
              charge. A brawl follows.
            </p>
          </Section>

          <Section title="Combat">
            <p>
              Hit chance starts at one half, then shifts 5% per point of difference: attack plus
              terrain attack bonus plus gang up bonus, against armor plus terrain armor bonus
              (defensive stance adds 1 more). Damage is the smaller side's count times that
              chance, rounded — never zero while the chance is above zero.
            </p>
            <p>
              Counter attacks: if the attacker stands inside the defender's range and the defender
              is not holding fire, the defender returns fire in the same exchange; both losses
              land together. Artillery (range 2–4) can neither counter nor be countered up close.
            </p>
            <p>
              Gang up: a defender remembers every strike it took this round. Each later attacker
              gains a bonus per earlier strike, by angle between the two attack positions:
            </p>
            <p className="rules-gangup">
              ranged <b>+1</b> · adjacent, under 60° <b>+1</b> · flanking, 60–135° <b>+2</b> ·
              opposite, 135° and up <b>+3</b>
            </p>
            <p>Counter attacks add nothing to gang up.</p>
          </Section>

          <Section title="Brawls">
            <p>
              A charge puts both factions in one cell. They trade full blows, exchange after
              exchange, until one side is gone. Terrain shields both. Stances ignored. The
              survivor keeps the cell. Both sides can die.
            </p>
          </Section>

          <Section title="The mist">
            <p>
              Every unit sees a radius of cells (vision). The map itself is always known; only
              enemy units hide. Enemies beyond your units' combined vision do not exist for
              planning. A hidden ranged enemy can still hit you — the damage lands with no source
              shown. Fire from the mist.
            </p>
          </Section>

          <Section title="Units">
            <p className="rules-legend">
              i initiative · a armor · r range · v vision · p attack vs personnel · h attack vs
              heavy/armored · m movement budget (tenths, see terrain costs)
            </p>
            <table className="rules-table" data-testid="rules-units-table">
              <thead>
                <tr>
                  <th />
                  <th className="rules-th-name" />
                  <th>i</th>
                  <th>a</th>
                  <th>r</th>
                  <th>v</th>
                  <th>p</th>
                  <th>h</th>
                  <th>m</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((t) => (
                  <tr key={t.key}>
                    <td className="rules-td-icon">
                      <svg viewBox="-14 -14 28 28" className="rules-unit-icon">
                        <UnitRenderer unit={iconUnit(t.key)} x={0} y={0} size={24} minimal />
                      </svg>
                    </td>
                    <td className="rules-td-name">{t.name}</td>
                    <td>{t.initiative}</td>
                    <td>{t.armor}</td>
                    <td>{fmtRange(t.minRange, t.maxRange)}</td>
                    <td>{t.vision}</td>
                    <td>{t.attackStrengths.personnel}</td>
                    <td>{t.attackStrengths.armored}</td>
                    <td>{t.movement}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Terrain">
            <p className="rules-legend">
              cost to enter (movement tenths) and attack / armor bonus, per class
            </p>
            <table className="rules-table" data-testid="rules-terrain-table">
              <thead>
                <tr>
                  <th />
                  <th colSpan={2}>personnel</th>
                  <th colSpan={2}>vehicle</th>
                </tr>
                <tr>
                  <th />
                  <th>cost</th>
                  <th>Ta/Td</th>
                  <th>cost</th>
                  <th>Ta/Td</th>
                </tr>
              </thead>
              <tbody>
                {TERRAIN_ORDER.map((key) => {
                  const pe = personnel.terrainEffects[key];
                  const ve = vehicle.terrainEffects[key];
                  const pOpen = pe.movementCost < IMPASSABLE;
                  const vOpen = ve.movementCost < IMPASSABLE;
                  return (
                    <tr key={key}>
                      <td className="rules-td-name">{TERRAIN_NAME[key]}</td>
                      <td>{fmtCost(pe.movementCost)}</td>
                      <td>{pOpen ? `${fmtBonus(pe.attackBonus)}/${fmtBonus(pe.armorBonus)}` : '—'}</td>
                      <td>{fmtCost(ve.movementCost)}</td>
                      <td>{vOpen ? `${fmtBonus(ve.attackBonus)}/${fmtBonus(ve.armorBonus)}` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p>Mountains stop vehicles. Water stops everyone.</p>
          </Section>

          <Section title="Bases">
            <p>
              Conquest mode plays for ground. Base tiles fly a flag: yours, theirs, or nobody's. A
              flag pip marks every base. A personnel unit standing on a foreign base at round end
              raises the colors and takes it. Vehicles never capture. An owned base watches 2
              cells around it.
            </p>
          </Section>

          <Section title="Credits">
            <p>
              Each faction holds credits, shown as ◈ in the top bar. Income lands at round end: a
              fixed sum per base owned at that moment. Credits buy units; nothing else does.
            </p>
          </Section>

          <Section title="Production">
            <p>
              Tap an owned base to muster a unit. One order per base per round; the total of all
              orders stays within your credits. The recruit appears on the base at round end and
              acts the next round. Credits are spent only when the recruit arrives. An occupied
              base delivers nothing: the order fails and the credits stay.
            </p>
          </Section>

          <Section title="Tiles">
            <p>
              The board is an organic mesh of irregular tiles — not a square or hex grid.
              Two tiles are <b>adjacent</b> when they share a border: each tile keeps a list of
              its direct neighbors. Adjacent means distance&nbsp;1.
            </p>
            <p>
              Distance counts in <b>hops</b> along neighbor links, not straight line. Range
              2–4 means 2 to 4 hops away. A tile that looks geometrically close might still be
              distance&nbsp;2 if no shared border exists between them.
            </p>
            {/* Schematic: center tile + 5 neighbors (dist 1) + 3 second-ring tiles (dist 2).
                One of the dist-2 tiles is drawn touching the center visually to illustrate
                the "looks near but is not adjacent" point. All numbers are hop distances. */}
            <svg
              viewBox="0 0 220 160"
              aria-label="Adjacency diagram: YOU tile at center, neighbors labeled 1, outer ring labeled 2"
              className="rules-tiles-svg"
            >
              {/* --- dist-2 tiles (outer ring, behind so dist-1 tiles sit on top) --- */}
              {/* top-left dist-2 */}
              <polygon points="18,14 62,14 70,44 28,52" fill="#e8e3d6" stroke="#c8c0ae" strokeWidth="1.2" />
              <text x="44" y="36" textAnchor="middle" fontSize="13" fontWeight="700" fill="#9a8f7a">2</text>
              {/* top-right dist-2 */}
              <polygon points="138,8 184,8 190,40 144,46" fill="#e8e3d6" stroke="#c8c0ae" strokeWidth="1.2" />
              <text x="163" y="31" textAnchor="middle" fontSize="13" fontWeight="700" fill="#9a8f7a">2</text>
              {/* right dist-2 */}
              <polygon points="186,64 218,58 218,104 186,100" fill="#e8e3d6" stroke="#c8c0ae" strokeWidth="1.2" />
              <text x="202" y="85" textAnchor="middle" fontSize="13" fontWeight="700" fill="#9a8f7a">2</text>
              {/* bottom dist-2 */}
              <polygon points="82,136 138,136 132,156 88,156" fill="#e8e3d6" stroke="#c8c0ae" strokeWidth="1.2" />
              <text x="110" y="151" textAnchor="middle" fontSize="13" fontWeight="700" fill="#9a8f7a">2</text>
              {/* bottom-left dist-2 */}
              <polygon points="14,104 50,96 54,130 16,136" fill="#e8e3d6" stroke="#c8c0ae" strokeWidth="1.2" />
              <text x="34" y="120" textAnchor="middle" fontSize="13" fontWeight="700" fill="#9a8f7a">2</text>

              {/* --- "looks close but dist 2" tile: placed near top-center, touching center
                   tile visually, but its only shared border is with the top neighbor (dist 1),
                   not the center. Annotated with a dashed stroke and a note. --- */}
              <polygon points="90,4 132,4 136,28 86,28" fill="#f0e8d0" stroke="#b8a880" strokeWidth="1.2" strokeDasharray="4 2" />
              <text x="111" y="22" textAnchor="middle" fontSize="12" fontWeight="700" fill="#9a7a40">2</text>
              <text x="111" y="4" textAnchor="middle" fontSize="8" fill="#9a7a40" dy="-2">no shared border</text>

              {/* --- dist-1 neighbors (the five direct neighbors of center) --- */}
              {/* top neighbor */}
              <polygon points="74,30 148,30 144,68 78,68" fill="#d4cfc3" stroke="#a89e8a" strokeWidth="1.4" />
              <text x="111" y="55" textAnchor="middle" fontSize="14" fontWeight="800" fill="#5a5040">1</text>
              {/* right neighbor */}
              <polygon points="152,62 186,58 186,100 150,102" fill="#d4cfc3" stroke="#a89e8a" strokeWidth="1.4" />
              <text x="168" y="84" textAnchor="middle" fontSize="14" fontWeight="800" fill="#5a5040">1</text>
              {/* bottom-right neighbor */}
              <polygon points="118,112 158,108 154,136 114,138" fill="#d4cfc3" stroke="#a89e8a" strokeWidth="1.4" />
              <text x="136" y="128" textAnchor="middle" fontSize="14" fontWeight="800" fill="#5a5040">1</text>
              {/* bottom-left neighbor */}
              <polygon points="62,110 106,112 102,138 58,134" fill="#d4cfc3" stroke="#a89e8a" strokeWidth="1.4" />
              <text x="82" y="129" textAnchor="middle" fontSize="14" fontWeight="800" fill="#5a5040">1</text>
              {/* left neighbor */}
              <polygon points="32,60 76,64 74,100 30,98" fill="#d4cfc3" stroke="#a89e8a" strokeWidth="1.4" />
              <text x="53" y="85" textAnchor="middle" fontSize="14" fontWeight="800" fill="#5a5040">1</text>

              {/* --- center "YOU" tile --- */}
              <polygon points="78,68 144,68 150,102 110,112 70,108 30,98 32,60 74,30" fill="#4a7c59" stroke="#2d5c3e" strokeWidth="1.8" />
              <text x="90" y="86" textAnchor="middle" fontSize="10" fontWeight="800" fill="#e8f4ec" letterSpacing="0.05em">YOU</text>
              <text x="90" y="100" textAnchor="middle" fontSize="10" fill="#c8e4d0">dist 0</text>
            </svg>
            <p className="rules-legend">
              Numbers = hop distance · tiles labeled 1 share a border with YOU (adjacent) ·
              tiles labeled 2 are two hops away · the dashed tile looks near but has no shared
              border with YOU — distance 2 via the tile labeled 1 above it.
            </p>
            <p>
              Movement and attack range both measure in hops. Moving into a tile that borders
              an enemy costs extra movement (friction) — the neighbor list is what makes a tile
              "adjacent to an enemy."
            </p>
          </Section>

          <Section title="Winning">
            <p>
              <b>Skirmish</b> — annihilation. A faction with no units at the end of a round loses.
              Both wiped out in the same round: draw. Round 40 reached with both alive: the mist
              settles — draw.
            </p>
            <p>
              <b>Conquest</b> — lose every unit AND every base, and the war is over at once. A
              faction holding zero bases for 3 round ends running collapses and loses; the
              countdown shows while you are baseless. An optional round limit (40, 60, 80) ends
              the war by count: most bases, then most total unit strength, else draw.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}
