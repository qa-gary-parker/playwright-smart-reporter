import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COVERAGE_ATTACHMENT_NAME, COVERAGE_CONTENT_TYPE, type CoveragePayload, type IstanbulFileCoverage, type RawSourceMap, type V8ScriptCoverage } from '../coverage/payload';
import { CoverageCollector, convertV8Script, displayPath, percent } from './coverage-collector';

// Runs `source` as a script named `url` in a fresh Node process and returns V8's precise coverage for it.
const CAPTURE = `
const { Session } = require('inspector');
const vm = require('vm');
const { source, url, calls } = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const session = new Session();
session.connect();
const post = (method, params) => new Promise((resolve, reject) => session.post(method, params, (e, r) => (e ? reject(e) : resolve(r))));
(async () => {
  await post('Profiler.enable');
  await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  const context = vm.createContext({});
  vm.runInContext(source, context, { filename: url });
  vm.runInContext(calls, context, { filename: 'calls.js' });
  const { result } = await post('Profiler.takePreciseCoverage');
  process.stdout.write(JSON.stringify(result.find((r) => r.url === url).functions));
})();
`;

function captureV8(source: string, url: string, calls = ''): V8ScriptCoverage {
  const out = execFileSync(process.execPath, ['-e', CAPTURE], { input: JSON.stringify({ source, url, calls }) });
  return { url, source, functions: JSON.parse(out.toString()) };
}

const MATH_TS = [
  'function add(a: number, b: number): number {',
  '  return a + b;',
  '}',
  'function multiply(a: number, b: number): number {',
  '  return a * b;',
  '}',
  'function sign(n: number): string {',
  '  if (n < 0) {',
  "    return 'negative';",
  '  }',
  "  return 'non-negative';",
  '}',
  '',
].join('\n');

const FORMAT_TS = [
  'function formatResult(label: string, value: number): string {',
  "  return label + ': ' + value;",
  '}',
  'function shout(text: string): string {',
  "  return text.toUpperCase() + '!';",
  '}',
  '',
].join('\n');

// A real multi-source bundle: tsc concatenates both files into one script with one source map.
function bundle(files: Record<string, string>): { code: string; map: RawSourceMap } {
  const out: Record<string, string> = {};
  const options: ts.CompilerOptions = {
    outFile: '/virtual/dist/bundle.js',
    module: ts.ModuleKind.None,
    target: ts.ScriptTarget.ES2020,
    sourceMap: true,
    inlineSources: true,
    noLib: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name, version) => (files[name] === undefined ? undefined : ts.createSourceFile(name, files[name], version));
  host.fileExists = (name) => files[name] !== undefined;
  host.readFile = (name) => files[name];
  host.writeFile = (name, text) => { out[name] = text; };
  ts.createProgram(Object.keys(files), options, host).emit();
  return { code: out['/virtual/dist/bundle.js'], map: JSON.parse(out['/virtual/dist/bundle.js.map']) };
}

const APP = bundle({ '/virtual/src/math.ts': MATH_TS, '/virtual/src/format.ts': FORMAT_TS });
const BUNDLE_URL = 'http://localhost:3000/assets/bundle.js';
const MAP_URL = 'http://localhost:3000/assets/bundle.js.map';

function appCoverage(calls: string): V8ScriptCoverage {
  return { ...captureV8(APP.code, BUNDLE_URL, calls), sourceMap: APP.map, sourceMapUrl: MAP_URL };
}

let tmp: string | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

function tmpDir(): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-coverage-'));
  return tmp;
}

function attachment(payload: CoveragePayload) {
  return { name: COVERAGE_ATTACHMENT_NAME, contentType: COVERAGE_CONTENT_TYPE, body: Buffer.from(JSON.stringify(payload)) };
}

function hitsOf(files: { path: string; coverage: IstanbulFileCoverage }[], filePath: string): number[] {
  const file = files.find((f) => f.path === filePath);
  if (!file) throw new Error(`no coverage for ${filePath}; got ${files.map((f) => f.path).join(', ')}`);
  return Object.entries(file.coverage.statementMap).map(([k]) => file.coverage.s[k]);
}

describe('percent', () => {
  it('floors to two decimals and reports an empty total as 100, like Istanbul', () => {
    expect(percent(12, 18)).toBe(66.66);
    expect(percent(1, 3)).toBe(33.33);
    expect(percent(0, 0)).toBe(100);
    expect(percent(5, 5)).toBe(100);
  });
});

describe('displayPath', () => {
  it('makes file URLs relative to the root dir and drops origin and query from web URLs', () => {
    const root = path.resolve('/project');
    expect(displayPath(pathToFileURL(path.join(root, 'src', 'a.ts')).href, root)).toBe('src/a.ts');
    expect(displayPath('http://localhost:5173/src/a.ts?t=123', root)).toBe('src/a.ts');
    expect(displayPath('webpack://my-app/./src/a.ts', root)).toBe('src/a.ts');
    expect(displayPath('http://cdn.test/a%20b.js', root)).toBe('a b.js');
  });
});

