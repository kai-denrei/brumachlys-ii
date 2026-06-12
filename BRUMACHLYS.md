# Brumachlys — Build Specification (PoC)

> *brume* (fr. mist) + *achlys* (gr. Ἀχλύς, the death-mist of the Iliad)
> A simultaneous-turn tactical wargame in the Weewar / Zetawar lineage, with tiles made out with the Oskar-Procedure (see project)

---

## 0. TL;DR for the implementing agent

Build a wargame where both players commit orders blind, then a deterministic resolver plays them out in **initiative order**. Combat math is ported directly from Weewar (see `Appendix A`) and Zetawar (MIT-licensed reference, see `Appendix B`). Map format is Weewar XML (sample provided).

Not a port of Zetawar. A fresh build using its design choices as a known-good baseline.

**Hard rules for the agent:**
- Pick decisively where this spec leaves a choice; document the choice in `DECISIONS.md`.
- Combat math is **deterministic only** (no per-roll RNG). Replays must be byte-identical given seed + orders.
- All RNG goes through the seeded generator in `src/core/rng.ts`. No `Math.random()` anywhere.
- Hot-seat single-screen. No netcode. No backend. No accounts.
- Don't import or vendor any code from Zetawar. Use it as conceptual reference only. We re-implement.
- Use placeholder geometric shapes for unit sprites; we'll skin later.

---

## 1. Project context

### 1.1 Lineage
- **Weewar** (2007–2009, defunct): turn-based hex wargame, browser, 20 unit types, hex combat with sub-units and gang-up bonus.
- **Zetawar** (2016–): MIT-licensed ClojureScript reimplementation. Modernized roster, kept Weewar's combat formula intact. Reference only — we reimplement in TypeScript.
- **Elite Command sprites** (Chris Vincent, CC-BY 4.0): available for later visual pass. Not used in PoC.

### 1.2 What's new in Brumachlys
- **Simultaneous turns**, discrete (Diplomacy-style two-phase), not continuous.
- **Initiative stat per unit** (D&D-style) drives intra-round ordering.
- **Fog of war** is core, not optional.
- **High-level orders** with stances (Aggressive / Defensive / Hold-Fire), units auto-resolve attacks during the resolution phase.

### 1.3 Out of scope for PoC
- Network play
- AI opponents
- Custom unit/sprite art
- Sound
- Persistent storage of games beyond the current session
- Map editor
- Capture mechanics, repair, base building, credits/economy (placed-units-only scenarios for now)
- More than 2 players

---

## 2. Game model

### 2.1 Turn structure

Each round has exactly two phases:

```
┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────┐
│   PLANNING PHASE     │ →  │  RESOLUTION PHASE    │ →  │  END / NEXT  │
│   both players       │    │  init-sorted, auto   │    │   ROUND      │
│   queue orders       │    │                      │    │              │
└──────────────────────┘    └──────────────────────┘    └──────────────┘
```

In hot-seat: planning phase runs sequentially (Player 1 plans → "Hand off" → Player 2 plans → "Resolve") with a screen-clearing handoff in between to preserve fog of war.

### 2.2 Initiative system

Every unit type has an `initiative: number`. During resolution, all queued orders are sorted by `initiative` descending; ties broken by `hash(unitId, round)` for determinism.

This is the only ordering mechanism in the resolver. There is no concept of "your turn vs. mine" inside a round.

### 2.3 Phases within a round

Inside the Resolution Phase, processing is itself two-phase:

**Phase A — Movement** (init order)
- Each unit with a queued `move` order traverses its planned path up to its `movement` allowance.
- Pathing checks happen at execution time, not at order time.
- Conflict rules: see §2.4.

**Phase B — Combat** (init order)
- Each unit with a queued `attack` order, plus each unit in **Aggressive** stance (auto-attack), fires on its target *if still in range* after Phase A.
- Out-of-range attacks fizzle (logged as "lost target"). No fallback target.
- Combat math: see §3.
- Damage applied **immediately** within Phase B (so a low-initiative ally attacking the same defender hits a softened target — this is intentional and creates "concentrate fire" tactics).
- Counter-attack: defender automatically returns fire if in range, with no gang-up bonus on the counter (matches Zetawar). Defender's initiative is irrelevant for counter-attack timing — it happens within the attacker's slot.

