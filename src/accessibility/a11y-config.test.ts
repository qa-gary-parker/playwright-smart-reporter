import { describe, it, expect } from 'vitest';
import type { PlaywrightTestConfig } from '@playwright/test';
import { withAccessibility } from './a11y-config';
import * as packageEntry from '../smart-reporter';

const DEFAULT = { enabled: true, standard: 'WCAG2AA' };

describe('withAccessibility', () => {
  it('injects the default scan config into use', () => {
    const result = withAccessibility({ testDir: './tests' });
    expect(result).toEqual({ testDir: './tests', use: { smartReporterA11y: DEFAULT } });
  });

  it('preserves existing use options', () => {
    const result = withAccessibility({ use: { headless: true, baseURL: 'http://localhost:3000' } });
    expect(result.use).toEqual({ headless: true, baseURL: 'http://localhost:3000', smartReporterA11y: DEFAULT });
  });

  it('reads the accessibility option from the smart reporter entry', () => {
    const accessibility = { enabled: true, standard: 'WCAG2A', exclude: ['region'] };
    const config: PlaywrightTestConfig = {
      reporter: [['html'], ['playwright-smart-reporter', { accessibility }]],
    };
    const result = withAccessibility(config);
    expect(result.use).toEqual({ smartReporterA11y: accessibility });
  });

  it('matches a local smart reporter path', () => {
    const accessibility = { enabled: false };
    const result = withAccessibility({ reporter: [['../dist/smart-reporter.js', { accessibility }]] });
    expect(result.use).toEqual({ smartReporterA11y: accessibility });
  });

  it('injects into each project use, keeping project options', () => {
    const result = withAccessibility({
      projects: [
        { name: 'chromium', use: { browserName: 'chromium' } },
        { name: 'firefox' },
      ],
    });
    expect(result.projects).toEqual([
      { name: 'chromium', use: { browserName: 'chromium', smartReporterA11y: DEFAULT } },
      { name: 'firefox', use: { smartReporterA11y: DEFAULT } },
    ]);
  });

  it('leaves the input config unchanged', () => {
    const config = { use: { headless: true }, reporter: [['html']] as PlaywrightTestConfig['reporter'] };
    withAccessibility(config);
    expect(config).toEqual({ use: { headless: true }, reporter: [['html']] });
  });

  it('is exported from the package entry point', () => {
    expect(packageEntry.withAccessibility).toBe(withAccessibility);
  });
});
