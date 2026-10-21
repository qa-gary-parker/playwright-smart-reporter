import type { ComponentChildren } from 'preact';
import { Button, Count, Icon, IconButton, Menu, StatusGlyph } from '../../components';
import { ACCENT_NAMES } from '../../styles/tokens';
import { formatDate, formatDuration, outcomeCounts } from '../data';
import { QUEUES, QUEUE_IDS, type QueueId } from '../queues';
import { formatRoute, type Route } from '../router';
import { applyTheme, data, keymapOpen, multiProject, navigate, paletteOpen, railOpen, route, runTests, theme } from '../store';
import { ExportMenu } from './Exports';

function ThemeMenu() {
  const { mode, accent } = theme.value;
  const modes: Array<[string, string]> = [
    ['system', 'System'],
    ['light', 'Light'],
    ['dark', 'Dark'],
    ['hc', 'High contrast'],
  ];
  return (
    <Menu
      label="Theme"
      triggerClass="icon-btn"
      items={[
        ...modes.map(([id, label]) => ({ id: `mode:${id}`, label, group: 'Mode', checked: mode === id })),
        ...ACCENT_NAMES.map((a) => ({ id: `accent:${a}`, label: a[0].toUpperCase() + a.slice(1), group: 'Accent', checked: accent === a })),
      ]}
      onSelect={(id) => {
        const [kind, value] = id.split(':');
        applyTheme(kind === 'mode' ? { mode: value, accent } : { mode, accent: value });
      }}
    >
      <Icon name={mode === 'dark' || mode === 'hc' ? 'moon' : mode === 'light' ? 'sun' : 'monitor'} />
    </Menu>
  );
}

export function queueCount(id: QueueId): number {
  return runTests.value.filter(QUEUES[id].includes).length;
}

function TopBar() {
  const d = data.value;
  const { failed: failures, passed, flaky, skipped } = outcomeCounts(runTests.value);
  const ci = d.meta.ci;
  const brand = d.config.branding;
  const toQueue = (queue: QueueId) => navigate({ view: 'queue', queue, q: '' });
  return (
    <header class="topbar">
      <IconButton icon="panel-left" label="Toggle sidebar (⌘B)" onClick={() => (railOpen.value = !railOpen.value)} />
      <span class="topbar__brand">
        {brand?.logo ? <img class="topbar__logo" src={brand.logo} alt={brand.title ? '' : 'Report logo'} /> : null}
        {brand?.title || (brand?.logo ? null : 'Smart Reporter')}
      </span>
      <span class="topbar__run hide-narrow">
        {ci?.branch && (
          <span class="topbar__meta">
            <Icon name="git-branch" size={14} />
            <span class="mono">{ci.branch}</span>
          </span>
        )}
        {ci?.commit && (
          <span class="topbar__meta">
            <Icon name="git-commit" size={14} />
            <span class="mono">{ci.commit.slice(0, 7)}</span>
          </span>
        )}
        {ci?.buildId && <span class="topbar__meta">{`${ci.provider} #${ci.buildId}`}</span>}
        <span class="topbar__meta faint">{formatDate(d.meta.startTime, true)}</span>
      </span>
      <span class="topbar__spacer" />
      <span class="topbar__verdict" aria-label="Run result">
        {failures === 0 ? (
          <Count status="passed" value="No" label="failures" onClick={() => toQueue('all')} />
        ) : (
          <Count status="failed" value={failures} onClick={() => toQueue('failures')} />
        )}
        <span class="hide-narrow">
          <Count status="passed" value={passed} onClick={() => navigate({ view: 'queue', queue: 'all', q: 'status:passed' })} />
        </span>
        {flaky > 0 && (
          <span class="hide-narrow">
            <Count status="flaky" value={flaky} onClick={() => toQueue('flaky')} />
          </span>
        )}
        {skipped > 0 && (
          <span class="hide-narrow">
            <Count status="skipped" value={skipped} onClick={() => navigate({ view: 'queue', queue: 'all', q: 'status:skipped' })} />
          </span>
        )}
      </span>
      {d.gates && (
        <a class="topbar__gate hide-narrow" href={formatRoute({ view: 'insights' })}>
          <StatusGlyph status={d.gates.passed ? 'passed' : 'failed'} decorative />
          Gate {d.gates.passed ? 'passed' : 'failed'}
        </a>
      )}
      <span class="topbar__meta mono hide-narrow">{formatDuration(d.summary.duration)}</span>
      <Button icon="search" kbd="⌘K" onClick={() => (paletteOpen.value = true)} class="topbar__search" aria-label="Search (⌘K)">
        <span class="hide-narrow">Search</span>
      </Button>
      <ThemeMenu />
      <ExportMenu />
    </header>
  );
}

