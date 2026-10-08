import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { readTrace, resourceStartTime } from './trace-reader';

const WALL = 1_700_000_000_000;
const MONO = 1_000;

const contextOptions = (extra: Record<string, unknown> = { wallTime: WALL, monotonicTime: MONO }) =>
  JSON.stringify({ version: 8, type: 'context-options', origin: 'library', browserName: 'chromium', ...extra });
const consoleLine = (messageType: string, text: string, time: number) =>
  JSON.stringify({ type: 'console', messageType, text, args: [], location: { url: '', lineNumber: 0, columnNumber: 0 }, time, pageId: 'page@1' });
const pageErrorLine = (time: number, error: Record<string, unknown>) =>
  JSON.stringify({ type: 'event', time, class: 'BrowserContext', method: 'pageError', params: { error }, pageId: 'page@1' });
const resourceLine = (url: string, monotonicTime: number) =>
  JSON.stringify({
    type: 'resource-snapshot',
    snapshot: {
      startedDateTime: new Date(WALL + monotonicTime - MONO).toISOString(),
      time: 12,
      request: { method: 'GET', url },
      response: { status: 200 },
      _monotonicTime: monotonicTime,
    },
  });

describe('readTrace', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-reader-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeZip(files: Record<string, string[]>): string {
    const zip = new AdmZip();
    for (const [name, lines] of Object.entries(files)) zip.addFile(name, Buffer.from(lines.join('\n'), 'utf8'));
    const file = path.join(dir, 'trace.zip');
    zip.writeZip(file);
    return file;
  }

  it('returns no contexts when the trace file does not exist', () => {
    expect(readTrace(path.join(dir, 'missing.zip'), { timeline: true })).toEqual({ contexts: [] });
  });

  it('reads only the first context network without the timeline flag', () => {
    const file = writeZip({
      '0-trace.trace': [contextOptions(), consoleLine('error', 'ignored', 1_100)],
      '0-trace.network': [resourceLine('http://a.test/0', 1_050)],
      '1-trace.network': [resourceLine('http://a.test/1', 1_060)],
    });

    const { contexts } = readTrace(file);

    expect(contexts).toHaveLength(1);
    expect(contexts[0].resources.map((r) => r.request.url)).toEqual(['http://a.test/0']);
    expect(contexts[0].console).toEqual([]);
    expect(contexts[0].clock).toBeUndefined();
  });

  it('reads every context, its clock anchor, console messages and page errors with the timeline flag', () => {
    const file = writeZip({
      '0-trace.trace': [
        contextOptions(),
        JSON.stringify({ type: 'frame-snapshot', snapshot: { html: ['P', {}, '{"type":"console"}'] } }),
        consoleLine('log', 'hello', 1_250.5),
        pageErrorLine(1_400, { error: { name: 'TypeError', message: "Cannot read properties of undefined (reading 'map')", stack: '' } }),
      ],
      '0-trace.network': [resourceLine('http://a.test/0', 1_050)],
      '1-trace.trace': [contextOptions({ wallTime: WALL + 500, monotonicTime: 1_480 }), consoleLine('error', 'second context', 1_500)],
      '1-trace.network': [],
    });

    const { contexts } = readTrace(file, { timeline: true });

    expect(contexts).toHaveLength(2);
    expect(contexts[0].clock).toEqual({ wallTime: WALL, monotonicTime: MONO });
    expect(contexts[0].console).toEqual([
      { time: WALL + 250.5, level: 'log', text: 'hello' },
      { time: WALL + 400, level: 'error', text: "Uncaught TypeError: Cannot read properties of undefined (reading 'map')" },
    ]);
    expect(contexts[1].console).toEqual([{ time: WALL + 520, level: 'error', text: 'second context' }]);
    expect(contexts[1].resources).toEqual([]);
  });

  it('reports a thrown non-Error value as an uncaught page error', () => {
    const file = writeZip({ '0-trace.trace': [contextOptions(), pageErrorLine(1_010, { value: 'plain string' })] });

    expect(readTrace(file, { timeline: true }).contexts[0].console).toEqual([
      { time: WALL + 10, level: 'error', text: 'Uncaught plain string' },
    ]);
  });

  it('drops console events when the trace has no monotonic clock anchor, since they cannot be aligned', () => {
    const file = writeZip({
      '0-trace.trace': [contextOptions({ wallTime: WALL }), consoleLine('error', 'unaligned', 1_100)],
      '0-trace.network': [resourceLine('http://a.test/0', 1_050)],
    });

    const [context] = readTrace(file, { timeline: true }).contexts;

    expect(context.clock).toBeUndefined();
    expect(context.console).toEqual([]);
    expect(context.resources).toHaveLength(1);
  });
});

describe('resourceStartTime', () => {
  it('converts the monotonic request start with the context clock', () => {
    const snapshot = { startedDateTime: '2000-01-01T00:00:00.000Z', _monotonicTime: 1_234.5 };
    expect(resourceStartTime(snapshot, { wallTime: WALL, monotonicTime: MONO })).toBe(WALL + 234.5);
  });

  it('falls back to the wall-clock startedDateTime without a clock or monotonic start', () => {
    const snapshot = { startedDateTime: '2023-11-14T22:13:20.250Z', _monotonicTime: 1_234.5 };
    expect(resourceStartTime(snapshot, undefined)).toBe(Date.parse('2023-11-14T22:13:20.250Z'));
    expect(resourceStartTime({ startedDateTime: '2023-11-14T22:13:20.250Z' }, { wallTime: WALL, monotonicTime: MONO }))
      .toBe(Date.parse('2023-11-14T22:13:20.250Z'));
  });

  it('returns undefined when the snapshot carries no usable start', () => {
    expect(resourceStartTime({}, undefined)).toBeUndefined();
  });
});
