import { defineConfig } from '@playwright/test';
import * as path from 'path';

// Driven by the *.acceptance.ts files: ACCEPTANCE_OUT is the output folder, ACCEPTANCE_OPTIONS the reporter
// options as JSON and ACCEPTANCE_MATCH the fixture file, so one config serves every scenario.
// Fixtures are not named *.spec.ts so the demo configs skip them.
// ACCEPTANCE_PROJECTS names the projects, comma-separated. Without it the run has one unnamed project.
const out = process.env.ACCEPTANCE_OUT ?? path.join(__dirname, 'out');
const options = JSON.parse(process.env.ACCEPTANCE_OPTIONS ?? '{}');
const projects = process.env.ACCEPTANCE_PROJECTS ? process.env.ACCEPTANCE_PROJECTS.split(',').map((name) => ({ name })) : undefined;

export default defineConfig({
  ...(projects ? { projects } : {}),
  testDir: __dirname,
  testMatch: process.env.ACCEPTANCE_MATCH ?? 'suite.fixtures.ts',
  outputDir: path.join(out, 'test-results'),
  retries: 1,
  workers: 1,
  reporter: [
    [path.join(__dirname, '../../dist/smart-reporter.js'), {
      outputFile: path.join(out, 'smart-report.html'),
      historyFile: path.join(out, 'test-history.json'),
      ...options,
    }],
    // Playwright's own counts, the oracle the reporter's numbers are checked against.
    ['json', { outputFile: path.join(out, 'pw.json') }],
  ],
});
