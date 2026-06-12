// GrainFilter — one subtle SVG grain/noise layer over the whole board,
// opacity ≤ 0.05 (spec §10.1). The <defs> filter plus a covering rect; the
// Board places the rect above the cells, below units, pointer-events none.

export const GRAIN_FILTER_ID = 'board-grain';
export const GRAIN_OPACITY = 0.045;

export function GrainFilterDef() {
  return (
    <filter id={GRAIN_FILTER_ID} x="0%" y="0%" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves={2} stitchTiles="stitch" result="noise" />
      <feColorMatrix
        in="noise"
        type="matrix"
        values="0 0 0 0 0.25  0 0 0 0 0.23  0 0 0 0 0.18  0 0 0 1 0"
      />
      <feComposite operator="in" in2="SourceGraphic" />
    </filter>
  );
}

export function GrainOverlay({
  x,
  y,
  width,
  height,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return (
    <rect
      className="board-grain"
      x={x}
      y={y}
      width={width}
      height={height}
      filter={`url(#${GRAIN_FILTER_ID})`}
      opacity={GRAIN_OPACITY}
      pointerEvents="none"
    />
  );
}
