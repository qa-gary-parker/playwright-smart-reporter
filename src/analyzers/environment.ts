import type { EnvironmentInsight, TestResultData } from '../types';
import { isFailedTest, isSkippedTest } from '../utils/flakiness';

/** The same test in every project: its id without the "[project] " prefix. */
export function environmentRowKey(t: Pick<TestResultData, 'testId' | 'project'>): string {
  const prefix = `[${t.project}] `;
  return t.project && t.testId.startsWith(prefix) ? t.testId.slice(prefix.length) : t.testId;
}

/** The worker slot (parallelIndex) the final attempt ran on. */
export function workerSlot(t: Pick<TestResultData, 'attempts'>): number | undefined {
  return t.attempts?.[t.attempts.length - 1]?.parallelIndex;
}

type Dimension = [EnvironmentInsight['dimension'], (r: TestResultData) => string | undefined];

/**
 * Failures that point at an environment: a test that fails in one project or browser and passes in the others,
 * or every failure on one worker slot. A merged report has no worker insight: merge-reports mixes the slots of every shard.
 */
export function environmentInsights(results: TestResultData[], merged: boolean): EnvironmentInsight[] {
  const ran = results.filter((r) => !isSkippedTest(r));
  const insights: EnvironmentInsight[] = [];
  const browserProjects = new Map<string, Set<string>>();
  for (const r of ran) if (r.browser && r.project) browserProjects.set(r.browser, (browserProjects.get(r.browser) ?? new Set()).add(r.project));
  const dimensions: Dimension[] = [['project', (r) => r.project]];
  // A browser that runs in one project only repeats the project insight
  if ([...browserProjects.values()].some((projects) => projects.size > 1)) dimensions.push(['browser', (r) => r.browser]);

  for (const [dimension, valueOf] of dimensions) {
    const failedIn = new Map<string, Map<string, boolean>>(); // test -> value -> failed there
    for (const r of ran) {
      const value = valueOf(r);
      if (!value) continue;
      const row = failedIn.get(environmentRowKey(r)) ?? new Map<string, boolean>();
      failedIn.set(environmentRowKey(r), row.set(value, row.get(value) === true || isFailedTest(r)));
    }
    const only = new Map<string, { tests: Set<string>; testIds: string[] }>();
    for (const r of ran) {
      const value = valueOf(r);
      const row = failedIn.get(environmentRowKey(r));
      if (!value || !row || row.size < 2 || !isFailedTest(r) || [...row.values()].filter(Boolean).length !== 1) continue;
      const entry = only.get(value) ?? { tests: new Set<string>(), testIds: [] };
      entry.tests.add(environmentRowKey(r));
      entry.testIds.push(r.testId);
      only.set(value, entry);
    }
    for (const [value, { tests, testIds }] of only) {
      insights.push({ dimension, value, testIds, text: `${tests.size === 1 ? '1 test fails' : `${tests.size} tests fail`} on ${value} only` });
    }
  }

  const failures = ran.filter(isFailedTest);
  const failedSlots = new Set(failures.map(workerSlot));
  const [slot] = failedSlots;
  if (!merged && failures.length >= 2 && failedSlots.size === 1 && slot !== undefined && new Set(ran.map(workerSlot)).size >= 2) {
    insights.push({ dimension: 'worker', value: String(slot), testIds: failures.map((r) => r.testId), text: `All ${failures.length} failures ran on worker ${slot}` });
  }
  return insights;
}
