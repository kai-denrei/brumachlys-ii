// ReplayFx — Layer-3 "what happened" drawing (spec §9.4 / §10.4): attack
// flash arcs, floating damage numbers, fire-from-the-mist impact markers,
// brawl clash bursts, the v0.6 animation language (Ask 7). All IN-SVG so
// effects track pan/zoom (P6 decision). Animations are CSS (styles.css
// `fx-*` classes); the Board remounts this group per frame (key=frame index)
// so they restart cleanly.
//
// v0.6 FX VOCABULARY (Ask 7) — minimal-vector verbs, ALL ≤500 ms, effects
// confirm what the data already shows (never compete with it), and they
// overlap the existing frame timing — playback never slows for them:
//   impact  = flash / spark / recoil   (HitFlash here + token recoil in
//             UnitRenderer, driven by ReplayFxData.impacts)
//   death   = crumble / shrink / smoke-puff  (DeathFx: hit-spark → brief
//             freeze/wobble → 3–5 vector fragments + smoke; enemy deaths add
//             a tiny radial celebration pop in the PLAYER color, own deaths
//             read heavier/muted with a dimming outline — loss, not a win)
//   capture = fill / flip / pulse      (CaptureFx: 150 ms tile pulse → paint-
//             fill sweep across the polygon → flag flip-in + shimmer; a
//             CONSUMED capturing unit dissolves INTO the flag — the cost of
//             the new capture-consumes rule made legible)
//   victory/loss banner verbs live on the banner scrim (styles.css).
// prefers-reduced-motion cuts every verb to its end state.
//
// Fog honesty (§7): this module draws exactly what it is given. The replay
// builder (state/replay.ts) already withheld mist sources — a mist floater
// arrives with `mist: true`, impacts arrive with attackerCell null, and there
// is simply no arc (or recoil) to draw.

import type { Board, CellId } from '../../board/types';
import type { FactionId, UnitInstance } from '../../core/types';
import type { Projectile } from '../../state/replay-timing';
import type { FloaterCategory } from '../../state/replay';
import { darken, desaturate, factionColor } from './palette';
import { UnitRenderer } from './UnitRenderer';
import { UnitGlyph } from './icons';
import { roundedPolygonPath, type Pt } from './rounded';

/** v0.6 Ask 7 — one shown strike whose defender SURVIVES the frame (deaths
 * use the destruction verb instead). attacker fields are null for mist
 * strikes: the flash lands, no recoil reveals the source. */
export type ImpactMark = {
  attackerId: string | null;
  attackerCell: CellId | null;
  defenderId: string;
  defenderCell: CellId;
};

export type ReplayFxData = {
  arcs: { from: CellId; to: CellId; faction: FactionId }[];
  /** R4 (PROJECTILE + ATTACK MOTION): the attack-motion primitives for this
   *  frame's shown, source-revealed strikes — crawling tracers / arcing shells
   *  (WAVE_A) and melee stabs (WAVE_B). When present and non-empty these REPLACE
   *  the instant `arcs` flash (each projectile is a 1:1 upgrade of one arc); the
   *  builder withholds a mist strike's projectile, so the source never leaks.
   *  Optional: absent ⇒ the legacy instant FlashArc renders for `arcs`. */
  projectiles?: Projectile[];
  /** `linger`: a "last volley" pill carried into later frames (P9) — still a
   *  breakdown tap target, but rendered settled (no pop animation, no
   *  re-expanding mist impact rings). */
  floaters: {
    id: string;
    cell: CellId;
    text: string;
    mist: boolean;
    /** R5: damage-number category — taken = INK, counter = GREY, kill = GOLD.
     *  Optional so older/synthetic callers default to 'taken' (ink). A mist
     *  floater keeps its fog-grey treatment regardless (fog honesty). */
    category?: FloaterCategory;
    slot: number;
    linger?: boolean;
  }[];
  bursts: CellId[];
  /** R6: units DISSOLVING this frame (the deferred fall). The builder now only
   *  fills this on the SETTLE beat — every wave casualty falls together there. */
  kills: UnitInstance[];
  /** R6 (DEFERRED DISSOLVE): units in the DOOMED hold this frame — killed during
   *  the combat waves but not yet dissolved. Each renders as a greyed token with
   *  a small smoke wisp / flicker / hairline-crack and a DEATH GLYPH replacing
   *  the count badge (never a "0"). This is the deferred visual FALL only —
   *  posthumous is OFF, a doomed unit never acts. The dissolve plays later, in
   *  SETTLE (`kills`). Optional: most frames send none; reduced-motion in CSS
   *  drops the flicker, leaving a static grey token + glyph. */
  doomed?: UnitInstance[];
  /** E3 conquest: units materializing this frame (Phase E spawns) — token
   *  fades/scales in (.fx-spawn-pop). Optional: skirmish never sends any. */
  spawns?: UnitInstance[];
  /** E3 conquest: bases flipping this frame — the v0.6 claim verb (pulse →
   *  paint-fill sweep → flag flip; the cell tint swap rides frame.bases).
   *  `consumed`: the capturing unit's snapshot when the capture consumed it
   *  (v0.6 rule) — its token dissolves into the flag. */
  captures?: { cell: CellId; to: FactionId; consumed?: UnitInstance }[];
  /** v0.6 Ask 7: surviving-defender strikes this frame (flash + recoil). */
  impacts?: ImpactMark[];
  /** v0.8 veterancy: units that ranked up this frame — upward-chevron burst
   *  at each cell in the faction colour (~450 ms, celebratory, not dominant). */
  promotions?: Array<{ cell: CellId; faction: FactionId; rank: number }>;
  /** Forced-crossing combat (addendum 2026-06-21 §5): "path interrupted!"
   *  signs at crossing cells — a short transient label announcing that two
   *  enemy movers' paths crossed and were halted here (the brawl that follows
   *  uses the existing brawl FX). Fog-gated upstream (state/replay.ts) — this
   *  draws exactly what it is given. Optional: most frames send none. */
  signs?: Array<{ cell: CellId; text: string }>;
};

