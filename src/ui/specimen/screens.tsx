import { Fragment, type ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { formatDuration } from '../../utils/formatters';
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
  Icon,
  IconButton,
  Kbd,
  ListRow,
  MiniBar,
  OutcomeStrip,
  Section,
  Sparkline,
  SplitPane,
  StatusGlyph,
  Tabs,
  statusLabel,
} from '../components';
import { FIXTURE, GREEN_FIXTURE, type Fixture, type FxTest } from './fixture';
import { Frame, isFailing, isFlaky, queueCounts } from './shell';

type Grouping = 'cluster' | 'file';

interface Group {
  key: string;
  label: string;
  meta?: string;
  mono: boolean;
  tests: FxTest[];
}

function group(tests: FxTest[], by: Grouping): Group[] {
  const map = new Map<string, FxTest[]>();
  for (const t of tests) {
    const key = by === 'cluster' ? (t.cluster ?? 'Other') : t.file;
    map.set(key, [...(map.get(key) ?? []), t]);
  }
  const rank = (ts: FxTest[]) => (ts.some((t) => t.signals.includes('new-failure')) ? 1000 : 0) + ts.length;
  return [...map.entries()]
    .sort((a, b) => rank(b[1]) - rank(a[1]))
    .map(([key, ts]) => ({
      key,
      label: key,
      meta: by === 'cluster' ? `${new Set(ts.map((t) => t.file)).size} files` : undefined,
      mono: true,
      tests: [...ts].sort((a, b) => Number(b.signals.includes('new-failure')) - Number(a.signals.includes('new-failure'))),
    }));
}