describe('convertV8Script', () => {
  it('turns V8 ranges for a plain script into per-line hit counts', async () => {
    const source = ['function add(a, b) {', '  return a + b;', '}', 'function unused() {', '  return 0;', '}', 'add(1, 2);', 'add(3, 4);'].join('\n');
    const files = await convertV8Script(captureV8(source, 'http://localhost:3000/app.js'), '/project');
    expect(files.map((f) => f.path)).toEqual(['app.js']);
    expect(hitsOf(files, 'app.js')).toEqual([2, 2, 2, 0, 0, 0, 1, 1]);
    expect(Object.values(files[0].coverage.fnMap).map((fn) => fn.name)).toEqual(['add', 'unused']);
    expect(Object.values(files[0].coverage.f)).toEqual([2, 0]);
  });

  it('maps a multi-file bundle back to its original sources through an external source map', async () => {
    const files = await convertV8Script(appCoverage('add(2, 3); sign(5);'), '/project');
    expect(files.map((f) => f.path).sort()).toEqual(['src/format.ts', 'src/math.ts']);
    expect(hitsOf(files, 'src/math.ts')).toEqual([1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1]);
    expect(hitsOf(files, 'src/format.ts')).toEqual([0, 0, 0, 0, 0, 0]);
    expect(files.find((f) => f.path === 'src/math.ts')?.source).toBe(MATH_TS);
  });

  it('decodes an inline base64 source map from the script itself', async () => {
    // Built at runtime: as a literal, Vite mistakes it for this test file's own inline source map.
    const comment = ['//#', 'sourceMappingURL=data:application/json;charset=utf-8;base64,'].join(' ');
    const inline = `${APP.code.replace(/\/\/# sourceMappingURL=.*$/m, '')}\n${comment}${Buffer.from(JSON.stringify(APP.map)).toString('base64')}\n`;
    const files = await convertV8Script(captureV8(inline, BUNDLE_URL, 'add(2, 3); sign(5);'), '/project');
    expect(files.map((f) => f.path).sort()).toEqual(['src/format.ts', 'src/math.ts']);
    expect(hitsOf(files, 'src/math.ts')).toEqual([1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1]);
  });

  it('reports against the generated script when its source map could not be fetched', async () => {
    const files = await convertV8Script(captureV8(APP.code, BUNDLE_URL, 'add(2, 3);'), '/project');
    expect(files.map((f) => f.path)).toEqual(['assets/bundle.js']);
    expect(files[0].source).toBe(APP.code);
  });

  it('leaves out sources under node_modules', async () => {
    const vendored = bundle({ '/virtual/src/math.ts': MATH_TS, '/virtual/node_modules/fmt/format.ts': FORMAT_TS });
    const entry = { ...captureV8(vendored.code, BUNDLE_URL, 'add(1, 1);'), sourceMap: vendored.map, sourceMapUrl: MAP_URL };
    const files = await convertV8Script(entry, '/project');
    expect(files.map((f) => f.path)).toEqual(['src/math.ts']);
  });

  it('reads a missing sourcesContent from disk for a local script but never for a remote one', async () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'math.ts'), MATH_TS);
    fs.writeFileSync(path.join(dir, 'src', 'format.ts'), FORMAT_TS);
    const { sourcesContent: _dropped, ...withoutContent } = APP.map;
    const localUrl = pathToFileURL(path.join(dir, 'dist', 'bundle.js')).href;

    const local = await convertV8Script({ ...captureV8(APP.code, localUrl, 'add(2, 3);'), sourceMap: withoutContent, sourceMapUrl: `${localUrl}.map` }, dir);
    expect(local.find((f) => f.path === 'src/math.ts')?.source).toBe(MATH_TS);

    const remoteMap = { ...withoutContent, sources: [pathToFileURL(path.join(dir, 'src', 'math.ts')).href, pathToFileURL(path.join(dir, 'src', 'format.ts')).href] };
    const remote = await convertV8Script({ ...captureV8(APP.code, BUNDLE_URL, 'add(2, 3);'), sourceMap: remoteMap, sourceMapUrl: MAP_URL }, dir);
    expect(remote.map((f) => f.path)).toEqual([]);
  });
});

