// PipelineModal — the dev pipeline tab behind the TopBar "⌬" (v0.5.1
// operator ask): a holistic "where are we" view of the product. Same family
// as the rules modal (full screen sheet, portal from the TopBar, laconic
// hyphen free copy); content is data driven from pipeline-data.ts so future
// releases append entries there and ship.

import { PIPELINE, TEST_COUNT } from './pipeline-data';
import type { PipelineStatus } from './pipeline-data';
import { VersionBadge } from './VersionBadge';

const STATUS_LABEL: Record<PipelineStatus, string> = {
  shipped: 'shipped',
  building: 'building',
  next: 'next',
};

export function PipelineModal({ onClose }: { onClose: () => void }) {
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
          {PIPELINE.map((e) => (
            <section key={e.version} className="pipeline-entry" data-testid="pipeline-entry">
              <div className="pipeline-head">
                <span className="pipeline-version">{e.version}</span>
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
