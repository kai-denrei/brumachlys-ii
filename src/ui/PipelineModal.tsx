// PipelineModal — the dev pipeline tab behind the TopBar "⌬" (v0.5.1
// operator ask): a holistic "where are we" view of the product. Same family
// as the rules modal (full screen sheet, portal from the TopBar, laconic
// hyphen free copy); content is data driven from pipeline-data.ts so future
// releases append entries there and ship.

import { useState } from 'react';
import { PIPELINE, TEST_COUNT } from './pipeline-data';
import type { PipelineStatus } from './pipeline-data';
import { SESSION_USAGE } from './usage-data';
import { VersionBadge } from './VersionBadge';

const GH_BASE = 'https://github.com/kai-denrei/brumachlys-ii';

const STATUS_LABEL: Record<PipelineStatus, string> = {
  shipped: 'shipped',
  building: 'building',
  next: 'next',
};

/** Latest shipped entry (last entry with status === 'shipped'). */
function latestShipped() {
  for (let i = PIPELINE.length - 1; i >= 0; i--) {
    if (PIPELINE[i]!.status === 'shipped') return PIPELINE[i]!;
  }
  return PIPELINE[0]!;
}

function UsagePanel() {
  const [open, setOpen] = useState(false);
  const u = SESSION_USAGE;

  return (
    <section
      className="pipeline-usage-section"
      data-testid="pipeline-usage"
      aria-label="session usage"
    >
      <div className="pipeline-usage-header">
        <span className="pipeline-usage-label">SESSION USAGE</span>
        <button
          className="pipeline-usage-toggle"
          data-testid="pipeline-usage-toggle"
          aria-expanded={open}
          aria-controls="pipeline-usage-body"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '−' : '+'}
        </button>
      </div>

      {open && (
        <div id="pipeline-usage-body" className="pipeline-usage-body">
          <table className="pipeline-usage-table">
            <tbody>
              <tr>
                <td className="pus-label">total cost</td>
                <td className="pus-value">${u.totalCost.toFixed(2)}</td>
              </tr>
              <tr>
                <td className="pus-label">API time</td>
                <td className="pus-value">{u.apiDuration}</td>
              </tr>
              <tr>
                <td className="pus-label">wall time</td>
                <td className="pus-value">{u.wallDuration}</td>
              </tr>
              <tr>
                <td className="pus-label">code changes</td>
                <td className="pus-value">
                  +{u.linesAdded} / −{u.linesRemoved}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="pus-model-head">by model</div>
          <table className="pipeline-usage-table pipeline-usage-models">
            <thead>
              <tr>
                <th className="pus-th">model</th>
                <th className="pus-th pus-num">in</th>
                <th className="pus-th pus-num">out</th>
                <th className="pus-th pus-num">cache·r</th>
                <th className="pus-th pus-num">cache·w</th>
                <th className="pus-th pus-num">cost</th>
              </tr>
            </thead>
            <tbody>
              {u.byModel.map((m) => (
                <tr key={m.model}>
                  <td className="pus-model-name">{m.model}</td>
                  <td className="pus-num">{m.inputK}k</td>
                  <td className="pus-num">{m.outputK}k</td>
                  <td className="pus-num">{m.cacheReadM}m</td>
                  <td className="pus-num">{m.cacheWriteK}k</td>
                  <td className="pus-num">${m.cost.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function PipelineModal({ onClose }: { onClose: () => void }) {
  const latest = latestShipped();

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div
        className="rules-modal pipeline-modal"
        role="dialog"
        aria-label="dev pipeline"
        data-testid="pipeline-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grab" />
        <div className="sheet-header">
          <span className="sheet-title">PIPELINE</span>
          <button className="sheet-close" onClick={onClose} aria-label="close pipeline">
            ✕
          </button>
        </div>
        <div className="rules-body">
          {/* VERSION block — shows current build at a glance */}
          <section
            className="pipeline-versioning"
            data-testid="pipeline-versioning"
            aria-label="versioning"
          >
            <div className="pipeline-versioning-label">VERSION</div>
            <div className="pipeline-versioning-row">
              <span className="pipeline-versioning-ver">{latest.version}</span>
              {latest.date && (
                <span className="pipeline-versioning-date">{latest.date}</span>
              )}
              <VersionBadge />
            </div>
          </section>

          {/* Session usage collapsible */}
          <UsagePanel />

          {PIPELINE.map((e) => (
            <section key={e.version} className="pipeline-entry" data-testid="pipeline-entry">
              <div className="pipeline-head">
                <span className="pipeline-version">{e.version}</span>
                {e.commit && (
                  <a
                    className="pipeline-commit"
                    href={`${GH_BASE}/commit/${e.commit}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {e.commit}
                  </a>
                )}
                {e.date && <span className="pipeline-date">{e.date}</span>}
                <span className={`pipeline-chip pipeline-chip-${e.status}`}>
                  {STATUS_LABEL[e.status]}
                </span>
              </div>
              <div className="pipeline-title">{e.title}</div>
              <ul className="pipeline-items">
                {e.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            </section>
          ))}
          <footer className="pipeline-footer" data-testid="pipeline-footer">
            <VersionBadge />
            <span className="pipeline-tests">{TEST_COUNT} tests green</span>
          </footer>
        </div>
      </div>
    </div>
  );
}
