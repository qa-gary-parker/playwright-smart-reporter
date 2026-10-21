import { failure, type GhFailure, type GhRunner } from './pr-comment';

// A broken suite can start dozens of clusters at once, so a run files only its largest few.
export const MAX_ISSUES = 5;

const MARKER_PREFIX = '<!-- playwright-smart-reporter cluster:';
const MARKER = /<!-- playwright-smart-reporter cluster:([0-9a-f]+) -->/;

export const clusterMarker = (clusterId: string) => `${MARKER_PREFIX}${clusterId} -->`;

export interface ClusterIssue {
  clusterId: string;
  title: string;
  body: string;
}

export interface FiledIssue {
  clusterId: string;
  number: number;
  outcome: 'created' | 'commented';
}

/** Comments on the open issue that carries the cluster's marker, or creates one, so each cluster has one open issue. */
export function fileClusterIssues(repo: string, issues: ClusterIssue[], gh: GhRunner): { filed: FiledIssue[]; error?: GhFailure } {
  const filed: FiledIssue[] = [];
  const list = gh(['api', '--paginate', `repos/${repo}/issues?state=open&per_page=100`, '--jq', `.[] | select(.body // "" | contains("${MARKER_PREFIX}")) | {number, body}`]);
  if (list.status !== 0) return { filed, error: failure(list) };

  const open = new Map<string, number>();
  for (const line of list.stdout.split('\n').filter((l) => l.trim())) {
    const issue = JSON.parse(line) as { number: number; body: string };
    const id = MARKER.exec(issue.body)?.[1];
    if (id && !open.has(id)) open.set(id, issue.number);
  }

  for (const { clusterId, title, body } of issues) {
    const existing = open.get(clusterId);
    const write = existing
      ? gh(['api', '--method', 'POST', `repos/${repo}/issues/${existing}/comments`, '--input', '-'], JSON.stringify({ body }))
      : gh(['api', '--method', 'POST', `repos/${repo}/issues`, '--input', '-', '--jq', '.number'], JSON.stringify({ title, body: `${clusterMarker(clusterId)}\n${body}` }));
    if (write.status !== 0) return { filed, error: failure(write) };
    filed.push(existing
      ? { clusterId, number: existing, outcome: 'commented' }
      : { clusterId, number: Number(write.stdout.trim()), outcome: 'created' });
  }
  return { filed };
}
