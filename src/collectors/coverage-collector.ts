import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import type { TestResult } from '@playwright/test/reporter';
import v8ToIstanbul from 'v8-to-istanbul';
import {
  COVERAGE_ATTACHMENT_NAME,
  isIstanbulFileCoverage,
  isSourceMap,
  type CoveragePayload,
  type IstanbulFileCoverage,
  type Location,
  type RawSourceMap,
  type V8ScriptCoverage,
} from '../coverage/payload';
import type { CoverageFile, CoverageTotals, ReportCoverage } from '../report-data/schema';

export interface ConvertedFile {
  path: string;
  source?: string;
  coverage: IstanbulFileCoverage;
}

interface FileState {
  path: string;
  source?: string;
  lines: Map<number, number>;
  functions: Map<string, number>;
  branches: Map<string, number>;
}

type ScriptCov = { scriptId: string; url: string; functions: V8ScriptCoverage['functions'] };
// No bundled types; this is the range-tree merge c8 uses to combine coverage from separate processes.
const { mergeScriptCovs } = require('@bcoe/v8-coverage') as { mergeScriptCovs(covs: ScriptCov[]): ScriptCov | undefined };

// v8-to-istanbul resolves source paths itself, so every source gets an opaque absolute id it leaves untouched.
const SYNTHETIC_PREFIX = '/__smart_coverage__/';
const SYNTHETIC_ID = /__smart_coverage__[\\/](\d+)$/;
const NODE_MODULES = /(^|\/)node_modules\//;
const MAP_COMMENT = /(?:\/\/|\/\*)[#@][ \t]+sourceMappingURL=[^\r\n]*/g;
const INLINE_MAP = /[#@][ \t]+sourceMappingURL=data:application\/json[^,]*?(;base64)?,([^\s'"`*]+)/g;

export function percent(covered: number, total: number): number {
  return total > 0 ? Math.floor((100000 * covered) / total / 10) / 100 : 100;
}

export function displayPath(url: string, rootDir: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol === 'file:') {
    return path.relative(rootDir, fileURLToPath(parsed)).split(path.sep).join('/');
  }
  let pathname = parsed.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // keep the encoded form
  }
  return pathname.replace(/^\/+/, '');
}

function resolveUrl(spec: string, base: string): string {
  try {
    return new URL(spec, base).href;
  } catch {
    return spec;
  }
}

function readLocalFile(url: string): string | undefined {
  if (!url.startsWith('file:')) return undefined;
  try {
    return fs.readFileSync(fileURLToPath(url), 'utf8');
  } catch {
    return undefined;
  }
}

function inlineSourceMap(source: string): RawSourceMap | undefined {
  const matches = [...source.matchAll(INLINE_MAP)];
  const last = matches[matches.length - 1];
  if (!last) return undefined;
  try {
    const json = last[1] ? Buffer.from(last[2], 'base64').toString('utf8') : decodeURIComponent(last[2]);
    const map: unknown = JSON.parse(json);
    return isSourceMap(map) ? map : undefined;
  } catch {
    return undefined;
  }
}

