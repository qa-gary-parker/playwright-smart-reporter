import { isFailing, isFlaky, titlePath } from './data';
import { failureSummary } from './detail-model';
import type { Route } from './router';
import { data, keymapOpen, multiProject, navigate, paletteOpen, queueOrder, railOpen, route, runTests, summaryOpen, testsById } from './store';
import { copyText } from './views/Detail';

const NUMBERED: Route[] = [
  { view: 'queue', queue: 'failures', q: '' },
  { view: 'queue', queue: 'all', q: '' },
  { view: 'insights' },
  { view: 'history', tab: 'trends' },
  { view: 'gallery' },
];

const CHORDS: Record<string, Route> = {
  f: { view: 'queue', queue: 'failures', q: '' },
  l: { view: 'queue', queue: 'flaky', q: '' },
  i: { view: 'insights' },
  h: { view: 'history', tab: 'trends' },
};

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

function overlayOpen(): boolean {
  return paletteOpen.value || keymapOpen.value || summaryOpen.value || !!document.querySelector('dialog[open]');
}

function selectRelative(ids: string[], dir: 1 | -1, current?: string): void {
  if (ids.length === 0) return;
  const i = current ? ids.indexOf(current) : -1;
  const next = ids[i < 0 ? (dir === 1 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, i + dir))];
  const r = route.value;
  if (r.view === 'queue' && queueOrder.value.includes(next)) navigate({ ...r, test: next }, true);
  else navigate({ view: 'queue', queue: 'all', q: '', test: next, ...(r.run ? { run: r.run } : {}) });
}

function cycle(predicate: (id: string) => boolean, dir: 1 | -1): void {
  const r = route.value;
  const current = r.view === 'queue' ? r.test : undefined;
  const order = queueOrder.value.filter(predicate);
  const ids = order.length ? order : runTests.value.map((t) => t.testId).filter(predicate);
  const i = current ? ids.indexOf(current) : -1;
  const next = i < 0 ? ids[dir === 1 ? 0 : ids.length - 1] : ids[(i + dir + ids.length) % ids.length];
  if (next) selectRelative([next], 1);
}

let chord: { key: string; at: number } | null = null;

export function onKeyDown(e: KeyboardEvent): void {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    paletteOpen.value = !paletteOpen.value;
    return;
  }
  if (mod && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    railOpen.value = !railOpen.value;
    return;
  }
  if (mod || e.altKey || typing(e.target) || overlayOpen()) return;

  const r = route.value;
  const current = r.view === 'queue' ? r.test : undefined;
  const byId = (id: string) => testsById.value.get(id);

  if (chord && chord.key === 'g' && Date.now() - chord.at < 1200) {
    chord = null;
    const to = CHORDS[e.key];
    if (to) {
      e.preventDefault();
      navigate(to);
    }
    return;
  }
  chord = null;

  switch (e.key) {
    case 'g':
      chord = { key: 'g', at: Date.now() };
      return;
    case 'j':
    case 'ArrowDown':
      if (r.view !== 'queue') return;
      e.preventDefault();
      selectRelative(queueOrder.value, 1, current);
      return;
    case 'k':
    case 'ArrowUp':
      if (r.view !== 'queue') return;
      e.preventDefault();
      selectRelative(queueOrder.value, -1, current);
      return;
    case ']':
    case 'f':
      cycle((id) => !!byId(id) && isFailing(byId(id)!), 1);
      return;
    case '[':
      cycle((id) => !!byId(id) && isFailing(byId(id)!), -1);
      return;
    case 'n':
      cycle((id) => !!byId(id) && isFlaky(byId(id)!), 1);
      return;
    case '/': {
      e.preventDefault();
      if (r.view !== 'queue') navigate({ view: 'queue', queue: 'all', q: '' });
      setTimeout(() => document.getElementById('filter-input')?.focus(), 0);
      return;
    }
    case 'c': {
      const t = current ? byId(current) : undefined;
      if (t && isFailing(t)) void copyText(failureSummary(t, titlePath(t, multiProject.value), data.value.meta.ci), 'Failure summary copied');
      return;
    }
    case 'e':
      summaryOpen.value = true;
      return;
    case '?':
      keymapOpen.value = true;
      return;
    case 'Escape':
      if (r.view === 'queue' && r.test && window.matchMedia('(max-width: 899px)').matches) navigate({ ...r, test: undefined });
      return;
    default:
      if (/^[1-5]$/.test(e.key)) navigate(NUMBERED[Number(e.key) - 1]);
  }
}
