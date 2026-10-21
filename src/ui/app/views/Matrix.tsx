import { environmentRowKey } from '../../../analyzers/environment';
import { displayStatus, location, plural, titlePath, type ReportTest } from '../data';
import { formatRoute } from '../router';
import { data } from '../store';
import { Panel } from './Insights';

const TONE = { passed: 'pass', failed: 'fail', timedOut: 'fail', flaky: 'flaky', skipped: 'skip', interrupted: 'skip', quarantined: 'skip' };

export function Matrix() {
  const d = data.value;
  const projects = [...new Set(d.tests.flatMap((t) => t.project ?? []))].sort();
  const browsers = new Map(d.tests.map((t) => [t.project, t.browser]));
  const rows = new Map<string, Map<string, ReportTest>>();
  for (const t of d.tests) if (t.project) rows.set(environmentRowKey(t), (rows.get(environmentRowKey(t)) ?? new Map()).set(t.project, t));
  const status = (t?: ReportTest) => (t ? displayStatus(t) : 'did not run');
  // The tests whose outcome is not the same in every project
  const differing = [...rows.values()].filter((r) => new Set(projects.map((p) => status(r.get(p)))).size > 1).slice(0, 100);
  const insights = d.environmentInsights ?? [];
  const cols = { gridTemplateColumns: `repeat(${projects.length}, 96px)` };
  return (
    <div class="page">
      <header class="page__head">
        <h1 class="page__title">Matrix</h1>
        <span class="faint">{plural(projects.length, 'project')}</span>
      </header>
      <Panel title="Environment insights">
        {insights.length ? (
          <ul class="lines">
            {insights.map((i) => (
              <li class="lines__item">
                <a class="lines__label" href={formatRoute({ view: 'queue', queue: 'failures', q: '', group: i.dimension === 'worker' ? 'worker' : 'project' })}>
                  {i.text}
                </a>
                <span class="lines__value">{i.dimension}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="panel__empty">No failure occurs in one project, browser or worker only.</p>
        )}
      </Panel>
      {differing.length === 0 ? (
        <p class="panel__empty">Every test had the same outcome in every project.</p>
      ) : (
        <div class="heatmap" role="table" aria-label="Outcome of each test in each project, for the tests whose outcome differs between projects">
          <div class="heatmap__row" role="row">
            <span />
            <span class="heatmap__cells" style={cols}>
              {projects.map((p) => (
                <span role="columnheader" class="heatmap__label" title={`${p} (${browsers.get(p) ?? 'browser not known'})`}>
                  {p}
                </span>
              ))}
            </span>
          </div>
          {differing.map((r) => {
            const first = [...r.values()][0];
            return (
              <div class="heatmap__row" role="row">
                <span role="rowheader" class="heatmap__label" title={location(first)}>
                  {titlePath(first, false).join(' › ')}
                </span>
                <span class="heatmap__cells" style={cols}>
                  {projects.map((p) => {
                    const t = r.get(p);
                    return (
                      <span role="cell" aria-label={t ? undefined : `${p}: did not run`}>
                        {t && <a class={`heatmap__cell seg-${TONE[displayStatus(t)]}`} href={formatRoute({ view: 'queue', queue: 'all', q: '', test: t.testId })} title={`${p}: ${status(t)}`} aria-label={`${p}: ${status(t)}`} />}
                      </span>
                    );
                  })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
