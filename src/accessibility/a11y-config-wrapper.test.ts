import { describe, it, expect } from 'vitest';
import { withAccessibility } from './a11y-config-wrapper';

describe('withAccessibility', () => {
  it('adds _smartReporterA11y marker to config', () => {
    const config = { testDir: './tests' };
    const result = withAccessibility(config);
    expect(result._smartReporterA11y).toBe(true);
  });

  it('preserves all existing config properties', () => {
    const config = {
      testDir: './tests',
      timeout: 30000,
      use: { headless: true },
      reporter: [['html']],
    };
    const result = withAccessibility(config);
    expect(result.testDir).toBe('./tests');
    expect(result.timeout).toBe(30000);
    expect(result.use).toEqual({ headless: true });
    expect(result.reporter).toEqual([['html']]);
  });

  it('returns config with unchanged properties when no accessibility option present', () => {
    const config = { outputDir: 'results' };
    const result = withAccessibility(config);
    expect(result.outputDir).toBe('results');
    expect(result._smartReporterA11y).toBe(true);
    expect(Object.keys(result)).toEqual(['outputDir', '_smartReporterA11y']);
  });
});
