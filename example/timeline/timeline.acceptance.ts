import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readTrace, resourceStartTime } from '../../src/collectors/trace-reader';
import type { CausalTimeline } from '../../src/types';

// Runs example/timeline through the built reporter (dist/) with traces on, then reads the
// JSON export. Needs `npm run build` and an installed Chromium; run with `npm run test:timeline`.
const ROOT = path.resolve(__dirname, '../..');
const CLI = path.join(ROOT, 'node_modules/@playwright/test/cli.js');
const CONFIG = path.join(__dirname, 'playwright.config.ts');

let out: string;
let timelines: Record<string, CausalTimeline | undefined>;

function runSuite(mode: 'baseline' | 'failure'): number | null {
  const run = spawnSync(process.execPath, [CLI, 'test', `--config=${CONFIG}`], {
    cwd: ROOT,
    env: { ...process.env, TIMELINE_OUT: out, TIMELINE_MODE: mode },
    encoding: 'utf8',
  });
  if (run.error) throw run.error;
  return run.status;
}

beforeAll(() => {
  if (!fs.existsSync(path.join(ROOT, 'dist/smart-reporter.js'))) throw new Error('dist/ is missing: run `npm run build` first');
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-timeline-'));
  // Two passing runs give every test.step the two samples slow-step detection needs.
  expect(runSuite('baseline')).toBe(0);
  expect(runSuite('baseline')).toBe(0);
  expect(runSuite('failure')).toBe(1);
  const report = JSON.parse(fs.readFileSync(path.join(out, 'smart-report-data.json'), 'utf8'));
  timelines = Object.fromEntries(report.tests.map((t: { title: string; timeline?: CausalTimeline }) => [t.title, t.timeline]));
}, 240_000);

afterAll(() => {
  if (out) fs.rmSync(out, { recursive: true, force: true });
});

function timelineOf(title: string): CausalTimeline {
  const timeline = timelines[title];
  if (!timeline) throw new Error(`no timeline for "${title}"`);
  return timeline;
}

const stepNamed = (timeline: CausalTimeline, title: string) => {
  const step = timeline.lanes.steps.find((s) => s.title === title);
  if (!step) throw new Error(`no step "${title}"`);
  return step;
};

describe('causal timeline on real failures', () => {
  it('suggests the 500 response for a test failing after an API error', () => {
    const timeline = timelineOf('orders API returns 500');

    expect(timeline.firstAnomaly?.kind).toBe('network-error');
    expect(timeline.firstAnomaly?.summary).toBe('GET http://timeline.test/api/orders returned 500');
    expect(timeline.lanes.network[timeline.firstAnomaly!.ref.index]).toMatchObject({ url: 'http://timeline.test/api/orders', status: 500 });
  });

  it('suggests the uncaught TypeError for a test failing after a page crash', () => {
    const timeline = timelineOf('orders payload throws a TypeError');

    expect(timeline.firstAnomaly?.kind).toBe('console-error');
    expect(timeline.firstAnomaly?.summary).toBe("Console error: Uncaught TypeError: Cannot read properties of undefined (reading 'map')");
  });

  it('suggests the slow step for a test that ran out of time later on', () => {
    const timeline = timelineOf('slow orders API exhausts the test timeout');

    expect(timeline.firstAnomaly?.kind).toBe('slow-step');
    expect(timeline.lanes.steps[timeline.firstAnomaly!.ref.index].title).toBe('load orders');
    expect(stepNamed(timeline, 'open first order').failed).toBe(true);
  });

  it('claims no anomaly when nothing unusual preceded the failure, and still builds the timeline', () => {
    const timeline = timelineOf('heading assertion fails with nothing unusual before it');

    expect('firstAnomaly' in timeline).toBe(false);
    expect(timeline.lanes.steps.filter((s) => s.category === 'test.step').map((s) => s.title)).toEqual(['open app', 'load orders']);
    expect(timeline.lanes.network.map((r) => [r.url, r.status])).toEqual([
      ['http://timeline.test/', 200],
      ['http://timeline.test/api/orders', 200],
    ]);
  });

  it('feeds each suggestion into the AI prompt under a heuristic label, and only those three', () => {
    const html = fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8');

    expect(html.split('# Possible first anomaly (heuristic)').length - 1).toBe(3);
  });

  it('places trace events inside the steps that caused them', () => {
    const api = timelineOf('orders API returns 500');
    const request = api.lanes.network.find((r) => r.url.endsWith('/api/orders'))!;
    expect(request.start).toBeGreaterThanOrEqual(stepNamed(api, "Click locator('#load')").start);
    expect(request.start).toBeLessThanOrEqual(stepNamed(api, 'load orders').end);

    const crash = timelineOf('orders payload throws a TypeError');
    const pageError = crash.lanes.console.find((c) => c.text.startsWith('Uncaught TypeError'))!;
    const failingExpect = crash.lanes.steps.find((s) => s.category === 'expect' && s.failed)!;
    expect(pageError.at).toBeGreaterThanOrEqual(stepNamed(crash, 'load orders').start);
    expect(pageError.at).toBeLessThanOrEqual(failingExpect.end);
  });

  it('converts trace monotonic time to the same wall clock the request log records', () => {
    const resultsDir = path.join(out, 'test-results');
    const traces = fs.readdirSync(resultsDir).map((d) => path.join(resultsDir, d, 'trace.zip')).filter((f) => fs.existsSync(f));
    expect(traces).toHaveLength(4);

    let checked = 0;
    for (const file of traces) {
      for (const context of readTrace(file, { timeline: true }).contexts) {
        expect(context.clock).toBeDefined();
        for (const snapshot of context.resources) {
          const fromMonotonic = resourceStartTime(snapshot, context.clock)!;
          // startedDateTime is an ISO string with ms precision.
          expect(Math.abs(fromMonotonic - Date.parse(snapshot.startedDateTime))).toBeLessThanOrEqual(1);
          checked++;
        }
      }
    }
    expect(checked).toBe(9);
  });
});
