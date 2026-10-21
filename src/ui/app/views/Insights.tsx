import type { ComponentChildren } from 'preact';
import { Count, MiniBar, Sparkline, StatusGlyph } from '../../components';
import { displayStatus, formatDate, formatDuration, formatPassRate, isFailing, outcomeCounts, plural, suiteHealth, type ReportTest } from '../data';
import { formatRoute } from '../router';
import { data, runTests, testsById } from '../store';
import { Markdown } from './Markdown';

function Panel({ title, meta, children }: { title: string; meta?: string; children: ComponentChildren }) {
  return (
    <section class="panel">
      <header class="panel__head">
        <h2 class="panel__title">{title}</h2>
        {meta && <span class="panel__meta">{meta}</span>}
      </header>
      {children}
    </section>
  );
}

function TestLines({ tests, value }: { tests: ReportTest[]; value: (t: ReportTest) => string }) {
  if (tests.length === 0) return <p class="panel__empty">None this run.</p>;
  return (
    <ul class="lines">
      {tests.map((t) => (
        <li class="lines__item">
          <StatusGlyph status={displayStatus(t)} />
          <a class="lines__label" href={formatRoute({ view: 'queue', queue: 'all', q: '', test: t.testId })}>
            {t.title}
          </a>
          <span class="lines__value mono">{value(t)}</span>
        </li>
      ))}
    </ul>
  );
}

