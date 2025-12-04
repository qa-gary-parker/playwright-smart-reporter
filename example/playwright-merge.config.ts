import { defineConfig } from '@playwright/test';
import * as path from 'path';

// Config used for merging blob reports from multiple machines
// Paths are resolved from project root (one level up from this config)
const projectRoot = path.resolve(__dirname, '..');

export default defineConfig({
  reporter: [
    ['../dist/smart-reporter.js', {
      outputFile: path.join(projectRoot, 'blob-reports/merged/smart-report.html'),
      historyFile: path.join(projectRoot, 'blob-reports/merged/test-history.json'),
    }],
  ],
});