export type ReplayFxProps = {
  board: Board;
  toScreen: (p: readonly [number, number]) => Pt;
  tokenSize: number;
  fx: ReplayFxData;
  /** The viewing faction — "celebrate" pops use this color and fire only for
   *  the OTHER side's deaths. */
  player?: FactionId;
  /** Tap a floating damage number → breakdown modal for its slot (§9.4). */
  onFloaterTap?: (slot: number) => void;
};

const center = (board: Board, id: CellId, toScreen: ReplayFxProps['toScreen']): Pt | null => {
  const cell = board.cells.get(id);
  return cell ? toScreen(cell.center) : null;
};

// --- v1.3 Tweak B: movement origin trails ----------------------------------
// Thin dotted line along the resolved path from the ORIGIN cell + a subtle
// ghost marker (hollow squircle) where the unit used to be. Lives in its own
// persistent layer (NOT the per-frame-remounted fx group) so the ~1.6 s CSS
// opacity fade survives frame advances. Fog honesty: paths arrive already
// filtered by the replay builder (TrailFx) — this draws them verbatim.

export type TrailMark = {
  id: string;
  faction: FactionId;
  /** Witnessed path cells, origin first (state/replay.ts TrailFx). */
  path: readonly CellId[];
  /** The move finished — fade out (CSS transition on .fx-trail-fading). */
  fading: boolean;
};

export function ReplayTrails({
  board,
  toScreen,
  tokenSize,
  trails,
}: {
  board: Board;
  toScreen: ReplayFxProps['toScreen'];
  tokenSize: number;
  trails: readonly TrailMark[];
}) {
  return (
    <g className="board-trails" pointerEvents="none">
      {trails.map((t) => {
        const pts = t.path
          .map((c) => center(board, c, toScreen))
          .filter((p): p is Pt => p !== null);
        if (pts.length < 2) return null;
        const [ox, oy] = pts[0]!;
        const g = tokenSize * 0.62; // ghost marker edge (a shrunk silhouette)
        const color = factionColor(t.faction);
        return (
          <g key={t.id} className={`fx-trail${t.fading ? ' fx-trail-fading' : ''}`}>
            <polyline
              className="fx-trail-line"
              points={pts.map((p) => `${p[0]},${p[1]}`).join(' ')}
              fill="none"
              stroke={color}
              strokeWidth={tokenSize * 0.07}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={`${tokenSize * 0.035} ${tokenSize * 0.2}`}
            />
            <rect
              className="fx-trail-ghost"
              x={ox - g / 2}
              y={oy - g / 2}
              width={g}
              height={g}
              rx={g * 0.3}
              fill="none"
              stroke={color}
              strokeWidth={tokenSize * 0.045}
              opacity={0.55}
            />
          </g>
        );
      })}
    </g>
  );
}

function FlashArc({
  board,
  toScreen,
  tokenSize,
  from,
  to,
  faction,
}: {
  board: Board;
  toScreen: ReplayFxProps['toScreen'];
  tokenSize: number;
  from: CellId;
  to: CellId;
  faction: FactionId;
}) {
  const a = center(board, from, toScreen);
  const b = center(board, to, toScreen);
  if (!a || !b) return null;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const bulge = Math.min(len * 0.22, tokenSize * 1.1);
  const cx = mx - (dy / len) * bulge;
  const cy = my + (dx / len) * bulge;
  return (
    <path
      className="fx-arc"
      d={`M${a[0]} ${a[1]} Q${cx} ${cy} ${b[0]} ${b[1]}`}
      fill="none"
      stroke={factionColor(faction)}
      strokeWidth={tokenSize * 0.1}
      strokeLinecap="round"
      pointerEvents="none"
    />
  );
}

// --- R4 (PROJECTILE + ATTACK MOTION primitives) ------------------------------
// Crawling ranged TRACERS, arcing artillery SHELLS, and melee STABS. Each is a
// CSS-animated upgrade of the instant FlashArc, parameterised by progress over
// the frame window (the impact fractions — 0.80 tracer / 0.88 shell / 0.5 stab —
// are baked into the styles.css keyframe percentages, matching the spec config).
// All WAVE_A projectiles of a beat animate on the SAME envelope (the dilation
// clock), never sequenced per-unit. A WAVE_B counter rides `--proj-delay`
// (≈75 ms) so an exchange reads as a crossfire of two motions. Reduced-motion
// degrades each to a simple instant mark (the line + the impact, no crawl/arc) —
// handled in CSS so the markup is identical (honesty: outcomes never change).

/** R4: a ranged tracer — a faint full-line guide + a crawling round with a
 *  gradient speed-streak tail; a brief charge glint near the start, then crawl
 *  to a sharp impact spark at ~0.80 of the frame window. */