export function Insights() {
  const d = data.value;
  const s = d.summary;
  const trends = d.trends;
  const health = suiteHealth(s);
  const tests = runTests.value;
  const byId = testsById.value;
  const ids = (list: string[] | undefined) => (list ?? []).map((id) => byId.get(id)).filter((t): t is ReportTest => !!t);
  const failing = tests.filter(isFailing);
  const newFailures = failing.filter((t) => t.signals.includes('new-failure')).length;
  // noNewFailures also counts these, so the card names them.
  const notInBaseline = new Set(d.comparison?.changes.notInBaseline);
  const absent = failing.filter((t) => notInBaseline.has(t.testId)).length;
  const failedSub = [newFailures ? `${newFailures} new` : '', absent ? `${absent} not in baseline` : ''].filter(Boolean).join(', ') || 'none new';

  return (
    <div class="page">
      <header class="page__head">
        <h1 class="page__title">Insights</h1>
        <span class="faint">
          Run of {formatDate(d.meta.startTime, true)}
          {trends.length > 1 ? ` · compared with the previous ${plural(trends.length - 1, 'run')}` : ''}
        </span>
      </header>
      <div class="stats">
        <a class="stat stat--link" href={formatRoute({ view: 'queue', queue: 'failures', q: '' })}>
          <span class="stat__label">Failed</span>
          <span class="stat__value" data-tone={failing.length ? 'fail' : undefined}>
            {failing.length}
          </span>
          <span class="stat__sub">{failing.length === 0 ? 'nothing failed' : failedSub}</span>
        </a>
        <div class="stat">
          <span class="stat__label">Pass rate</span>
          <span class="stat__value">{formatPassRate(s.passRate)}</span>
          <Sparkline label="Pass rate, recent runs" values={trends.flatMap((r) => r.passRate ?? [])} width={88} />
        </div>
        <div class="stat">
          <span class="stat__label">Duration</span>
          <span class="stat__value">{formatDuration(s.duration)}</span>
          <Sparkline label="Duration, recent runs" values={trends.map((r) => r.duration)} width={88} />
        </div>
        <div class="stat">
          <span class="stat__label">Tests</span>
          <span class="stat__value">{s.total}</span>
          <span class="stat__sub">{s.newTests ? `${s.newTests} new` : 'no new tests'}</span>
        </div>
        <div class="stat">
          <span class="stat__label">Flaky</span>
          <span class="stat__value" title="Flaky in this run or by recent history">{s.flaky}</span>
          <Sparkline label="Flaky tests, recent runs" values={trends.map((r) => r.flaky)} width={88} />
        </div>
        <div class="stat">
          <span class="stat__label">Health</span>
          <span class="stat__value">{health.grade}</span>
          <span class="stat__sub">
            {health.score ?? 'n/a'} · pass {health.pass ?? 'n/a'} · stability {health.stability} · perf {health.perf}
          </span>
        </div>
      </div>
      <div class="stats-bar">
        <MiniBar
          segments={(({ passed, failed, flaky, skipped }) => [
            { tone: 'pass' as const, value: passed, label: 'passed' },
            { tone: 'fail' as const, value: failed, label: 'failed' },
            { tone: 'flaky' as const, value: flaky, label: 'flaky this run' },
            { tone: 'skip' as const, value: skipped, label: 'skipped' },
          ])(outcomeCounts(tests))}
        />
      </div>
      <div class="panels">
        <Panel title="AI summary">
          {d.ai.suiteHealthSummary ? (
            <Markdown text={d.ai.suiteHealthSummary} />
          ) : d.ai.summaryOff ? (
            <p class="panel__empty">AI is off for this run (enableAIRecommendations or enableAISuiteHealth is false).</p>
          ) : (
            <p class="panel__empty">Not configured. Set an AI provider key, or a local model, to get a plain-language summary of this run.</p>
          )}
        </Panel>
        <Panel title="Quality gate" meta={d.gates ? (d.gates.passed ? 'passed' : 'failed') : undefined}>
          {d.gates ? (
            <ul class="lines">
              {d.gates.rules.map((rule) => (
                <li class="lines__item">
                  <StatusGlyph status={rule.skipped ? 'skipped' : rule.passed ? 'passed' : 'failed'} />
                  <span class="lines__label">{rule.rule}</span>
                  <span class="lines__value mono">
                    {rule.actual} / {rule.threshold}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p class="panel__empty">No quality gate configured.</p>
          )}
        </Panel>
        <Panel title="Failure clusters" meta={d.clusters.length ? plural(d.clusters.length, 'cluster') : undefined}>
          {d.clusters.length ? (
            <ul class="lines">
              {d.clusters.map((c) => (
                <li class="lines__item">
                  <a class="lines__label mono" href={formatRoute({ view: 'queue', queue: 'failures', q: '', group: 'cluster' })}>
                    {c.errorType}
                  </a>
                  <span class="lines__value">
                    <Count status="failed" value={c.testIds.length} label="" />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p class="panel__empty">No failures to cluster.</p>
          )}
        </Panel>
        {d.forecastSummary && (
          <Panel title="At risk" meta={`passing, trending unstable`}>
            <TestLines
              tests={ids(d.forecastSummary.atRisk).slice(0, 8)}
              value={(t) => {
                const f = t.forecast;
                return f?.state === 'scored' ? `${Math.round(f.risk * 100)}% risk` : '';
              }}
            />
          </Panel>
        )}
        {d.coverage && (
          <Panel title="Coverage" meta={`${d.coverage.summary.lines.pct}% of lines`}>
            <ul class="lines">
              {[...d.coverage.files]
                .sort((a, b) => a.lines.pct - b.lines.pct)
                .slice(0, 5)
                .map((f) => (
                  <li class="lines__item">
                    <a class="lines__label mono" href={formatRoute({ view: 'coverage' })}>
                      {f.path}
                    </a>
                    <span class="lines__value mono">{f.lines.pct}%</span>
                  </li>
                ))}
            </ul>
          </Panel>
        )}
        <Panel title="Regressions">
          <TestLines tests={tests.filter((t) => t.signals.includes('regression')).slice(0, 8)} value={(t) => (t.performanceMetrics ? `+${Math.round(t.performanceMetrics.percentChange)}%` : formatDuration(t.duration))} />
        </Panel>
        <Panel title="Slowest">
          <TestLines tests={[...tests].sort((a, b) => b.duration - a.duration).slice(0, 5)} value={(t) => formatDuration(t.duration)} />
        </Panel>
        <Panel title="Most flaky">
          <TestLines
            tests={tests.filter((t) => t.flakinessStatus === 'flaky' || t.flakinessStatus === 'unstable').sort((a, b) => (b.flakinessScore ?? 0) - (a.flakinessScore ?? 0)).slice(0, 5)}
            value={(t) => `${Math.round((t.flakinessScore ?? 0) * 100)}% of ${plural(t.flakinessRuns ?? 0, 'run')}`}
          />
        </Panel>
        <Panel title="Fixed">
          <TestLines tests={ids(d.comparison?.changes.fixedTests)} value={(t) => formatDuration(t.duration)} />
        </Panel>
        <Panel title="New tests">
          <TestLines tests={tests.filter((t) => t.signals.includes('new')).slice(0, 8)} value={(t) => formatDuration(t.duration)} />
        </Panel>
        <Panel title="Quarantine" meta={d.quarantine ? `threshold ${d.quarantine.threshold ?? ''}` : undefined}>
          {d.quarantine ? (
            d.quarantine.entries.length ? (
              <ul class="lines">
                {d.quarantine.entries.map((e) => (
                  <li class="lines__item">
                    <StatusGlyph status="quarantined" />
                    <span class="lines__label">{e.title}</span>
                    <span class="lines__value mono">
                      {e.flakinessScore === undefined ? e.source : `${Math.round(e.flakinessScore * 100)}%${e.runs !== undefined ? ` of ${plural(e.runs, 'run')}` : ''}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p class="panel__empty">No tests quarantined.</p>
            )
          ) : (
            <p class="panel__empty">Not enabled for this project.</p>
          )}
        </Panel>
        {d.ownership && (
          <Panel title="Owners" meta={plural(d.ownership.owners.length, 'owner')}>
            <ul class="lines">
              {d.ownership.owners.map((o) => (
                <li class="lines__item">
                  <a class="lines__label mono" href={formatRoute({ view: 'queue', queue: 'all', q: `owner:${o.owner}`, group: 'owner' })}>
                    {o.owner}
                  </a>
                  <span class="lines__value">
                    {o.failed > 0 && <Count status="failed" value={o.failed} label="" />} {formatPassRate(o.passRate)} of {o.total}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}