function RailItem({ icon, label, count, to, active }: { icon: string; label: string; count?: number; to: Route; active: boolean }) {
  return (
    <a class="rail__item" href={formatRoute(to)} aria-current={active ? 'page' : undefined}>
      <Icon name={icon} />
      <span class="rail__label">{label}</span>
      {count !== undefined && <span class="rail__count">{count}</span>}
    </a>
  );
}

function Rail() {
  const r = route.value;
  const f = data.value.config.features;
  const run = r.run ? { run: r.run } : {};
  const brand = data.value.config.branding;
  return (
    <nav class="rail" aria-label="Views" data-open={railOpen.value ? '' : undefined}>
      <div class="rail__group">
        {QUEUE_IDS.map((id) => (
          <RailItem icon={QUEUES[id].icon} label={QUEUES[id].label} count={queueCount(id)} to={{ view: 'queue', queue: id, q: '', ...run }} active={r.view === 'queue' && r.queue === id} />
        ))}
      </div>
      <div class="rail__group">
        <RailItem icon="gauge" label="Insights" to={{ view: 'insights' }} active={r.view === 'insights'} />
        <RailItem icon="history" label="History" to={{ view: 'history', tab: f.trends ? 'trends' : 'heatmap' }} active={r.view === 'history'} />
        {f.gallery && <RailItem icon="image" label="Gallery" to={{ view: 'gallery', ...run }} active={r.view === 'gallery'} />}
        {f.live && <RailItem icon="radio" label="Live" to={{ view: 'live' }} active={r.view === 'live'} />}
        {data.value.coverage && <RailItem icon="target" label="Coverage" count={Math.floor(data.value.coverage.summary.lines.pct)} to={{ view: 'coverage' }} active={r.view === 'coverage'} />}
        {multiProject.value && <RailItem icon="table" label="Matrix" count={data.value.environmentInsights?.length} to={{ view: 'matrix' }} active={r.view === 'matrix'} />}
        {data.value.a11y && <RailItem icon="eye" label="Accessibility" count={data.value.a11y.totalViolations} to={{ view: 'a11y' }} active={r.view === 'a11y'} />}
      </div>
      <div class="rail__foot">
        <button type="button" class="rail__keys" onClick={() => (keymapOpen.value = true)}>
          <Icon name="command" size={14} />
          Keyboard shortcuts
          <span class="kbd">?</span>
        </button>
        {brand?.footer && <p class="rail__note">{brand.footer}</p>}
        {!brand?.hidePoweredBy && <p class="rail__note">Playwright Smart Reporter {data.value.meta.reporterVersion}</p>}
      </div>
    </nav>
  );
}

export function Frame({ children }: { children: ComponentChildren }) {
  const r = route.value;
  return (
    <div class="app" data-rail={railOpen.value ? 'open' : 'closed'}>
      {/* A hash link would change the route, so move focus directly. */}
      <button type="button" class="skip-link" onClick={() => document.getElementById('main')?.focus()}>
        Skip to content
      </button>
      <TopBar />
      {r.run && (
        <div class="runbar" role="status">
          <Icon name="history" size={14} />
          Viewing the run of {formatDate(data.value.historySnapshots?.[r.run]?.timestamp ?? '', true)}. Read only.
          <Button size="sm" variant="ghost" onClick={() => navigate({ ...r, run: undefined } as Route)}>
            Back to current run
          </Button>
        </div>
      )}
      <div class="app__body">
        <Rail />
        <main class="app__main" id="main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
