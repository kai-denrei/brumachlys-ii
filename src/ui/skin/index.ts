// src/ui/skin — the skin-swap contract (spec §10.4). All board/unit drawing
// goes through these renderers; replacing glyphs with sprites or animated art
// later = a new skin module, zero game code touched.

export {
  DARK_COVER_OPACITY,
  MEMORY_DESATURATION,
  PALETTE,
  darken,
  desaturate,
  factionColor,
  mix,
  terrainFill,
} from './palette';
export { roundedPolygonPath, ringCentroid, ringRadius } from './rounded';
export type { Pt } from './rounded';
export {
  CellRenderer,
  CELL_STROKE_WIDTH,
  CAMP_DESATURATION,
  SPOTLIGHT_DIM_OPACITY,
  SPOTLIGHT_DESATURATION,
} from './CellRenderer';
export type { CellRendererProps } from './CellRenderer';
export { UnitRenderer } from './UnitRenderer';
export type { UnitRendererProps } from './UnitRenderer';
export { UnitSprite, SpriteRedFilter } from './UnitSprite';
export type { Motion } from './sprites/sprite-data';
export { UnitWatercolor } from './UnitWatercolor';
export type { UnitWatercolorProps } from './UnitWatercolor';
export { watercolorUrl, WATERCOLOR_KEYS } from './watercolors/watercolor-data';
export type { WatercolorKey } from './watercolors/watercolor-data';
export { UnitGlyph, UNIT_ICON_KEYS } from './icons';
export { GrainFilterDef, GrainOverlay, GRAIN_FILTER_ID, GRAIN_OPACITY } from './GrainFilter';
export {
  BuildPips,
  BuyGhosts,
  CaptureIntentMarkers,
  EffectRenderer,
  HoldFireIcon,
  ProposalGhost,
  ShieldIcon,
  StanceIcon,
  SwordIcon,
  VisionEdge,
  visionEdgeSegments,
} from './EffectRenderer';
export type {
  BuildPipMark,
  BuyGhostMark,
  CaptureIntentMark,
  EffectRendererProps,
  GhostOrder,
  ProposalGhostMark,
} from './EffectRenderer';
export { ReplayFx, ReplayTrails } from './ReplayFx';
export type { ImpactMark, ReplayFxData, ReplayFxProps, TrailMark } from './ReplayFx';
// R3 (DILATION): WAVE A board cooling vignette (the kept R3 chrome).
export { DilationVignette } from './DilationOverlay';
// Phase 2: the Swiss-railway BULLET-TIME dilation clock (top-right canvas
// overlay, replay-time-driven across the whole resolution — replaces the R3
// SVG clock).
export { DilationClock } from './DilationClock';
export type { DilationClockProps } from './DilationClock';
// v0.9 HUD: canvas split-flap round number + odometer credits (displays/).
export { RoundFlap, CreditsOdometer } from './displays';
// v1.5 VICTORY DASHBOARD: sparkline + bar-histogram viz primitives (charts/).
export { Sparkline, BarHistogram } from './charts';
export type { SparkSeries, HistBar } from './charts';
