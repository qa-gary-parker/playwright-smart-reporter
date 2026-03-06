export function withAccessibility<T extends Record<string, unknown>>(config: T): T & { _smartReporterA11y: boolean } {
  return {
    ...config,
    _smartReporterA11y: true,
  };
}