function Tracer({
  a,
  b,
  tokenSize,
  faction,
  delay,
}: {
  a: Pt;
  b: Pt;
  tokenSize: number;
  faction: FactionId;
  delay: number;
}) {
  const color = factionColor(faction);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  // unit vector for the streak tail (a short segment trailing the round)
  const ux = dx / len;
  const uy = dy / len;
  const tail = Math.min(len * 0.4, tokenSize * 0.9);
  const style = { '--proj-delay': `${delay}ms` } as React.CSSProperties;
  return (
    <g className="fx-tracer" pointerEvents="none" style={style}>
      {/* faint full-line guide along the whole shot */}
      <line
        className="fx-tracer-guide"
        x1={a[0]}
        y1={a[1]}
        x2={b[0]}
        y2={b[1]}
        stroke={color}
        strokeWidth={tokenSize * 0.04}
        strokeLinecap="round"
      />
      {/* charge glint near the start */}
      <circle className="fx-tracer-charge" cx={a[0]} cy={a[1]} r={tokenSize * 0.16} fill="#fff" />
      {/* the crawling round + its speed-streak tail (translated start→impact) */}
      <g className="fx-tracer-round" style={{ '--tx': `${dx}px`, '--ty': `${dy}px` } as React.CSSProperties}>
        <line
          className="fx-tracer-streak"
          x1={a[0] - ux * tail}
          y1={a[1] - uy * tail}
          x2={a[0]}
          y2={a[1]}
          stroke={color}
          strokeWidth={tokenSize * 0.1}
          strokeLinecap="round"
        />
        <circle cx={a[0]} cy={a[1]} r={tokenSize * 0.11} fill="#fff" stroke={color} strokeWidth={tokenSize * 0.04} />
      </g>
      {/* sharp impact spark at the destination, fired at ~0.80 */}
      <ImpactSpark at={b} tokenSize={tokenSize} className="fx-tracer-spark" />
    </g>
  );
}

/** R4: an artillery shell — a high parabolic ballistic arc (quadratic, control
 *  point lobbed above the midpoint) with a DASHED trail; launches near the start
 *  and LANDS LATE (~0.88). On impact: dust + an expanding ring burst. */
function Shell({
  a,
  b,
  tokenSize,
  faction,
  delay,
}: {
  a: Pt;
  b: Pt;
  tokenSize: number;
  faction: FactionId;
  delay: number;
}) {
  const color = factionColor(faction);
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  // High lob: control point well ABOVE the midpoint (perpendicular, biased up).
  const lob = Math.min(len * 0.55, tokenSize * 2.6) + tokenSize * 1.4;
  const cx = mx - (dy / len) * lob * 0.25;
  const cy = my - lob; // straight up in screen space (y-down) → smaller y
  const d = `M${a[0]} ${a[1]} Q${cx} ${cy} ${b[0]} ${b[1]}`;
  const style = { '--proj-delay': `${delay}ms` } as React.CSSProperties;
  return (
    <g className="fx-shell" pointerEvents="none" style={style}>
      {/* dashed ballistic trail — drawn-on then faded */}
      <path
        className="fx-shell-trail"
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={tokenSize * 0.07}
        strokeLinecap="round"
        strokeDasharray={`${tokenSize * 0.16} ${tokenSize * 0.22}`}
      />
      {/* the shell itself: rides the same parabola via offset-path, landing
          LATE (~0.88). The path string is passed as a CSS var so the keyframes
          can sweep offset-distance 0→100% along this exact arc. */}
      <g
        className="fx-shell-round"
        style={{ '--shell-path': `path('${d}')` } as React.CSSProperties}
      >
        <circle r={tokenSize * 0.13} fill={darken(color, 0.15)} stroke="#fff" strokeWidth={tokenSize * 0.035} />
      </g>
      {/* dust + expanding ring burst at the landing */}
      <g className="fx-shell-impact" transform={`translate(${b[0]} ${b[1]})`}>
        <circle className="fx-shell-ring" r={tokenSize * 0.6} fill="none" stroke="#fff" strokeWidth={tokenSize * 0.09} />
        <circle className="fx-shell-ring fx-shell-ring-2" r={tokenSize * 0.6} fill="none" stroke={color} strokeWidth={tokenSize * 0.05} />
        {[0, 1, 2, 3, 4].map((k) => {
          const t = (k / 5) * Math.PI * 2 + Math.PI / 5;
          return (
            <circle
              key={k}
              className="fx-shell-dust"
              cx={Math.cos(t) * tokenSize * 0.42}
              cy={Math.sin(t) * tokenSize * 0.42}
              r={tokenSize * 0.16}
              fill="#8d8675"
              style={{ animationDelay: `calc(var(--proj-delay) + ${0.02 * k}s)` } as React.CSSProperties}
            />
          );
        })}
      </g>
    </g>
  );
}

/** R4: a melee stab — a short dash from the attacker toward the target (~0.5
 *  reach) + a flash; fast and punchy. Used for adjacent strikes AND brawls
 *  (same-cell: the dash nudges toward the shared tile). */
function Stab({
  a,
  b,
  tokenSize,
  faction,
  delay,
}: {
  a: Pt;
  b: Pt;
  tokenSize: number;
  faction: FactionId;
  delay: number;
}) {
  const color = factionColor(faction);
  let dx = b[0] - a[0];
  let dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) {
    // brawl (same cell): nudge a fixed direction so both halves still read.
    dx = tokenSize;
    dy = 0;
  }
  const reach = 0.5; // ~half the distance toward the target
  const style = {
    '--proj-delay': `${delay}ms`,
    '--tx': `${dx * reach}px`,
    '--ty': `${dy * reach}px`,
  } as React.CSSProperties;
  return (
    <g className="fx-stab" pointerEvents="none" style={style}>
      <g className="fx-stab-dash">
        <line
          x1={a[0]}
          y1={a[1]}
          x2={a[0] + (dx / (len || 1)) * tokenSize * 0.42}
          y2={a[1] + (dy / (len || 1)) * tokenSize * 0.42}
          stroke={color}
          strokeWidth={tokenSize * 0.14}
          strokeLinecap="round"
        />
      </g>
      <ImpactSpark at={b} tokenSize={tokenSize} className="fx-stab-flash" />
    </g>
  );
}

/** R4: a sharp, brief impact spark (4 radial spokes + a core) — the punctuation
 *  on a tracer / stab landing. The animation timing lives in CSS. */
