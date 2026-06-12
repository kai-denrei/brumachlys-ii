// Self-contained cache-bust runner (CI-portable replacement for the skill's
// bust.sh in this Vite project — Vite hashes bundles; this bumps the human-
// visible build identity: <meta name="cb">, the shape favicon, and any ?v= on
// public/ asset references in index.html).
// Usage: node scripts/bust.mjs [token]   (random 32-bit hex if omitted)
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const token = (process.argv[2] ?? randomBytes(4).toString('hex')).toLowerCase();
if (!/^[0-9a-f]{8}$/.test(token)) {
  console.error(`bust: token must be 8 hex chars, got "${token}"`);
  process.exit(1);
}
const cell = String(parseInt(token.slice(0, 2), 16) % 64).padStart(2, '0');

const file = 'index.html';
let html = readFileSync(file, 'utf8');
html = html
  .replace(/(<meta name="cb" content=")[0-9a-f]+(")/, `$1${token}$2`)
  .replace(/\/cb-shapes\/\d{2}\.svg\?v=[0-9a-f]+/, `/cb-shapes/${cell}.svg?v=${token}`)
  .replace(/(cb-badge\.js\?v=)[0-9a-f]+/, `$1${token}`);
writeFileSync(file, html);
console.log(`bust: token ${token} → favicon cell ${cell}`);
