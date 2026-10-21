import { GroupHeader, ListRow, Tabs, type TestStatus } from '../../components';
import { displayStatus, formatDate, formatDuration, formatPassRate, location, plural, titlePath, trendStats, type ReportTest } from '../data';
import type { ComparisonKey } from '../../../report-data/schema';
import { formatRoute, type HistoryTab } from '../router';
import { data, multiProject, navigate, testsById } from '../store';

// A null value (a run with no pass rate) draws no bar and reads "n/a".
function TrendChart({ title, values, dates, format, tone, onPick }: { title: string; values: Array<number | null>; dates: string[]; format: (v: number) => string; tone?: string; onPick?: (i: number) => void }) {
  const w = 320;
  const h = 96;
  const max = Math.max(...values.map((v) => v ?? 0), 1);
  const show = (v: number | null) => (v === null ? 'n/a' : format(v));
  const bw = w / Math.max(values.length, 1);
  const y = (v: number) => h - (v / max) * (h - 8);
  const { average, anomalies } = trendStats(values);
  const avgPoints = average.map((a, i) => (a === null ? null : `${i * bw + bw / 2},${y(a)}`)).filter(Boolean);
  const outliers = anomalies.filter(Boolean).length;
  return (
    <figure class="trend">
      <figcaption class="trend__head">
        <span class="trend__title">{title}</span>
        <span class="trend__value">{values.length ? show(values[values.length - 1]) : '—'}</span>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} class="trend__svg" role="img" aria-label={`${title}: ${values.map(show).join(', ')}${outliers ? `; ${plural(outliers, 'unusual run')}` : ''}`}>
        <line x1="0" x2={w} y1={h - 0.5} y2={h - 0.5} class="trend__axis" />
        {values.map((v, i) => v === null ? null : (
          <rect
            x={i * bw + 2}
            width={Math.max(1, bw - 4)}
            y={y(v)}
            height={Math.max(1, (v / max) * (h - 8))}
            rx="2"
            class={`trend__bar${i === values.length - 1 ? ` trend__bar--last ${tone ?? ''}` : ''}${onPick ? ' trend__bar--pick' : ''}`}
            data-anomaly={anomalies[i] ? '' : undefined}
            onClick={onPick ? () => onPick(i) : undefined}
          >
            <title>{`${dates[i]}: ${format(v)}${anomalies[i] ? ' (unusual: more than 2 standard deviations from the mean)' : ''}`}</title>
          </rect>
        ))}
        {avgPoints.length > 1 && <polyline class="trend__avg" points={avgPoints.join(' ')} fill="none" />}
        {anomalies.map((a, i) => (a ? <circle class="trend__anomaly" cx={i * bw + bw / 2} cy={Math.max(4, y(values[i]!) - 6)} r="3" /> : null))}
      </svg>
      <div class="trend__dates" aria-hidden="true">
        <span>{dates[0]}</span>
        <span>{dates[dates.length - 1]}</span>
      </div>
    </figure>
  );
}

function Trends() {
  const d = data.value;
  const runs = d.trends;
  if (runs.length === 0) return <p class="panel__empty">No runs recorded.</p>;
  const dates = runs.map((r) => formatDate(r.timestamp));
  const drill = d.config.features.historyDrilldown;
  const pick = drill ? (i: number) => d.historySnapshots?.[runs[i].runId] && navigate({ view: 'queue', queue: 'all', q: '', run: runs[i].runId }) : undefined;
  return (
    <>
      {runs.length === 1 ? (
        <p class="panel__empty trends__note">This is the first recorded run. Trends build up from the next run.</p>
      ) : (
        <p class="faint trends__note">Line: three-run average. Dot: a run more than two standard deviations from the mean.</p>
      )}
      <div class="trends">
      <TrendChart title="Pass rate" values={runs.map((r) => r.passRate)} dates={dates} format={(v) => `${v}%`} onPick={pick} />
      <TrendChart title="Duration" values={runs.map((r) => r.duration)} dates={dates} format={formatDuration} onPick={pick} />
      <TrendChart title="Flaky tests" values={runs.map((r) => r.flaky)} dates={dates} format={(v) => `${v}`} tone="tone-flaky" onPick={pick} />
      <TrendChart title="Slow tests" values={runs.map((r) => r.slow)} dates={dates} format={(v) => `${v}`} onPick={pick} />
      </div>
    </>
  );
}

const CELL: Record<string, TestStatus> = { pass: 'passed', fail: 'failed', flaky: 'flaky', skip: 'skipped' };

