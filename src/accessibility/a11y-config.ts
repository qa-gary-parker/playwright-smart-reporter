import type { AccessibilityConfig } from '../types';

type ConfigLike = {
  reporter?: unknown;
  use?: Record<string, unknown>;
  projects?: Array<{ use?: Record<string, unknown> }>;
};

const DEFAULT_CONFIG: AccessibilityConfig = { enabled: true, standard: 'WCAG2AA' };

function reporterA11yConfig(reporter: unknown): AccessibilityConfig | undefined {
  if (!Array.isArray(reporter)) return undefined;
  for (const entry of reporter) {
    if (Array.isArray(entry) && typeof entry[0] === 'string' && entry[0].includes('smart-reporter')) {
      const options = entry[1] as { accessibility?: AccessibilityConfig } | undefined;
      if (options?.accessibility) return options.accessibility;
    }
  }
  return undefined;
}

/**
 * Turns on the a11y fixture for every project by setting `use.smartReporterA11y`,
 * taken from the smart reporter's `accessibility` option (default: WCAG2AA, enabled).
 * Tests still need `test` from 'playwright-smart-reporter/accessibility'.
 */
export function withAccessibility<T extends object>(config: T): T & { use: Record<string, unknown> } {
  const c = config as T & ConfigLike;
  const smartReporterA11y = reporterA11yConfig(c.reporter) ?? { ...DEFAULT_CONFIG };
  const result = { ...c, use: { ...(c.use ?? {}), smartReporterA11y } };
  if (Array.isArray(c.projects)) {
    result.projects = c.projects.map(project => ({
      ...project,
      use: { ...(project.use ?? {}), smartReporterA11y },
    }));
  }
  return result;
}
