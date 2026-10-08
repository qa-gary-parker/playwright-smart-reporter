import { defineConfig } from '@playwright/test';
import * as path from 'path';

// SMART_COVERAGE_OUT picks the output folder and SMART_MIN_COVERAGE the gate, so one config serves
// the single run, the sharded runs and merge-reports in src/coverage/coverage-example.test.ts.
const out = path.resolve(__dirname, 'coverage-report', process.env.SMART_COVERAGE_OUT ?? 'run');

export default defineConfig({
  testDir: __dirname,
  testMatch: 'coverage.spec.ts',
  globalSetup: './build-app.mjs',
  outputDir: path.join(out, 'test-results'),
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  reporter: [
    ['list'],
    ['../../dist/smart-reporter.js', {
      outputFile: path.join(out, 'smart-report.html'),
      historyFile: path.join(out, 'test-history.json'),
      exportJson: true,
      enableAIRecommendations: false,
      qualityGates: { minCoverage: Number(process.env.SMART_MIN_COVERAGE ?? 60) },
    }],
  ],
});
