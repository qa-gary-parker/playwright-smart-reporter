import { defineConfig } from '@playwright/test';
import * as path from 'path';

// Output directory is controlled by PLAYWRIGHT_BLOB_OUTPUT_DIR env var
// Resolve to absolute path from project root
const outputDir = process.env.PLAYWRIGHT_BLOB_OUTPUT_DIR || 'blob-report';
const projectRoot = path.resolve(__dirname, '..');

export default defineConfig({
  testDir: './parallel',
  timeout: 30000,
  use: {
    headless: true,
  },
  reporter: [
    ['blob'],
    ['../dist/smart-reporter.js', {
      outputFile: path.join(projectRoot, outputDir, 'smart-report.html'),
      historyFile: path.join(projectRoot, outputDir, 'test-history.json'),
    }],
  ],
});