function ImpactSpark({ at, tokenSize, className }: { at: Pt; tokenSize: number; className: string }) {
  const r0 = tokenSize * 0.18;
  const r1 = tokenSize * 0.5;
  return (
    <g className={className} transform={`translate(${at[0]} ${at[1]})`}>
      {[0, 1, 2, 3].map((k) => {
        const t = (k / 4) * Math.PI * 2 + Math.PI / 4;
        return (
          <line
            key={k}
            x1={Math.cos(t) * r0}
            y1={Math.sin(t) * r0}
            x2={Math.cos(t) * r1}
            y2={Math.sin(t) * r1}
            stroke="#fff"
            strokeWidth={tokenSize * 0.07}
            strokeLinecap="round"
          />
        );
      })}
      <circle r={r0 * 0.8} fill="#fff" />
    </g>
  );
}

/** R4: render a single projectile primitive by kind. Cells resolved upstream. */
function ProjectileFx({
  board,
  toScreen,
  tokenSize,
  proj,
}: {
  board: Board;
  toScreen: ReplayFxProps['toScreen'];
  tokenSize: number;
  proj: Projectile;
}) {
  const a = center(board, proj.from, toScreen);
  const b = center(board, proj.to, toScreen);
  if (!a || !b) return null;
  const common = { a, b, tokenSize, faction: proj.faction, delay: proj.delay };
  if (proj.kind === 'shell') return <Shell {...common} />;
  if (proj.kind === 'stab') return <Stab {...common} />;
  return <Tracer {...common} />;
}

// NOTE (P9 fix): a CSS `transform` animation REPLACES an element's SVG
// `transform` presentation attribute (the attribute is just a low-priority
// presentational hint) — so animated transforms must live on an INNER group,
// never on the same element that carries the positioning translate. P8
// shipped with bursts and floater pills silently rendering at the layer
// origin because of this; caught by the P9 Playwright pass.

function ClashBurst({ at, tokenSize }: { at: Pt; tokenSize: number }) {
  const r0 = tokenSize * 0.34;
  const r1 = tokenSize * 0.78;
  const spikes = [...Array(8).keys()].map((k) => {
    const t = (k / 8) * Math.PI * 2 + Math.PI / 8;
    return [Math.cos(t), Math.sin(t)] as const;
  });
  return (
    <g transform={`translate(${at[0]} ${at[1]})`} pointerEvents="none">
      <g className="fx-burst">
        {spikes.map(([ux, uy], k) => (
          <line
            key={k}
            x1={ux * r0}
            y1={uy * r0}
            x2={ux * r1}
            y2={uy * r1}
            stroke="#fff"
            strokeWidth={tokenSize * 0.09}
            strokeLinecap="round"
          />
        ))}
        <circle r={r0 * 0.8} fill="#fff" opacity={0.85} />
      </g>
    </g>
  );
}

/** Expanding double ring — damage arriving from an unseen source ("fire
 *  from the mist", spec §7): the impact is shown, the shooter is not. */
function MistImpact({ at, tokenSize }: { at: Pt; tokenSize: number }) {
  return (
    <g className="fx-impact" transform={`translate(${at[0]} ${at[1]})`} pointerEvents="none">
      <circle className="fx-impact-ring" r={tokenSize * 0.55} fill="none" stroke="#fff" strokeWidth={tokenSize * 0.08} />
      <circle className="fx-impact-ring fx-impact-ring-2" r={tokenSize * 0.55} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={tokenSize * 0.05} />
    </g>
  );
}

// --- R6 (DEFERRED DISSOLVE): the DOOMED hold ---------------------------------
// A unit killed during the combat waves does NOT dissolve at its kill frame: it
// holds here, greyed toward grey with a small smoke wisp + a hairline-crack /
// flicker, and a DEATH GLYPH (✕) REPLACING the count badge — never a "0", which
// is the exact thing that reads as "a corpse still standing at 0 HP." The token
// stays in place through the remaining wave frames; the actual dissolve (DeathFx)
// plays once, later, on the SETTLE beat. Posthumous is OFF in this model — this
// is purely the deferred visual FALL, not a deferred action.
//
// The glyph + crack geometry is deterministic (fixed coordinates, no randomness).
// prefers-reduced-motion (CSS) drops the flicker/wisp drift, leaving a static
// grey token + glyph — the read survives, outcomes never change.

const DOOMED_DESATURATION = 0.85; // toward grey, but a faint tint remains

function DoomedFx({
  unit,
  at,
  tokenSize,
}: {
  unit: UnitInstance;
  at: Pt;
  tokenSize: number;
}) {
  const grey = desaturate(factionColor(unit.faction), DOOMED_DESATURATION);
  const h = tokenSize / 2;
  const rx = tokenSize * 0.3;
  const strokeW = tokenSize * 0.06;
  return (
    <g
      className="fx-doomed"
      transform={`translate(${at[0]} ${at[1]})`}
      pointerEvents="none"
      data-doomed-id={unit.id}
    >
      {/* the held token, desaturated toward grey. Minimal + glyph-only: NO count
          pip (a "0" must never show); the death glyph below replaces it. */}
      <g className="fx-doomed-token">
        <rect
          className="unit-body unit-token"
          x={-h}
          y={-h}
          width={tokenSize}
          height={tokenSize}
          rx={rx}
          fill={grey}
          stroke="#fff"
          strokeWidth={strokeW}
          opacity={0.7}
        />
        <g transform={`translate(${-h} ${-h}) scale(${tokenSize / 100})`}>
          <UnitGlyph type={unit.type} />
        </g>
      </g>
      {/* hairline-crack across the token face — a deterministic fracture line. */}
      <polyline
        className="fx-doomed-crack"
        points={`${-h * 0.5},${-h * 0.55} ${-h * 0.05},${-h * 0.05} ${h * 0.3},${h * 0.15} ${h * 0.55},${h * 0.6}`}
        fill="none"
        stroke="#2a2620"
        strokeWidth={tokenSize * 0.05}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.6}
      />
      {/* a small smoke wisp rising off the doomed token. */}
      <g className="fx-doomed-wisp">
        {[0, 1, 2].map((k) => (
          <circle
            key={k}
            cx={(k - 1) * tokenSize * 0.16}
            cy={-h * 0.4 - k * tokenSize * 0.12}
            r={tokenSize * (0.12 - k * 0.018)}
            fill="#8d8675"
            opacity={0.5 - k * 0.12}
          />
        ))}
      </g>
      {/* DEATH GLYPH replacing the count badge (✕), in the count-pip corner. */}
      <g className="fx-doomed-badge" transform={`translate(${h * 0.78} ${h * 0.78})`}>
        <circle r={tokenSize * 0.21} fill="#fff" stroke={darken(grey, 0.18)} strokeWidth={tokenSize * 0.03} />
        <text
          className="fx-doomed-glyph"
          y={tokenSize * 0.012}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={tokenSize * 0.3}
          fontWeight={700}
          fill="#9c2f1d"
        >
          ✕
        </text>
      </g>
    </g>
  );
}

