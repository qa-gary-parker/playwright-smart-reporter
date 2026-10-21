import * as fs from 'fs';
import * as path from 'path';
import type { MetricsPushConfig, TestResultData } from '../types';
import { isSkippedTest } from '../utils/flakiness';
import { computeRunStats, retryWasteOf, type RunStats } from '../utils/run-stats';

export interface MetricsContext {
  duration: number;  // ms
  branch?: string;
  time: number;      // epoch ms the samples are for (OTLP only; Pushgateway rejects timestamped samples)
}

export interface Metric {
  name: string;
  help: string;
  unit: string;
  int: boolean;
  points: Array<{ labels: Record<string, string>; value: number }>;
}

const seconds = (ms: number) => Math.round(ms) / 1000;

// Label values are names (branch, project, file, test id). Like every other output, redact leaves names exact.
function labels(values: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter((e): e is [string, string] => !!e[1]));
}

/** One gauge per run figure, per suite (a project's test file); counts come from computeRunStats. */
export function buildMetrics(results: TestResultData[], ctx: Omit<MetricsContext, 'time'>): Metric[] {
  const suites = new Map<string, { labels: Record<string, string>; results: TestResultData[] }>();
  for (const r of results) {
    const suite = r.file.replace(/\\/g, '/');
    const key = `${r.project ?? ''}\n${suite}`;
    if (!suites.has(key)) suites.set(key, { labels: labels({ branch: ctx.branch, project: r.project, suite }), results: [] });
    suites.get(key)!.results.push(r);
  }
  const groups = [...suites.values()].map((s) => ({ ...s, stats: computeRunStats(s.results) }));
  const count = (name: string, help: string, of: keyof Pick<RunStats, 'total' | 'passed' | 'failed' | 'flaky' | 'skipped'>): Metric => ({
    name, help, unit: '{test}', int: true, points: groups.map((g) => ({ labels: g.labels, value: g.stats[of] })),
  });

  return [
    count('smart_reporter_tests', 'Tests in the run.', 'total'),
    count('smart_reporter_tests_passed', 'Tests that passed, passed on a retry, or failed as test.fail() expected.', 'passed'),
    count('smart_reporter_tests_failed', 'Tests that failed, including a test.fail() test that passed.', 'failed'),
    count('smart_reporter_tests_flaky', 'Tests that passed on a retry.', 'flaky'),
    count('smart_reporter_tests_skipped', 'Tests that did not run: skipped, never started, or interrupted.', 'skipped'),
    {
      name: 'smart_reporter_pass_ratio', help: 'Passed tests out of the tests that ran. No sample for a suite where no test ran.', unit: '1', int: false,
      points: groups.flatMap((g) => g.stats.passRatio === null ? [] : [{ labels: g.labels, value: g.stats.passRatio }]),
    },
    {
      name: 'smart_reporter_retry_waste_seconds', help: 'Time in the attempts that Playwright retried.', unit: 's', int: false,
      points: groups.map((g) => ({ labels: g.labels, value: seconds(g.results.reduce((sum, r) => sum + retryWasteOf(r), 0)) })),
    },
    {
      name: 'smart_reporter_run_duration_seconds', help: 'Duration of the run.', unit: 's', int: false,
      points: [{ labels: labels({ branch: ctx.branch }), value: seconds(ctx.duration) }],
    },
    {
      name: 'smart_reporter_test_duration_seconds', help: 'Duration of the last attempt of each test that ran.', unit: 's', int: false,
      points: groups.flatMap((g) => g.results.filter((r) => !isSkippedTest(r)).map((r) => ({ labels: { ...g.labels, test_id: r.testId }, value: seconds(r.duration) }))),
    },
  ].filter((m) => m.points.length > 0);
}

// https://prometheus.io/docs/instrumenting/exposition_formats/#text-format-details
const escapeLabel = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');

export function toPrometheus(metrics: Metric[]): string {
  return metrics.map((m) => [
    `# HELP ${m.name} ${m.help}`,
    `# TYPE ${m.name} gauge`,
    ...m.points.map((p) => {
      const set = Object.entries(p.labels).map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(',');
      return `${m.name}${set ? `{${set}}` : ''} ${p.value}`;
    }),
  ].join('\n') + '\n').join('');
}

// https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding: 64-bit integers are strings
export function toOtlp(metrics: Metric[], time: number) {
  const timeUnixNano = `${Math.round(time)}000000`;
  const name = 'playwright-smart-reporter';
  return {
    resourceMetrics: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: name } }] },
      scopeMetrics: [{
        scope: { name },
        metrics: metrics.map((m) => ({
          name: m.name,
          description: m.help,
          unit: m.unit,
          gauge: {
            dataPoints: m.points.map((p) => ({
              attributes: Object.entries(p.labels).map(([key, v]) => ({ key, value: { stringValue: v } })),
              timeUnixNano,
              ...(m.int ? { asInt: String(p.value) } : { asDouble: p.value }),
            })),
          },
        })),
      }],
    }],
  };
}

export function exportMetrics(results: TestResultData[], ctx: MetricsContext, outputDir: string, basename = 'smart-report') {
  const metrics = buildMetrics(results, ctx);
  const prometheus = toPrometheus(metrics);
  const otlp = JSON.stringify(toOtlp(metrics, ctx.time), null, 2);
  const files = [path.resolve(outputDir, `${basename}-metrics.prom`), path.resolve(outputDir, `${basename}-metrics.otlp.json`)];
  fs.writeFileSync(files[0], prometheus);
  fs.writeFileSync(files[1], otlp);
  return { prometheus, otlp, files };
}

/** Sends one of the bodies to the endpoint. Never throws: a failed push is logged and the run goes on. */
export async function pushMetrics(push: MetricsPushConfig, bodies: { prometheus: string; otlp: string }, timeoutMs = 10_000): Promise<void> {
  const otlp = push.format === 'otlp';
  try {
    const res = await fetch(push.url, {
      method: 'POST',
      headers: { 'Content-Type': otlp ? 'application/json' : 'text/plain; version=0.0.4', ...push.headers },
      body: otlp ? bodies.otlp : bodies.prometheus,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) console.log(`   Metrics pushed: HTTP ${res.status}`);
    else console.warn(`⚠️  Metrics push failed: HTTP ${res.status}`);
  } catch (err) {
    // fetch() hides the network error, such as ECONNREFUSED, in its cause
    const cause = (err as { cause?: unknown }).cause;
    console.warn(`⚠️  Metrics push failed: ${cause instanceof Error ? cause.message : err instanceof Error ? err.message : String(err)}`);
  }
}
