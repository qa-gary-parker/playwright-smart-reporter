import { GROUP_BYS, type GroupBy } from './grouping';
import { QUEUE_IDS, type QueueId } from './queues';

export type ViewRoute =
  | { view: 'queue'; queue: QueueId; test?: string; q: string; group?: GroupBy }
  | { view: 'insights' }
  | { view: 'history'; tab: HistoryTab }
  | { view: 'gallery' }
  | { view: 'live' }
  | { view: 'a11y' }
  | { view: 'coverage' };

export type Route = ViewRoute & { run?: string };

export const HISTORY_TABS = ['trends', 'heatmap', 'compare'] as const;
export type HistoryTab = (typeof HISTORY_TABS)[number];

export const DEFAULT_ROUTE: Route = { view: 'queue', queue: 'failures', q: '' };

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(queryPart);
  } catch {
    params = new URLSearchParams();
  }
  let segments = pathPart.split('/').filter(Boolean).map(safeDecode);
  let run: string | undefined;
  if (segments[0] === 'run' && segments[1]) {
    run = segments[1];
    segments = segments.slice(2);
  }
  const withRun = (r: ViewRoute): Route => (run ? { ...r, run } : r);
  const [head, arg] = segments;
  if (head === 'q' && (QUEUE_IDS as readonly string[]).includes(arg)) {
    const group = params.get('g');
    return withRun({
      view: 'queue',
      queue: arg as QueueId,
      q: params.get('q') ?? '',
      ...(params.get('test') ? { test: params.get('test')! } : {}),
      ...(group && (GROUP_BYS as readonly string[]).includes(group) ? { group: group as GroupBy } : {}),
    });
  }
  if (head === 'insights') return withRun({ view: 'insights' });
  if (head === 'history') return withRun({ view: 'history', tab: (HISTORY_TABS as readonly string[]).includes(arg) ? (arg as HistoryTab) : 'trends' });
  if (head === 'gallery') return withRun({ view: 'gallery' });
  if (head === 'live') return withRun({ view: 'live' });
  if (head === 'a11y') return withRun({ view: 'a11y' });
  if (head === 'coverage') return withRun({ view: 'coverage' });
  return withRun({ ...DEFAULT_ROUTE });
}

export function formatRoute(route: Route): string {
  const prefix = route.run ? `#/run/${encodeURIComponent(route.run)}` : '#';
  switch (route.view) {
    case 'queue': {
      const params = new URLSearchParams();
      if (route.test) params.set('test', route.test);
      if (route.q) params.set('q', route.q);
      if (route.group) params.set('g', route.group);
      const qs = params.toString();
      return `${prefix}/q/${route.queue}${qs ? `?${qs}` : ''}`;
    }
    case 'history':
      return `${prefix}/history/${route.tab}`;
    default:
      return `${prefix}/${route.view}`;
  }
}
