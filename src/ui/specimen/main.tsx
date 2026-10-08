import { render, type ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  Button,
  CodeFrame,
  Count,
  Dialog,
  Diff,
  EmptyState,
  ErrorMessage,
  FilterToken,
  GroupHeader,
  IconButton,
  Kbd,
  ListRow,
  Menu,
  MiniBar,
  OutcomeStrip,
  Section,
  Sparkline,
  SplitPane,
  StatusGlyph,
  Tabs,
  Toast,
  Tooltip,
  type TestStatus,
} from '../components';
import { ACCENT_NAMES, NEUTRAL_ROLES, SCALE, STATUSES } from '../styles/tokens';
import { Screen } from './screens';
import { applyTheme } from './theme';

const params = new URLSearchParams(location.search);
const root = document.documentElement;
const MODES = ['system', 'light', 'dark', 'hc'] as const;

applyTheme(params.get('mode') ?? 'system', params.get('accent') ?? 'default');

function Block({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="spec-block">
      <h2 class="spec-block__title">{title}</h2>
      {children}
    </section>
  );
}

function Example({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="spec-example">
      <div class="spec-example__label">{label}</div>
      <div class="spec-example__body">{children}</div>
    </div>
  );
}

function Swatch({ token }: { token: string }) {
  const [value, setValue] = useState('');
  useEffect(() => {
    setValue(getComputedStyle(root).getPropertyValue(`--${token}`).trim());
  });
  return (
    <div class="spec-swatch">
      <span class="spec-swatch__chip" style={{ background: `var(--${token})` }} />
      <span class="mono">--{token}</span>
      <span class="mono faint">{value}</span>
    </div>
  );
}

const STATUS_LIST: TestStatus[] = ['failed', 'timedOut', 'flaky', 'passed', 'skipped', 'quarantined', 'interrupted'];

