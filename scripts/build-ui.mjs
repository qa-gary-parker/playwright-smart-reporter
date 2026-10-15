import * as esbuild from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const OUT = path.join(root, 'dist/ui');
const SPECIMEN_OUT = path.join(root, '.ui-specimen');
// Fonts dominate: two Latin-subset variable woff2 files, base64-encoded.
const BUDGET = { 'report.css': 48 * 1024, 'fonts.css': 80 * 1024, 'app.js': 128 * 1024 };

async function loadTs(entry) {
  const result = await esbuild.build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
  });
  const source = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${source}`);
}

// The 2.x trace viewer is reused as-is; its old variable names alias the v3 tokens.
const TRACE_ALIASES =
  '.trace-modal{--accent-blue:var(--accent);--border-subtle:var(--border);--text-primary:var(--text);' +
  '--text-secondary:var(--text-muted);--bg-primary:var(--bg);--bg-secondary:var(--bg-subtle);--bg-card:var(--bg);' +
  '--bg-card-hover:var(--bg-hover);--accent-red:var(--fail-fg);--accent-green:var(--pass-fg);' +
  '--accent-yellow:var(--flaky-fg);--border-default:var(--border-strong);font-family:var(--font-sans)}';

async function traceViewerAssets() {
  const tv = await loadTs('src/generators/trace-viewer-generator.ts');
  return {
    'trace-viewer.html': tv.generateTraceViewerHtml(),
    'trace-viewer.css': TRACE_ALIASES + tv.generateTraceViewerStyles('var(--font-mono)'),
    'trace-viewer.js': tv.generateJSZipScript() + '\n' + tv.generateTraceViewerScript(),
  };
}

async function bundleApp() {
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/ui/app/main.tsx')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    minify: true,
    legalComments: 'none',
    write: false,
  });
  return result.outputFiles[0].text;
}

async function fontsCss() {
  const faces = [
    ['Geist', '@fontsource-variable/geist', 'geist-latin-wght-normal.woff2'],
    ['Geist Mono', '@fontsource-variable/geist-mono', 'geist-mono-latin-wght-normal.woff2'],
  ];
  let css = '';
  for (const [family, pkg, file] of faces) {
    const dir = path.dirname(require.resolve(`${pkg}/LICENSE`));
    const index = await readFile(path.join(dir, 'index.css'), 'utf8');
    const block = index.split('@font-face').find((b) => b.includes(file));
    const range = block?.match(/unicode-range:\s*([^;]+);/)?.[1];
    if (!range) throw new Error(`unicode-range for ${file} not found in ${pkg}/index.css`);
    const data = (await readFile(path.join(dir, 'files', file))).toString('base64');
    css +=
      `@font-face{font-family:"${family}";font-style:normal;font-display:swap;font-weight:100 900;` +
      `src:url(data:font/woff2;base64,${data}) format("woff2-variations");unicode-range:${range}}`;
  }
  return css;
}

async function bundleCss(entry) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, minify: true, write: false });
  return result.outputFiles[0].text;
}

async function buildReportAssets() {
  const { renderTokensCss } = await loadTs('src/ui/styles/tokens.ts');
  const assets = {
    'report.css': renderTokensCss() + '\n' + (await bundleCss(path.join(root, 'src/ui/styles/index.css'))),
    'fonts.css': await fontsCss(),
    'app.js': await bundleApp(),
    ...(await traceViewerAssets()),
  };
  await mkdir(OUT, { recursive: true });
  for (const [name, content] of Object.entries(assets)) {
    const size = Buffer.byteLength(content);
    if (BUDGET[name] && size > BUDGET[name]) {
      throw new Error(`${name} is ${size} bytes, over its ${BUDGET[name]} byte budget`);
    }
    await writeFile(path.join(OUT, name), content);
    console.log(`dist/ui/${name}  ${(size / 1024).toFixed(1)} KB${BUDGET[name] ? ` (budget ${BUDGET[name] / 1024} KB)` : ''}`);
  }
  await copyFile(require.resolve('@fontsource-variable/geist/LICENSE'), path.join(OUT, 'OFL-Geist.txt'));
  return assets;
}

function page(title, withFonts) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${withFonts ? '<link rel="stylesheet" href="fonts.css">\n' : ''}<link rel="stylesheet" href="report.css">
<link rel="stylesheet" href="specimen.css">
</head>
<body>
<div id="app"></div>
<script src="specimen.js"></script>
</body>
</html>
`;
}

// The app on fixture data, with the trace viewer markup the report shell adds.
function previewPage(assets) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Report preview</title>
<link rel="stylesheet" href="fonts.css">
<link rel="stylesheet" href="report.css">
<style>${assets['trace-viewer.css']}</style>
</head>
<body>
<div id="app"></div>
${assets['trace-viewer.html']}
<script>${assets['trace-viewer.js'].replace(/<\/script/gi, '<\\/script')}</script>
<script src="preview.js"></script>
</body>
</html>
`;
}

async function buildSpecimen(assets) {
  await rm(SPECIMEN_OUT, { recursive: true, force: true });
  await mkdir(SPECIMEN_OUT, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(root, 'src/ui/specimen/main.tsx')],
    outfile: path.join(SPECIMEN_OUT, 'specimen.js'),
    bundle: true,
    format: 'iife',
    target: 'es2022',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    minify: true,
  });
  await writeFile(path.join(SPECIMEN_OUT, 'specimen.css'), await bundleCss(path.join(root, 'src/ui/specimen/specimen.css')));
  await esbuild.build({
    entryPoints: [path.join(root, 'src/ui/specimen/preview.tsx')],
    outfile: path.join(SPECIMEN_OUT, 'preview.js'),
    bundle: true,
    format: 'iife',
    target: 'es2022',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    minify: true,
  });
  await writeFile(path.join(SPECIMEN_OUT, 'preview.html'), previewPage(assets));
  for (const name of ['report.css', 'fonts.css']) {
    await writeFile(path.join(SPECIMEN_OUT, name), assets[name]);
  }
  await writeFile(path.join(SPECIMEN_OUT, 'index.html'), page('UI specimen', true));
  await writeFile(path.join(SPECIMEN_OUT, 'csp.html'), page('UI specimen (cspSafe)', false));
  console.log(`.ui-specimen/ built`);
}

const assets = await buildReportAssets();
if (process.argv.includes('--specimen')) await buildSpecimen(assets);
