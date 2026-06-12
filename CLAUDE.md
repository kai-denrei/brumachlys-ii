# Brumachlys II — agent notes

Read the spec FULLY before writing code:
`docs/superpowers/specs/2026-06-12-brumachlys-ii-design.md`

Hard rules (spec §0):
- `src/board/`, `src/core/`, `src/ai/` are pure and deterministic. No `Math.random`,
  `Date.now`, argless `new Date()`, DOM, or imports from `ui/`/`state/`.
  `npm test` runs `scripts/check-purity.mjs` first and fails on violations.
- Port from the reference codebases, don't reinvent:
  - v1 game logic + tests: `/Users/minikai/Documents/Dev/STB_Brumachlys`
  - mesh kernel: `/Users/minikai/Dev/oskar-procedure`
- Decisions go to the deban log (`.deban/`, local-only) — not a DECISIONS.md.
- Mobile-first. The board is the screen. Modals/sheets for everything secondary.
- Don't start phase N+1 with phase N red (phases in spec §12).

Versioning: `node scripts/bust.mjs` bumps the build-identity token (badge + favicon).
CI (`.github/workflows/deploy.yml`) tests, busts, builds, deploys to GitHub Pages.
