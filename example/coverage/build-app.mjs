// Bundles app/src into one whitespace-minified script with a linked source map.
// Coverage against the one-line bundle is meaningless; the reporter must map it back to app/src.
import { build } from 'esbuild';
import { fileURLToPath } from 'url';

export const appDir = fileURLToPath(new URL('./app/', import.meta.url));

export default async function buildApp() {
  await build({
    entryPoints: [`${appDir}src/main.ts`],
    outfile: `${appDir}dist/bundle.js`,
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minifyWhitespace: true,
    sourcemap: 'linked',
    logLevel: 'warning',
  });
}