// --- v0.6 Ask 7: the destruction verb ---------------------------------------
// hit-spark → brief freeze/wobble → break into vector fragments + smoke puff,
// ~400 ms total. Enemy deaths end on a tiny radial celebration burst in the
// player's color; own deaths share the skeleton but pause longer, fade muted,
// and dim through a hollow outline — they must read as loss. All geometry is
// deterministic (fixed angles — no randomness in render).

function DeathFx({
  unit,
  at,
  tokenSize,
  own,
  cheerColor,
}: {
  unit: UnitInstance;
  at: Pt;
  tokenSize: number;
  own: boolean;
  cheerColor: string;
}) {
  const color = factionColor(unit.faction);
  const h = tokenSize / 2;
  // 4 shard triangles fanning out from the center (octagon vertices, fixed).
  const verts = [...Array(8).keys()].map((k) => {
    const t = (k / 8) * Math.PI * 2 + Math.PI / 8;
    return [Math.cos(t) * h * 0.92, Math.sin(t) * h * 0.92] as const;
  });
  const travel = tokenSize * (own ? 0.55 : 0.95);
  const frags = [0, 2, 4, 6].map((k, i) => {
    const a = verts[k]!;
    const b = verts[(k + 1) % 8]!;
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const len = Math.hypot(mx, my) || 1;
    return {
      d: `M0 0 L${a[0]} ${a[1]} L${b[0]} ${b[1]} Z`,
      dx: (mx / len) * travel,
      dy: (my / len) * travel,
      rot: i % 2 === 0 ? 38 : -30,
    };
  });
  const sparkR0 = tokenSize * 0.3;
  const sparkR1 = tokenSize * 0.62;
  const smoke: readonly (readonly [number, number, number])[] = [
    [-0.18, -0.12, 0.26],
    [0.17, -0.2, 0.2],
    [0, 0.07, 0.3],
  ];
  return (
    <g
      className={`fx-death ${own ? 'fx-death-own' : 'fx-death-enemy'}`}
      transform={`translate(${at[0]} ${at[1]})`}
      pointerEvents="none"
    >
      <g className="fx-death-spark">
        {[0, 1, 2, 3].map((k) => {
          const t = (k / 4) * Math.PI * 2 + Math.PI / 4;
          return (
            <line
              key={k}
              x1={Math.cos(t) * sparkR0}
              y1={Math.sin(t) * sparkR0}
              x2={Math.cos(t) * sparkR1}
              y2={Math.sin(t) * sparkR1}
              stroke="#fff"
              strokeWidth={tokenSize * 0.08}
              strokeLinecap="round"
            />
          );
        })}
      </g>
      {/* the token itself: freeze/wobble, then it is gone (frags take over) */}
      <g className="fx-death-token">
        <UnitRenderer unit={unit} x={0} y={0} size={tokenSize} />
      </g>
      {own && (
        <rect
          className="fx-death-outline"
          x={-h}
          y={-h}
          width={tokenSize}
          height={tokenSize}
          rx={tokenSize * 0.3}
          fill="none"
          stroke={darken(color, 0.35)}
          strokeWidth={tokenSize * 0.06}
        />
      )}
      {frags.map((f, k) => (
        <g
          key={`fr${k}`}
          className="fx-death-frag"
          style={
            {
              '--fdx': `${f.dx}px`,
              '--fdy': `${f.dy}px`,
              '--frot': `${f.rot}deg`,
            } as React.CSSProperties
          }
        >
          <path d={f.d} fill={color} stroke="#fff" strokeWidth={tokenSize * 0.025} />
        </g>
      ))}
      {smoke.map(([ox, oy, r], k) => (
        <circle
          key={`sm${k}`}
          className="fx-death-smoke"
          cx={ox * tokenSize}
          cy={oy * tokenSize}
          r={r * tokenSize}
          fill="#8d8675"
          style={{ animationDelay: `${0.14 + k * 0.04}s` }}
        />
      ))}
      {!own && (
        <g className="fx-death-cheer">
          {[0, 1, 2, 3, 4, 5].map((k) => {
            const t = (k / 6) * Math.PI * 2 - Math.PI / 2;
            return (
              <line
                key={k}
                x1={Math.cos(t) * tokenSize * 0.5}
                y1={Math.sin(t) * tokenSize * 0.5}
                x2={Math.cos(t) * tokenSize * 0.82}
                y2={Math.sin(t) * tokenSize * 0.82}
                stroke={cheerColor}
                strokeWidth={tokenSize * 0.07}
                strokeLinecap="round"
              />
            );
          })}
        </g>
      )}
    </g>
  );
}

