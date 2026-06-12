#!/usr/bin/env node
// scan-donors.mjs — donor curation for spec §4.2.
//
// 1. Scans the v1 Weewar stash (12k+ XMLs) with cheap regexes for candidates:
//    maxPlayers == 2, 150–500 terrain tiles, >= 1 base for faction 0 AND 1.
// 2. Ranks the shortlist by |tiles - 300| ascending, then pixel aspect ratio
//    closest to square (ribbon maps make poor portrait-phone boards; §4.2
//    wants "interesting"), then total base count ascending (fewer flavor bases
//    = cleaner skirmish board), then id.
// 3. Bundles the real TS pipeline via esbuild, generates a board (seed 7,
//    maxRetries 0) per shortlisted donor in rank order, keeps the first 5 that
//    pass the connectivity guard FIRST TRY. 10701 (Tai Chi) is force-tried
//    first when it qualifies.
// 4. Copies the 5 chosen XMLs to data/maps/ and prints the report.
//
// Usage: node scripts/scan-donors.mjs [--stash <dir>] [--probe <n>] [--no-copy]

import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : dflt;
};
const STASH = argVal('--stash', '/Users/minikai/Documents/Dev/STB_Brumachlys/weewar-maps');
const PROBE_LIMIT = Number(argVal('--probe', '60')); // how deep into the ranking to probe
const COPY = !args.includes('--no-copy');
const SEED = 7;
const TAICHI = '10701';

// --- stage 1+2: regex shortlist ----------------------------------------------

console.log(`scanning ${STASH} ...`);
const files = readdirSync(STASH).filter((f) => f.endsWith('.xml'));
const candidates = [];
for (const f of files) {
  let xml;
  try {
    xml = readFileSync(join(STASH, f), 'utf-8');
  } catch {
    continue;
  }
  const mp = /<maxPlayers>(\d+)<\/maxPlayers>/.exec(xml);
  if (!mp || Number(mp[1]) !== 2) continue;
  const tileCount = (xml.match(/<terrain\b/g) || []).length;
  if (tileCount < 150 || tileCount > 500) continue;
  // bases per faction 0/1 — attribute order varies, so test both orderings.
  const baseTags = xml.match(/<terrain\b[^>]*type="Base"[^>]*>/g) || [];
  let f0 = 0;
  let f1 = 0;
  for (const tag of baseTags) {
    const sf = /startFaction="(\d+)"/.exec(tag);
    if (!sf) continue;
    if (sf[1] === '0') f0++;
    else if (sf[1] === '1') f1++;
  }
  if (f0 < 1 || f1 < 1) continue;
  const name = (/<name>([\s\S]*?)<\/name>/.exec(xml)?.[1] ?? 'Untitled').trim();
  // Donor names ship in the start-screen map picker: skip junk/profane names
  // and self-declared copies (the stash holds many byte-identical re-uploads).
  if (/\b(shit|fuck|piss|cunt|cock)\b/i.test(name) || /^copy of/i.test(name)) continue;
  const id = f.replace(/\.xml$/, '');
  // Content fingerprint (FNV-1a over the terrains block) to drop re-uploads.
  let fp = 0x811c9dc5;
  const terrBlock = /<terrains>[\s\S]*?<\/terrains>/.exec(xml)?.[0] ?? xml;
  for (let i = 0; i < terrBlock.length; i++) {
    fp = ((fp ^ terrBlock.charCodeAt(i)) * 0x01000193) >>> 0;
  }
  const w = Number(/<width>(\d+)<\/width>/.exec(xml)?.[1] ?? 0);
  const h = Number(/<height>(\d+)<\/height>/.exec(xml)?.[1] ?? 0);
  // odd-r pixel footprint: width spans √3·w, height 1.5·h. 1 = square.
  const wpx = Math.sqrt(3) * Math.max(w, 1);
  const hpx = 1.5 * Math.max(h, 1);
  const aspect = Math.max(wpx, hpx) / Math.min(wpx, hpx);
  candidates.push({ id, file: join(STASH, f), name, fp, tiles: tileCount, w, h, aspect, bases: baseTags.length, f0, f1 });
}

candidates.sort(
  (a, b) =>
    Math.abs(a.tiles - 300) - Math.abs(b.tiles - 300) ||
    a.aspect - b.aspect ||
    a.bases - b.bases ||
    Number(a.id) - Number(b.id),
);