describe('CoverageCollector', () => {
  const shardA = (): CoveragePayload => ({ version: 1, v8: [appCoverage('add(2, 3); sign(5);')] });
  const shardB = (): CoveragePayload => ({ version: 1, v8: [appCoverage("formatResult('sum', 5); sign(-1);")] });

  it('merges coverage from separate tests into union totals and summed hits', async () => {
    const collector = new CoverageCollector('/project');
    await collector.collect({ attachments: [attachment(shardA())] });
    await collector.collect({ attachments: [attachment(shardB())] });
    const report = await collector.finish();

    expect(report?.summary.lines).toEqual({ total: 18, covered: 12, pct: 66.66 });
    expect(report?.summary.functions).toEqual({ total: 5, covered: 3, pct: 60 });
    const math = report?.files.find((f) => f.path === 'src/math.ts');
    expect(math?.hits).toEqual([1, 1, 1, 0, 0, 0, 2, 2, 1, 1, 1, 1]);
    expect(math?.lines).toEqual({ total: 12, covered: 9, pct: 75 });
    expect(report?.files.find((f) => f.path === 'src/format.ts')?.lines).toEqual({ total: 6, covered: 3, pct: 50 });
  });

  it('counts branches across tests the same as one process running every test', async () => {
    const split = new CoverageCollector('/project');
    await split.collect({ attachments: [attachment(shardA())] });
    await split.collect({ attachments: [attachment(shardB())] });
    const together = new CoverageCollector('/project');
    await together.collect({ attachments: [attachment({ version: 1, v8: [appCoverage("add(2, 3); sign(5); formatResult('sum', 5); sign(-1);")] })] });

    const splitReport = await split.finish();
    expect(splitReport?.summary).toEqual((await together.finish())?.summary);
    expect(splitReport?.files.find((f) => f.path === 'src/math.ts')?.branches).toEqual({ total: 3, covered: 3, pct: 100 });
  });

  it('produces the same report whichever shard arrives first', async () => {
    const forward = new CoverageCollector('/project');
    await forward.collect({ attachments: [attachment(shardA())] });
    await forward.collect({ attachments: [attachment(shardB())] });
    const reverse = new CoverageCollector('/project');
    await reverse.collect({ attachments: [attachment(shardB())] });
    await reverse.collect({ attachments: [attachment(shardA())] });
    expect(await reverse.finish()).toEqual(await forward.finish());
  });

  it('waits for in-flight attachments before finishing', async () => {
    const file = path.join(tmpDir(), 'coverage.json');
    fs.writeFileSync(file, JSON.stringify(shardA()));
    const collector = new CoverageCollector('/project');
    void collector.collect({ attachments: [{ name: COVERAGE_ATTACHMENT_NAME, contentType: COVERAGE_CONTENT_TYPE, path: file }] });
    expect((await collector.finish())?.summary.lines).toEqual({ total: 18, covered: 7, pct: 38.88 });
  });

  it('reads attachments stored as files, the way Playwright and merge-reports deliver them', async () => {
    const file = path.join(tmpDir(), 'coverage.json');
    fs.writeFileSync(file, JSON.stringify(shardA()));
    const collector = new CoverageCollector('/project');
    await collector.collect({ attachments: [{ name: COVERAGE_ATTACHMENT_NAME, contentType: COVERAGE_CONTENT_TYPE, path: file }] });
    expect((await collector.finish())?.summary.lines).toEqual({ total: 18, covered: 7, pct: 38.88 });
  });

  it('uses Istanbul counters when present and ignores V8 data for that test', async () => {
    const loc = (line: number, column = 0) => ({ start: { line, column }, end: { line, column: column + 5 } });
    const istanbul: IstanbulFileCoverage = {
      path: '/project/src/math.ts',
      statementMap: { 0: loc(1), 1: loc(2), 2: loc(2, 10), 3: loc(4) },
      s: { 0: 1, 1: 0, 2: 3, 3: 0 },
      fnMap: { 0: { name: 'add', decl: loc(1), loc: loc(1) } },
      f: { 0: 1 },
      branchMap: { 0: { loc: loc(2), locations: [loc(2), loc(2, 10)] } },
      b: { 0: [1, 0] },
    };
    const collector = new CoverageCollector('/project');
    await collector.collect({ attachments: [attachment({ version: 1, v8: [appCoverage('add(1, 1);')], istanbul: { '/project/src/math.ts': istanbul } })] });
    const report = await collector.finish();
    expect(report?.files.map((f) => f.path)).toEqual(['src/math.ts']);
    expect(report?.files[0].hits).toEqual([1, 3, null, 0]);
    expect(report?.files[0].source).toBeUndefined();
    expect(report?.summary).toEqual({
      lines: { total: 3, covered: 2, pct: 66.66 },
      functions: { total: 1, covered: 1, pct: 100 },
      branches: { total: 2, covered: 1, pct: 50 },
    });
  });

  it('warns once and keeps other tests when an attachment is unreadable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const collector = new CoverageCollector('/project');
    const bad = { name: COVERAGE_ATTACHMENT_NAME, contentType: COVERAGE_CONTENT_TYPE, body: Buffer.from('{not json') };
    await collector.collect({ attachments: [bad] });
    await collector.collect({ attachments: [bad] });
    await collector.collect({ attachments: [attachment(shardA())] });
    expect((await collector.finish())?.summary.lines.covered).toBe(7);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reports nothing when no test carried coverage', async () => {
    const collector = new CoverageCollector('/project');
    await collector.collect({ attachments: [{ name: 'trace', contentType: 'application/zip', path: '/x.zip' }] });
    expect(await collector.finish()).toBeUndefined();
  });
});