There is no Phase C in the PoC. Capture, repair, build are deferred.

### 2.4 Conflict resolution rules

These need to be exact for replay determinism.

**Move into occupied hex** (target hex contains a unit at attempt time):
- If target hex has a friendly unit: stop one hex back along path. If no valid prior hex, order fails (unit stays put).
- If target hex has an enemy unit: stop one hex back along path. (Combat will follow if attacker has an attack order against that unit; otherwise no engagement.)

**Two units want the same hex** (both moving into the same empty hex):
- Higher-initiative unit claims the hex.
- Loser stops one hex back along its path.
- This is resolved naturally by init-ordered processing of Phase A.

**Pass-through**:
- Allowed through hexes containing friendly units (`move-through-friendly: true`, matches Zetawar).
- Blocked by enemy units (must stop adjacent).

**Movement cost**:
- Per-terrain `movement-cost` (integer, in tenths of a movement point).
- Total `movement` budget is in tenths too. (Zetawar uses the same: infantry has `movement: 9`, plains cost is `3` → 3 plains per turn. We keep this.)

**Edge case — terrain mismatch** (e.g., land unit ordered into water): order rejected at order-entry time, never reaches resolver.

---

## 3. Combat math

### 3.1 The formula

```
p = clamp(0.5 + 0.05 * ((A + Ta) - (D + Td) + B), 0, 1)
damage = round(attackerCount * p)
```

Where:
- `A` = attacker's attack strength **vs. defender's armor type** (`personnel | armored | naval | air`)
- `D` = defender's armor (or `capturing-armor` if capturing — N/A in PoC)
- `Ta` = terrain attack bonus for attacker on its current terrain, indexed by attacker's unit type
- `Td` = terrain armor bonus for defender on its current terrain, indexed by defender's unit type
- `B` = gang-up bonus (see §3.2)
- `attackerCount` = current number of sub-units in the attacking unit (1–10)

This is the spreadsheet formula verbatim. Stochastic mode (6 rolls per sub-unit) is **not implemented** in the PoC.

### 3.2 Gang-up bonus under initiative

```
B = (rangedAttacks  * 1)
  + (adjacentAttacks * 1)
  + (flankingAttacks * 2)
  + (oppositeAttacks * 3)
```

A previous attack against the defender this round contributes to `B` based on the hex it came from, classified relative to the **current** attacker's hex and the defender's hex:

- **ranged**: prior attacker hex was not adjacent to the defender (used a `min-range > 1` weapon)
- **opposite**: prior attacker was on the hex directly opposite the current attacker across the defender (uses `hex.opposite?`)
- **adjacent**: prior attacker was adjacent to both the defender AND the current attacker
- **flanking**: prior attacker was adjacent to the defender but not adjacent to the current attacker, and not opposite

Each defender carries a `attackedFromHexes: Hex[]` accumulator within a round. At each attack resolution:
1. Compute `B` from the current accumulator before this strike
2. Apply damage
3. Append attacker's hex to defender's accumulator
4. (Counter-attack does NOT contribute to its own `B` — Zetawar behavior preserved)

Accumulator clears at end of round.

### 3.3 Counter-attack