console.log(`\nshortlist: ${candidates.length} candidates (maxPlayers=2, 150–500 tiles, base per faction)`);
console.log('top 20 by rank (|tiles-300|, squareness, base count):');
for (const c of candidates.slice(0, 20)) {
  console.log(
    `  #${c.id.padEnd(6)} ${c.name.slice(0, 32).padEnd(32)} tiles=${String(c.tiles).padEnd(4)} ${c.w}x${c.h} aspect=${c.aspect.toFixed(2)} bases=${c.bases} (f0=${c.f0}, f1=${c.f1})`,
  );
}

// --- stage 3: probe the real pipeline ----------------------------------------

const outfile = join(root, 'node_modules', '.cache', 'scan-donors', 'pipeline.mjs');
mkdirSync(dirname(outfile), { recursive: true });
await build({
  stdin: {
    contents: `
      export { parseWeewarMap, toDonorMap } from './src/io/weewar-xml.ts';
      export { generateBoard, generateCells, targetCellsFor } from './src/board/index.ts';
      export { meshTargetForDonor } from './src/board/donor.ts';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
});
const pipeline = await import(pathToFileURL(outfile).href);

// Probe order: Tai Chi first if shortlisted, then ranking order.
const probeOrder = [
  ...candidates.filter((c) => c.id === TAICHI),
  ...candidates.filter((c) => c.id !== TAICHI),
].slice(0, Math.max(PROBE_LIMIT, 1));
if (!candidates.some((c) => c.id === TAICHI)) {
  console.log(`\nnote: ${TAICHI} (Tai Chi) did NOT pass the shortlist filter.`);
}

const chosen = [];
const warn = console.warn;
console.warn = () => {}; // parser warnings (unmapped air/naval units) are expected noise here
console.log(`\nprobing pipeline (seed ${SEED}, connectivity guard, first try only):`);
const seenFp = new Set();
for (const c of probeOrder) {
  if (chosen.length >= 5) break;
  if (seenFp.has(c.fp)) {
    console.log(`  skip #${c.id} ${c.name} — duplicate terrain content`);
    continue;
  }
  try {
    const donor = pipeline.toDonorMap(pipeline.parseWeewarMap(readFileSync(c.file, 'utf-8')));
    const target = pipeline.targetCellsFor(donor);
    const board = pipeline.generateBoard(donor, SEED, target, { maxRetries: 0 });
    const meshCells = pipeline.generateCells(SEED, pipeline.meshTargetForDonor(donor, target)).size;
    const terr = {};
    for (const cell of board.cells.values()) terr[cell.terrain] = (terr[cell.terrain] ?? 0) + 1;
    const water = terr.water ?? 0;
    seenFp.add(c.fp);
    chosen.push({ ...c, target, meshCells, boardCells: board.cells.size, water, terr, anchors: board.placementAnchors });
    console.log(
      `  PASS #${c.id} ${c.name} — tiles=${c.tiles} target=${target} mesh=${meshCells} board=${board.cells.size} (deleted ${meshCells - board.cells.size}) water=${water} anchors=${board.placementAnchors}`,
    );
  } catch (e) {
    console.log(`  fail #${c.id} ${c.name} — ${String(e.message).split('\n')[0]}`);
  }
}
console.warn = warn;

if (chosen.length < 5) {
  console.error(`\nonly ${chosen.length}/5 donors passed within probe limit ${PROBE_LIMIT}; raise --probe.`);
  process.exit(1);
}

// --- stage 4: copy + report ----------------------------------------------------

if (COPY) {
  mkdirSync(join(root, 'data', 'maps'), { recursive: true });
  for (const c of chosen) copyFileSync(c.file, join(root, 'data', 'maps', `${c.id}.xml`));
}

console.log('\n=== CHOSEN DONORS (data/maps/) ===');
for (const c of chosen) {
  console.log(`#${c.id}  "${c.name}"  tiles=${c.tiles}  boardCells=${c.boardCells}  terrain=${JSON.stringify(c.terr)}`);
}
writeFileSync(
  join(root, 'node_modules', '.cache', 'scan-donors', 'report.json'),
  JSON.stringify(chosen, null, 2),
);
console.log(COPY ? '\ncopied 5 XMLs to data/maps/. report.json in node_modules/.cache/scan-donors/.' : '\n(--no-copy: nothing copied)');
