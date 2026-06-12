// Data registry pins — the spec §6.1 roster table and §6.2 terrain class
// table are authoritative; this suite locks data/units.json and
// data/terrain.json to them so balance edits are deliberate.

import { describe, expect, test } from 'vitest';
import { loadTerrain, loadUnits } from '../../src/io/data-loader';
import type { UnitType } from '../../src/core/types';

const units = loadUnits();
const terrain = loadTerrain();

// key → [init, mov, armor, armorType, minRange, maxRange, vision, A pers, A arm]
const ROSTER: Record<string, [number, number, number, string, number, number, number, number, number]> = {
  sniper: [13, 6, 4, 'personnel', 1, 2, 4, 9, 2],
  humvee: [12, 15, 4, 'armored', 1, 1, 3, 6, 3],
  ranger: [11, 12, 5, 'personnel', 1, 1, 3, 7, 4],
  infantry: [8, 9, 6, 'personnel', 1, 1, 2, 6, 3],
  grenadier: [7, 6, 7, 'personnel', 1, 1, 2, 4, 7],
  tank: [6, 12, 5, 'armored', 1, 1, 2, 5, 6],
  artillery: [4, 6, 3, 'armored', 2, 4, 1, 8, 6],
  heavytank: [3, 9, 8, 'armored', 1, 1, 1, 7, 8],
};

describe('units.json — spec §6.1 roster', () => {
  test('exactly the 8 land units', () => {
    expect(Object.keys(units).sort()).toEqual(Object.keys(ROSTER).sort());
  });

  for (const [key, [init, mov, armor, armorType, minR, maxR, vision, aPers, aArm]] of Object.entries(ROSTER)) {
    test(`${key} matches the table exactly`, () => {
      const u = units[key]!;
      expect(u.key).toBe(key);
      expect(u.initiative).toBe(init);
      expect(u.movement).toBe(mov);
      expect(u.armor).toBe(armor);
      expect(u.armorType).toBe(armorType);
      expect(u.minRange).toBe(minR);
      expect(u.maxRange).toBe(maxR);
      expect(u.vision).toBe(vision);
      expect(u.attackStrengths.personnel).toBe(aPers);
      expect(u.attackStrengths.armored).toBe(aArm);
      expect(u.attackStrengths.naval).toBe(0);
      expect(u.attackStrengths.air).toBe(0);
    });
  }
});

describe('units.json — spec §6.2 terrain class table', () => {
  const personnel = ['sniper', 'ranger', 'infantry', 'grenadier'];
  const vehicles = ['humvee', 'tank', 'artillery', 'heavytank'];

  const effectsOf = (key: string) => (units[key] as UnitType).terrainEffects;

  test('personnel class: costs and bonuses', () => {
    for (const key of personnel) {
      const e = effectsOf(key);
      expect(e.plains).toEqual({ movementCost: 3, attackBonus: 0, armorBonus: 0 });
      expect(e.woods).toEqual({ movementCost: 4, attackBonus: 0, armorBonus: 2 });
      expect(e.mountains).toEqual({ movementCost: 6, attackBonus: 2, armorBonus: 2 });
      expect(e.swamp).toEqual({ movementCost: 6, attackBonus: 0, armorBonus: -1 });
      expect(e.water.movementCost).toBeGreaterThanOrEqual(99);
      expect(e.base).toEqual({ movementCost: 2, attackBonus: 0, armorBonus: 2 });
    }
  });

  test('vehicle class: costs and bonuses, mountains + water impassable', () => {
    for (const key of vehicles) {
      const e = effectsOf(key);
      expect(e.plains).toEqual({ movementCost: 3, attackBonus: 0, armorBonus: 0 });
      expect(e.woods).toEqual({ movementCost: 6, attackBonus: 0, armorBonus: 0 });
      expect(e.mountains.movementCost).toBeGreaterThanOrEqual(99);
      expect(e.swamp).toEqual({ movementCost: 9, attackBonus: 0, armorBonus: -2 });
      expect(e.water.movementCost).toBeGreaterThanOrEqual(99);
      expect(e.base).toEqual({ movementCost: 2, attackBonus: 0, armorBonus: 1 });
    }
  });
});

describe('terrain.json — spec §6.2 passability', () => {
  test('six terrain keys', () => {
    expect(Object.keys(terrain).sort()).toEqual(
      ['base', 'mountains', 'plains', 'swamp', 'water', 'woods'].sort(),
    );
  });

  test('water impassable to the whole land roster', () => {
    expect(terrain.water.passable).not.toContain('personnel');
    expect(terrain.water.passable).not.toContain('armored');
  });

  test('mountains impassable to vehicles, open to personnel', () => {
    expect(terrain.mountains.passable).not.toContain('armored');
    expect(terrain.mountains.passable).toContain('personnel');
  });
});
