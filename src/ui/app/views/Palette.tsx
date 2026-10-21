import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Dialog, FilterToken, Icon, Kbd, StatusGlyph } from '../../components';
import { displayStatus, isFailing, location, suiteNames, titlePath, type ReportTest } from '../data';
import { QUEUES, QUEUE_IDS } from '../queues';
import type { Route } from '../router';
import { applyTheme, data, keymapOpen, multiProject, navigate, paletteOpen, route, runTests, summaryOpen, theme } from '../store';
import { exportCsv, exportJson } from './Exports';

interface Command {
  id: string;
  group: 'Tests' | 'Go to' | 'Filter' | 'Actions';
  label: string;
  hint?: string;
  kbd?: string;
  test?: ReportTest;
  token?: [string, string];
  run: () => void;
}

// Subsequence match; contiguous and early matches score higher.
export function fuzzyScore(needle: string, hay: string): number {
  const n = needle.toLowerCase();
  const h = hay.toLowerCase();
  if (!n) return 1;
  const idx = h.indexOf(n);
  if (idx >= 0) return 1000 - idx;
  let score = 0;
  let pos = -1;
  for (const ch of n) {
    const next = h.indexOf(ch, pos + 1);
    if (next < 0) return 0;
    score += next === pos + 1 ? 5 : 1;
    pos = next;
  }
  return score;
}

function gotoTargets(): Array<[string, Route, string?]> {
  const d = data.value;
  const f = d.config.features;
  return [
    ...QUEUE_IDS.map((id): [string, Route, string?] => [QUEUES[id].label, { view: 'queue', queue: id, q: '' }, id === 'failures' ? 'g f' : id === 'flaky' ? 'g l' : undefined]),
    ['Insights', { view: 'insights' }, 'g i'],
    ['History', { view: 'history', tab: f.trends ? 'trends' : 'heatmap' }, 'g h'],
    ...(f.gallery ? [['Gallery', { view: 'gallery' }] as [string, Route]] : []),
    ...(f.live ? [['Live', { view: 'live' }] as [string, Route]] : []),
    ...(d.coverage ? [['Coverage', { view: 'coverage' }] as [string, Route]] : []),
    ...(d.a11y ? [['Accessibility', { view: 'a11y' }] as [string, Route]] : []),
    ...(multiProject.value ? [['Matrix', { view: 'matrix' }] as [string, Route]] : []),
  ];
}

function buildCommands(query: string): Command[] {
  const close = () => (paletteOpen.value = false);
  const q = query.trim();
  const tests = runTests.value;
  const out: Command[] = [];

  const scored = tests
    .map((t) => ({ t, s: Math.max(fuzzyScore(q, titlePath(t, multiProject.value).join(' ')), fuzzyScore(q, t.file) * 0.8) + (isFailing(t) ? 0.5 : 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, q ? 8 : 5);
  for (const { t } of scored) {
    out.push({ id: `t:${t.testId}`, group: 'Tests', label: titlePath(t, multiProject.value).join(' › '), hint: location(t), test: t, run: () => (navigate({ view: 'queue', queue: isFailing(t) ? 'failures' : 'all', q: '', test: t.testId }), close()) });
  }

  for (const [label, to, kbd] of gotoTargets()) {
    if (fuzzyScore(q, label) > 0) out.push({ id: `g:${label}`, group: 'Go to', label, kbd, run: () => (navigate(to), close()) });
  }

  const values = new Map<string, Set<string>>([
    ['tag', new Set(tests.flatMap((t) => t.tags ?? []))],
    ['project', new Set(tests.map((t) => t.project).filter((p): p is string => !!p))],
    ['file', new Set(tests.map((t) => t.file))],
    ['suite', new Set(tests.flatMap(suiteNames))],
    ['owner', new Set(tests.flatMap((t) => t.owners ?? []))],
    ['grade', new Set(tests.map((t) => t.stabilityScore?.grade).filter((g): g is 'A' | 'B' | 'C' | 'D' | 'F' => !!g))],
    ['signal', new Set(tests.flatMap((t) => t.signals))],
    ['status', new Set(['failed', 'flaky', 'passed', 'skipped'])],
  ]);
  const filters: Command[] = [];
  for (const [key, set] of values) {
    for (const value of set) {
      if (q && fuzzyScore(q, `${key}:${value}`) > 0) {
        const r = route.value;
        const base = r.view === 'queue' ? r : ({ view: 'queue', queue: 'all', q: '' } as Extract<Route, { view: 'queue' }>);
        filters.push({ id: `f:${key}:${value}`, group: 'Filter', label: `${key}:${value}`, token: [key, value], run: () => (navigate({ ...base, q: `${base.q} ${key}:${/\s/.test(value) ? `"${value}"` : value}`.trim(), test: undefined }), close()) });
      }
    }
  }
  out.push(...filters.slice(0, 5));

  const actions: Array<[string, () => void, string?]> = [
    ['Summary card', () => (summaryOpen.value = true), 'e'],
    ['Export results as CSV', exportCsv],
    ['Export results as JSON', exportJson],
    ['Keyboard shortcuts', () => (keymapOpen.value = true), '?'],
    ...(['system', 'light', 'dark', 'hc'] as const).map((mode): [string, () => void] => [
      `Theme: ${mode === 'hc' ? 'high contrast' : mode}`,
      () => applyTheme({ ...theme.value, mode }),
    ]),
  ];
  for (const [label, fn, kbd] of actions) {
    if (fuzzyScore(q, label) > 0) out.push({ id: `a:${label}`, group: 'Actions', label, kbd, run: () => (close(), fn()) });
  }
  return out;
}

export function Palette() {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const open = paletteOpen.value;
  const commands = useMemo(() => buildCommands(query), [query, runTests.value, open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);
  useEffect(() => setActive(0), [query]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(commands.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commands[active]?.run();
    }
  };

  let lastGroup = '';
  return (
    <Dialog open={open} onClose={() => (paletteOpen.value = false)} title="Command palette" showTitle={false}>
      <div class="palette">
        <div class="palette__input">
          <Icon name="search" />
          <input
            ref={input}
            value={query}
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={onKey}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={commands[active] ? `pal-${active}` : undefined}
            aria-label="Search tests, views, filters, and actions"
            placeholder="Search tests, views, filters, actions"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div class="palette__results" id="palette-results" role="listbox" aria-label="Results">
          {commands.length === 0 && <p class="palette__empty">No matches.</p>}
          {commands.map((c, i) => {
            const header = c.group !== lastGroup ? <div class="palette__group" role="presentation">{c.group}</div> : null;
            lastGroup = c.group;
            return (
              <>
                {header}
                <div
                  id={`pal-${i}`}
                  class="palette__item"
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => c.run()}
                >
                  {c.test ? <StatusGlyph status={displayStatus(c.test)} /> : <Icon name={c.group === 'Filter' ? 'filter' : c.group === 'Go to' ? 'arrow-right' : 'command'} size={14} />}
                  <span class="palette__label">{c.token ? <FilterToken name={c.token[0]} value={c.token[1]} /> : c.label}</span>
                  {c.hint && <span class="mono faint palette__hint">{c.hint}</span>}
                  {c.kbd && <Kbd>{c.kbd}</Kbd>}
                </div>
              </>
            );
          })}
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
          <span class="palette__count">{data.value.tests.length} tests</span>
        </div>
      </div>
    </Dialog>
  );
}