Within the attacker's initiative slot:
1. Attacker inflicts `damageA→D` (with current `B`).
2. If defender is in range of attacker (using defender's `min-range/max-range`): defender inflicts `damageD→A` with `B = 0`.
3. Both damages applied immediately.
4. If either unit's count drops to 0, it is removed from the board.

Order of internal steps (1) → (2) → (3) is fixed. Both damage values are computed against starting counts of this exchange, then applied together (one tick of mutual loss).

### 3.4 Damage application

Within a round:
- After each attack exchange completes, both units' counts update immediately.
- If a unit reaches 0 count, it is removed; subsequent queued orders involving it are dropped.
- A unit removed in Phase B can still have completed its Phase A movement.

### 3.5 Initiative values (PoC starting set)

For the two-unit MVP roster:

| Unit     | Initiative |
|----------|------------|
| Infantry | 8          |
| Tank     | 6          |

Future roster (transcribed from Zetawar), initial balance guess:

| Unit            | Init | Notes                          |
|-----------------|------|--------------------------------|
| Sniper          | 13   | shoots first                   |
| Fighter (jet)   | 14   | air superiority                |
| Ranger          | 11   | light recon                    |
| Gunship         | 11   |                                |
| Humvee          | 12   | fast vehicle                   |
| Bomber          | 10   |                                |
| Frigate         | 9    |                                |
| Infantry        | 8    | baseline                       |
| Destroyer       | 8    |                                |
| Mobile Flak     | 8    |                                |
| Grenadier       | 7    |                                |
| Medic           | 7    |                                |
| Tank            | 6    |                                |
| Engineer        | 6    |                                |
| Mortar          | 6    |                                |
| Cruiser         | 6    |                                |
| Heavy Tank      | 5    | slow, heavy                    |
| Artillery       | 4    | static                         |
| Heavy Artillery | 3    | slowest setup                  |

These live in `data/units.json`, easy to retune.

---

## 4. Data model

### 4.1 Game state (TypeScript)

```ts
type Hex = { q: number; r: number };

type FactionId = 0 | 1;

type Stance = 'aggressive' | 'defensive' | 'hold-fire';

type Order =
  | { kind: 'move'; unitId: string; path: Hex[] }                 // path is destination hexes only, not including start
  | { kind: 'attack'; unitId: string; targetHex: Hex }
  | { kind: 'stance'; unitId: string; stance: Stance };

type UnitInstance = {
  id: string;
  type: string;                  // key into UnitType registry, e.g. 'infantry'
  faction: FactionId;
  hex: Hex;
  count: number;                 // 1..10
  stance: Stance;                // default 'aggressive'
  attackedFromHexes: Hex[];      // gang-up accumulator, cleared per round
};

type GameState = {
  round: number;                 // 1-indexed
  phase: 'planning' | 'planning-handoff' | 'resolution' | 'replay' | 'over';
  activePlanner: FactionId | null;  // who's currently entering orders (hot-seat)
  map: GameMap;
  units: Record<string, UnitInstance>;
  pendingOrders: Record<FactionId, Order[]>;  // committed orders for this round
  rngSeed: number;               // xorshift32 state
  log: ResolutionEvent[];        // for replay
};
```

### 4.2 Order representation

Orders are immutable values. A unit can have at most one `move` and at most one `attack` order per round. Stance changes are an order too (queued, applied at start of resolution).

Order entry constraints checked at submission:
- `move`: path is reachable given unit's `movement` and current visible terrain (don't path through fog — only into it; pathing assumes unknown terrain has plains cost; resolver re-checks at execution).
- `attack`: target hex contains a visible enemy unit AND that unit is in range.
- `stance`: always valid.

### 4.3 Unit type definition

```ts
type ArmorType = 'personnel' | 'armored' | 'naval' | 'air';
type TerrainKey = 'plains' | 'mountains' | 'woods' | 'swamp' | 'water' | 'base';

type UnitType = {
  key: string;                   // 'infantry', 'tank', ...
  description: string;
  cost: number;                  // unused in PoC
  movement: number;              // total movement points (in tenths-of-hex; see §2.4)
  initiative: number;            // §2.2
  armor: number;                 // D in formula
  armorType: ArmorType;          // determines which attackStrength applies when attacked
  minRange: number;
  maxRange: number;
  vision: number;                // §6
  attackStrengths: Record<ArmorType, number>;  // A vs each armor type; 0 = cannot attack
  terrainEffects: Record<TerrainKey, {
    movementCost: number;        // tenths
    attackBonus: number;         // Ta
    armorBonus: number;          // Td
  }>;
};
```

PoC ships with two unit types (`infantry`, `tank`). The loader supports the full Zetawar roster shape so we can drop in the rest later by editing JSON.

### 4.4 Terrain definition

