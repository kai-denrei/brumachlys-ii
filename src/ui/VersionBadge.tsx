// Cache-bust version badge (spec §10.3): three shape tiles + short token in
// the top bar. Reads the bust token from <meta name="cb"> (rewritten by
// scripts/bust.mjs on each deploy) and renders the same 64-cell artwork the
// favicon uses (public/cb-shapes/), so favicon and badge always agree.
// Encoding (cache-busting toolkit): byte → cell = byte mod 64.

const BASE = import.meta.env.BASE_URL;

function readToken(): string {
  const meta = document.querySelector('meta[name="cb"]');
  const t = meta?.getAttribute('content') ?? '';
  return /^[0-9a-f]{8}$/.test(t) ? t : '00000000';
}

export function VersionBadge() {
  const token = readToken();
  const cells = [0, 1, 2].map((i) =>
    String(parseInt(token.slice(i * 2, i * 2 + 2), 16) % 64).padStart(2, '0'),
  );
  return (
    <span className="version-badge" title={`build ${token}`}>
      {cells.map((cell, i) => (
        <img key={i} className="version-shape" src={`${BASE}cb-shapes/${cell}.svg`} alt="" />
      ))}
      <span className="version-token">·{token.slice(0, 4)}</span>
    </span>
  );
}
