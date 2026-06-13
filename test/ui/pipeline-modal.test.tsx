// @vitest-environment jsdom
// v0.5.1 — the dev pipeline tab behind the TopBar "⌬": opens/closes like the
// rules modal, renders one entry per pipeline-data.ts row (data driven — a
// future release appends there and ships), carries the build badge + test
// count footer, and keeps the shared hyphen free copy constraint.
// v0.8 additions: versioning block, collapsible session-usage panel,
// per-version GitHub commit links.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { TopBar } from '../../src/ui/TopBar';
import { PipelineModal } from '../../src/ui/PipelineModal';
import { PIPELINE, TEST_COUNT } from '../../src/ui/pipeline-data';

const GH_BASE = 'https://github.com/kai-denrei/brumachlys-ii';

afterEach(cleanup);

describe('TopBar "⌬" affordance', () => {
  it('opens the pipeline modal and closes it again', () => {
    const { baseElement, getByLabelText } = render(<TopBar round={3} phase="planning" />);
    expect(baseElement.querySelector('[data-testid="pipeline-modal"]')).toBeNull();
    fireEvent.click(getByLabelText('dev pipeline'));
    expect(baseElement.querySelector('[data-testid="pipeline-modal"]')).not.toBeNull();
    fireEvent.click(getByLabelText('close pipeline'));
    expect(baseElement.querySelector('[data-testid="pipeline-modal"]')).toBeNull();
  });
});

describe('PipelineModal', () => {
  it('renders one entry per pipeline-data row with version, status chip, items', () => {
    const { baseElement } = render(<PipelineModal onClose={() => {}} />);
    const entries = baseElement.querySelectorAll('[data-testid="pipeline-entry"]');
    expect(entries.length).toBe(PIPELINE.length);
    for (const [i, e] of PIPELINE.entries()) {
      const el = entries[i]!;
      expect(el.querySelector('.pipeline-version')!.textContent).toBe(e.version);
      expect(el.querySelector(`.pipeline-chip-${e.status}`)).not.toBeNull();
      expect(el.querySelectorAll('.pipeline-items li').length).toBe(e.items.length);
    }
    // the conquest release is on the board, the parking lot is queued
    const text = baseElement.textContent!;
    expect(text).toContain('CONQUEST');
    expect(text).toContain('hot seat · PWA');
  });

  it('footer carries the build badge and the release test count', () => {
    const { baseElement } = render(<PipelineModal onClose={() => {}} />);
    const footer = baseElement.querySelector('[data-testid="pipeline-footer"]')!;
    expect(footer.querySelector('.version-badge')).not.toBeNull();
    expect(footer.textContent).toContain(`${TEST_COUNT} tests green`);
  });

  it('copy contains no hyphen anywhere (shared rules modal constraint)', () => {
    const { baseElement } = render(<PipelineModal onClose={() => {}} />);
    const text = baseElement.querySelector('[data-testid="pipeline-modal"]')!.textContent!;
    expect(text).not.toContain('-'); // U+002D
  });

  it('versioning block renders with VERSION label and latest shipped version', () => {
    const { baseElement } = render(<PipelineModal onClose={() => {}} />);
    const block = baseElement.querySelector('[data-testid="pipeline-versioning"]')!;
    expect(block).not.toBeNull();
    // the latest shipped entry in pipeline-data is 0.8.x
    const latestShipped = [...PIPELINE].reverse().find((e) => e.status === 'shipped')!;
    expect(block.textContent).toContain(latestShipped.version);
    // must also contain a version-badge
    expect(block.querySelector('.version-badge')).not.toBeNull();
  });

  it('session-usage panel is collapsed by default; expands and collapses on toggle', () => {
    const { baseElement } = render(<PipelineModal onClose={() => {}} />);
    const usage = baseElement.querySelector('[data-testid="pipeline-usage"]')!;
    const toggle = baseElement.querySelector('[data-testid="pipeline-usage-toggle"]') as HTMLButtonElement;
    expect(usage).not.toBeNull();
    expect(toggle).not.toBeNull();
    // collapsed by default — body not present
    expect(baseElement.querySelector('#pipeline-usage-body')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // expand
    fireEvent.click(toggle);
    expect(baseElement.querySelector('#pipeline-usage-body')).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // collapse again
    fireEvent.click(toggle);
    expect(baseElement.querySelector('#pipeline-usage-body')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('session-usage shows cost and model breakdown when expanded', () => {
    const { baseElement } = render(<PipelineModal onClose={() => {}} />);
    const toggle = baseElement.querySelector('[data-testid="pipeline-usage-toggle"]') as HTMLButtonElement;
    fireEvent.click(toggle);
    const body = baseElement.querySelector('#pipeline-usage-body')!;
    expect(body.textContent).toContain('40.08');
    expect(body.textContent).toContain('2h 31m 17s');
    // model names visible
    expect(body.textContent).toContain('claude-sonnet-4-6');
    expect(body.textContent).toContain('claude-opus-4-8');
  });

  it('commit links point at GH_BASE and only render for entries with a commit field', () => {
    const { baseElement } = render(<PipelineModal onClose={() => {}} />);
    const links = baseElement.querySelectorAll<HTMLAnchorElement>('.pipeline-commit');
    const entriesWithCommit = PIPELINE.filter((e) => e.commit);
    expect(links.length).toBe(entriesWithCommit.length);
    for (const link of links) {
      expect(link.href).toMatch(new RegExp(`^${GH_BASE}/commit/[0-9a-f]{7,}$`));
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noreferrer');
    }
  });
});
