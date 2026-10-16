import { computed, signal } from '@preact/signals';
import type { ReportData, ReportTest } from './data';
import { hasMultipleProjects } from './data';
import { formatRoute, parseHash, type Route } from './router';

declare global {
  interface Window {
    __SMART_DATA__?: ReportData;
    openTraceModal?: (path: string) => void;
  }
}

export const data = signal<ReportData>(window.__SMART_DATA__ as ReportData);

// A view or tab whose feature is off, or that has no data, falls back instead of rendering.
export function reachable(r: Route): Route {
  const d = data.value;
  if (!d) return r;
  const f = d.config.features;
  if ((r.view === 'gallery' && !f.gallery) || (r.view === 'live' && !f.live) || (r.view === 'coverage' && !d.coverage) || (r.view === 'a11y' && !d.a11y)) {
    return { view: 'insights' };
  }
  if (r.view === 'history' && ((r.tab === 'trends' && !f.trends) || (r.tab === 'compare' && !f.comparison))) return { ...r, tab: 'heatmap' };
  return r;
}

export const route = signal<Route>(reachable(parseHash(location.hash)));
export const paletteOpen = signal(false);
export const keymapOpen = signal(false);
export const railOpen = signal(true);
export const toast = signal<string | null>(null);
export const summaryOpen = signal(false);
// Test ids in the order the current queue shows them, for keyboard navigation.
export const queueOrder = signal<string[]>([]);

window.addEventListener('hashchange', () => {
  const next = reachable(parseHash(location.hash));
  route.value = next;
  if (formatRoute(next) !== location.hash) location.replace(formatRoute(next));
});
if (route.value && formatRoute(route.value) !== location.hash && location.hash) location.replace(formatRoute(route.value));

export function navigate(next: Route, replace = false): void {
  next = reachable(next);
  const hash = formatRoute(next);
  route.value = next;
  if (location.hash === hash) return;
  if (replace) location.replace(hash);
  else location.hash = hash;
}

export function showToast(message: string): void {
  toast.value = message;
}

// Historical drilldown swaps in that run's snapshot; everything else keeps the current run.
export const runTests = computed<ReportTest[]>(() => {
  const run = route.value.run;
  const snapshot = run ? data.value.historySnapshots?.[run] : undefined;
  if (!snapshot) return data.value.tests;
  return Object.values(snapshot.tests).map((s) => ({
    ...s,
    outcome: s.status === 'failed' || s.status === 'timedOut' ? ('unexpected' as const) : s.status === 'skipped' || s.status === 'interrupted' ? ('skipped' as const) : ('expected' as const),
    history: [],
    signals: [],
  }));
});

export const multiProject = computed(() => hasMultipleProjects(data.value.tests));

export const testsById = computed(() => new Map(runTests.value.map((t) => [t.testId, t])));

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows and file:// can block storage; preferences then last for the session only.
  }
}

const SECTIONS_KEY = 'smart-reporter:sections';
export const sectionState = signal<Record<string, boolean>>(load(SECTIONS_KEY, {}));
export function setSection(title: string, open: boolean): void {
  sectionState.value = { ...sectionState.value, [title]: open };
  save(SECTIONS_KEY, sectionState.value);
}

const THEME_KEY = 'smart-reporter:theme';
const root = document.documentElement;
export const theme = signal<{ mode: string; accent: string }>(
  load(THEME_KEY, { mode: root.dataset.mode ?? 'system', accent: root.dataset.accent ?? 'default' }),
);

export function applyTheme(next: { mode: string; accent: string }, persist = true): void {
  theme.value = next;
  if (next.mode === 'system') delete root.dataset.mode;
  else root.dataset.mode = next.mode;
  if (next.accent === 'default') delete root.dataset.accent;
  else root.dataset.accent = next.accent;
  if (persist) save(THEME_KEY, next);
}
