// src/ui/skin/charts — VICTORY DASHBOARD viz primitives (v1.5). Pure,
// presentational inline-SVG charts that reuse the skin's paper/pastel + faction
// red/blue + JetBrains-Mono vocabulary and the .summary-cell card styling. They
// take only their data + colors as props (no store reads), so they are trivially
// unit-testable and skin-swappable. Mobile-first: each chart is a small inline
// SVG that scales to its card width via a viewBox, and carries an aria-label /
// <title> describing the series it plots.
//
// Sparkline   — one or more polylines normalized to the COMBINED data range
//               (so a dual series shares one y-scale and the two lines are
//               directly comparable). Degenerate sizes render gracefully: a
//               single point becomes a centered dot; two points draw a line
//               with endpoint dots; an empty series draws nothing.
// BarHistogram — vertical <rect> bars scaled to the max count, each topped by a
//               count label and footed by a small unit glyph (currentColor-
//               tinted via the bar's faction color). Faction-colored.

import { UnitGlyph } from '../icons';

// --- Sparkline ---------------------------------------------------------------

export type SparkSeries = {
  /** y-values in round order (x is the index). */
  points: readonly number[];
  /** stroke color (faction color or any hex). */
  color: string;
};

const SPARK_W = 120;
const SPARK_H = 34;
const SPARK_PAD = 4;

/** Normalize a value to the SVG y-axis (inverted: bigger value = higher up). */
function normY(v: number, min: number, max: number): number {
  const span = max - min || 1; // flat series → mid-line, never divide by zero
  const t = (v - min) / span;
  return SPARK_H - SPARK_PAD - t * (SPARK_H - 2 * SPARK_PAD);
}

/** x for the k-th of n points, spread across the inner width. */
function spreadX(k: number, n: number): number {
  if (n <= 1) return SPARK_W / 2;
  return SPARK_PAD + (k / (n - 1)) * (SPARK_W - 2 * SPARK_PAD);
}

/** A small inline sparkline. One polyline per series, all on a SHARED y-scale
 *  (the min/max across every series' points) so a dual series is comparable.
 *  1 point → a centered dot; 2 points → a line + endpoint dots; 0 points →
 *  nothing. The <title> + aria-label describe the plotted series. */
export function Sparkline({
  series,
  ariaLabel,
}: {
  series: readonly SparkSeries[];
  ariaLabel: string;
}): React.ReactElement {
  const all = series.flatMap((s) => s.points);
  const min = all.length ? Math.min(...all) : 0;
  const max = all.length ? Math.max(...all) : 0;

  return (
    <svg
      className="spark"
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <title>{ariaLabel}</title>
      {series.map((s, si) => {
        const n = s.points.length;
        if (n === 0) return null;
        if (n === 1) {
          // Single round: a centered dot (a 1-point polyline is invisible).
          return (
            <circle
              key={si}
              className="spark-dot"
              cx={spreadX(0, 1)}
              cy={normY(s.points[0]!, min, max)}
              r={2.4}
              fill={s.color}
            />
          );
        }
        const coords = s.points.map((v, k) => `${spreadX(k, n)},${normY(v, min, max)}`);
        return (
          <g key={si}>
            <polyline
              className="spark-line"
              points={coords.join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Endpoint dots keep a tiny (2-point) series visible. */}
            <circle className="spark-dot" cx={spreadX(0, n)} cy={normY(s.points[0]!, min, max)} r={1.8} fill={s.color} />
            <circle
              className="spark-dot"
              cx={spreadX(n - 1, n)}
              cy={normY(s.points[n - 1]!, min, max)}
              r={1.8}
              fill={s.color}
            />
          </g>
        );
      })}
    </svg>
  );
}

// --- BarHistogram ------------------------------------------------------------

export type HistBar = {
  /** unit-type key for the glyph. */
  type: string;
  /** faction (kept for callers; the color drives the visuals). */
  faction: number;
  count: number;
  /** bar + glyph color (faction color). */
  color: string;
  /** accessible per-bar label (e.g. unit name). */
  label: string;
};

const BAR_W = 22;
const BAR_GAP = 8;
const BAR_AREA_H = 46; // bar drawing area (above the glyph foot)
const BAR_LABEL_H = 12; // count label band on top
const GLYPH_H = 18; // unit-glyph foot band
const BAR_TOTAL_H = BAR_LABEL_H + BAR_AREA_H + GLYPH_H;

/** Vertical bars scaled to the max count, faction-colored, each topped by its
 *  count and footed by its unit glyph. Returns null when there are no bars
 *  (the dashboard hides the whole section). */
export function BarHistogram({
  bars,
  ariaLabel,
}: {
  bars: readonly HistBar[];
  ariaLabel: string;
}): React.ReactElement | null {
  if (bars.length === 0) return null;
  const max = Math.max(1, ...bars.map((b) => b.count));
  const width = bars.length * BAR_W + (bars.length - 1) * BAR_GAP;

  return (
    <svg
      className="hist"
      viewBox={`0 0 ${Math.max(width, 1)} ${BAR_TOTAL_H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={ariaLabel}
    >
      <title>{ariaLabel}</title>
      {bars.map((b, k) => {
        const x = k * (BAR_W + BAR_GAP);
        const h = Math.max(2, (b.count / max) * BAR_AREA_H);
        const y = BAR_LABEL_H + (BAR_AREA_H - h);
        return (
          <g key={`${b.faction}-${b.type}-${k}`} aria-label={`${b.label}: ${b.count}`}>
            {/* count label on top */}
            <text
              className="hist-count"
              x={x + BAR_W / 2}
              y={BAR_LABEL_H - 3}
              textAnchor="middle"
              fill={b.color}
            >
              {b.count}
            </text>
            {/* the bar */}
            <rect
              className="bar-rect"
              x={x}
              y={y}
              width={BAR_W}
              height={h}
              rx={3}
              fill={b.color}
            />
            {/* unit glyph foot — UnitGlyph draws in a 100×100 box, so scale it
                into the GLYPH_H footprint and tint it the bar's color. */}
            <g transform={`translate(${x + (BAR_W - GLYPH_H) / 2} ${BAR_LABEL_H + BAR_AREA_H + 1}) scale(${GLYPH_H / 100})`}>
              <UnitGlyph type={b.type} color={b.color} />
            </g>
          </g>
        );
      })}
    </svg>
  );
}