function Heatmap() {
  const tests = data.value.tests
    .map((t) => {
      const cells = t.history.map((h) => (h.skipped ? 'skip' : h.passed ? (h.retry ? 'flaky' : 'pass') : 'fail'));
      return { t, cells, unstable: cells.filter((c) => c !== 'pass' && c !== 'skip').length };
    })
    .filter((r) => r.unstable > 0)
    .sort((a, b) => b.unstable - a.unstable)
    .slice(0, 100);
  if (tests.length === 0) return <p class="panel__empty">Every test passed in every recorded run.</p>;
  const width = Math.max(...tests.map((r) => r.cells.length));
  return (
    <div class="heatmap" role="table" aria-label="Outcome of each unstable test in each recorded run, oldest first">
      {tests.map(({ t, cells }) => (
        <div class="heatmap__row" role="row">
          <a role="rowheader" class="heatmap__label" href={formatRoute({ view: 'queue', queue: 'all', q: '', test: t.testId })} title={location(t)}>
            {titlePath(t, multiProject.value).join(' › ')}
          </a>
          <span class="heatmap__cells" style={{ gridTemplateColumns: `repeat(${width}, 10px)` }}>
            {cells.map((c, i) => (
              <span role="cell" class={`heatmap__cell seg-${c}`} title={`${formatDate(t.history[i].timestamp, true)} · ${CELL[c]}`} aria-label={CELL[c]} />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

const COMPARE_GROUPS: Array<[ComparisonKey, string]> = [
  ['newFailures', 'New failures'],
  ['regressions', 'Performance regressions'],
  ['fixedTests', 'Fixed'],
  ['improvements', 'Performance improvements'],
  ['newTests', 'New tests'],
  ['notInBaseline', 'Not in baseline run'],
];

function Compare() {
  const c = data.value.comparison;
  const byId = testsById.value;
  if (!c) return <p class="panel__empty">No baseline run to compare with yet.</p>;
  const delta = (a: number, b: number, unit = '') => `${a - b >= 0 ? '+' : ''}${Math.round((a - b) * 10) / 10}${unit}`;
  const [cur, base] = [c.currentRun, c.baselineRun];
  const baseAt = [base.ciInfo?.branch, base.ciInfo?.commit].filter(Boolean).join(' @ ');
  return (
    <>
      <div class="stats">
        <div class="stat">
          <span class="stat__label">Pass rate</span>
          <span class="stat__value">{formatPassRate(cur.passRate)}</span>
          <span class="stat__sub">{cur.passRate === null || base.passRate === null ? 'n/a' : delta(cur.passRate, base.passRate, ' pts')} vs baseline</span>
        </div>
        <div class="stat">
          <span class="stat__label">Duration</span>
          <span class="stat__value">{formatDuration(cur.duration)}</span>
          <span class="stat__sub">{`${cur.duration >= base.duration ? '+' : '-'}${formatDuration(Math.abs(cur.duration - base.duration))}`} vs baseline</span>
        </div>
        <div class="stat">
          <span class="stat__label">Tests</span>
          <span class="stat__value">{cur.total}</span>
          <span class="stat__sub">{delta(cur.total, base.total)} vs baseline</span>
        </div>
        <div class="stat">
          <span class="stat__label">Flaky</span>
          <span class="stat__value">{cur.flaky}</span>
          <span class="stat__sub">{delta(cur.flaky, base.flaky)} vs baseline</span>
        </div>
      </div>
      <p class="faint compare__base">Baseline: run of {formatDate(base.timestamp, true)}{baseAt && <> on <span class="mono">{baseAt}</span></>}</p>
      <div class="compare" role="tree" aria-label="Changes since the baseline run">
        {COMPARE_GROUPS.map(([key, label]) => {
          const tests = c.changes[key].map((id) => byId.get(id)).filter((t): t is ReportTest => !!t);
          return (
            <>
              <GroupHeader label={label} count={tests.length} expanded onToggle={() => {}} />
              {tests.map((t) => (
                <ListRow
                  status={displayStatus(t)}
                  path={titlePath(t, multiProject.value)}
                  location={location(t)}
                  duration={formatDuration(t.duration)}
                  level={2}
                  onSelect={() => navigate({ view: 'queue', queue: 'all', q: '', test: t.testId })}
                />
              ))}
            </>
          );
        })}
      </div>
    </>
  );
}

export function History({ tab }: { tab: HistoryTab }) {
  const f = data.value.config.features;
  const tabs = [
    ...(f.trends ? [{ id: 'trends', label: 'Trends' }] : []),
    { id: 'heatmap', label: 'Reliability' },
    ...(f.comparison ? [{ id: 'compare', label: 'Compare' }] : []),
  ];
  return (
    <div class="page">
      <header class="page__head">
        <h1 class="page__title">History</h1>
        <span class="faint">{plural(data.value.trends.length, 'recorded run')}</span>
      </header>
      <Tabs label="History" value={tab} onChange={(id) => navigate({ view: 'history', tab: id as HistoryTab })} tabs={tabs} />
      <div class="page__body">{tab === 'compare' ? <Compare /> : tab === 'heatmap' ? <Heatmap /> : <Trends />}</div>
    </div>
  );
}
