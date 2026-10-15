import { defineConfig } from '@playwright/test';
import * as path from 'path';

// Driven by the *.acceptance.ts files: ACCEPTANCE_OUT is the output folder, ACCEPTANCE_OPTIONS the reporter
// options as JSON and ACCEPTANCE_MATCH the fixture file, so one config serves every scenario.
// Fixtures are not named *.spec.ts so the demo configs skip them.
const out = process.env.ACCEPTANCE_OUT ?? path.join(__dirname, 'out');
const options = JSON.parse(process.env.ACCEPTANCE_OPTIONS ?? '{}');

export default defineConfig({
  testDir: __dirname,
  testMatch: process.env.ACCEPTANCE_MATCH ?? 'suite.fixtures.ts',
  outputDir: path.join(out, 'test-results'),
  retries: 1,
  workers: 1,
  reporter: [
    [path.join(__dirname, '../../dist/smart-reporter.js'), {
      outputFile: path.join(out, 'smart-report.html'),
      historyFile: path.join(out, 'test-history.json'),
      enableAIRecommendations: false,
      ...options,
    }],
    // Playwright's own counts, the oracle the reporter's numbers are checked against.
    ['json', { outputFile: path.join(out, 'pw.json') }],
  ],
});