function TestList({
  title,
  tests,
  by,
  selected,
  onSelect,
  filter,
}: {
  title: string;
  tests: FxTest[];
  by: Grouping;
  selected?: string;
  onSelect: (id: string) => void;
  filter: Array<[string, string]>;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const groups = group(tests, by);
  return (
    <div class="pane">
      <div class="pane__head">
        <h1 class="pane__title">{title}</h1>
        <span class="pane__count">{tests.length}</span>
        <span class="pane__spacer" />
        <Button size="sm" variant="ghost" icon="layers">
          Group: {by}
        </Button>
      </div>
      <div class="filterbar">
        <Icon name="filter" size={14} />
        {filter.map(([k, v]) => (
          <FilterToken name={k} value={v} onRemove={() => {}} />
        ))}
        <input class="filterbar__input" placeholder="Filter by title, tag:, file:, project:" aria-label="Filter tests" />
        <Kbd>/</Kbd>
      </div>
      <div class="pane__scroll" role="tree" aria-label={title}>
        {groups.map((g) => {
          const open = !closed.has(g.key);
          return (
            <Fragment key={g.key}>
              <GroupHeader
                label={g.label}
                count={g.tests.length}
                meta={g.meta}
                mono={g.mono}
                expanded={open}
                onToggle={() => {
                  const next = new Set(closed);
                  if (open) next.add(g.key);
                  else next.delete(g.key);
                  setClosed(next);
                }}
              />
              {open &&
                g.tests.map((t) => (
                  <ListRow
                    status={t.status}
                    path={t.path}
                    location={`${t.file}${t.line ? `:${t.line}` : ''}`}
                    retries={t.attempts - 1}
                    duration={formatDuration(t.duration)}
                    signals={t.signals}
                    level={2}
                    selected={t.id === selected}
                    onSelect={() => onSelect(t.id)}
                  />
                ))}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function StackError({ message }: { message: string }) {
  const lines = message.split('\n');
  const [all, setAll] = useState(lines.length <= 14);
  return (
    <>
      <ErrorMessage message={all ? message : lines.slice(0, 12).join('\n')} />
      {!all && (
        <Button size="sm" variant="ghost" icon="chevron-down" onClick={() => setAll(true)}>
          Show all {lines.length} lines
        </Button>
      )}
    </>
  );
}

function Steps({ steps }: { steps: FxTest['steps'] }) {
  const max = Math.max(...steps.map((s) => s.duration), 1);
  return (
    <ol class="steps">
      {steps.map((s) => (
        <li class="step" data-failed={s.failed ? '' : undefined}>
          {s.failed ? <StatusGlyph status="failed" size={12} /> : <span class="step__dot" />}
          <span class="step__title mono">{s.title}</span>
          <span class="step__bar">
            <span style={{ width: `${(s.duration / max) * 100}%` }} />
          </span>
          <span class="step__dur mono">{formatDuration(s.duration)}</span>
        </li>
      ))}
    </ol>
  );
}

function Network({ entries }: { entries: NonNullable<FxTest['network']> }) {
  return (
    <div class="net" role="table" aria-label="Network requests">
      {entries.map((e) => (
        <div class="net__row" role="row" data-failed={e.status >= 400 ? '' : undefined}>
          <span role="cell" class="mono faint">
            {e.method}
          </span>
          <span role="cell" class="net__status mono">
            {e.status >= 400 && <StatusGlyph status="failed" size={12} />}
            {e.status}
          </span>
          <span role="cell" class="net__url mono">
            {e.url}
          </span>
          <span role="cell" class="net__dur mono">
            {formatDuration(e.duration)}
          </span>
        </div>
      ))}
    </div>
  );
}

function History({ t }: { t: FxTest }) {
  const passed = t.history.filter((r) => r.status === 'passed' || r.status === 'flaky').length;
  return (
    <div class="history">
      <OutcomeStrip
        label={`Last ${t.history.length} runs: ${passed} passed`}
        runs={t.history.map((r) => ({ status: r.status, title: `${statusLabel(r.status)} · ${formatDuration(r.duration)}` }))}
      />
      <div class="statline">
        <span>
          Passed <strong>{passed}</strong> of last {t.history.length}
        </span>
        <span>
          Avg <strong class="mono">{formatDuration(t.avgDuration ?? t.duration)}</strong>
        </span>
        <span>
          Flakiness <strong>{Math.round(t.flakiness * 100)}%</strong>
        </span>
        {t.grade && (
          <span>
            Grade <strong>{t.grade}</strong>
          </span>
        )}
        <Sparkline label="Duration, last runs" values={t.history.map((r) => r.duration)} width={120} />
      </div>
    </div>
  );
}

export function Detail({ t, onClose }: { t: FxTest; onClose?: () => void }) {
  const failing = isFailing(t);
  const att = t.attachments;
  const failedReq = t.network?.filter((n) => n.status >= 400).length ?? 0;
  return (
    <article class="detail" aria-label="Test detail">
      <header class="detail__head">
        <div class="detail__title-row">
          {onClose && <IconButton icon="chevron-left" label="Back to list" onClick={onClose} />}
          <StatusGlyph status={t.status} size={16} />
          <h2 class="detail__title">
            {t.path.slice(0, -1).map((p) => (
              <span class="detail__crumb">
                {p}
                <span class="row__sep">›</span>
              </span>
            ))}
            {t.path[t.path.length - 1]}
          </h2>
          <span class="detail__nav">
            <IconButton icon="chevron-up" label="Previous failure ([)" />
            <IconButton icon="chevron-down" label="Next failure (])" />
          </span>
        </div>
        <div class="detail__meta">
          <span class="mono">
            {t.file}
            {t.line ? `:${t.line}` : ''}
          </span>
          <span>{t.project}</span>
          <span class="mono">{formatDuration(t.duration)}</span>
          {t.attempts > 1 && <span>{t.attempts} attempts</span>}
          {t.signals.map((s) => (
            <span class="signal">{s === 'new-failure' ? 'New failure' : s[0].toUpperCase() + s.slice(1)}</span>
          ))}
          {t.tags.map((tag) => (
            <FilterToken name="tag" value={tag} />
          ))}
        </div>
        {failing && (
          <div class="detail__actions">
            <Button size="sm" icon="copy" kbd="c">
              Copy failure summary
            </Button>
            <Button size="sm" icon="bot">
              Copy AI prompt
            </Button>
            {att.traces > 0 && (
              <Button size="sm" icon="play">
                Open trace
              </Button>
            )}
          </div>
        )}
      </header>
      {t.error && (
        <Section title="Error">
          <StackError message={t.error} />
        </Section>
      )}
      {t.expected && t.received && (
        <Section title="Expected and received">
          <Diff expected={t.expected} received={t.received} />
        </Section>
      )}
      {t.code && (
        <Section title="Source" meta={<span class="mono">{t.code.file}</span>}>
          <CodeFrame lines={t.code.lines} highlight={t.code.highlight} column={t.code.column} />
        </Section>
      )}
      {failing && (
        <Section title="AI analysis" meta={t.ai ? 'claude-haiku-4-5' : undefined}>
          {t.ai ? (
            <p class="prose">{t.ai}</p>
          ) : (
            <p class="muted">
              No analysis for this run. Set <code>ANTHROPIC_API_KEY</code>, <code>OPENAI_API_KEY</code>, or <code>GEMINI_API_KEY</code>, or use Copy AI
              prompt.
            </p>
          )}
        </Section>
      )}
      {t.steps.length > 0 && (
        <Section title="Steps" meta={`${t.steps.length} steps`}>
          <Steps steps={t.steps} />
        </Section>
      )}
      {t.network && (
        <Section title="Network" meta={`${t.network.length} requests${failedReq ? ` · ${failedReq} failed` : ''}`}>
          <Network entries={t.network} />
        </Section>
      )}
      {t.console && (
        <Section title="Console" meta={`${t.console.filter((c) => c.level === 'error').length} error`}>
          <ul class="console">
            {t.console.map((c) => (
              <li class="console__line mono" data-level={c.level}>
                <span class="console__level">{c.level}</span>
                {c.text}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {att.screenshots + att.videos + att.traces > 0 && (
        <Section title="Attachments" meta={`${att.screenshots} screenshot · ${att.videos} video · ${att.traces} trace`}>
          <div class="attachments">
            {att.screenshots > 0 && (
              <button type="button" class="thumb">
                <Icon name="image" size={20} />
                <span class="mono">test-failed-1.png</span>
              </button>
            )}
            {att.videos > 0 && (
              <button type="button" class="thumb">
                <Icon name="film" size={20} />
                <span class="mono">video.webm</span>
              </button>
            )}
            {att.traces > 0 && (
              <button type="button" class="thumb">
                <Icon name="route" size={20} />
                <span class="mono">trace.zip</span>
              </button>
            )}
          </div>
        </Section>
      )}
      {t.history.length > 0 && (
        <Section title="History" meta={`last ${t.history.length} runs`}>
          <History t={t} />
        </Section>
      )}
    </article>
  );
}

function QueueScreen({
  fx,
  queue,
  title,
  tests,
  by,
  filter,
  narrow,
}: {
  fx: Fixture;
  queue: string;
  title: string;
  tests: FxTest[];
  by: Grouping;
  filter: Array<[string, string]>;
  narrow: boolean;
}) {
  const params = new URLSearchParams(location.search);
  const [selected, setSelected] = useState<string | undefined>(params.get('test') ?? (narrow ? undefined : tests[0]?.id));
  const [palette, setPalette] = useState(params.get('overlay') === 'palette');
  const current = tests.find((t) => t.id === selected);
  const list = <TestList title={title} tests={tests} by={by} selected={selected} onSelect={setSelected} filter={filter} />;
  const detail = current ? (
    <Detail t={current} onClose={narrow ? () => setSelected(undefined) : undefined} />
  ) : (
    <EmptyState title="Select a test" icon="mouse-pointer">
      Use <Kbd>j</Kbd> and <Kbd>k</Kbd> to move, <Kbd>↵</Kbd> to open.
    </EmptyState>
  );
  return (
    <Frame fx={fx} active={queue} onSearch={() => setPalette(true)}>
      {narrow ? (current ? detail : list) : <SplitPane initial={440} min={320} max={640} start={list} end={detail} label="Resize test list" />}
      <Palette open={palette} onClose={() => setPalette(false)} fx={fx} />
    </Frame>
  );
}

function Palette({ open, onClose, fx }: { open: boolean; onClose: () => void; fx: Fixture }) {
  const tests = fx.tests.filter(isFailing).slice(0, 3);
  return (
    <Dialog open={open} onClose={onClose} title="Command palette" showTitle={false}>
      <div class="palette">
        <div class="palette__input">
          <Icon name="search" />
          <input defaultValue="pay" aria-label="Search tests, views, and filters" />
          <Kbd>Esc</Kbd>
        </div>
        <div class="palette__results" role="listbox" aria-label="Results">
          <div class="palette__group">Tests</div>
          {tests.map((t, i) => (
            <div class="palette__item" role="option" aria-selected={i === 0}>
              <StatusGlyph status={t.status} />
              <span class="palette__label">{t.path[t.path.length - 1]}</span>
              <span class="mono faint palette__hint">{t.file}</span>
            </div>
          ))}
          <div class="palette__group">Go to</div>
          {[
            ['Failures', 'g f'],
            ['Flaky', 'g l'],
            ['Insights', 'g i'],
            ['History', 'g h'],
          ].map(([label, kbd]) => (
            <div class="palette__item" role="option" aria-selected={false}>
              <Icon name="arrow-right" size={14} />
              <span class="palette__label">{label}</span>
              <Kbd>{kbd}</Kbd>
            </div>
          ))}
          <div class="palette__group">Filter</div>
          <div class="palette__item" role="option" aria-selected={false}>
            <Icon name="filter" size={14} />
            <span class="palette__label">
              <FilterToken name="tag" value="@payments" />
            </span>
          </div>
        </div>
        <div class="palette__foot">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
          </span>
          <span>
            <Kbd>↵</Kbd> open
          </span>
          <span>
            <Kbd>Esc</Kbd> close
          </span>
        </div>
      </div>
    </Dialog>
  );
}

const KEYMAP: Array<[string, Array<[string, string]>]> = [
  [
    'Navigate',
    [
      ['j / k', 'Next or previous test'],
      ['↵', 'Open test'],
      ['[ / ]', 'Previous or next failure'],
      ['f / n', 'Next failure / next flaky'],
      ['Esc', 'Close or clear'],
    ],
  ],
  [
    'Go to',
    [
      ['g f', 'Failures'],
      ['g l', 'Flaky'],
      ['g i', 'Insights'],
      ['g h', 'History'],
      ['1 – 5', 'Failures, All tests, Insights, History, Gallery'],
    ],
  ],
  [
    'Actions',
    [
      ['⌘K', 'Command palette'],
      ['/', 'Filter tests'],
      ['c', 'Copy failure summary'],
      ['e', 'Export summary card'],
      ['⌘B', 'Toggle sidebar'],
      ['?', 'This list'],
    ],
  ],
];

function KeymapScreen({ fx }: { fx: Fixture }) {
  const [open, setOpen] = useState(true);
  return (
    <Frame fx={fx} active="failures">
      <Dialog open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" size="lg">
        <div class="keymap">
          {KEYMAP.map(([title, keys]) => (
            <section>
              <h3 class="keymap__title">{title}</h3>
              <dl class="keymap__list">
                {keys.map(([k, label]) => (
                  <>
                    <dt>
                      {k === '/' ? <Kbd>/</Kbd> : k.split(' ').map((part) => (part === '/' || part === '–' ? <span class="faint"> {part} </span> : <Kbd>{part}</Kbd>))}
                    </dt>
                    <dd>{label}</dd>
                  </>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </Dialog>
    </Frame>
  );
}

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

function TestLines({ tests, value }: { tests: FxTest[]; value: (t: FxTest) => string }) {
  if (tests.length === 0) return <p class="panel__empty">None this run.</p>;
  return (
    <ul class="lines">
      {tests.map((t) => (
        <li class="lines__item">
          <StatusGlyph status={t.status} />
          <span class="lines__label">{t.path[t.path.length - 1]}</span>
          <span class="lines__value mono">{value(t)}</span>
        </li>
      ))}
    </ul>
  );
}

function InsightsScreen({ fx }: { fx: Fixture }) {
  const s = fx.summaries;
  const last = s[s.length - 1];
  const c = queueCounts(fx);
  const clusters = group(fx.tests.filter(isFailing), 'cluster');
  const gate: Array<[string, string, boolean]> = [
    ['Pass rate ≥ 90%', `${last.passRate}%`, last.passRate >= 90],
    ['No new failures', `${fx.tests.filter((t) => t.signals.includes('new-failure')).length}`, false],
    ['Flaky ≤ 5', `${c.flaky}`, c.flaky <= 5],
  ];
  return (
    <Frame fx={fx} active="insights">
      <div class="page">
        <header class="page__head">
          <h1 class="page__title">Insights</h1>
          <span class="faint">Run of 1 Sep, 11:34 · compared with the previous 9 runs</span>
        </header>
        <div class="stats">
          <div class="stat">
            <span class="stat__label">Pass rate</span>
            <span class="stat__value">{last.passRate}%</span>
            <Sparkline label="Pass rate, last 10 runs" values={s.map((r) => r.passRate)} width={88} />
          </div>
          <div class="stat">
            <span class="stat__label">Duration</span>
            <span class="stat__value">{formatDuration(last.duration)}</span>
            <Sparkline label="Duration, last 10 runs" values={s.map((r) => r.duration)} width={88} />
          </div>
          <div class="stat">
            <span class="stat__label">Tests</span>
            <span class="stat__value">{fx.tests.length}</span>
            <span class="stat__sub">+1 new</span>
          </div>
          <div class="stat">
            <span class="stat__label">Flaky</span>
            <span class="stat__value">{c.flaky}</span>
            <Sparkline label="Flaky tests, last 10 runs" values={s.map((r) => r.flaky)} width={88} />
          </div>
          <div class="stat">
            <span class="stat__label">Health</span>
            <span class="stat__value">C</span>
            <span class="stat__sub">pass 66 · stability 86 · perf 96</span>
          </div>
        </div>
        <div class="stats-bar">
          <MiniBar
            segments={[
              { tone: 'pass', value: fx.tests.filter((t) => t.status === 'passed').length, label: 'passed' },
              { tone: 'fail', value: c.failures, label: 'failed' },
              { tone: 'flaky', value: fx.tests.filter((t) => t.status === 'flaky').length, label: 'flaky' },
              { tone: 'skip', value: fx.tests.filter((t) => t.status === 'skipped').length, label: 'skipped' },
            ]}
          />
        </div>
        <div class="panels">
          <Panel title="AI summary">
            <p class="panel__empty">
              Not configured. Set an AI provider key to get a plain-language summary of this run.
            </p>
          </Panel>
          <Panel title="Quality gate" meta="failed">
            <ul class="lines">
              {gate.map(([rule, value, ok]) => (
                <li class="lines__item">
                  <StatusGlyph status={ok ? 'passed' : 'failed'} />
                  <span class="lines__label">{rule}</span>
                  <span class="lines__value mono">{value}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Failure clusters" meta={`${clusters.length} clusters`}>
            <ul class="lines">
              {clusters.map((g) => (
                <li class="lines__item">
                  <span class="lines__label mono">{g.label}</span>
                  <span class="lines__value">
                    <Count status="failed" value={g.tests.length} label="" />
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Regressions">
            <TestLines tests={fx.tests.filter((t) => t.signals.includes('regression'))} value={(t) => `+${Math.round((t.duration / (t.avgDuration ?? t.duration) - 1) * 100)}%`} />
          </Panel>
          <Panel title="Slowest">
            <TestLines tests={[...fx.tests].sort((a, b) => b.duration - a.duration).slice(0, 5)} value={(t) => formatDuration(t.duration)} />
          </Panel>
          <Panel title="Most flaky">
            <TestLines
              tests={[...fx.tests].filter((t) => t.flakiness > 0 && t.flakiness < 1).sort((a, b) => b.flakiness - a.flakiness).slice(0, 5)}
              value={(t) => `${Math.round(t.flakiness * 100)}%`}
            />
          </Panel>
          <Panel title="Fixed">
            <TestLines tests={[]} value={() => ''} />
          </Panel>
          <Panel title="Quarantine">
            <p class="panel__empty">Not enabled for this project.</p>
          </Panel>
        </div>
      </div>
    </Frame>
  );
}

function TrendChart({
  title,
  values,
  dates,
  format,
  tone,
}: {
  title: string;
  values: number[];
  dates: string[];
  format: (v: number) => string;
  tone: string;
}) {
  const w = 320;
  const h = 96;
  const max = Math.max(...values, 1);
  const bw = w / values.length;
  return (
    <figure class="trend">
      <figcaption class="trend__head">
        <span class="trend__title">{title}</span>
        <span class="trend__value">{format(values[values.length - 1])}</span>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} class="trend__svg" role="img" aria-label={`${title}: ${values.map(format).join(', ')}`}>
        <line x1="0" x2={w} y1={h - 0.5} y2={h - 0.5} class="trend__axis" />
        {values.map((v, i) => (
          <rect
            x={i * bw + 3}
            width={bw - 6}
            y={h - (v / max) * (h - 8)}
            height={(v / max) * (h - 8)}
            rx="2"
            class={i === values.length - 1 ? `trend__bar trend__bar--last ${tone}` : 'trend__bar'}
          >
            <title>{format(v)}</title>
          </rect>
        ))}
      </svg>
      <div class="trend__dates" aria-hidden="true">
        <span>{dates[0]}</span>
        <span>{dates[dates.length - 1]}</span>
      </div>
    </figure>
  );
}

function HistoryScreen({ fx, tab: initial }: { fx: Fixture; tab: string }) {
  const [tab, setTab] = useState(initial);
  const s = fx.summaries;
  const prev = s[s.length - 2];
  const last = s[s.length - 1];
  const delta = (a: number, b: number, unit = '') => `${a - b >= 0 ? '+' : ''}${a - b}${unit}`;
  const newFailures = fx.tests.filter((t) => t.signals.includes('new-failure'));
  const dates = s.map((r) => new Date(r.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }));
  const regressions = fx.tests.filter((t) => t.signals.includes('regression'));
  return (
    <Frame fx={fx} active="history">
      <div class="page">
        <header class="page__head">
          <h1 class="page__title">History</h1>
          <span class="faint">Last {s.length} runs</span>
        </header>
        <Tabs
          label="History"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'trends', label: 'Trends' },
            { id: 'compare', label: 'Compare' },
          ]}
        />
        {tab === 'trends' ? (
          <div class="trends">
            <TrendChart title="Pass rate" values={s.map((r) => r.passRate)} dates={dates} format={(v) => `${v}%`} tone="tone-fail" />
            <TrendChart title="Duration" values={s.map((r) => r.duration)} dates={dates} format={formatDuration} tone="tone-skip" />
            <TrendChart title="Flaky tests" values={s.map((r) => r.flaky)} dates={dates} format={(v) => `${v}`} tone="tone-flaky" />
            <TrendChart title="Slow tests" values={s.map((r) => r.slow)} dates={dates} format={(v) => `${v}`} tone="tone-skip" />
          </div>
        ) : (
          <>
            <div class="stats">
              <div class="stat">
                <span class="stat__label">Pass rate</span>
                <span class="stat__value">{last.passRate}%</span>
                <span class="stat__sub">{delta(last.passRate, prev.passRate, ' pts')} vs previous</span>
              </div>
              <div class="stat">
                <span class="stat__label">Duration</span>
                <span class="stat__value">{formatDuration(last.duration)}</span>
                <span class="stat__sub">+{formatDuration(last.duration - prev.duration)} vs previous</span>
              </div>
              <div class="stat">
                <span class="stat__label">Tests</span>
                <span class="stat__value">{last.total}</span>
                <span class="stat__sub">{delta(last.total, prev.total)} vs previous</span>
              </div>
              <div class="stat">
                <span class="stat__label">Flaky</span>
                <span class="stat__value">{last.flaky}</span>
                <span class="stat__sub">{delta(last.flaky, prev.flaky)} vs previous</span>
              </div>
            </div>
            <div class="compare" role="tree" aria-label="Changes since previous run">
              {(
                [
                  ['New failures', newFailures],
                  ['Performance regressions', regressions],
                  ['Fixed', []],
                  ['New tests', []],
                ] as Array<[string, FxTest[]]>
              ).map(([label, tests]) => (
                <>
                  <GroupHeader label={label} count={tests.length} expanded onToggle={() => {}} />
                  {tests.map((t) => (
                    <ListRow
                      status={t.status}
                      path={t.path}
                      location={t.file}
                      duration={formatDuration(t.duration)}
                      signals={t.signals}
                      level={2}
                    />
                  ))}
                </>
              ))}
            </div>
          </>
        )}
      </div>
    </Frame>
  );
}

export function Screen({ name }: { name: string }) {
  const narrow = window.innerWidth < 900;
  const fx = name === 'green' ? GREEN_FIXTURE : FIXTURE;
  switch (name) {
    case 'failures':
      return (
        <QueueScreen fx={fx} queue="failures" title="Failures" tests={fx.tests.filter(isFailing)} by="cluster" filter={[['status', 'failed']]} narrow={narrow} />
      );
    case 'flaky':
    case 'green':
      return (
        <QueueScreen fx={fx} queue="flaky" title="Flaky" tests={fx.tests.filter(isFlaky)} by="file" filter={[['status', 'flaky']]} narrow={narrow} />
      );
    case 'all':
      return <QueueScreen fx={fx} queue="all" title="All tests" tests={fx.tests} by="file" filter={[]} narrow={narrow} />;
    case 'insights':
      return <InsightsScreen fx={fx} />;
    case 'history':
      return <HistoryScreen fx={fx} tab={new URLSearchParams(location.search).get('tab') ?? 'trends'} />;
    case 'keymap':
      return <KeymapScreen fx={fx} />;
    default:
      return (
        <Frame fx={fx} active={name}>
          <EmptyState title="Not part of the D2 screen set" icon="info">
            This view keeps its current behaviour until its roadmap phase.
          </EmptyState>
        </Frame>
      );
  }
}
