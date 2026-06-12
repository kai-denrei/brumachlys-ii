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
export { CellRenderer, CELL_STROKE_WIDTH } from './CellRenderer';
export type { CellRendererProps } from './CellRenderer';
export { UnitRenderer } from './UnitRenderer';
export type { UnitRendererProps } from './UnitRenderer';
export { UnitGlyph, UNIT_ICON_KEYS } from './icons';
export { GrainFilterDef, GrainOverlay, GRAIN_FILTER_ID, GRAIN_OPACITY } from './GrainFilter';
export {
  EffectRenderer,
  HoldFireIcon,
  ShieldIcon,
  StanceIcon,
  SwordIcon,
  VisionEdge,
  visionEdgeSegments,
} from './EffectRenderer';
export type { EffectRendererProps, GhostOrder } from './EffectRenderer';
export { ReplayFx, ReplayTrails } from './ReplayFx';
export type { ReplayFxData, ReplayFxProps, TrailMark } from './ReplayFx';
