export function withAccessibility<T extends Record<string, unknown>>(config: T): T {
  // Extract accessibility config from reporter options
  const reporter = (config as any).reporter;
  let a11yConfig: Record<string, unknown> | undefined;

  if (Array.isArray(reporter)) {
    for (const entry of reporter) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && entry[0].includes('smart-reporter')) {
        const options = entry[1] as Record<string, unknown> | undefined;
        if (options?.accessibility) {
          a11yConfig = options.accessibility as Record<string, unknown>;
          break;
        }
      }
    }
  }

  if (!a11yConfig) {
    a11yConfig = { enabled: true, standard: 'WCAG2AA' };
  }

  // Inject smartReporterA11y into use config
  const use = { ...((config as any).use || {}), smartReporterA11y: a11yConfig };
  const result: Record<string, unknown> = { ...config, use };

  // Also inject into each project's use config
  if (Array.isArray((config as any).projects)) {
    result.projects = (config as any).projects.map((project: any) => ({
      ...project,
      use: { ...(project.use || {}), smartReporterA11y: a11yConfig },
    }));
  }

  return result as T;
}
