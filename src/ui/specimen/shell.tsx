import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { formatDuration } from '../../utils/formatters';
import { Button, Count, Icon, IconButton, Menu, StatusGlyph } from '../components';
import { ACCENT_NAMES } from '../styles/tokens';
import type { Fixture, FxTest } from './fixture';
import { applyTheme, currentTheme, screenHref } from './theme';

export const isFailing = (t: FxTest) => t.status === 'failed' || t.status === 'timedOut';
export const isFlaky = (t: FxTest) => t.status === 'flaky' || t.signals.includes('flaky');

export function queueCounts(fx: Fixture) {
  return {
    failures: fx.tests.filter(isFailing).length,
    flaky: fx.tests.filter(isFlaky).length,
    regressions: fx.tests.filter((t) => t.signals.includes('regression')).length,
    quarantined: fx.tests.filter((t) => t.status === 'quarantined').length,
    all: fx.tests.length,
  };
}

function ThemeMenu() {
  const [{ mode, accent }, setTheme] = useState(currentTheme());
  const modes = [
    ['system', 'System'],
    ['light', 'Light'],
    ['dark', 'Dark'],
    ['hc', 'High contrast'],
  ];
  return (
    <Menu
      label="Theme"
      items={[
        ...modes.map(([id, label]) => ({ id: `mode:${id}`, label, group: 'Mode', checked: mode === id })),
        ...ACCENT_NAMES.map((a) => ({
          id: `accent:${a}`,
          label: a[0].toUpperCase() + a.slice(1),
          group: 'Accent',
          checked: accent === a,
        })),
      ]}
      onSelect={(id) => {
        const [kind, value] = id.split(':');
        const next = kind === 'mode' ? { mode: value, accent } : { mode, accent: value };
        applyTheme(next.mode, next.accent);
        setTheme(next);
      }}
    >
      <Icon name={mode === 'dark' || mode === 'hc' ? 'moon' : mode === 'light' ? 'sun' : 'monitor'} />
    </Menu>
  );
}

function ExportMenu() {
  return (
    <Menu
      label="Export"
      items={[
        { id: 'json', label: 'JSON', icon: 'braces' },
        { id: 'csv', label: 'CSV', icon: 'table' },
        { id: 'summary', label: 'Summary card', icon: 'clipboard', kbd: 'e' },
        { id: 'pdf', label: 'PDF report', icon: 'file-text' },
        { id: 'junit', label: 'JUnit XML', icon: 'file' },
      ]}
      onSelect={() => {}}
    >
      <Icon name="download" />
      <span class="hide-narrow">Export</span>
    </Menu>
  );
}

export function TopBar({ fx, onSearch }: { fx: Fixture; onSearch?: () => void }) {
  const c = queueCounts(fx);
  const passed = fx.tests.filter((t) => t.status === 'passed').length;
  const skipped = fx.tests.filter((t) => t.status === 'skipped').length;
  const allPassed = c.failures === 0;
  return (
    <header class="topbar">
      <IconButton icon="panel-left" label="Toggle sidebar (⌘B)" class="topbar__rail-toggle" />
      <span class="topbar__brand">Smart Reporter</span>
      <span class="topbar__run hide-narrow">
        <span class="topbar__meta">
          <Icon name="git-branch" size={14} />
          <span class="mono">{fx.run.branch}</span>
        </span>
        <span class="topbar__meta">
          <Icon name="git-commit" size={14} />
          <span class="mono">{fx.run.commit}</span>
        </span>
        <a class="topbar__meta topbar__ci" href="#ci">
          {fx.run.ci}
        </a>
        <span class="topbar__meta faint">1 Sep, 11:34</span>
      </span>
      <span class="topbar__spacer" />
      <span class="topbar__verdict" aria-label="Run result">
        {allPassed ? (
          <>
            <Count status="passed" value="No" label="failures" />
            <span class="hide-narrow">
              <Count value={passed} label="passed" />
            </span>
          </>
        ) : (
          <>
            <Count status="failed" value={c.failures} onClick={() => {}} />
            <span class="hide-narrow">
              <Count status="passed" value={passed} onClick={() => {}} />
            </span>
          </>
        )}
        <span class="hide-narrow">
          <Count status="flaky" value={c.flaky} onClick={() => {}} />
        </span>
        <span class="hide-narrow">
          <Count status="skipped" value={skipped} onClick={() => {}} />
        </span>
      </span>
      <span class="topbar__gate hide-narrow">
        <StatusGlyph status={allPassed ? 'passed' : 'failed'} />
        Gate {allPassed ? 'passed' : 'failed'}
      </span>
      <span class="topbar__meta mono hide-narrow">{formatDuration(fx.run.duration)}</span>
      <Button variant="secondary" icon="search" kbd="⌘K" onClick={onSearch} class="topbar__search">
        <span class="hide-narrow">Search</span>
      </Button>
      <ThemeMenu />
      <span class="hide-narrow">
        <ExportMenu />
      </span>
    </header>
  );
}

function RailItem({ icon, label, count, screen, active }: { icon: string; label: string; count?: number; screen: string; active: string }) {
  return (
    <a class="rail__item" href={screenHref(screen)} aria-current={active === screen ? 'page' : undefined}>
      <Icon name={icon} />
      <span class="rail__label">{label}</span>
      {count !== undefined && <span class="rail__count">{count}</span>}
    </a>
  );
}

export function Rail({ fx, active }: { fx: Fixture; active: string }) {
  const c = queueCounts(fx);
  return (
    <nav class="rail" aria-label="Views">
      <div class="rail__group">
        <RailItem icon="x-circle" label="Failures" count={c.failures} screen="failures" active={active} />
        <RailItem icon="shuffle" label="Flaky" count={c.flaky} screen="flaky" active={active} />
        <RailItem icon="trending-up" label="Regressions" count={c.regressions} screen="regressions" active={active} />
        <RailItem icon="ban" label="Quarantined" count={c.quarantined} screen="quarantined" active={active} />
        <RailItem icon="layers" label="All tests" count={c.all} screen="all" active={active} />
      </div>
      <div class="rail__group">
        <RailItem icon="gauge" label="Insights" screen="insights" active={active} />
        <RailItem icon="history" label="History" screen="history" active={active} />
        <RailItem icon="image" label="Gallery" screen="gallery" active={active} />
        <RailItem icon="radio" label="Live" screen="live" active={active} />
      </div>
      <a class="rail__foot" href={screenHref('keymap')}>
        <Icon name="command" size={14} />
        Keyboard shortcuts
        <span class="kbd">?</span>
      </a>
    </nav>
  );
}

export function Frame({
  fx,
  active,
  children,
  onSearch,
}: {
  fx: Fixture;
  active: string;
  children: ComponentChildren;
  onSearch?: () => void;
}) {
  return (
    <div class="app">
      <a class="skip-link" href="#main">
        Skip to content
      </a>
      <TopBar fx={fx} onSearch={onSearch} />
      <div class="app__body">
        <Rail fx={fx} active={active} />
        <main class="app__main" id="main">
          {children}
        </main>
      </div>
    </div>
  );
}