// --- v0.6 Ask 7: the claim verb (v0.8 strengthened) --------------------------
// 0–150 ms: double ring pulse around the cell border (inner solid, outer gap).
// 150–500 ms: paint-fill sweep expands from the center in the faction color
//   (stronger than before — the sweep is now a deliberate stain, not a ghost).
// 220–480 ms: keep/flag raises — the same motif as the static base-pip, with
//   a brief wave (rotation oscillation) as it plants itself.
// 480–700 ms: shimmer flash on the flag face.
// Throughout (if consumed): the unit token rises from its position, shrinking
//   and trailing 4 dissolve-sparks that merge into the flag tip — the cost of
//   the capture is visible in the animation.

function CaptureFx({
  board,
  toScreen,
  tokenSize,
  cell,
  to,
  consumed,
}: {
  board: Board;
  toScreen: ReplayFxProps['toScreen'];
  tokenSize: number;
  cell: CellId;
  to: FactionId;
  consumed?: UnitInstance;
}) {
  const cellObj = board.cells.get(cell);
  if (!cellObj) return null;
  const at = toScreen(cellObj.center);
  const pts = cellObj.polygon.map(toScreen);
  const d = roundedPolygonPath(pts);
  const color = factionColor(to);
  const sweepR = Math.max(...pts.map((p) => Math.hypot(p[0] - at[0], p[1] - at[1]))) * 1.1;
  const clipId = `fx-cap-clip-${cell}`;
  const ts = tokenSize;
  // Dissolve-spark positions: 4 dots orbit the rising token and merge upward
  const sparks = [0, 1, 2, 3].map((k) => {
    const angle = (k / 4) * Math.PI * 2 + Math.PI / 4;
    return { sx: Math.cos(angle) * ts * 0.38, sy: Math.sin(angle) * ts * 0.38 };
  });
  return (
    <g className="fx-capture" pointerEvents="none">
      {/* double-ring pulse around the cell border */}
      <path className="fx-capture-pulse" d={d} fill="none" stroke={color} strokeWidth={ts * 0.15} />
      <path className="fx-capture-pulse-outer" d={d} fill="none" stroke={color} strokeWidth={ts * 0.08} />
      {/* paint-fill sweep — clipped to the cell polygon */}
      <clipPath id={clipId}>
        <path d={d} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <circle className="fx-capture-sweep" cx={at[0]} cy={at[1]} r={sweepR} fill={color} />
        {/* lingering color stain behind the sweep so the cell reads as claimed */}
        <circle className="fx-capture-stain" cx={at[0]} cy={at[1]} r={sweepR} fill={color} />
      </g>
      {/* all positioned elements anchor to cell center */}
      <g transform={`translate(${at[0]} ${at[1]})`}>
        {/* consumed unit token dissolves upward + sparks */}
        {consumed && (
          <>
            <g className="fx-capture-consume">
              <UnitRenderer unit={consumed} x={0} y={0} size={ts} />
            </g>
            {sparks.map(({ sx, sy }, k) => (
              <circle
                key={`sp${k}`}
                className="fx-capture-spark"
                cx={sx}
                cy={sy}
                r={ts * 0.07}
                fill={color}
                stroke="#fff"
                strokeWidth={ts * 0.025}
                style={{ animationDelay: `${0.12 + k * 0.04}s` } as React.CSSProperties}
              />
            ))}
          </>
        )}
        {/* flag: flagpole + banner — raises with a wave, matches OwnedBaseMotif
            proportions so the FX flag and static base look like the same object */}
        <g className="fx-capture-flag">
          {/* pole */}
          <line
            x1={0}
            y1={ts * 0.35}
            x2={0}
            y2={-ts * 0.55}
            stroke={color}
            strokeWidth={ts * 0.1}
            strokeLinecap="round"
          />
          {/* banner — wider than the old pennant so it reads on a phone */}
          <path
            d={`M0 ${-ts * 0.55} L${ts * 0.62} ${-ts * 0.33} L0 ${-ts * 0.1} Z`}
            fill={color}
          />
          {/* highlight streak across the banner face */}
          <line
            className="fx-capture-shimmer"
            x1={ts * 0.07}
            y1={-ts * 0.48}
            x2={ts * 0.38}
            y2={-ts * 0.25}
            stroke="#fff"
            strokeWidth={ts * 0.07}
            strokeLinecap="round"
          />
        </g>
      </g>
    </g>
  );
}

// --- v0.8 veterancy: the promotion verb ----------------------------------------
// A brief upward-chevron burst in the faction colour at the unit's cell —
// celebratory but not screen-dominating. ~450 ms total (PROMOTE_MS). Uses
// the same spike-geometry as ClashBurst but shoots the spikes upward (a "rising
// salute") and fades out with the CSS fx-promote class.

function PromotionFx({ at, tokenSize, color }: { at: Pt; tokenSize: number; color: string }) {
  const inner = tokenSize * 0.28;
  const outer = tokenSize * 0.72;
  // 5 upward spikes in a ~120° arc above the token center (−60° to +60° from up).
  const spikes = [0, 1, 2, 3, 4].map((k) => {
    const t = -Math.PI / 2 + ((k - 2) / 4) * (Math.PI * 0.67);
    return [Math.cos(t), Math.sin(t)] as const;
  });
  return (
    <g transform={`translate(${at[0]} ${at[1]})`} pointerEvents="none">
      {/* outer positioning wrapper — CSS animation lives on the inner group
          per the P9 rule: CSS transforms must not mix with SVG transform attrs */}
      <g className="fx-promote">
        {spikes.map(([ux, uy], k) => (
          <line
            key={k}
            x1={ux * inner}
            y1={uy * inner}
            x2={ux * outer}
            y2={uy * outer}
            stroke={color}
            strokeWidth={tokenSize * 0.08}
            strokeLinecap="round"
          />
        ))}
        {/* small star/circle burst at center */}
        <circle r={inner * 0.7} fill={color} opacity={0.75} />
      </g>
    </g>
  );
}

