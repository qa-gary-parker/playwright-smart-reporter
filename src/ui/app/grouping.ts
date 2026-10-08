import { isFailing, type ReportData, type ReportTest } from './data';

export const GROUP_BYS = ['cluster', 'file', 'project', 'suite', 'tag', 'status', 'grade', 'owner', 'none'] as const;
export type GroupBy = (typeof GROUP_BYS)[number];

export interface Group {
  key: string;
  label: string;
  mono: boolean;
  tests: ReportTest[];
}

interface Grouping {
  label: string;
  mono: boolean;
  keys: (t: ReportTest, clusters: Map<string, string>) => string[];
}

const NONE = '(none)';

export const GROUPINGS: Record<GroupBy, Grouping> = {
  cluster: { label: 'Cluster', mono: true, keys: (t, c) => [(t.clusterId && c.get(t.clusterId)) || 'Not clustered'] },
  file: { label: 'File', mono: true, keys: (t) => [t.file] },
  project: { label: 'Project', mono: false, keys: (t) => [t.project ?? NONE] },
  suite: { label: 'Suite', mono: false, keys: (t) => [t.suites?.length ? t.suites.join(' › ') : NONE] },
  tag: { label: 'Tag', mono: true, keys: (t) => (t.tags?.length ? t.tags : [NONE]) },
  status: { label: 'Status', mono: false, keys: (t) => [isFailing(t) ? 'failed' : t.outcome === 'flaky' ? 'flaky' : t.status] },
  grade: { label: 'Grade', mono: false, keys: (t) => [t.stabilityScore ? `Grade ${t.stabilityScore.grade}` : NONE] },
  owner: { label: 'Owner', mono: true, keys: (t) => t.owners?.slice(0, 1) ?? ['Unowned'] },
  none: { label: 'None', mono: false, keys: () => [''] },
};

function rank(tests: ReportTest[]): number[] {
  return [
    tests.some((t) => t.signals.includes('new-failure')) ? 1 : 0,
    tests.filter(isFailing).length,
    tests.length,
  ];
}

function byPriority(a: ReportTest, b: ReportTest): number {
  const score = (t: ReportTest) =>
    (t.signals.includes('new-failure') ? 8 : 0) + (isFailing(t) ? 4 : 0) + (t.signals.includes('regression') ? 2 : 0) + (t.signals.includes('flaky') ? 1 : 0);
  return score(b) - score(a);
}

export function groupTests(tests: ReportTest[], by: GroupBy, data: Pick<ReportData, 'clusters'>): Group[] {
  const clusters = new Map(data.clusters.map((c) => [c.id, c.errorType]));
  const grouping = GROUPINGS[by];
  const map = new Map<string, ReportTest[]>();
  for (const t of tests) {
    for (const key of grouping.keys(t, clusters)) map.set(key, [...(map.get(key) ?? []), t]);
  }
  return [...map.entries()]
    .map(([key, ts]) => ({ key, label: key, mono: grouping.mono, tests: [...ts].sort(byPriority) }))
    .sort((a, b) => {
      const [ra, rb] = [rank(a.tests), rank(b.tests)];
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i];
      return a.label.localeCompare(b.label);
    });
}