export async function convertV8Script(entry: V8ScriptCoverage, rootDir: string): Promise<ConvertedFile[]> {
  if (typeof entry.source !== 'string' || !Array.isArray(entry.functions)) return [];
  const files: Array<{ path: string; source: string }> = [];
  const register = (url: string, source: string) => {
    files.push({ path: displayPath(url, rootDir), source });
    return `${SYNTHETIC_PREFIX}${files.length - 1}`;
  };
  const fileFor = (id: string) => {
    const match = SYNTHETIC_ID.exec(id);
    return match ? files[Number(match[1])] : undefined;
  };

  // Blanking keeps offsets but stops v8-to-istanbul from reading map files relative to a fake path.
  const source = entry.source.replace(MAP_COMMENT, (comment) => ' '.repeat(comment.length));
  const map = entry.sourceMap ?? inlineSourceMap(entry.source);
  let converter: ReturnType<typeof v8ToIstanbul>;
  if (map && map.sources.length > 0) {
    const base = entry.sourceMap ? entry.sourceMapUrl ?? entry.url : entry.url;
    const root = map.sourceRoot ? map.sourceRoot.replace(/\/?$/, '/') : '';
    // Disk fallback only for local scripts, so a remote page cannot point the reporter at arbitrary files.
    const local = entry.url.startsWith('file:');
    const sources = map.sources.map((name, i) => {
      const url = resolveUrl(root + (name ?? ''), base);
      return register(url, map.sourcesContent?.[i] ?? (local ? readLocalFile(url) : undefined) ?? '');
    });
    const sourcemap = {
      version: 3 as const,
      file: map.file,
      names: map.names ?? [],
      mappings: map.mappings,
      sources,
      sourcesContent: files.map((f) => f.source),
    };
    converter = v8ToIstanbul(`${SYNTHETIC_PREFIX}script`, 0, { source, originalSource: '', sourceMap: { sourcemap } },
      (id) => NODE_MODULES.test(fileFor(id)?.path ?? ''));
  } else {
    converter = v8ToIstanbul(register(entry.url, entry.source), 0, { source });
  }

  await converter.load();
  converter.applyCoverage(entry.functions);
  const result: ConvertedFile[] = [];
  for (const [id, coverage] of Object.entries(converter.toIstanbul())) {
    const file = fileFor(id);
    if (!file || !file.source || NODE_MODULES.test(file.path)) continue;
    result.push({ path: file.path, source: file.source, coverage: coverage as unknown as IstanbulFileCoverage });
  }
  return result;
}

function convertIstanbul(data: Record<string, unknown>, rootDir: string): ConvertedFile[] {
  return Object.values(data)
    .filter(isIstanbulFileCoverage)
    .map((coverage) => {
      const url = path.isAbsolute(coverage.path) ? pathToFileURL(coverage.path).href : coverage.path;
      return { path: displayPath(url, rootDir), coverage };
    })
    .filter((file) => !NODE_MODULES.test(file.path));
}

function locationKey(loc: Location): string {
  return `${loc.start.line}:${loc.start.column}-${loc.end.line}:${loc.end.column}`;
}

// Identical keys inside one conversion stay distinct; across conversions they add up.
function addCounts(target: Map<string, number>, entries: Array<[string, number]>): void {
  const seen = new Map<string, number>();
  for (const [base, hits] of entries) {
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const key = n === 0 ? base : `${base}~${n}`;
    target.set(key, (target.get(key) ?? 0) + hits);
  }
}

function totals(counts: Map<unknown, number>): CoverageTotals {
  let covered = 0;
  for (const hits of counts.values()) if (hits > 0) covered++;
  return { total: counts.size, covered, pct: percent(covered, counts.size) };
}

function sumTotals(items: CoverageTotals[]): CoverageTotals {
  const total = items.reduce((n, t) => n + t.total, 0);
  const covered = items.reduce((n, t) => n + t.covered, 0);
  return { total, covered, pct: percent(covered, total) };
}

function toCoverageFile(state: FileState, filePath: string): CoverageFile {
  let maxLine = 0;
  for (const line of state.lines.keys()) if (line > maxLine) maxLine = line;
  const hits = Array.from({ length: maxLine }, (_, i) => state.lines.get(i + 1) ?? null);
  return {
    path: filePath,
    lines: totals(state.lines),
    functions: totals(state.functions),
    branches: totals(state.branches),
    hits,
    ...(state.source !== undefined ? { source: state.source } : {}),
  };
}

function lineHitsOf(fc: IstanbulFileCoverage): Map<number, number> {
  const lineHits = new Map<number, number>();
  for (const [key, loc] of Object.entries(fc.statementMap)) {
    const hits = fc.s[key] ?? 0;
    lineHits.set(loc.start.line, Math.max(lineHits.get(loc.start.line) ?? 0, hits));
  }
  return lineHits;
}

function sha1(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex');
}

/**
 * Turns per-test coverage attachments from the `playwright-smart-reporter/coverage` fixture into
 * merged per-file line, function and branch coverage. Works the same on live runs and merge-reports.
 *
 * Raw V8 data is merged per script and converted once, as c8 does: V8 omits a block range whose
 * count equals its parent's, so converting each test separately and adding the results undercounts
 * branches. It is also the cheap path: conversion costs ~25 ms per script on a 22k-line app.
 */
export class CoverageCollector {
  private scripts = new Map<string, V8ScriptCoverage>();
  private files = new Map<string, FileState>();
  private pending = new Set<Promise<unknown>>();
  private warned = false;