// --- Forced-crossing combat: the "path interrupted!" sign ---------------------
// A short transient label floating above the crossing cell, announcing that two
// enemy movers' paths crossed and were halted here (addendum 2026-06-21 §5).
// Reuses the floater-pill visual vocabulary (a rounded label with the same rise
// motion) but as a wider banner with a small ✕ glyph — it reads as an
// announcement, not a damage number, and carries no breakdown tap target. The
// ensuing brawl renders via the existing brawl FX.

function CrossSign({ at, tokenSize, text }: { at: Pt; tokenSize: number; text: string }) {
  const fs = tokenSize * 0.3;
  const w = text.length * fs * 0.56 + fs * 2.2;
  const h = fs * 1.7;
  const y = at[1] - tokenSize * 1.05;
  return (
    <g
      className="fx-cross-sign"
      transform={`translate(${at[0]} ${y})`}
      pointerEvents="none"
    >
      {/* the rise animation lives on this INNER group — see the transform NOTE */}
      <g className="fx-floater-rise">
        <rect
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          rx={h / 2}
          fill="#9c2f1d"
          stroke="#fff"
          strokeWidth={tokenSize * 0.035}
        />
        {/* ✕ glyph at the left, echoing the crossing */}
        <text
          x={-w / 2 + fs * 0.9}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={fs * 0.9}
          fontWeight={700}
          fill="#fff"
        >
          ✕
        </text>
        <text
          x={fs * 0.5}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={fs * 0.78}
          fontWeight={700}
          fill="#fff"
        >
          {text}
        </text>
      </g>
    </g>
  );
}

// --- R5: category-coloured DAMAGE NUMBERS ------------------------------------
// A damage floater is coloured by its CATEGORY (derived purely upstream in
// state/replay.ts) and SIZED by the hit's magnitude:
//   • taken   = INK   (#4a443a) pill, light text  — normal damage taken
//   • counter = GREY  (#8d8675) pill, light text  — an answering counter blow
//   • kill    = GOLD  (var(--gold)) pill, dark text — the lethal blow
// PRECEDENCE (documented): FOG honesty is absolute — a mist (fire-from-the-mist)
// floater keeps its existing fog-grey treatment REGARDLESS of category, so a
// hidden attacker's lethal hit never gains a tell that a normal mist hit lacks.
// For source-revealed floaters the order is kill > counter > taken (a counter
// that kills reads as a kill — set upstream). The motion (arc-rise + fade) is
// unchanged: the same .fx-floater-rise the pills already used.

/** R5 (pure): pill fill + text colour for a damage floater. Mist wins (fog
 *  honesty); otherwise colour by category. */
function floaterColors(
  mist: boolean,
  category: FloaterCategory,
): { fill: string; text: string; stroke: string } {
  if (mist) {
    // fog-grey, unchanged — the hidden attacker never leaks through a category.
    return { fill: '#5d5648', text: '#f2eee3', stroke: 'rgba(255,255,255,0.55)' };
  }
  switch (category) {
    case 'kill':
      // GOLD pill, dark ink text — the lethal blow reads loudest.
      return { fill: 'var(--gold)', text: '#4a443a', stroke: 'rgba(74,68,58,0.45)' };
    case 'counter':
      // GREY pill, light text — the answering blow.
      return { fill: '#8d8675', text: '#f2eee3', stroke: 'rgba(74,68,58,0.35)' };
    default:
      // INK pill, light text — normal damage taken.
      return { fill: '#4a443a', text: '#f2eee3', stroke: 'rgba(74,68,58,0.35)' };
  }
}

/** R5 (pure): the font-size multiplier for a damage floater, scaling with the
 *  hit magnitude (the number parsed from the pill text) and BOUNDED. A non-
 *  numeric label ("no target", "build failed") stays at the base size. The ramp
 *  is gentle (≈√magnitude) so a 1-damage tick and a 99-damage haymaker differ
 *  clearly but the big number never overruns its pill / neighbours.
 *    1 → 1.00×   ·   12 → ~1.30×   ·   99+ → 1.40× (the clamp ceiling). */
export function floaterSizeScale(text: string): number {
  const mag = Math.abs(parseInt(text.replace(/[^0-9-]/g, ''), 10));
  if (!Number.isFinite(mag) || mag <= 1) return 1;
  // √-ramp from 1×, +~0.115 per √step, clamped to 1.4× so it stays bounded.
  return Math.min(1.4, 1 + (Math.sqrt(mag) - 1) * 0.115);
}

