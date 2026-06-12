# Brumachlys II

> *brume* (fr. mist) + *achlys* (gr. Ἀχλύς, the death-mist of the Iliad)

A simultaneous-resolution tactical wargame on a procedurally generated organic board.
Both sides commit orders blind; a deterministic resolver plays them out in initiative
order. Fog of war makes second-guessing the opponent the core skill.

The board is not a grid: it's an irregular cell graph (Oskar Stålberg-style relaxed
quad-mesh dual), generated from classic Weewar maps used as shape/terrain donors.

**Spec:** [`docs/superpowers/specs/2026-06-12-brumachlys-ii-design.md`](docs/superpowers/specs/2026-06-12-brumachlys-ii-design.md)
**Lineage:** [`BRUMACHLYS.md`](BRUMACHLYS.md) (v1 PoC spec, 2026-05) · [oskar-procedure](https://github.com/kai-denrei/oskar-procedure) (mesh kernel)

## Run

```bash
npm install
npm run dev        # localhost:5173
npm test           # purity check + vitest
npm run build      # type-check + production build
node scripts/bust.mjs   # bump the build-identity token (CI does this per deploy)
```

## Build identity

The top-left badge (three shape tiles + short token) and the favicon are derived from
the cache-bust token in `<meta name="cb">` — one glance tells you which build you're on.
The token re-bumps on every deploy.

## Status

P0 — ship pipeline. See the spec §12 for the build phases.
