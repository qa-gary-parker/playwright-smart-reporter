import { defineConfig } from '@playwright/test';
import * as path from 'path';

// Causal timeline fixtures. Run `npm run build` first; the acceptance test sets
// TIMELINE_OUT to a temp dir so generated output never lands in the repo.
// Not named *.spec.ts so the demo configs (testDir './') do not pick up these deliberate failures.
const out = process.env.TIMELINE_OUT ?? path.join(__dirname, 'out');

export default defineConfig({
  testDir: __dirname,
  testMatch: 'timeline.fixtures.ts',
  outputDir: path.join(out, 'test-results'),
  retries: 0,
  workers: 1,
  use: {
    browserName: 'chromium',
    headless: true,
    trace: 'on',
  },
  reporter: [
    [path.join(__dirname, '../../dist/smart-reporter.js'), {
      outputFile: path.join(out, 'smart-report.html'),
      historyFile: path.join(out, 'test-history.json'),
      exportJson: true,
      enableAIRecommendations: false,
    }],
  ],
});
