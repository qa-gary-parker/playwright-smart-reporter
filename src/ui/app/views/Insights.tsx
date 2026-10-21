import type { ComponentChildren } from 'preact';
import { Count, MiniBar, Sparkline, StatusGlyph } from '../../components';
import { clusterLabel, displayStatus, formatDate, formatDuration, formatPassRate, isFailing, outcomeCounts, plural, suiteHealth, type ReportData, type ReportTest } from '../data';
import { formatRoute } from '../router';
import { data, runTests, testsById } from '../store';
import { Markdown } from './Markdown';
import { isWarning, ruleLabel } from '../../../gates/quality-gate-reporter';

export function Panel({ title, meta, children }: { title: string; meta?: string; children: ComponentChildren }) {
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

function Line({ label, value, children }: { label: string; value: string; children?: ComponentChildren }) {
  return (
    <li class="lines__item">
      <span class="lines__label">{label}</span>
      {children}
      <span class="lines__value mono">{value}</span>
    </li>
  );
}

function Efficiency({ e }: { e: NonNullable<ReportData['efficiency']> }) {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <Panel title="Efficiency" meta={e.shard ? `shard ${e.shard.current} of ${e.shard.total}` : undefined}>
      <ul class="lines">
        <Line label={`Retry waste${e.cost ? `, ${e.cost.retryWaste} at ${e.cost.perMinute}/min` : ''}`} value={formatDuration(e.retryWaste)}>
          <Sparkline label="Retry waste, recent runs" values={e.retryWasteTrend.flatMap((r) => r.retryWaste ?? [])} width={64} height={20} />
        </Line>
        {e.longTail.map((l) => (
          <Line label={`Slowest ${l.percent}% (${plural(l.tests, 'test')})`} value={`${pct(l.share)} of test time`} />
        ))}
        {e.setupGap !== undefined && <Line label="Setup before the first test" value={formatDuration(e.setupGap)} />}
        {e.shard && <Line label="Shard wall time" value={formatDuration(e.shard.wallTime)} />}
        {e.workers && <Line label="Worker utilisation" value={pct(e.workers.utilisation)} />}
        {e.workers?.slots.map((s) => (
          <Line label={`Worker ${s.slot}, ${plural(s.attempts, 'attempt')}`} value={`${formatDuration(s.busy)} busy, ${formatDuration(s.idle)} idle`} />
        ))}
      </ul>
      {e.merged && <p class="panel__empty">Merged report: merge-reports does not record which shard or worker ran a test.</p>}
    </Panel>
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
  // The card names what noNewFailures counts: new failures, failing new tests and failures not in the baseline run.
  const newTests = new Set(d.comparison?.changes.newTests);
  const newFailures = failing.filter((t) => t.signals.includes('new-failure') || newTests.has(t.testId)).length;
  const notInBaseline = new Set(d.comparison?.changes.notInBaseline);
  const absent = failing.filter((t) => notInBaseline.has(t.testId)).length;
  const failedSub = [newFailures ? `${newFailures} new` : '', absent ? `${absent} not in baseline` : ''].filter(Boolean).join(', ') || 'none new';
  // Each recovered test -> the baseline cluster it was in
  const resolvedIn = new Map((d.resolvedClusters ?? []).flatMap((c) => c.testIds.map((id) => [id, c.id] as const)));

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
                  <StatusGlyph status={rule.skipped ? 'skipped' : rule.passed ? 'passed' : isWarning(rule) ? 'flaky' : 'failed'} decorative={isWarning(rule)} />
                  <span class="lines__label">{ruleLabel(rule)}{isWarning(rule) && ' (warning)'}</span>
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
              {d.clusters.map((c) => {
                const label = c.tracking && clusterLabel(c.tracking);
                return (
                  <li class="lines__item">
                    <a class="lines__label mono" href={formatRoute({ view: 'queue', queue: 'failures', q: '', group: 'cluster' })}>
                      {c.errorType}
                    </a>
                    {label && (
                      <span class="signal" title={label.title}>
                        {label.text}
                      </span>
                    )}
                    {c.tracking && <Sparkline label={`Tests in this cluster per run: ${c.tracking.trend.join(', ')}`} values={c.tracking.trend} width={48} height={16} />}
                    <span class="lines__value">
                      <Count status="failed" value={c.testIds.length} label="" />
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p class="panel__empty">No failures to cluster.</p>
          )}
        </Panel>
        {d.resolvedClusters && (
          <Panel title="Resolved clusters" meta={d.resolvedClusters.length ? plural(d.resolvedClusters.length, 'cluster') : undefined}>
            <TestLines tests={ids([...resolvedIn.keys()])} value={(t) => `cluster ${resolvedIn.get(t.testId)!.slice(0, 8)}`} />
          </Panel>
        )}
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
        {d.efficiency && <Efficiency e={d.efficiency} />}
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
