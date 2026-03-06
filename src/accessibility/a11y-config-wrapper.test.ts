import { describe, it, expect } from 'vitest';
import { withAccessibility } from './a11y-config-wrapper';

describe('withAccessibility', () => {
  it('injects smartReporterA11y into use config', () => {
    const config = { testDir: './tests' };
    const result = withAccessibility(config);
    expect((result as any).use).toBeDefined();
    expect((result as any).use.smartReporterA11y).toEqual({ enabled: true, standard: 'WCAG2AA' });
  });

  it('preserves existing use config properties', () => {
    const config = {
      testDir: './tests',
      use: { headless: true, baseURL: 'http://localhost:3000' },
    };
    const result = withAccessibility(config);
    expect((result as any).use.headless).toBe(true);
    expect((result as any).use.baseURL).toBe('http://localhost:3000');
    expect((result as any).use.smartReporterA11y).toEqual({ enabled: true, standard: 'WCAG2AA' });
  });

  it('extracts accessibility config from reporter options', () => {
    const config = {
      testDir: './tests',
      reporter: [
        ['html'],
        ['playwright-smart-reporter', { accessibility: { enabled: true, standard: 'WCAG2A' } }],
      ],
    };
    const result = withAccessibility(config);
    expect((result as any).use.smartReporterA11y).toEqual({ enabled: true, standard: 'WCAG2A' });
  });

  it('injects smartReporterA11y into each project use config', () => {
    const config = {
      projects: [
        { name: 'chromium', use: { browserName: 'chromium' } },
        { name: 'firefox', use: { browserName: 'firefox' } },
      ],
    };
    const result = withAccessibility(config);
    const projects = (result as any).projects;
    expect(projects).toHaveLength(2);
    expect(projects[0].use.smartReporterA11y).toEqual({ enabled: true, standard: 'WCAG2AA' });
    expect(projects[0].use.browserName).toBe('chromium');
    expect(projects[1].use.smartReporterA11y).toEqual({ enabled: true, standard: 'WCAG2AA' });
    expect(projects[1].use.browserName).toBe('firefox');
  });

  it('preserves all existing config properties', () => {
    const config = {
      testDir: './tests',
      timeout: 30000,
      reporter: [['html']],
    };
    const result = withAccessibility(config);
    expect(result.testDir).toBe('./tests');
    expect(result.timeout).toBe(30000);
    expect(result.reporter).toEqual([['html']]);
  });

  it('uses default config when no reporter accessibility option found', () => {
    const config = { outputDir: 'results' };
    const result = withAccessibility(config);
    expect((result as any).use.smartReporterA11y).toEqual({ enabled: true, standard: 'WCAG2AA' });
  });

  it('does not include _smartReporterA11y marker', () => {
    const config = { testDir: './tests' };
    const result = withAccessibility(config);
    expect((result as any)._smartReporterA11y).toBeUndefined();
  });
});
