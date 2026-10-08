import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { Page, TestInfo } from '@playwright/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoveragePayload } from './payload';

const MAP = { version: 3, sources: ['../src/a.ts'], sourcesContent: ['export const a = 1;\n'], mappings: 'AAAA', names: [] };

let dir: string;
let attached: Array<{ name: string; contentType?: string; payload: CoveragePayload }>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-fixture-'));
  attached = [];
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

function testInfo(): TestInfo {
  return {
    title: 'a test',
    outputPath: (name: string) => path.join(dir, name),
    attach: async (name: string, options: { path: string; contentType?: string }) => {
      attached.push({ name, contentType: options.contentType, payload: JSON.parse(fs.readFileSync(options.path, 'utf8')) });
    },
  } as unknown as TestInfo;
}

function fakePage(opts: { entries?: unknown[]; istanbul?: unknown; stopError?: Error; mapStatus?: number } = {}) {
  const get = vi.fn(async () => ({
    ok: () => (opts.mapStatus ?? 200) === 200,
    status: () => opts.mapStatus ?? 200,
    text: async () => JSON.stringify(MAP),
  }));
  const page = {
    coverage: {
      startJSCoverage: vi.fn(async () => {}),
      stopJSCoverage: vi.fn(async () => {
        if (opts.stopError) throw opts.stopError;
        return opts.entries ?? [];
      }),
    },
    evaluate: vi.fn(async () => opts.istanbul ?? null),
    context: () => ({ request: { get } }),
  };
  return { page: page as unknown as Page, raw: page, get };
}

async function run(page: Page, browserName: string): Promise<string[]> {
  const { pageWithCoverage } = await import('./index');
  const order: string[] = [];
  await pageWithCoverage(page, browserName, testInfo(), async () => {
    order.push('test body');
  });
  return order;
}

const script = (url: string, source = 'function a(){}\n//# sourceMappingURL=a.js.map\n') => ({
  url,
  scriptId: '1',
  source,
  functions: [{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] }],
});

describe('pageWithCoverage', () => {
  it('records V8 coverage for page scripts only and ships the fetched source map in a file attachment', async () => {
    const { page, raw, get } = fakePage({
      entries: [script('http://localhost:3000/a.js'), script('__playwright_evaluation_script__'), script('chrome-extension://x/y.js')],
    });
    await run(page, 'chromium');

    expect(raw.coverage.startJSCoverage).toHaveBeenCalledWith({ resetOnNavigation: false });
    expect(get).toHaveBeenCalledWith('http://localhost:3000/a.js.map');
    expect(attached).toHaveLength(1);
    expect(attached[0].name).toBe('smart-reporter-coverage');
    expect(attached[0].contentType).toBe('application/vnd.smart-reporter.coverage+json');
    expect(attached[0].payload.v8?.map((e) => [e.url, e.sourceMapUrl, e.sourceMap?.sources])).toEqual([
      ['http://localhost:3000/a.js', 'http://localhost:3000/a.js.map', ['../src/a.ts']],
    ]);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('reads a local source map from disk for a file:// script', async () => {
    fs.writeFileSync(path.join(dir, 'a.js.map'), JSON.stringify(MAP));
    const { page, get } = fakePage({ entries: [script(pathToFileURL(path.join(dir, 'a.js')).href)] });
    await run(page, 'chromium');
    expect(get).not.toHaveBeenCalled();
    expect(attached[0].payload.v8?.[0].sourceMap?.sources).toEqual(['../src/a.ts']);
  });

  it('never reads a file:// source map named by a remote script', async () => {
    const mapFile = path.join(dir, 'a.js.map');
    fs.writeFileSync(mapFile, JSON.stringify(MAP));
    const { page, get } = fakePage({ entries: [script('http://evil.test/a.js', `function a(){}\n//# sourceMappingURL=${pathToFileURL(mapFile).href}\n`)] });
    await run(page, 'chromium');
    expect(get).not.toHaveBeenCalled();
    expect(attached[0].payload.v8?.map((e) => [e.url, e.sourceMap])).toEqual([['http://evil.test/a.js', undefined]]);
  });

  it('keeps the entry and warns once when a source map cannot be fetched', async () => {
    const { page } = fakePage({ entries: [script('http://localhost:3000/a.js')], mapStatus: 404 });
    await run(page, 'chromium');
    await run(page, 'chromium');
    expect(attached.map((a) => a.payload.v8?.[0].sourceMap)).toEqual([undefined, undefined]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('http://localhost:3000/a.js.map not loaded (HTTP 404)');
  });

  it('skips V8 on other browsers with one warning, never fails, and still sends Istanbul counters', async () => {
    const istanbul = {
      '/app/src/a.ts': { path: '/app/src/a.ts', statementMap: {}, s: {}, fnMap: {}, f: {}, branchMap: {}, b: {}, inputSourceMap: { big: true } },
    };
    const first = fakePage({ istanbul });
    const second = fakePage();
    expect(await run(first.page, 'firefox')).toEqual(['test body']);
    expect(await run(second.page, 'webkit')).toEqual(['test body']);

    expect(first.raw.coverage.startJSCoverage).not.toHaveBeenCalled();
    expect(second.raw.coverage.stopJSCoverage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('V8 coverage needs Chromium');
    expect(attached.map((a) => a.payload)).toEqual([{
      version: 1,
      istanbul: { '/app/src/a.ts': { path: '/app/src/a.ts', statementMap: {}, s: {}, fnMap: {}, f: {}, branchMap: {}, b: {} } },
    }]);
  });

  it('warns instead of failing the test when coverage cannot be stopped', async () => {
    const { page } = fakePage({ stopError: new Error('Target page has been closed') });
    expect(await run(page, 'chromium')).toEqual(['test body']);
    expect(attached).toEqual([]);
    expect(String(warn.mock.calls[0][0])).toContain('Coverage not collected for "a test": Target page has been closed');
  });
});