```ts
type TerrainType = {
  key: TerrainKey;
  description: string;
  passable: ArmorType[];         // which armor types may enter; e.g. water excludes 'personnel' and 'armored'
};
```

For the PoC: `plains`, `mountains`, `woods`, `swamp`, `water`, `base` (base is a tile but with no functional effect in PoC — visual only).

---

## 5. Map format

### 5.1 Weewar XML (input)

The PoC loads pre-existing Weewar map XML files. Sample schema:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<map id="1">
  <name>Three ways</name>
  <initialCredits>100</initialCredits>
  <perBaseCredits>200</perBaseCredits>
  <width>17</width>
  <height>20</height>
  <maxPlayers>3</maxPlayers>
  <revision>0</revision>
  <creator>bert</creator>
  <terrains>
    <terrain x="0" y="9" type="Water" />
    <terrain x="6" y="7" type="Plains" startUnit="Trooper" startUnitOwner="0" />
    <terrain x="7" y="6" type="Base" startFaction="0" />
    ...
  </terrains>
</map>
```

Terrain types observed in samples (PoC will accept these): `Plains`, `Water`, `Mountains`, `Woods`, `Swamp`, `Base`. Map case-insensitively to internal `TerrainKey`.

Unit types observed: `Trooper` (mapped to `infantry`). Future mappings as we expand the roster.

Owner attributes: `startUnitOwner` and `startFaction` are 0-indexed faction IDs. PoC supports only 2 factions; maps with `maxPlayers > 2` are loaded with factions ≥ 2 dropped (their units and bases not placed). Log a warning.

### 5.2 Coordinate conversion

Weewar XML uses (x, y) "offset" with what looks like odd-row-shift. Zetawar's `hex.cljc` uses (q, r) offset coordinates with the same odd-r convention (see `Appendix B`).

Mapping: `q = x, r = y`. Verify visually after rendering the sample map; if islands look wrong, try `r = y` with parity flipped or `q = x - floor(r/2)` (axial). The exact convention is empirical — write the converter, render `Three ways`, eyeball it against any preserved Weewar map screenshot online. Sanity check: bases at (1,10) and (6,10) and (7,6) on a 17×20 map should form roughly the "three ways" landmasses.

### 5.3 Internal map shape

```ts
type GameMap = {
  width: number;
  height: number;
  name: string;
  tiles: Map<string, TerrainKey>;   // key = `${q},${r}`
  startingUnits: Array<{ hex: Hex; unitTypeKey: string; faction: FactionId }>;
  startingBases: Array<{ hex: Hex; faction: FactionId | null }>;  // not used in PoC
};
```

---

## 6. Fog of War

### 6.1 Visibility derivation

Per faction:
```
visibleHexes(faction) = ⋃ { hex within unit.vision of unit.hex | unit.faction == faction }
```

`unit.vision` defaults to 2. (Snipers/recon units later get 3+; this is a unit type stat — already in the type definition.)

### 6.2 What's hidden

When rendering for faction F:
- Tiles outside `visibleHexes(F)` are rendered as fog (dark, no terrain detail).
- **Wait — terrain itself is permanent knowledge in most fog systems.** PoC choice: terrain is always visible (it's the map; players see it from the start). Only **enemy units** are hidden in fog. Friendly units always visible. This matches Diplomacy more than Combat Mission and is much simpler.
- Enemy units in non-visible hexes: not shown at all. No "last known position" in PoC.

### 6.3 Order entry and fog

During a faction's planning phase, only its own visible state is shown. Enemy unit positions outside visibility are absent. Movement orders may target hexes inside fog (the unit will go there; combat may follow if it walks into something). Attack orders require a visible enemy.

### 6.4 Replay phase and fog

During replay, fog is **lifted** for the faction whose planning is being shown — players see what each side did. This is a simplification for the PoC (real game would replay each side's view separately). Decide later.

---

## 7. UI / interaction

### 7.1 Layout

```
┌────────────────────────────────────────────────────────────────┐
│  HEADER  Round 3 — Planning Phase — Player 1 (Red)             │
├──────────────────────────────────────────┬─────────────────────┤
│                                          │  SELECTED: Infantry │
│                                          │  HP: 8/10           │
│           HEX BOARD                      │  Stance: Aggressive │
│           (Canvas or SVG)                │                     │
│                                          │  [Move]             │
│                                          │  [Attack]           │
│                                          │  [Stance ▼]         │
│                                          │                     │
│                                          │  ──────────────     │
│                                          │  ORDERS (3)         │
│                                          │  • Inf-A → (5,7)    │
│                                          │  • Inf-B → atk Tnk  │
│                                          │  • Tnk-A: defensive │
├──────────────────────────────────────────┴─────────────────────┤
│  [Commit Orders]                                  [Hand off]   │
└────────────────────────────────────────────────────────────────┘
```

### 7.2 Order entry phase

- Click own unit → unit selected, its movement range and attack range highlighted.
- Click reachable hex → queue move order.
- Click visible enemy in range → queue attack order.
- Right-click own unit → cycle stance (Aggressive → Defensive → Hold-Fire → Aggressive).
- Click queued order in side panel → option to delete.
- One move and one attack per unit per round (UI prevents queuing a second).
- "Commit Orders" button locks orders for this player.

### 7.3 Hand-off (hot-seat)

After Player 1 commits:
- Show full-screen "Pass to Player 2" overlay with click-through.
- Clear selection state.
- Re-render board from Player 2's perspective.

After Player 2 commits:
- Run resolver.
- Animate replay (see 7.4).

### 7.4 Replay phase

- Resolver produces an event log: `{ type: 'move' | 'attack' | 'stance' | 'kill', ... }` in initiative order.
- UI plays events on a timeline with ~600ms per event, with a speed slider (0.5×, 1×, 2×, instant).
- Movement events animate the unit moving along its actual resolved path (which may be shorter than planned).
- Attack events flash the attacker → defender line, show damage numbers floating up (`-3`, `-2`), update counts in real time.
- A "next round" button advances when the log is exhausted.

### 7.5 Win condition (PoC)

A faction loses when it has no units remaining at end of round. Other faction wins. Show a banner.

---

## 8. Module / file layout

```
brumachlys/
├─ README.md
├─ DECISIONS.md            # agent records every choice it makes here
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
├─ index.html
├─ data/
│  ├─ units.json           # transcribed unit roster (start with 2 entries: infantry, tank)
│  ├─ terrain.json         # terrain stats
│  └─ maps/
│     └─ three-ways.xml    # provided sample
├─ src/
│  ├─ main.tsx
│  ├─ App.tsx
│  ├─ core/
│  │  ├─ hex.ts            # offset (q,r), distance, neighbors, opposite, adjacents
│  │  ├─ rng.ts            # xorshift32
│  │  ├─ combat.ts         # attackDamage(), battleExchange(), gangUpBonus()
│  │  ├─ resolver.ts       # resolveRound(state, ordersP1, ordersP2) → {newState, log}
│  │  ├─ orders.ts         # validateOrder(), Order types
│  │  ├─ pathing.ts        # bfs/dijkstra over hexes with movement-cost
│  │  ├─ fog.ts            # visibleHexesFor(faction, state)
│  │  ├─ map.ts            # GameMap utilities
│  │  └─ types.ts          # GameState, UnitType, etc.
│  ├─ io/
│  │  ├─ weewar-xml.ts     # parseWeewarMap(xmlString) → GameMap
│  │  └─ data-loader.ts    # loads units.json + terrain.json into typed registries
│  ├─ state/
│  │  └─ store.ts          # Zustand store, actions: selectUnit, queueMove, queueAttack, commit, ...
│  └─ ui/
│     ├─ Board.tsx
│     ├─ Hex.tsx
│     ├─ Unit.tsx
│     ├─ OrderPanel.tsx
│     ├─ HudHeader.tsx
│     ├─ Handoff.tsx
│     ├─ Replay.tsx
│     └─ styles.css
└─ test/
   ├─ hex.test.ts
   ├─ combat.test.ts
   ├─ resolver.test.ts
   ├─ pathing.test.ts
   ├─ fog.test.ts
   └─ weewar-xml.test.ts
