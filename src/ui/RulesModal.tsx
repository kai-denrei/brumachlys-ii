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
              A tile can have <b>4 to 8 neighbors</b>, and every tile that shares a border with
              you is distance&nbsp;1. Distance counts in <b>hops</b> along neighbor links, not
              straight line: range 2–4 means 2 to 4 hops away, reached by crossing a neighbor.
            </p>
            {/* Schematic: a center YOU tile ringed by its direct neighbors. Each
                neighbor shares one full EDGE with YOU, so all six are distance 1 (a
                real tile has 4 to 8 such neighbors). The outer tiles share a border
                only with a neighbor, never with YOU, so they are distance 2. Built
                so every drawn shared edge matches its label. Numbers are hop counts. */}
            <svg
              viewBox="0 0 240 200"
              aria-label="Adjacency diagram: a YOU tile ringed by six neighbors at distance 1, with an outer ring at distance 2"
              className="rules-tiles-svg"
            >
              {/* --- distance 2 (outer ring): each shares a border with a neighbor, not with YOU --- */}
              <polygon points="82,33 159,33 150,8 95,8" fill="#e8e3d6" stroke="#c8c0ae" strokeWidth="1.2" />
              <text x="121" y="25" textAnchor="middle" fontSize="13" fontWeight="700" fill="#9a8f7a">2</text>
              <polygon points="159,33 197,100 226,84 188,18" fill="#e8e3d6" stroke="#c8c0ae" strokeWidth="1.2" />
              <text x="192" y="64" textAnchor="middle" fontSize="13" fontWeight="700" fill="#9a8f7a">2</text>
              <polygon points="197,100 159,167 184,186 222,122" fill="#e8e3d6" stroke="#c8c0ae" strokeWidth="1.2" />
              <text x="190" y="148" textAnchor="middle" fontSize="13" fontWeight="700" fill="#9a8f7a">2</text>
              <polygon points="82,167 159,167 151,190 90,190" fill="#e8e3d6" stroke="#c8c0ae" strokeWidth="1.2" />
              <text x="120" y="183" textAnchor="middle" fontSize="13" fontWeight="700" fill="#9a8f7a">2</text>
              <polygon points="43,100 82,167 52,184 16,116" fill="#e8e3d6" stroke="#c8c0ae" strokeWidth="1.2" />
              <text x="48" y="148" textAnchor="middle" fontSize="13" fontWeight="700" fill="#9a8f7a">2</text>
              <polygon points="43,100 82,33 54,18 16,84" fill="#e8e3d6" stroke="#c8c0ae" strokeWidth="1.2" />
              <text x="49" y="64" textAnchor="middle" fontSize="13" fontWeight="700" fill="#9a8f7a">2</text>

              {/* --- distance 1 (the six direct neighbors): each shares one full edge with YOU --- */}
              <polygon points="98,62 142,62 159,33 82,33" fill="#d4cfc3" stroke="#a89e8a" strokeWidth="1.4" />
              <text x="120" y="53" textAnchor="middle" fontSize="14" fontWeight="800" fill="#5a5040">1</text>
              <polygon points="142,62 164,100 197,100 159,33" fill="#d4cfc3" stroke="#a89e8a" strokeWidth="1.4" />
              <text x="166" y="79" textAnchor="middle" fontSize="14" fontWeight="800" fill="#5a5040">1</text>
              <polygon points="164,100 142,138 159,167 197,100" fill="#d4cfc3" stroke="#a89e8a" strokeWidth="1.4" />
              <text x="166" y="131" textAnchor="middle" fontSize="14" fontWeight="800" fill="#5a5040">1</text>
              <polygon points="142,138 98,138 82,167 159,167" fill="#d4cfc3" stroke="#a89e8a" strokeWidth="1.4" />
              <text x="120" y="157" textAnchor="middle" fontSize="14" fontWeight="800" fill="#5a5040">1</text>
              <polygon points="98,138 76,100 43,100 82,167" fill="#d4cfc3" stroke="#a89e8a" strokeWidth="1.4" />
              <text x="74" y="131" textAnchor="middle" fontSize="14" fontWeight="800" fill="#5a5040">1</text>
              <polygon points="76,100 98,62 82,33 43,100" fill="#d4cfc3" stroke="#a89e8a" strokeWidth="1.4" />
              <text x="74" y="79" textAnchor="middle" fontSize="14" fontWeight="800" fill="#5a5040">1</text>

              {/* --- center YOU tile: a hexagon whose six edges are each shared with a neighbor --- */}
              <polygon points="164,100 142,138 98,138 76,100 98,62 142,62" fill="#4a7c59" stroke="#2d5c3e" strokeWidth="1.8" />
              <text x="120" y="98" textAnchor="middle" fontSize="11" fontWeight="800" fill="#e8f4ec" letterSpacing="0.05em">YOU</text>
              <text x="120" y="112" textAnchor="middle" fontSize="9" fill="#c8e4d0">dist 0</text>
            </svg>
            <p className="rules-legend">
              Numbers = hop distance · every tile that shares a border with YOU is distance 1 ·
              the outer tiles share a border only with a neighbor, so they are distance 2.
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