  constructor(private rootDir: string) {}

  collect(result: Pick<TestResult, 'attachments'>): Promise<void> {
    const attachments = result.attachments.filter((a) => a.name === COVERAGE_ATTACHMENT_NAME);
    if (attachments.length === 0) return Promise.resolve();
    const task = this.collectAttachments(attachments).catch((err) => this.warn(err));
    this.pending.add(task);
    void task.then(() => this.pending.delete(task));
    return task;
  }

  async finish(): Promise<ReportCoverage | undefined> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
    for (const script of this.scripts.values()) {
      for (const file of await this.convert(script)) this.merge(file);
    }
    this.scripts.clear();
    if (this.files.size === 0) return undefined;
    const seen = new Map<string, number>();
    const files = [...this.files.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, state]) => {
        const n = (seen.get(state.path) ?? 0) + 1;
        seen.set(state.path, n);
        return toCoverageFile(state, n === 1 ? state.path : `${state.path} (${n})`);
      });
    return {
      summary: {
        lines: sumTotals(files.map((f) => f.lines)),
        functions: sumTotals(files.map((f) => f.functions)),
        branches: sumTotals(files.map((f) => f.branches)),
      },
      files,
    };
  }

  private async collectAttachments(attachments: TestResult['attachments']): Promise<void> {
    for (const attachment of attachments) {
      const raw = attachment.path ? await fs.promises.readFile(attachment.path, 'utf8') : attachment.body?.toString('utf8');
      if (!raw) continue;
      const payload = JSON.parse(raw) as CoveragePayload;
      if (payload?.version !== 1) continue;
      // Istanbul counters come from instrumented code; V8 data for the same bundle would double count.
      if (payload.istanbul && Object.keys(payload.istanbul).length > 0) {
        for (const file of convertIstanbul(payload.istanbul, this.rootDir)) this.merge(file);
      } else {
        for (const entry of payload.v8 ?? []) this.addScript(entry);
      }
    }
  }

  private async convert(entry: V8ScriptCoverage): Promise<ConvertedFile[]> {
    try {
      return await convertV8Script(entry, this.rootDir);
    } catch (err) {
      this.warn(err);
      return [];
    }
  }

  private addScript(entry: V8ScriptCoverage): void {
    if (typeof entry.source !== 'string' || !Array.isArray(entry.functions)) return;
    const key = `${entry.url}\0${sha1(entry.source)}`;
    const current = this.scripts.get(key);
    const incoming = { scriptId: '0', url: entry.url, functions: entry.functions };
    const merged = mergeScriptCovs(current ? [{ scriptId: '0', url: current.url, functions: current.functions }, incoming] : [incoming]);
    this.scripts.set(key, {
      url: entry.url,
      source: entry.source,
      sourceMap: current?.sourceMap ?? entry.sourceMap,
      sourceMapUrl: current?.sourceMap ? current.sourceMapUrl : entry.sourceMapUrl,
      functions: merged?.functions ?? [],
    });
  }

  private merge(file: ConvertedFile): void {
    const fc = file.coverage;
    const lineHits = lineHitsOf(fc);
    if (lineHits.size === 0 && Object.keys(fc.fnMap).length === 0) return;
    const id = `${file.path}\0${file.source === undefined ? 'istanbul' : sha1(file.source)}`;
    let state = this.files.get(id);
    if (!state) {
      state = { path: file.path, source: file.source, lines: new Map(), functions: new Map(), branches: new Map() };
      this.files.set(id, state);
    }
    for (const [line, hits] of lineHits) state.lines.set(line, (state.lines.get(line) ?? 0) + hits);
    addCounts(state.functions, Object.entries(fc.fnMap).map(([key, fn]) => [
      `${fn.name}@${locationKey(fn.decl ?? fn.loc)}`, fc.f[key] ?? 0,
    ]));
    addCounts(state.branches, Object.entries(fc.branchMap).flatMap(([key, branch]) => branch.locations.map(
      (loc, i): [string, number] => [`${locationKey(branch.loc ?? loc)}#${i}`, fc.b[key]?.[i] ?? 0],
    )));
  }

  private warn(err: unknown): void {
    if (this.warned) return;
    this.warned = true;
    console.warn('⚠️  Coverage data could not be read; affected files are left out:', err instanceof Error ? err.message : err);
  }
}
