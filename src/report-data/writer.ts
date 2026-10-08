import * as fs from 'fs';
import * as path from 'path';
import type { ThemeConfig } from '../types';
import type { ReportData } from './schema';

export type AssetMode = 'inline' | 'external' | 'auto';

export interface UiAssets {
  css: string;
  fonts: string;
  js: string;
}

export interface WriteReportOptions {
  outputPath: string;
  assets: UiAssets;
  cspSafe?: boolean;
  assetMode?: AssetMode;
  autoThresholdBytes?: number;
}

export interface WriteReportResult {
  mode: 'inline' | 'external';
  dataBytes: number;
  files: string[];
}

// Data above this size goes to a companion <name>-data.js in 'auto' mode.
// See docs/investigations/report-scale.md for the measurements behind it.
export const AUTO_EXTERNAL_BYTES = 32 * 1024 * 1024;

export function loadUiAssets(dir: string = path.resolve(__dirname, '../ui')): UiAssets {
  const read = (name: string) => {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) {
      throw new Error(`Smart Reporter UI asset missing: ${file}. Run "npm run build".`);
    }
    return fs.readFileSync(file, 'utf8');
  };
  return { css: read('report.css'), fonts: read('fonts.css'), js: read('app.js') };
}

// JSON is embedded in <script>; escaping "<" keeps "</script>" and "<!--" inert.
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function serializeData(data: ReportData): string[] {
  const { tests, ...rest } = data;
  const head = safeJson(rest);
  const chunks = [`${head.slice(0, -1)},"tests":[`];
  tests.forEach((t, i) => chunks.push((i > 0 ? ',' : '') + safeJson(t)));
  chunks.push(']}');
  return chunks;
}

const MODE_FOR_PRESET: Record<string, string> = { dark: 'dark', light: 'light', 'high-contrast': 'hc' };

export function themeAttributes(theme?: ThemeConfig): string {
  const preset = theme?.preset;
  if (!preset || preset === 'default') return '';
  const mode = MODE_FOR_PRESET[preset];
  return mode ? ` data-mode="${mode}"` : ` data-accent="${preset}"`;
}

const CSS_COLOR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|(rgb|rgba|hsl|hsla|oklch)\([^;{}]*\))$/;

export function customThemeCss(theme?: ThemeConfig): string {
  if (!theme) return '';
  const map: Array<[string | undefined, string[]]> = [
    [theme.background, ['bg']],
    [theme.surface, ['bg-subtle']],
    [theme.text, ['text']],
    [theme.primary ?? theme.accent, ['accent-l', 'accent-d']],
    [theme.success, ['pass-fg']],
    [theme.error, ['fail-fg']],
    [theme.warning, ['flaky-fg']],
  ];
  const decls = map
    .filter(([value]) => value && CSS_COLOR.test(value.trim()))
    .flatMap(([value, vars]) => vars.map((v) => `--${v}:${value!.trim()};`))
    .join('');
  // Triple :root outranks the mode blocks so explicit colours win in every mode.
  return decls ? `:root:root:root{${decls}}` : '';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function writeChunks(file: string, chunks: Iterable<string>): Promise<void> {
  const stream = fs.createWriteStream(file, { encoding: 'utf8' });
  try {
    for (const chunk of chunks) {
      if (!stream.write(chunk)) {
        await new Promise<void>((resolve) => stream.once('drain', resolve));
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => stream.end((err?: Error | null) => (err ? reject(err) : resolve())));
  }
}

export async function writeReport(data: ReportData, opts: WriteReportOptions): Promise<WriteReportResult> {
  const { outputPath, assets, cspSafe = false } = opts;
  const dir = path.dirname(outputPath);
  const base = path.basename(outputPath, '.html');
  fs.mkdirSync(dir, { recursive: true });

  const chunks = serializeData(data);
  const dataBytes = chunks.reduce((n, c) => n + Buffer.byteLength(c), 0);
  const requested = opts.assetMode ?? 'auto';
  const mode: 'inline' | 'external' =
    cspSafe || requested === 'external' || (requested === 'auto' && dataBytes > (opts.autoThresholdBytes ?? AUTO_EXTERNAL_BYTES))
      ? 'external'
      : 'inline';

  const title = escapeHtml(data.config.branding?.title || 'Smart Test Report');
  const themeCss = customThemeCss(data.config.theme);
  const files = [outputPath];
  const head: string[] = [
    '<!doctype html>\n',
    `<html lang="en"${themeAttributes(data.config.theme)}>\n<head>\n<meta charset="utf-8">\n`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n',
    `<meta name="generator" content="playwright-smart-reporter ${escapeHtml(data.meta.reporterVersion)}">\n`,
    `<title>${title}</title>\n`,
  ];

  if (cspSafe) {
    const cssFile = path.join(dir, `${base}.css`);
    fs.writeFileSync(cssFile, assets.css + (themeCss ? `\n${themeCss}` : ''));
    files.push(cssFile);
    head.push(`<link rel="stylesheet" href="./${encodeURI(base)}.css">\n`);
  } else {
    head.push(`<style>${assets.fonts}</style>\n<style>${assets.css}${themeCss}</style>\n`);
  }

  const body = ['</head>\n<body>\n<div id="app"></div>\n'];
  if (mode === 'external') {
    const dataFile = path.join(dir, `${base}-data.js`);
    await writeChunks(dataFile, ['window.__SMART_DATA__=', ...chunks, ';\n']);
    files.push(dataFile);
    body.push(`<script src="./${encodeURI(base)}-data.js"></script>\n`);
  }

  if (cspSafe) {
    const jsFile = path.join(dir, `${base}.js`);
    fs.writeFileSync(jsFile, assets.js);
    files.push(jsFile);
    body.push(`<script src="./${encodeURI(base)}.js"></script>\n`);
  }

  const inlineData = mode === 'inline' ? ['<script>window.__SMART_DATA__=', ...chunks, ';</script>\n'] : [];
  const inlineApp = cspSafe ? [] : [`<script>${assets.js.replace(/<\/script/gi, '<\\/script')}</script>\n`];

  await writeChunks(outputPath, [...head, ...body, ...inlineData, ...inlineApp, '</body>\n</html>\n']);
  return { mode, dataBytes, files };
}
