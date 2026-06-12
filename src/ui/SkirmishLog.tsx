// SkirmishLog — v1.1 Feature D. Top-right floating terminal: monospace, dark
// background, light text — a deliberate contrast island in the pastel skin.
// Collapses to a small "+" chip (both toggles are 44px tap targets).
//
// SOURCE CONTRACT: lines come exclusively from the fog-filtered replay script
// (state/replay.ts buildReplay → ReplayScript.log) — never the raw event log.
// fromMist strikes arrive pre-withheld ("−4 from the mist", no attacker
// name/cell); wholly-unseen moves/kills were never emitted. The live round's
// lines append as playback advances (gated by `upToFrame`); completed rounds
// persist in `history` for the whole battle.

import { useEffect, useRef, useState } from 'react';
import type { ReplayLogEntry } from '../state/replay';
import type { LoggedRound } from '../state/store';

export type LiveLog = {
  round: number;
  entries: readonly ReplayLogEntry[];
  /** Current playback frame — only lines with atFrame <= this are shown. */
  upToFrame: number;
};

function LogLine({ entry }: { entry: ReplayLogEntry }) {
  return (
    <div className="skirmish-line">
      {entry.segs.map((seg, k) => (
        <span key={k} className={seg.f !== undefined ? `log-f-${seg.f}` : undefined}>
          {seg.t}
        </span>
      ))}
    </div>
  );
}

function RoundBlock({ round, entries }: { round: number; entries: readonly ReplayLogEntry[] }) {
  return (
    <div className="skirmish-round" data-round={round}>
      <div className="skirmish-round-head">── round {round} ──</div>
      {entries.map((e, k) => (
        <LogLine key={k} entry={e} />
      ))}
    </div>
  );
}

export function SkirmishLog({
  history,
  live,
  defaultOpen,
}: {
  history: readonly LoggedRound[];
  live: LiveLog | null;
  /** Open on ≥700px viewports, collapsed on phone width (caller decides). */
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyRef = useRef<HTMLDivElement>(null);

  const liveShown = live ? live.entries.filter((e) => e.atFrame <= live.upToFrame) : [];
  const lineCount =
    history.reduce((n, r) => n + r.entries.length, 0) + liveShown.length + history.length;

  // Newest at bottom + autoscroll as lines append.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lineCount, open]);

  if (!open) {
    return (
      <button
        className="skirmish-chip"
        onClick={() => setOpen(true)}
        aria-label="open skirmish log"
      >
        +
      </button>
    );
  }

  return (
    <section className="skirmish-log" data-testid="skirmish-log" aria-label="skirmish log">
      <div className="skirmish-head">
        <span className="skirmish-title">skirmish.log</span>
        <button
          className="skirmish-collapse"
          onClick={() => setOpen(false)}
          aria-label="collapse skirmish log"
        >
          −
        </button>
      </div>
      <div className="skirmish-body" ref={bodyRef}>
        {history.length === 0 && !live && (
          <div className="skirmish-line skirmish-idle">awaiting contact…</div>
        )}
        {history.map((r) => (
          <RoundBlock key={r.round} round={r.round} entries={r.entries} />
        ))}
        {live && <RoundBlock round={live.round} entries={liveShown} />}
      </div>
    </section>
  );
}