export function ReplayFx({ board, toScreen, tokenSize, fx, player = 0, onFloaterTap }: ReplayFxProps) {
  // Stack same-cell floaters (brawl halves) side by side.
  const seenCells = new Map<CellId, number>();
  // R4: when the frame carries attack-motion primitives, render them (crawling
  // tracers / arcing shells / melee stabs) INSTEAD of the instant FlashArc — each
  // projectile is a 1:1 upgrade of one arc. A mist strike has neither an arc nor
  // a projectile (the source is withheld), so the impact alone shows either way.
  // Frames without projectiles (or older callers) keep the legacy FlashArc.
  const projectiles = fx.projectiles ?? [];
  const useProjectiles = projectiles.length > 0;
  return (
    <g className="board-replay-fx">
      {useProjectiles
        ? projectiles.map((proj, k) => (
            <ProjectileFx
              key={`pj${k}`}
              board={board}
              toScreen={toScreen}
              tokenSize={tokenSize}
              proj={proj}
            />
          ))
        : fx.arcs.map((arc, k) => (
            <FlashArc
              key={`a${k}`}
              board={board}
              toScreen={toScreen}
              tokenSize={tokenSize}
              from={arc.from}
              to={arc.to}
              faction={arc.faction}
            />
          ))}
      {fx.bursts.map((cell, k) => {
        const at = center(board, cell, toScreen);
        return at ? <ClashBurst key={`b${k}`} at={at} tokenSize={tokenSize} /> : null;
      })}
      {fx.floaters.map((fl) => {
        const at = center(board, fl.cell, toScreen);
        if (!at) return null;
        const stack = seenCells.get(fl.cell) ?? 0;
        seenCells.set(fl.cell, stack + 1);
        // R5: bigger hits get a bigger pill (bounded) so the number's weight
        // tracks the damage. The pill geometry scales with the same factor so
        // the larger glyph stays contained.
        const scale = floaterSizeScale(fl.text);
        const w = (Math.max(fl.text.length, 2) * tokenSize * 0.26 + tokenSize * 0.3) * scale;
        const h = tokenSize * 0.52 * scale;
        const x = at[0] + (stack === 0 ? 0 : (stack % 2 === 1 ? 1 : -1) * w * 0.7);
        const y = at[1] - tokenSize * 0.95 - stack * h * 0.25;
        const category: FloaterCategory = fl.category ?? 'taken';
        const { fill, text, stroke } = floaterColors(fl.mist, category);
        return (
          <g
            key={fl.id}
            className={`fx-floater${fl.mist ? ' fx-floater-mist' : ''}${fl.linger ? ' fx-floater-linger' : ''}`}
            transform={`translate(${x} ${y})`}
          >
            {/* the rise animation lives on this INNER group — see NOTE above */}
            <g className="fx-floater-rise">
              {fl.mist && !fl.linger && (
                <MistImpact at={[at[0] - x, at[1] - y]} tokenSize={tokenSize} />
              )}
              <g
                className="fx-floater-pill"
                onClick={onFloaterTap ? () => onFloaterTap(fl.slot) : undefined}
              >
                {/* generous invisible tap zone (P9): pills are small at fit
                    zoom — the hit target is ~2× the pill */}
                <rect
                  x={-w}
                  y={-h * 1.4}
                  width={w * 2}
                  height={h * 2.8}
                  fill="transparent"
                  stroke="none"
                />
                <rect
                  x={-w / 2}
                  y={-h / 2}
                  width={w}
                  height={h}
                  rx={h / 2}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={tokenSize * 0.03}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={h * 0.62}
                  fontWeight={700}
                  fill={text}
                  pointerEvents="none"
                >
                  {fl.text}
                </text>
              </g>
            </g>
          </g>
        );
      })}
      {(fx.impacts ?? []).map((im, k) => {
        // v0.6 impact verb (the flash half — the recoil half rides the
        // attacker's real token, see Board/UnitRenderer): an 80 ms white
        // flash over the surviving defender, settling out by ~300 ms.
        const at = center(board, im.defenderCell, toScreen);
        if (!at) return null;
        const s = tokenSize * 1.08;
        return (
          <g
            key={`i${k}`}
            className="fx-hit"
            transform={`translate(${at[0]} ${at[1]})`}
            pointerEvents="none"
          >
            <rect
              className="fx-hit-flash"
              x={-s / 2}
              y={-s / 2}
              width={s}
              height={s}
              rx={s * 0.3}
              fill="#fff"
            />
          </g>
        );
      })}
      {/* R6 (DEFERRED DISSOLVE): units in the DOOMED hold — greyed token + death
          glyph (never a "0"), no dissolve. They persist through the wave frames
          and fall later, in the SETTLE beat (fx.kills). */}
      {(fx.doomed ?? []).map((unit) => {
        const at = center(board, unit.cell, toScreen);
        if (!at) return null;
        return <DoomedFx key={`d${unit.id}`} unit={unit} at={at} tokenSize={tokenSize} />;
      })}
      {fx.kills.map((unit) => {
        const at = center(board, unit.cell, toScreen);
        if (!at) return null;
        return (
          <DeathFx
            key={`k${unit.id}`}
            unit={unit}
            at={at}
            tokenSize={tokenSize}
            own={unit.faction === player}
            cheerColor={factionColor(player)}
          />
        );
      })}
      {(fx.spawns ?? []).map((unit) => {
        const at = center(board, unit.cell, toScreen);
        if (!at) return null;
        // Positioning translate on the OUTER group; the CSS scale/fade
        // animation lives on the inner one (see the P9 transform NOTE above).
        return (
          <g
            key={`s${unit.id}`}
            className="fx-spawn"
            transform={`translate(${at[0]} ${at[1]})`}
            pointerEvents="none"
          >
            <g className="fx-spawn-pop">
              <UnitRenderer unit={unit} x={0} y={0} size={tokenSize} />
            </g>
            <circle
              className="fx-spawn-ring"
              r={tokenSize * 0.62}
              fill="none"
              stroke={factionColor(unit.faction)}
              strokeWidth={tokenSize * 0.07}
            />
          </g>
        );
      })}
      {(fx.captures ?? []).map(({ cell, to, consumed }, k) => (
        <CaptureFx
          key={`c${k}`}
          board={board}
          toScreen={toScreen}
          tokenSize={tokenSize}
          cell={cell}
          to={to}
          consumed={consumed}
        />
      ))}
      {(fx.promotions ?? []).map(({ cell, faction }, k) => {
        const at = center(board, cell, toScreen);
        return at ? (
          <PromotionFx
            key={`p${k}`}
            at={at}
            tokenSize={tokenSize}
            color={factionColor(faction)}
          />
        ) : null;
      })}
      {(fx.signs ?? []).map(({ cell, text }, k) => {
        const at = center(board, cell, toScreen);
        return at ? (
          <CrossSign key={`sign${k}`} at={at} tokenSize={tokenSize} text={text} />
        ) : null;
      })}
    </g>
  );
}
