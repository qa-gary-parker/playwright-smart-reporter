import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Button, EmptyState, FilterToken, GroupHeader, Icon, Kbd, ListRow, Menu, SplitPane, type Signal } from '../../components';
import { displayStatus, formatDuration, location, titlePath, type ReportTest } from '../data';
import { formatQuery, matchesQuery, parseQuery } from '../filters';
import { GROUP_BYS, GROUPINGS, groupTests, type GroupBy } from '../grouping';
import { QUEUES, type QueueId } from '../queues';
import type { Route } from '../router';
import { data, multiProject, navigate, queueOrder, route, runTests } from '../store';
import { Detail } from './Detail';

const ROW = 32;
const GROUP = 28;
const OVERSCAN = 12;

type Item = { kind: 'group'; key: string; label: string; count: number; mono: boolean; open: boolean } | { kind: 'test'; test: ReportTest; group: string };

const ROW_SIGNALS: Signal[] = ['new-failure', 'regression', 'flaky', 'quarantined', 'slow'];

export interface QueueModel {
  queue: QueueId;
  tests: ReportTest[];
  items: Item[];
  order: ReportTest[];
}

export function useQueueModel(queue: QueueId, q: string, group: GroupBy | undefined, closed: Set<string>): QueueModel {
  const all = runTests.value;
  return useMemo(() => {
    const query = parseQuery(q);
    const tests = all.filter((t) => QUEUES[queue].includes(t) && matchesQuery(t, query));
    const by = group ?? QUEUES[queue].groupBy;
    const items: Item[] = [];
    const order: ReportTest[] = [];
    const seen = new Set<string>();
    for (const g of groupTests(tests, by, data.value)) {
      const open = !closed.has(g.key);
      if (by !== 'none') items.push({ kind: 'group', key: g.key, label: g.label, count: g.tests.length, mono: g.mono, open });
      if (open || by === 'none') {
        for (const t of g.tests) {
          items.push({ kind: 'test', test: t, group: g.key });
          // A test can sit in several tag groups; keyboard order visits it once.
          if (!seen.has(t.testId)) {
            seen.add(t.testId);
            order.push(t);
          }
        }
      }
    }
    return { queue, tests, items, order };
  }, [all, queue, q, group, closed]);
}

