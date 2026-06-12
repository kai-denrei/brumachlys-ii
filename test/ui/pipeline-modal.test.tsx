// @vitest-environment jsdom
// v0.5.1 — the dev pipeline tab behind the TopBar "⌬": opens/closes like the
// rules modal, renders one entry per pipeline-data.ts row (data driven — a
// future release appends there and ships), carries the build badge + test
// count footer, and keeps the shared hyphen free copy constraint.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { TopBar } from '../../src/ui/TopBar';
import { PipelineModal } from '../../src/ui/PipelineModal';
import { PIPELINE, TEST_COUNT } from '../../src/ui/pipeline-data';

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
});