function Specimen() {
  const [mode, setMode] = useState(params.get('mode') ?? 'system');
  const [accent, setAccent] = useState(params.get('accent') ?? 'default');
  const [tab, setTab] = useState('trends');
  const [selected, setSelected] = useState(1);
  const [groupOpen, setGroupOpen] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [tokens, setTokens] = useState(['status:failed', 'tag:@smoke', 'file:checkout.spec.ts']);

  useEffect(() => applyTheme(mode, accent), [mode, accent]);

  return (
    <main class="spec">
      <header class="spec-head">
        <h1 class="spec-head__title">Smart Reporter UI specimen</h1>
        <Tabs
          label="Mode"
          value={mode}
          onChange={setMode}
          tabs={MODES.map((m) => ({ id: m, label: m === 'hc' ? 'High contrast' : m[0].toUpperCase() + m.slice(1) }))}
        />
        <Menu
          label="Accent"
          items={ACCENT_NAMES.map((a) => ({ id: a, label: a[0].toUpperCase() + a.slice(1), checked: a === accent }))}
          onSelect={setAccent}
        >
          Accent: {accent}
        </Menu>
      </header>

      <Block title="Accent sample">
        <div class="spec-row" data-testid="accent-sample">
          <Button variant="primary" icon="play">
            Run tests
          </Button>
          <a href="#accent">View trace</a>
          <Tabs label="Accent tabs" value="a" onChange={() => {}} tabs={[{ id: 'a', label: 'Selected' }, { id: 'b', label: 'Other' }]} />
          <div role="tree" aria-label="Accent row" class="spec-row__list">
            <ListRow status="failed" path={['checkout', 'pays with saved card']} duration="2.1s" selected />
          </div>
        </div>
      </Block>

      <Block title="Colour">
        <div class="spec-grid">
          {NEUTRAL_ROLES.map((r) => (
            <Swatch token={r} />
          ))}
          {STATUSES.flatMap((s) => [<Swatch token={`${s}-fg`} />, <Swatch token={`${s}-bg`} />])}
          <Swatch token="accent" />
          <Swatch token="accent-fg" />
        </div>
      </Block>

      <Block title="Type">
        {Object.entries(SCALE.text)
          .reverse()
          .map(([k, [size, leading]]) => (
            <div class="spec-type" style={{ fontSize: `var(--text-${k})`, lineHeight: `var(--leading-${k})` }}>
              <span class="mono faint spec-type__meta">
                {k} {size}/{leading}
              </span>
              13 failed of 56 tests in 1m 42s
            </div>
          ))}
        <p class="spec-type mono">checkout.spec.ts:42 · 0.84s · a1b2c3d</p>
      </Block>

      <Block title="Space and radius">
        <div class="spec-row">
          {SCALE.space.map((s, i) => (
            <div class="spec-space">
              <span class="spec-space__bar" style={{ width: `var(--space-${i + 1})` }} />
              <span class="mono faint">{s}</span>
            </div>
          ))}
          <span class="spec-radius" style={{ borderRadius: 'var(--radius-sm)' }}>sm</span>
          <span class="spec-radius" style={{ borderRadius: 'var(--radius-md)' }}>md</span>
        </div>
      </Block>

      <Block title="Buttons">
        <Example label="Variants">
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button icon="download">Export</Button>
          <Button icon="search" kbd="⌘K">
            Search
          </Button>
        </Example>
        <Example label="Small">
          <Button size="sm" variant="primary">
            Primary
          </Button>
          <Button size="sm" icon="copy">
            Copy prompt
          </Button>
          <Button size="sm" variant="ghost">
            Ghost
          </Button>
        </Example>
        <Example label="Disabled">
          <Button variant="primary" disabled>
            Primary
          </Button>
          <Button disabled>Secondary</Button>
          <IconButton icon="copy" label="Copy" disabled />
        </Example>
        <Example label="Icon buttons">
          <IconButton icon="panel-left" label="Toggle sidebar" />
          <IconButton icon="filter" label="Filters" pressed />
          <IconButton icon="more-horizontal" label="More" />
          <Tooltip text="Copy failure summary">
            <IconButton icon="copy" label="Copy failure summary" />
          </Tooltip>
        </Example>
        <Example label="Keys">
          <Kbd>⌘K</Kbd>
          <Kbd>j</Kbd>
          <Kbd>k</Kbd>
          <Kbd>/</Kbd>
          <Kbd>?</Kbd>
          <Kbd>Esc</Kbd>
        </Example>
      </Block>

      <Block title="Status">
        <Example label="Glyphs">
          {STATUS_LIST.map((s) => (
            <StatusGlyph status={s} showLabel />
          ))}
        </Example>
        <Example label="Counts">
          <Count status="failed" value={13} />
          <Count status="passed" value={37} />
          <Count status="flaky" value={4} />
          <Count status="skipped" value={2} />
          <Count value="1m 42s" label="duration" />
          <Count status="failed" value={13} onClick={() => setToast('Opened Failures')} />
        </Example>
        <Example label="Filter tokens">
          {tokens.map((t) => {
            const [name, ...v] = t.split(':');
            return <FilterToken name={name} value={v.join(':')} onRemove={() => setTokens(tokens.filter((x) => x !== t))} />;
          })}
          <FilterToken name="project" value="chromium" />
        </Example>
        <Example label="Tabs">
          <Tabs
            label="History"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'trends', label: 'Trends' },
              { id: 'compare', label: 'Compare', count: 5 },
            ]}
          />
        </Example>
      </Block>

      <Block title="List">
        <div class="spec-list" role="tree" aria-label="Tests">
          <GroupHeader
            label="toBeVisible timeout"
            count={3}
            meta="expect(locator).toBeVisible() failed"
            expanded={groupOpen}
            onToggle={() => setGroupOpen(!groupOpen)}
            mono
          />
          {groupOpen &&
            [
              { status: 'failed', path: ['checkout', 'pays with saved card'], loc: 'checkout.spec.ts:42', d: '2.1s', sig: ['new-failure'] },
              { status: 'failed', path: ['checkout', 'applies coupon'], loc: 'checkout.spec.ts:88', d: '912ms', retries: 2, sig: ['regression', 'slow'] },
              {
                status: 'timedOut',
                path: ['search', 'results', 'filters by tag when the tag list has more than fifty entries and the user scrolls'],
                loc: 'search/filters-with-a-long-directory-name.spec.ts:177',
                d: '30.0s',
                sig: ['slow'],
              },
            ].map((r, i) => (
              <ListRow
                status={r.status as TestStatus}
                path={r.path}
                location={r.loc}
                duration={r.d}
                retries={r.retries}
                signals={r.sig as never}
                level={2}
                selected={selected === i}
                onSelect={() => setSelected(i)}
              />
            ))}
          <GroupHeader label="search.spec.ts" count={2} expanded onToggle={() => {}} />
          <ListRow status="flaky" path={['search', 'filters by tag']} location="search.spec.ts:77" duration="1.4s" retries={1} signals={['flaky']} level={2} />
          <ListRow status="passed" path={['home', 'loads hero']} location="home.spec.ts:12" duration="0ms" signals={['quarantined']} level={2} />
        </div>
      </Block>

      <Block title="Detail sections">
        <div class="spec-panel">
          <Section title="Error" meta="expect.toHaveText">
            <ErrorMessage
              message={
                'Error: expect(locator).toHaveText(expected) failed\n\nLocator: getByRole(\'heading\')\nTimeout: 5000ms\nCall log:\n  - waiting for getByRole(\'heading\')'
              }
            />
          </Section>
          <Section title="Expected and received">
            <Diff expected={'"Order confirmed"'} received={'"Payment declined"'} />
          </Section>
          <Section title="Source">
            <CodeFrame
              file="tests/checkout.spec.ts"
              highlight={42}
              column={33}
              lines={[
                { n: 40, text: "  await page.getByRole('button', { name: 'Pay' }).click();" },
                { n: 41, text: '' },
                { n: 42, text: "  await expect(page.getByRole('heading')).toHaveText('Order confirmed');" },
                { n: 43, text: '});' },
              ]}
            />
          </Section>
          <Section title="History" meta="last 20 runs" open={false}>
            <OutcomeStrip label="Last 20 runs" runs={[]} />
          </Section>
        </div>
      </Block>

      <Block title="Charts">
        <Example label="Sparkline">
          <Sparkline label="Pass rate, last 12 runs" values={[92, 94, 91, 95, 96, 90, 88, 93, 97, 95, 89, 66]} />
          <Sparkline label="Duration, last 12 runs" values={[98, 102, 99, 101, 97, 110, 108, 104, 100, 99, 105, 102]} width={160} />
        </Example>
        <Example label="Stacked bar">
          <div class="spec-wide">
            <MiniBar
              segments={[
                { tone: 'pass', value: 37, label: 'passed' },
                { tone: 'fail', value: 13, label: 'failed' },
                { tone: 'flaky', value: 4, label: 'flaky' },
                { tone: 'skip', value: 2, label: 'skipped' },
              ]}
            />
          </div>
        </Example>
        <Example label="Outcome strip">
          <OutcomeStrip
            label="Last 20 runs: 14 passed, 4 flaky, 2 failed"
            runs={(['passed', 'passed', 'flaky', 'passed', 'passed', 'passed', 'failed', 'passed', 'flaky', 'passed', 'passed', 'passed', 'passed', 'flaky', 'passed', 'passed', 'flaky', 'passed', 'passed', 'failed'] as TestStatus[]).map((status) => ({ status }))}
          />
        </Example>
      </Block>

      <Block title="Overlays">
        <Example label="Triggers">
          <Menu
            label="Theme"
            items={[
              { id: 'system', label: 'System', group: 'Mode', checked: true },
              { id: 'light', label: 'Light', group: 'Mode', checked: false },
              { id: 'dark', label: 'Dark', group: 'Mode', checked: false },
              { id: 'hc', label: 'High contrast', group: 'Mode', checked: false },
            ]}
            onSelect={(id) => setToast(`Mode: ${id}`)}
          >
            Theme
          </Menu>
          <Button onClick={() => setDialog(true)}>Open dialog</Button>
          <Button onClick={() => setToast('Failure summary copied')}>Show toast</Button>
        </Example>
        <Dialog
          open={dialog}
          onClose={() => setDialog(false)}
          title="Export summary"
          footer={
            <>
              <Button onClick={() => setDialog(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => setDialog(false)}>
                Copy
              </Button>
            </>
          }
        >
          <div class="spec-dialog-body">
            <MiniBar
              segments={[
                { tone: 'pass', value: 37, label: 'passed' },
                { tone: 'fail', value: 13, label: 'failed' },
              ]}
            />
          </div>
        </Dialog>
        {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      </Block>

      <Block title="Empty state">
        <div class="spec-panel">
          <EmptyState title="No failures" action={<Button size="sm">Show flaky tests</Button>}>
            All 56 tests passed. 4 passed only after a retry.
          </EmptyState>
        </div>
      </Block>

      <Block title="Split pane">
        <div class="spec-split">
          <SplitPane initial={280} min={200} max={480} start={<div class="spec-fill">List</div>} end={<div class="spec-fill">Detail</div>} />
        </div>
      </Block>
    </main>
  );
}

const screen = params.get('screen');
render(screen ? <Screen name={screen} /> : <Specimen />, document.getElementById('app')!);