```

### 8.1 Module responsibilities

| Module             | Responsibility                                                                 |
|--------------------|---------------------------------------------------------------------------------|
| `core/hex.ts`      | Pure hex math. No game knowledge.                                               |
| `core/rng.ts`      | Seeded xorshift32. `next()`, `seed()`, `clone()`.                               |
| `core/combat.ts`   | `attackDamage(attacker, defender, terrain, bonus): number`. Pure function.      |
| `core/resolver.ts` | The core. `resolveRound(state, allOrders): {newState, eventLog}`. Pure.         |
| `core/orders.ts`   | Order types and validation predicates.                                          |
| `core/pathing.ts`  | `findPath(map, units, from, to, unit) → Hex[]\|null`.                           |
| `core/fog.ts`      | `visibleHexes(state, faction): Set<string>`.                                    |
| `io/weewar-xml.ts` | XML → `GameMap`. DOMParser-based.                                               |
| `state/store.ts`   | All UI state mutations. Wraps the pure resolver.                                |
| `ui/*`             | React components, dumb wrt game logic.                                          |

**Critical**: `core/*` must be 100% pure functions (no module state, no side effects, no `Math.random`). This is what makes replay determinism cheap and tests easy.

---

## 9. Build phases

The agent should build these in order, fully testing each before the next.

### Phase 1: Hex math + RNG + types
- `core/hex.ts` with full unit tests against the table in §11.1.
- `core/rng.ts` with reproducibility test.
- `core/types.ts` and `core/orders.ts` (types only, no logic).
- **Done when:** `npm test` passes for hex and rng modules.

### Phase 2: Data loading
- `data/units.json` with entries for `infantry` and `tank`.
- `data/terrain.json` with the six terrain types.
- `io/weewar-xml.ts` parses the provided `three-ways.xml` into a `GameMap`.
- `io/data-loader.ts` loads JSON registries.
- **Done when:** test loads `three-ways.xml` and asserts width=17, height=20, has 190 tiles, and starting units include three Troopers.

### Phase 3: Pathing + Combat (pure)
- `core/pathing.ts` with movement-cost-weighted BFS/Dijkstra.
- `core/combat.ts` with `attackDamage` and `battleExchange`.
- **Done when:** combat tests in §11.2 pass.

### Phase 4: Resolver
- `core/resolver.ts` implements the full Phase A → Phase B pipeline in init order.
- Produces a structured event log.
- **Done when:** resolver tests in §11.3 pass, including determinism test (same input → byte-identical output).

### Phase 5: Fog
- `core/fog.ts`.
- **Done when:** fog test in §11.4 passes.

### Phase 6: UI — board rendering only
- Render the loaded map. No interaction yet. Just see it.
- **Done when:** `three-ways.xml` renders recognizably with the three landmasses.

### Phase 7: UI — order entry
- Click unit → see range. Click hex → queue order. Side panel.
- **Done when:** can queue a move and an attack for each unit, see them listed.

### Phase 8: UI — commit + hand-off + resolve + replay
- Commit button, hand-off screen, resolution call, replay animation.
- **Done when:** can play a full round end-to-end.

### Phase 9: Polish
- Win condition banner, Round counter, basic styling, "New Game" button to reset.

---

## 10. Tech stack & conventions

- **Vite** + **React 18** + **TypeScript** (strict mode on).
- **Zustand** for state (`state/store.ts`).
- **Vitest** for tests.
- **Canvas** for board rendering (SVG also acceptable; choose one and stick with it). Document choice in `DECISIONS.md`.
- **DOMParser** for XML (no library needed).
- No CSS framework. Plain CSS in `styles.css`. Dark editorial palette (off-black background, amber/teal accents, monospace UI — `JetBrains Mono` or `IBM Plex Mono`).
- Linting: default Vite-React-TS ESLint setup is fine.
- **No** external animation libraries for the PoC. `requestAnimationFrame` and lerp.

### 10.1 Determinism guards
- `core/*` may not import from `ui/*` or `state/*`.
- `core/*` may not call `Date.now()`, `Math.random()`, or any non-deterministic API.
- Add a lint rule or a comment-banner check to enforce.

---

## 11. Tests

### 11.1 Hex math (concrete cases)

Using offset (q, r) with odd-r shift (matches Zetawar):

```
distance((0,0), (0,0))  == 0
distance((0,0), (1,0))  == 1
distance((0,0), (0,1))  == 1
distance((0,0), (3,0))  == 3
distance((0,0), (3,3))  == 5     // verify against cube conversion
adjacent((0,0), (1,0))  == true
adjacent((0,0), (2,0))  == false
opposite((0,0), (1,0), (2,0))   == true   // east-east-east
opposite((0,0), (1,0), (1,1))   == false
```

If any of these fail, fix `hex.ts` before proceeding.

### 11.2 Combat formula

Reference cases (matching the "raider vs tank" example in the spreadsheet, adapted to two-unit roster):

```
// Infantry attacks Tank, both on plains, 10 sub-units each, no gang-up
// A (infantry vs armored) = 3, D (tank armor) = 5
// Ta = 0, Td = 0, B = 0
// p = 0.5 + 0.05 * (3 - 5 + 0) = 0.5 - 0.10 = 0.40
// damage = round(10 * 0.40) = 4
attackDamage(infantry10, tank10, plains, plains, 0) == 4

// Counter: tank attacks infantry
// A (tank vs personnel) = 5, D (infantry armor) = 6
// p = 0.5 + 0.05 * (5 - 6) = 0.45
// damage = round(10 * 0.45) = 5  (round-half-to-even may give 4 — pick rounding mode and document)
attackDamage(tank10, infantry10, plains, plains, 0) == 5
```

Note: Math.round in JS rounds half-up for positives; document this.

Gang-up case:
```
// Infantry-A attacks Tank from north (init 8). No prior attacks. B = 0. p = 0.40, dmg = 4.
// Tank now has count 6, attackedFromHexes = [hexN].
// Infantry-B (init 8, tie-broken by id hash) attacks Tank from south.
// Prior attacker hex N relative to attacker hex S, defender between them → opposite!
// B = +3. p = 0.5 + 0.05 * (3 - 5 + 3) = 0.55. dmg = round(6 * 0.55) = 3.
```

Test these exact values.

### 11.3 Resolver determinism

```
const log1 = resolveRound(state, orders, seed=42).log;
const log2 = resolveRound(state, orders, seed=42).log;
expect(JSON.stringify(log1)).toBe(JSON.stringify(log2));

// Different seed → potentially different (only if there's any RNG; in PoC there isn't, so should still match)
// Order independence: shuffling input order arrays must not change the log
const log3 = resolveRound(state, [...ordersP1].reverse(), [...ordersP2].reverse(), seed=42).log;
expect(JSON.stringify(log3)).toBe(JSON.stringify(log1));
```

### 11.4 Fog

```
// Two infantry, one each faction, 5 hexes apart, vision=2.
// Faction 0 should not see Faction 1's unit.
expect(visibleHexes(state, 0).has(`${enemy.q},${enemy.r}`)).toBe(false);
// Move them to 4 hexes apart with vision=2 each → still not visible (4 > 2).
// Move to 2 hexes apart → faction 0 sees faction 1.
```

### 11.5 Weewar XML

```
const map = parseWeewarMap(threeWaysXml);
expect(map.width).toBe(17);
expect(map.height).toBe(20);
expect(map.tiles.size).toBe(190);
expect(map.startingUnits.length).toBe(3);
expect(map.startingUnits.every(u => u.unitTypeKey === 'infantry')).toBe(true);
```

---

## 12. Open design questions (defer, but record)

These are flagged for `DECISIONS.md` once resolved. The agent should pick a default for the PoC and note the choice.

1. **Damage timing within a round** — chosen: immediate (§3.4). Alternative considered: end-of-round atomic. Revisit if "concentrate fire" feels too strong.
2. **Fizzled attack fallback** — chosen: no fallback (attack is wasted). Alternative: attack the nearest enemy in range. Revisit when AI exists.
3. **Counter-attack initiative** — chosen: counter happens within attacker's slot, defender's init irrelevant. Alternative: defender counters at its own slot regardless of who attacked. Current choice matches Zetawar.
4. **Initiative tie-breaking** — chosen: `hash(unitId, round)` for stable per-round shuffling. Document the hash function (use FNV-1a for simplicity; just sum char codes of `unitId` XOR round if FNV is too much).
5. **Replay fog-of-war** — chosen: full reveal during replay. Alternative: replay each side's view separately.
6. **Movement granularity** — chosen: integer-tenths for movement points (matches Zetawar). Alternative: fractional. Stick with tenths.
7. **Pathing under fog** — chosen: planner assumes plains cost for fogged hexes; resolver re-paths at execution. Alternative: forbid pathing into fog.

---

## 13. Build commands the agent should produce

```bash
# Initial setup (the agent runs this once)
npm create vite@latest . -- --template react-ts
npm install zustand
npm install -D vitest @testing-library/react jsdom

# Daily
npm run dev           # local server on :5173
npm test              # vitest run
npm test -- --watch
npm run build
```

`vite.config.ts` should include:
```ts
test: { environment: 'jsdom' }
```

---

## 14. Definition of "PoC complete"

All of the following true at once:

1. `npm test` passes (≥80% line coverage on `core/*`).
2. Loading `data/maps/three-ways.xml` renders the map correctly.
3. Two human players (hot-seat) can play a full game from start to one side losing all units.
4. A queued attack with gang-up bonus from a higher-init ally produces the correct `B` and damage matches the expected formula values.
5. Two consecutive resolutions of the same committed orders produce byte-identical event logs.
6. Fog of war hides enemy units outside vision range and reveals them when in range.
7. `DECISIONS.md` exists and documents every choice the agent made on questions in §12 and any others it encountered.

---

## Appendix A — Spreadsheet cross-reference

The 2007 Weewar combat spreadsheet (provided separately) defines:
- The formula `p = 0.05 * ((A + Ta) - (D + Td) + B) + 0.5`.
- Sub-units 1–10 per unit, with damage = (hits over 6N rolls) / 6 in stochastic mode.
- Gang-up bonus: +1 ranged, +1 adjacent, +2 other-adjacent, +3 opposite.
- Per-terrain attack/armor bonuses by armor type.
- Per-attacker-vs-armor-type attack strengths.

Brumachlys uses the deterministic version of the same formula and the same bonus values. The stochastic mode is preserved as a possible future toggle (`stochasticDamage` flag in game settings, default off, not implemented in PoC).

## Appendix B — Zetawar code references

Zetawar is MIT-licensed at https://github.com/Zetawar/zetawar. The agent should NOT vendor or import its code, but may consult these files as reference for behavior:

- `src/cljc/zetawar/hex.cljc` — odd-r offset hex math, distance, opposite predicate. Mirror this convention.
- `src/cljs/zetawar/data.cljs` — unit/terrain stat tables. Use as source for transcribing `units.json` and `terrain.json` (game-design data, not code).
- `src/cljs/zetawar/game.cljs:552` (`attack-damage`) — combat formula. Re-implement in TypeScript.
- `src/cljs/zetawar/game.cljs:622` (`battle-damage`) — counter-attack pattern.

Brumachlys does not implement: `unit-state-map` FSMs (replaced by simultaneous order queue), `attack-count` per turn (replaced by single attack per round), `:game/current-faction` (no turn alternation).

## Appendix C — Naming notes

**Brumachlys** /bʁy.ma.klis/ — French *brume* + Greek *Achlys* (Ἀχλύς). The mist of the battlefield. The thing both players plan inside.

Internal jargon to use in code/comments:
- `round` (not "turn") — one full plan→commit→resolve cycle.
- `slot` — a unit's position in the initiative queue within a resolution.
- `commit` — the act of locking orders for the round.
- `fog` — the boolean visibility filter.

---

*End of spec. The agent should read this in full before writing any code.*
