// Determinism guard (spec §0, §11): src/board, src/core, src/ai must be pure.
// Greps for forbidden APIs and forbidden imports. Exits 1 on violation.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PURE_DIRS = ['src/board', 'src/core', 'src/ai'];
const FORBIDDEN = [
  { re: /Math\.random/g, why: 'Math.random — use src/core/rng.ts' },
  { re: /Date\.now/g, why: 'Date.now — pass timestamps in from the UI layer' },
  { re: /new Date\(\)/g, why: 'argless new Date()' },
  { re: /\bdocument\./g, why: 'DOM access' },
  { re: /\bwindow\./g, why: 'window access' },
  { re: /\blocalStorage\b/g, why: 'localStorage' },
  { re: /from\s+['"][^'"]*\/(ui|state)\//g, why: 'import from ui/ or state/' },
];

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|js)$/.test(e.name)) yield p;
  }
}

let violations = 0;
for (const dir of PURE_DIRS) {
  if (!existsSync(dir)) continue;
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8');
    for (const { re, why } of FORBIDDEN) {
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (re.test(line) && !line.includes('purity-ok')) {
          console.error(`PURITY ${file}:${i + 1} — ${why}`);
          violations++;
        }
        re.lastIndex = 0;
      });
    }
  }
}

if (violations > 0) {
  console.error(`\n${violations} purity violation(s).`);
  process.exit(1);
}
console.log('purity: clean');
