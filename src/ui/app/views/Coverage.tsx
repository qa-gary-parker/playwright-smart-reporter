import { useState } from 'preact/hooks';
import type { CoverageFile, CoverageTotals } from '../../../report-data/schema';
import { EmptyState } from '../../components';
import { plural } from '../data';
import { data } from '../store';

function Pct({ t }: { t: CoverageTotals }) {
  return (
    <span class="cov-pct">
      <span class="cov-pct__value">{t.pct}%</span>
      <span class="faint mono">
        {t.covered}/{t.total}
      </span>
    </span>
  );
}

function Bar({ pct }: { pct: number }) {
  return (
    <span class="cov-bar" role="img" aria-label={`${pct}% covered`}>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

function Source({ file }: { file: CoverageFile }) {
  if (!file.source) return <p class="panel__empty">Source was not embedded for this file.</p>;
  const lines = file.source.split('\n');
  return (
    <pre class="cov-src" tabIndex={0} aria-label={`Source of ${file.path} with hit counts`}>
      <code>
        {lines.map((text, i) => {
          const hits = file.hits[i];
          const state = hits === null || hits === undefined ? undefined : hits > 0 ? 'hit' : 'miss';
          return (
            <span class="cov-src__line" data-state={state}>
              <span class="cov-src__n">{i + 1}</span>
              <span class="cov-src__hits">{state ? (hits! > 0 ? `${hits}×` : '0') : ''}</span>
              <span class="cov-src__t">{text || ' '}</span>
            </span>
          );
        })}
      </code>
    </pre>
  );
}

export function Coverage() {
  const c = data.value.coverage;
  const [open, setOpen] = useState<string | null>(null);
  if (!c) {
    return (
      <div class="page">
        <header class="page__head">
          <h1 class="page__title">Coverage</h1>
        </header>
        <EmptyState title="No coverage in this run" icon="target">
          Use the <code>playwright-smart-reporter/coverage</code> fixture to collect JavaScript coverage from Chromium tests.
        </EmptyState>
      </div>
    );
  }
  const files = [...c.files].sort((a, b) => a.lines.pct - b.lines.pct);
  const selected = files.find((f) => f.path === open);
  return (
    <div class="page">
      <header class="page__head">
        <h1 class="page__title">Coverage</h1>
        <span class="faint">{plural(files.length, 'file')}, least covered first</span>
      </header>
      <div class="stats">
        <div class="stat">
          <span class="stat__label">Lines</span>
          <span class="stat__value">{c.summary.lines.pct}%</span>
          <span class="stat__sub">
            {c.summary.lines.covered} of {c.summary.lines.total}
          </span>
        </div>
        <div class="stat">
          <span class="stat__label">Functions</span>
          <span class="stat__value">{c.summary.functions.pct}%</span>
          <span class="stat__sub">
            {c.summary.functions.covered} of {c.summary.functions.total}
          </span>
        </div>
        <div class="stat">
          <span class="stat__label">Branches</span>
          <span class="stat__value">{c.summary.branches.pct}%</span>
          <span class="stat__sub">
            {c.summary.branches.covered} of {c.summary.branches.total}
          </span>
        </div>
      </div>
      <div class="cov-table" role="table" aria-label="Coverage by file">
        <div class="cov-row cov-row--head" role="row">
          <span role="columnheader">File</span>
          <span role="columnheader">Lines</span>
          <span role="columnheader" aria-hidden="true" />
          <span role="columnheader">Functions</span>
          <span role="columnheader">Branches</span>
        </div>
        {files.map((f) => (
          <div class="cov-row" role="row" aria-selected={f.path === open}>
            <span role="cell">
              <button type="button" class="cov-file mono" aria-expanded={f.path === open} onClick={() => setOpen(f.path === open ? null : f.path)}>
                {f.path}
              </button>
            </span>
            <span role="cell">
              <Pct t={f.lines} />
            </span>
            <span role="cell">
              <Bar pct={f.lines.pct} />
            </span>
            <span role="cell">
              <Pct t={f.functions} />
            </span>
            <span role="cell">
              <Pct t={f.branches} />
            </span>
          </div>
        ))}
      </div>
      {selected && (
        <section class="panel">
          <header class="panel__head">
            <h2 class="panel__title mono">{selected.path}</h2>
            <span class="panel__meta">{selected.lines.pct}% of lines</span>
          </header>
          <Source file={selected} />
        </section>
      )}
    </div>
  );
}
