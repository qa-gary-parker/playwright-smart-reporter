// Replays the calls from coverage.spec.ts against the same bundle in Node, so c8 can measure it independently.
import { readFileSync } from 'fs';
import vm from 'vm';
import { appDir } from './build-app.mjs';

const bundle = `${appDir}dist/bundle.js`;
vm.runInThisContext(readFileSync(bundle, 'utf8'), { filename: bundle });
globalThis.add(2, 3);
globalThis.sign(5);
globalThis.formatResult('sum', 5);
globalThis.sign(-1);
