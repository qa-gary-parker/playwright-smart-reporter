import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { test as base, expect } from '@playwright/test';
import type { Fixtures, Page, TestInfo, TestType } from '@playwright/test';
import {
  COVERAGE_ATTACHMENT_NAME,
  COVERAGE_CONTENT_TYPE,
  isIstanbulFileCoverage,
  isSourceMap,
  type CoveragePayload,
  type IstanbulFileCoverage,
  type RawSourceMap,
  type V8ScriptCoverage,
} from './payload';

export { COVERAGE_ATTACHMENT_NAME, COVERAGE_CONTENT_TYPE };

const MAP_REFERENCE = /[#@][ \t]+sourceMappingURL=([^\s'"`*]+)/g;
const PAGE_SCRIPT = /^(https?|file):/;

let warnedBrowser = false;
const warnedMaps = new Set<string>();
const mapCache = new Map<string, Promise<RawSourceMap | undefined>>();

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function fetchSourceMap(page: Page, mapUrl: string, scriptUrl: string): Promise<RawSourceMap | undefined> {
  let text: string;
  if (mapUrl.startsWith('file:')) {
    if (!scriptUrl.startsWith('file:')) return undefined;
    text = await fs.promises.readFile(fileURLToPath(mapUrl), 'utf8');
  } else if (/^https?:/.test(mapUrl)) {
    const response = await page.context().request.get(mapUrl);
    if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
    text = await response.text();
  } else {
    return undefined;
  }
  const map: unknown = JSON.parse(text);
  if (!isSourceMap(map)) throw new Error('not a version 3 source map');
  return map;
}

// The reporter may run later on another machine (merge-reports), so external maps travel in the attachment.
async function withSourceMaps(page: Page, entries: V8ScriptCoverage[]): Promise<V8ScriptCoverage[]> {
  return Promise.all(entries.map(async (entry) => {
    const references = entry.source ? [...entry.source.matchAll(MAP_REFERENCE)] : [];
    const reference = references[references.length - 1]?.[1];
    if (!reference || reference.startsWith('data:')) return entry;
    let mapUrl: string;
    try {
      mapUrl = new URL(reference, entry.url).href;
    } catch {
      return entry;
    }
    let pending = mapCache.get(mapUrl);
    if (!pending) {
      pending = fetchSourceMap(page, mapUrl, entry.url).catch((err) => {
        if (!warnedMaps.has(mapUrl)) {
          warnedMaps.add(mapUrl);
          console.warn(`[smart-reporter] Source map ${mapUrl} not loaded (${message(err)}); coverage for ${entry.url} uses the generated code.`);
        }
        return undefined;
      });
      mapCache.set(mapUrl, pending);
    }
    const sourceMap = await pending;
    return sourceMap ? { ...entry, sourceMap, sourceMapUrl: mapUrl } : entry;
  }));
}

async function readIstanbul(page: Page): Promise<Record<string, IstanbulFileCoverage> | undefined> {
  const data: unknown = await page
    .evaluate(() => (globalThis as { __coverage__?: unknown }).__coverage__ ?? null)
    .catch(() => null);
  if (!data || typeof data !== 'object') return undefined;
  const files: Record<string, IstanbulFileCoverage> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!isIstanbulFileCoverage(value)) continue;
    const { path, statementMap, s, fnMap, f, branchMap, b } = value;
    files[key] = { path, statementMap, s, fnMap, f, branchMap, b };
  }
  return Object.keys(files).length > 0 ? files : undefined;
}

export async function pageWithCoverage(
  page: Page,
  browserName: string,
  testInfo: TestInfo,
  use: (page: Page) => Promise<void>,
): Promise<void> {
  let v8 = false;
  if (browserName === 'chromium') {
    try {
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      v8 = true;
    } catch (err) {
      console.warn(`[smart-reporter] V8 coverage did not start: ${message(err)}`);
    }
  } else if (!warnedBrowser) {
    warnedBrowser = true;
    console.warn(`[smart-reporter] V8 coverage needs Chromium; ${browserName} tests report window.__coverage__ (Istanbul) only.`);
  }

  await use(page);

  try {
    const payload: CoveragePayload = { version: 1 };
    if (v8) {
      const entries = (await page.coverage.stopJSCoverage()).filter((entry) => PAGE_SCRIPT.test(entry.url));
      payload.v8 = await withSourceMaps(page, entries);
    }
    const istanbul = await readIstanbul(page);
    if (istanbul) payload.istanbul = istanbul;
    if (!payload.v8?.length && !payload.istanbul) return;
    // A path attachment stays on disk; a body attachment would travel base64-encoded over worker IPC.
    const file = testInfo.outputPath('smart-reporter-coverage.json');
    await fs.promises.writeFile(file, JSON.stringify(payload));
    await testInfo.attach(COVERAGE_ATTACHMENT_NAME, { path: file, contentType: COVERAGE_CONTENT_TYPE });
    await fs.promises.rm(file, { force: true });
  } catch (err) {
    console.warn(`[smart-reporter] Coverage not collected for "${testInfo.title}": ${message(err)}`);
  }
}

export function withCoverage<T extends { page: Page }, W extends { browserName: string }>(
  testType: TestType<T, W>,
): TestType<T, W> {
  const fixtures = {
    page: async (
      { page, browserName }: { page: Page; browserName: string },
      use: (page: Page) => Promise<void>,
      testInfo: TestInfo,
    ) => pageWithCoverage(page, browserName, testInfo, use),
  };
  return testType.extend(fixtures as unknown as Fixtures<object, object, T, W>);
}

export const test = withCoverage(base);
export { expect };
