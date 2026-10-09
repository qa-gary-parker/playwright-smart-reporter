import { defineConfig } from '@playwright/test';
import * as path from 'path';

// Driven by reporter.acceptance.ts: ACCEPTANCE_OUT is the output folder and ACCEPTANCE_OPTIONS the reporter
// options as JSON, so one config serves every scenario. Not named *.spec.ts so the demo configs skip it.
const out = process.env.ACCEPTANCE_OUT ?? path.join(__dirname, 'out');
const options = JSON.parse(process.env.ACCEPTANCE_OPTIONS ?? '{}');

export default defineConfig({
  testDir: __dirname,
  testMatch: 'suite.fixtures.ts',
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
  ],
});