function FilterBar({ q, onChange }: { q: string; onChange: (q: string) => void }) {
  const query = parseQuery(q);
  const [draft, setDraft] = useState(query.text);
  useEffect(() => setDraft(query.text), [q]);
  const commit = (text: string) => onChange(formatQuery({ tokens: [...query.tokens, ...parseQuery(text).tokens], text: parseQuery(text).text }));
  return (
    <div class="filterbar" role="search">
      <Icon name="filter" size={14} />
      {query.tokens.map((tok) => (
        <FilterToken
          name={tok.key}
          value={tok.value}
          onRemove={() => onChange(formatQuery({ tokens: query.tokens.filter((x) => x !== tok), text: query.text }))}
        />
      ))}
      <input
        id="filter-input"
        class="filterbar__input"
        placeholder="Filter: text, status:, tag:, file:, project:, owner:"
        aria-label="Filter tests"
        value={draft}
        onInput={(e) => {
          const text = (e.currentTarget as HTMLInputElement).value;
          setDraft(text);
          if (!/\S+:\S*$/.test(text)) commit(text);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(draft);
          if (e.key === 'Backspace' && !draft && query.tokens.length) {
            onChange(formatQuery({ tokens: query.tokens.slice(0, -1), text: '' }));
          }
          if (e.key === 'Escape') {
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
      />
      <Kbd>/</Kbd>
    </div>
  );
}

function TestTree({ model, selected, onSelect, label }: { model: QueueModel; selected?: string; onSelect: (id: string) => void; label: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(800);

  const offsets = useMemo(() => {
    const out = new Array<number>(model.items.length + 1);
    out[0] = 0;
    model.items.forEach((it, i) => (out[i + 1] = out[i] + (it.kind === 'group' ? GROUP : ROW)));
    return out;
  }, [model.items]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scroll only when the selection changes, not when groups collapse or filters change.
  const latest = useRef({ items: model.items, offsets });
  latest.current = { items: model.items, offsets };
  useEffect(() => {
    const el = scroller.current;
    const { items, offsets: offs } = latest.current;
    const i = items.findIndex((it) => it.kind === 'test' && it.test.testId === selected);
    if (!el || i < 0) return;
    const top = offs[i];
    if (top < el.scrollTop) el.scrollTop = top - GROUP;
    else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight;
  }, [selected]);

  let first = 0;
  let lo = 0;
  let hi = model.items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1] <= scrollTop) lo = mid + 1;
    else hi = mid;
  }
  first = Math.max(0, lo - OVERSCAN);
  let last = lo;
  while (last < model.items.length && offsets[last] < scrollTop + height) last++;
  last = Math.min(model.items.length, last + OVERSCAN);

  const toggle = (key: string) => {
    window.dispatchEvent(new CustomEvent('smart:toggle-group', { detail: key }));
  };

  return (
    <div class="pane__scroll" ref={scroller} role="tree" aria-label={label} onScroll={(e) => setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}>
      <div class="vlist" style={{ height: `${offsets[model.items.length]}px` }}>
        {model.items.slice(first, last).map((it, k) => {
          const i = first + k;
          return (
            <div class="vlist__item" style={{ transform: `translateY(${offsets[i]}px)` }} key={it.kind === 'group' ? `g:${it.key}` : `t:${it.group}:${it.test.testId}`}>
              {it.kind === 'group' ? (
                <GroupHeader label={it.label} count={it.count} mono={it.mono} expanded={it.open} onToggle={() => toggle(it.key)} />
              ) : (
                <ListRow
                  status={displayStatus(it.test)}
                  path={titlePath(it.test, multiProject.value)}
                  location={location(it.test)}
                  retries={it.test.retry}
                  duration={formatDuration(it.test.duration)}
                  signals={it.test.signals.filter((s): s is Signal => (ROW_SIGNALS as string[]).includes(s))}
                  level={2}
                  selected={it.test.testId === selected}
                  onSelect={() => onSelect(it.test.testId)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type QueueRoute = Extract<Route, { view: 'queue' }>;

export function QueueView({ narrow }: { narrow: boolean }) {
  // App renders this view only for queue routes.
  const r = route.value as QueueRoute;
  const [closed, setClosed] = useState<Set<string>>(new Set());
  useEffect(() => setClosed(new Set()), [r.queue, r.group]);
  useEffect(() => {
    const onToggle = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      setClosed((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    };
    window.addEventListener('smart:toggle-group', onToggle);
    return () => window.removeEventListener('smart:toggle-group', onToggle);
  }, []);

  const model = useQueueModel(r.queue, r.q, r.group, closed);
  const queue = QUEUES[r.queue];
  const by = r.group ?? queue.groupBy;
  const selectedId = r.test ?? (narrow ? undefined : model.order[0]?.testId);
  const selected = selectedId ? model.tests.find((t) => t.testId === selectedId) ?? runTests.value.find((t) => t.testId === selectedId) : undefined;

  useEffect(() => {
    if (!narrow && !r.test && model.order[0]) navigate({ ...r, test: model.order[0].testId }, true);
  }, [r.queue, r.q, narrow]);

  useEffect(() => {
    queueOrder.value = model.order.map((t) => t.testId);
  }, [model]);

  const select = (id: string) => navigate({ ...r, test: id }, !narrow);
  const step = (dir: 1 | -1) => {
    const i = model.order.findIndex((t) => t.testId === selectedId);
    const next = model.order[i + dir];
    if (next) select(next.testId);
  };

  const list = (
    <div class="pane">
      <div class="pane__head">
        <h1 class="pane__title">{queue.label}</h1>
        <span class="pane__count">{model.tests.length}</span>
        <span class="pane__spacer" />
        <Menu
          label="Group by"
          triggerClass="btn btn--ghost btn--sm"
          items={GROUP_BYS.map((g) => ({ id: g, label: GROUPINGS[g].label, checked: g === by }))}
          onSelect={(id) => navigate({ ...r, group: id as GroupBy, test: undefined })}
        >
          <Icon name="layers" size={14} />
          <span>Group: {GROUPINGS[by].label.toLowerCase()}</span>
        </Menu>
      </div>
      <FilterBar q={r.q} onChange={(q) => navigate({ ...r, q, test: undefined }, true)} />
      {model.tests.length === 0 ? (
        <EmptyState title={r.q ? 'No tests match this filter' : queue.empty} icon={r.q ? 'filter' : 'inbox'} action={r.q ? <Button size="sm" onClick={() => navigate({ ...r, q: '' })}>Clear filter</Button> : undefined} />
      ) : (
        <TestTree model={model} selected={selectedId} onSelect={select} label={queue.label} />
      )}
    </div>
  );

  const detail = selected ? (
    <Detail key={selected.testId} t={selected} onBack={narrow ? () => navigate({ ...r, test: undefined }) : undefined} onStep={step} />
  ) : (
    <EmptyState title="Select a test" icon="mouse-pointer">
      Use <Kbd>j</Kbd> and <Kbd>k</Kbd> to move, <Kbd>↵</Kbd> to open.
    </EmptyState>
  );

  if (narrow) return r.test && selected ? detail : list;
  return <SplitPane initial={440} min={320} max={720} start={list} end={detail} label="Resize test list" />;
}
