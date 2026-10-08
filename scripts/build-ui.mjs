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
const BUDGET = { 'report.css': 24 * 1024, 'fonts.css': 80 * 1024 };

async function loadTokens() {
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/ui/styles/tokens.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
  });
  const source = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${source}`);
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
  const { renderTokensCss } = await loadTokens();
  const assets = {
    'report.css': renderTokensCss() + '\n' + (await bundleCss(path.join(root, 'src/ui/styles/index.css'))),
    'fonts.css': await fontsCss(),
  };
  await mkdir(OUT, { recursive: true });
  for (const [name, content] of Object.entries(assets)) {
    const size = Buffer.byteLength(content);
    if (size > BUDGET[name]) {
      throw new Error(`${name} is ${size} bytes, over its ${BUDGET[name]} byte budget`);
    }
    await writeFile(path.join(OUT, name), content);
    console.log(`dist/ui/${name}  ${(size / 1024).toFixed(1)} KB (budget ${BUDGET[name] / 1024} KB)`);
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
  const specimenCss = await Promise.all(['specimen.css', 'screens.css'].map((f) => bundleCss(path.join(root, 'src/ui/specimen', f))));
  await writeFile(path.join(SPECIMEN_OUT, 'specimen.css'), specimenCss.join('\n'));
  for (const [name, content] of Object.entries(assets)) {
    await writeFile(path.join(SPECIMEN_OUT, name), content);
  }
  await writeFile(path.join(SPECIMEN_OUT, 'index.html'), page('UI specimen', true));
  await writeFile(path.join(SPECIMEN_OUT, 'csp.html'), page('UI specimen (cspSafe)', false));
  console.log(`.ui-specimen/ built`);
}

const assets = await buildReportAssets();
if (process.argv.includes('--specimen')) await buildSpecimen(assets);
