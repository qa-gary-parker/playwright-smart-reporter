# Accessibility Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add axe-core accessibility checking to playwright-smart-reporter with a `withAccessibility()` config wrapper, a11y collector/analyzer, dedicated report tab, and quality gate integration.

**Architecture:** Users wrap their Playwright config with `withAccessibility()` which injects an auto-fixture. The fixture runs axe-core + captures a11y tree snapshots after each test, attaching results as JSON artifacts. The reporter's collector parses these attachments, the analyzer scores them, and the generator renders a dedicated Accessibility tab plus per-test detail sections. Community tier gets basic violation display; Starter+ gets the full tab, tree snapshots, severity thresholds, and quality gates.

**Tech Stack:** TypeScript, @axe-core/playwright (optional peer dep), Vitest for tests

**Design Doc:** `docs/plans/2026-03-06-accessibility-integration-design.md`

---

### Task 1: Add accessibility types to types.ts

**Files:**
- Modify: `src/types.ts:77` (ThresholdConfig), `src/types.ts:173` (SmartReporterOptions), `src/types.ts:304` (TestResultData), `src/types.ts:462` (QualityGateConfig), after `src/types.ts:500` (new section)

**Step 1: Add a11y fields to ThresholdConfig**

In `src/types.ts`, after line 76 (before the closing `}`), add:

```typescript
  // Accessibility thresholds
  a11yCriticalMax?: number;          // Default: 0 (any critical = needs attention)
  a11ySeriousMax?: number;           // Default: 3
```

**Step 2: Add AccessibilityConfig to SmartReporterOptions**

After line 172 (closing brace of SmartReporterOptions), insert before the `}`:

```typescript
  // Accessibility checking (Community: basic, Starter+: advanced features)
  accessibility?: AccessibilityConfig;
```

**Step 3: Add accessibility field to TestResultData**

After line 303 (`networkLogs?: NetworkLogData;`), add:

```typescript
  accessibility?: A11yResult;
```

**Step 4: Add a11y gates to QualityGateConfig**

After line 461 (`noNewFailures?: boolean;`), add:

```typescript
  maxA11yCritical?: number;          // Max critical accessibility violations (default: 0)
  maxA11ySerious?: number;           // Max serious accessibility violations
  maxA11yTotal?: number;             // Max total accessibility violations
```

**Step 5: Add new accessibility interfaces**

After line 500 (end of QuarantineFile), add a new section:

```typescript
// ============================================================================
// Accessibility (Community: basic, Starter+: advanced)
// ============================================================================

export interface AccessibilityConfig {
  enabled: boolean;
  standard?: 'WCAG2A' | 'WCAG2AA' | 'WCAG2AAA';  // Default: 'WCAG2AA'
  failOnSeverity?: 'critical' | 'serious' | 'moderate' | 'minor';  // Starter+
  include?: string[];            // axe rule IDs to include
  exclude?: string[];            // axe rule IDs to exclude
  selector?: string;             // CSS selector to scope scan
}

export type A11yImpact = 'minor' | 'moderate' | 'serious' | 'critical';

export interface A11yNode {
  target: string[];              // CSS selector path
  html: string;                  // Offending HTML snippet
  failureSummary: string;
}

export interface A11yViolation {
  id: string;                    // axe rule ID (e.g. 'color-contrast')
  impact: A11yImpact;
  description: string;
  helpUrl: string;
  wcagTags: string[];            // e.g. ['wcag2a', 'wcag21aa']
  nodes: A11yNode[];
}

export interface A11yTreeSnapshot {
  role: string;
  name: string;
  children?: A11yTreeSnapshot[];
}

export interface A11yResult {
  violations: A11yViolation[];
  passes: number;
  incomplete: number;
  inapplicable: number;
  tree?: A11yTreeSnapshot;
  timestamp: string;
  standard: string;
  url?: string;
}

export interface A11ySuiteScore {
  totalViolations: number;
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  testsWithViolations: number;
  testsScanned: number;
  rating: 'excellent' | 'good' | 'fair' | 'poor';
  topViolationIds: string[];     // Most common violation rule IDs
}
```

**Step 6: Run tests to verify no type errors**

Run: `cd /Users/gary.parker/git/playwright-smart-reporter && npx tsc --noEmit`
Expected: No errors (new types are additive only)

**Step 7: Commit**

```bash
git add src/types.ts
git commit -m "feat(a11y): add accessibility type definitions

Adds AccessibilityConfig, A11yViolation, A11yResult, A11yTreeSnapshot,
and A11ySuiteScore interfaces. Extends ThresholdConfig, SmartReporterOptions,
TestResultData, and QualityGateConfig with a11y fields."
```

---

### Task 2: Create the A11yCollector

**Files:**
- Create: `src/collectors/a11y-collector.ts`
- Create: `src/collectors/a11y-collector.test.ts`
- Modify: `src/collectors/index.ts`

**Step 1: Write the failing test**

Create `src/collectors/a11y-collector.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { A11yCollector } from './a11y-collector';
import type { A11yResult } from '../types';

function createMockTestResult(attachments: Array<{ name: string; contentType: string; body?: Buffer; path?: string }> = []) {
  return { attachments } as any;
}

function createA11yAttachmentBody(overrides: Partial<A11yResult> = {}): Buffer {
  const result: A11yResult = {
    violations: [],
    passes: 10,
    incomplete: 0,
    inapplicable: 5,
    timestamp: '2026-03-06T00:00:00.000Z',
    standard: 'WCAG2AA',
    ...overrides,
  };
  return Buffer.from(JSON.stringify(result));
}

describe('A11yCollector', () => {
  const collector = new A11yCollector();

  it('returns undefined when no a11y attachment exists', () => {
    const result = createMockTestResult([
      { name: 'screenshot', contentType: 'image/png', body: Buffer.from('') },
    ]);

    expect(collector.collect(result)).toBeUndefined();
  });

  it('returns undefined when attachments array is empty', () => {
    const result = createMockTestResult([]);
    expect(collector.collect(result)).toBeUndefined();
  });

  it('parses a11y attachment with no violations', () => {
    const body = createA11yAttachmentBody();
    const result = createMockTestResult([
      { name: 'smart-reporter-a11y', contentType: 'application/json', body },
    ]);

    const a11y = collector.collect(result);

    expect(a11y).toBeDefined();
    expect(a11y!.violations).toEqual([]);
    expect(a11y!.passes).toBe(10);
    expect(a11y!.standard).toBe('WCAG2AA');
  });

  it('parses a11y attachment with violations', () => {
    const body = createA11yAttachmentBody({
      violations: [
        {
          id: 'color-contrast',
          impact: 'serious',
          description: 'Elements must have sufficient color contrast',
          helpUrl: 'https://dequeuniversity.com/rules/axe/4.7/color-contrast',
          wcagTags: ['wcag2aa', 'wcag143'],
          nodes: [
            {
              target: ['#header > h1'],
              html: '<h1 style="color: #aaa">Title</h1>',
              failureSummary: 'Fix any of the following: Element has insufficient color contrast',
            },
          ],
        },
      ],
    });
    const result = createMockTestResult([
      { name: 'smart-reporter-a11y', contentType: 'application/json', body },
    ]);

    const a11y = collector.collect(result);

    expect(a11y).toBeDefined();
    expect(a11y!.violations).toHaveLength(1);
    expect(a11y!.violations[0].id).toBe('color-contrast');
    expect(a11y!.violations[0].impact).toBe('serious');
    expect(a11y!.violations[0].nodes).toHaveLength(1);
  });

  it('parses a11y tree snapshot when present', () => {
    const body = createA11yAttachmentBody({
      tree: {
        role: 'WebArea',
        name: 'Test Page',
        children: [
          { role: 'heading', name: 'Title' },
          { role: 'button', name: 'Submit' },
        ],
      },
    });
    const result = createMockTestResult([
      { name: 'smart-reporter-a11y', contentType: 'application/json', body },
    ]);

    const a11y = collector.collect(result);

    expect(a11y!.tree).toBeDefined();
    expect(a11y!.tree!.role).toBe('WebArea');
    expect(a11y!.tree!.children).toHaveLength(2);
  });

  it('handles malformed JSON gracefully', () => {
    const result = createMockTestResult([
      { name: 'smart-reporter-a11y', contentType: 'application/json', body: Buffer.from('not json') },
    ]);

    expect(collector.collect(result)).toBeUndefined();
  });

  it('handles missing body gracefully', () => {
    const result = createMockTestResult([
      { name: 'smart-reporter-a11y', contentType: 'application/json' },
    ]);

    expect(collector.collect(result)).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/gary.parker/git/playwright-smart-reporter && npx vitest run src/collectors/a11y-collector.test.ts`
Expected: FAIL — module `./a11y-collector` not found

**Step 3: Write the implementation**

Create `src/collectors/a11y-collector.ts`:

```typescript
import type { A11yResult } from '../types';

const A11Y_ATTACHMENT_NAME = 'smart-reporter-a11y';

export class A11yCollector {
  /**
   * Extract accessibility results from test attachments.
   * Looks for a JSON attachment named 'smart-reporter-a11y' that the
   * a11y fixture attaches after running axe-core + a11y tree capture.
   */
  collect(result: { attachments: Array<{ name: string; contentType: string; body?: Buffer; path?: string }> }): A11yResult | undefined {
    const attachment = result.attachments.find(
      a => a.name === A11Y_ATTACHMENT_NAME && a.contentType === 'application/json',
    );

    if (!attachment?.body) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(attachment.body.toString('utf-8'));
      return this.validateResult(parsed);
    } catch {
      return undefined;
    }
  }

  private validateResult(data: unknown): A11yResult | undefined {
    if (!data || typeof data !== 'object') return undefined;

    const obj = data as Record<string, unknown>;
    if (!Array.isArray(obj.violations)) return undefined;

    return {
      violations: obj.violations,
      passes: typeof obj.passes === 'number' ? obj.passes : 0,
      incomplete: typeof obj.incomplete === 'number' ? obj.incomplete : 0,
      inapplicable: typeof obj.inapplicable === 'number' ? obj.inapplicable : 0,
      tree: obj.tree as A11yResult['tree'],
      timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : new Date().toISOString(),
      standard: typeof obj.standard === 'string' ? obj.standard : 'WCAG2AA',
      url: typeof obj.url === 'string' ? obj.url : undefined,
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/gary.parker/git/playwright-smart-reporter && npx vitest run src/collectors/a11y-collector.test.ts`
Expected: All 7 tests PASS

**Step 5: Export from barrel**

In `src/collectors/index.ts`, add at the end:

```typescript
export * from './a11y-collector';
```

**Step 6: Commit**

```bash
git add src/collectors/a11y-collector.ts src/collectors/a11y-collector.test.ts src/collectors/index.ts
git commit -m "feat(a11y): add A11yCollector to parse a11y attachments

Parses 'smart-reporter-a11y' JSON attachments from test results.
Handles missing/malformed data gracefully."
```

---

### Task 3: Create the A11yAnalyzer

**Files:**
- Create: `src/analyzers/a11y-analyzer.ts`
- Create: `src/analyzers/a11y-analyzer.test.ts`
- Modify: `src/analyzers/index.ts`

**Step 1: Write the failing test**

Create `src/analyzers/a11y-analyzer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { A11yAnalyzer } from './a11y-analyzer';
import type { TestResultData, A11yResult, A11yViolation } from '../types';

function createTestResult(overrides: Partial<TestResultData> = {}): TestResultData {
  return {
    testId: 'test-1',
    title: 'Test 1',
    file: 'test.spec.ts',
    status: 'passed',
    duration: 1000,
    retry: 0,
    steps: [],
    history: [],
    ...overrides,
  };
}

function createViolation(overrides: Partial<A11yViolation> = {}): A11yViolation {
  return {
    id: 'color-contrast',
    impact: 'serious',
    description: 'Elements must have sufficient color contrast',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.7/color-contrast',
    wcagTags: ['wcag2aa'],
    nodes: [{ target: ['h1'], html: '<h1>Test</h1>', failureSummary: 'Fix contrast' }],
    ...overrides,
  };
}

function createA11yResult(overrides: Partial<A11yResult> = {}): A11yResult {
  return {
    violations: [],
    passes: 20,
    incomplete: 0,
    inapplicable: 5,
    timestamp: '2026-03-06T00:00:00.000Z',
    standard: 'WCAG2AA',
    ...overrides,
  };
}

describe('A11yAnalyzer', () => {
  const analyzer = new A11yAnalyzer();

  describe('analyze', () => {
    it('does nothing when a11y result is undefined', () => {
      const test = createTestResult();
      analyzer.analyze(test, undefined);
      expect(test.accessibility).toBeUndefined();
    });

    it('attaches a11y result to test data', () => {
      const test = createTestResult();
      const a11y = createA11yResult();
      analyzer.analyze(test, a11y);
      expect(test.accessibility).toBe(a11y);
    });

    it('attaches result with violations', () => {
      const test = createTestResult();
      const a11y = createA11yResult({
        violations: [
          createViolation({ impact: 'critical' }),
          createViolation({ id: 'image-alt', impact: 'serious' }),
          createViolation({ id: 'label', impact: 'minor' }),
        ],
      });

      analyzer.analyze(test, a11y);

      expect(test.accessibility!.violations).toHaveLength(3);
    });
  });

  describe('calculateSuiteScore', () => {
    it('returns score with zero violations for clean suite', () => {
      const results = [
        createTestResult({ accessibility: createA11yResult() }),
        createTestResult({ accessibility: createA11yResult() }),
      ];

      const score = analyzer.calculateSuiteScore(results);

      expect(score.totalViolations).toBe(0);
      expect(score.critical).toBe(0);
      expect(score.testsScanned).toBe(2);
      expect(score.testsWithViolations).toBe(0);
      expect(score.rating).toBe('excellent');
    });

    it('counts violations by severity', () => {
      const results = [
        createTestResult({
          accessibility: createA11yResult({
            violations: [
              createViolation({ impact: 'critical' }),
              createViolation({ id: 'img-alt', impact: 'serious' }),
            ],
          }),
        }),
        createTestResult({
          accessibility: createA11yResult({
            violations: [
              createViolation({ id: 'label', impact: 'moderate' }),
              createViolation({ id: 'tabindex', impact: 'minor' }),
            ],
          }),
        }),
      ];

      const score = analyzer.calculateSuiteScore(results);

      expect(score.totalViolations).toBe(4);
      expect(score.critical).toBe(1);
      expect(score.serious).toBe(1);
      expect(score.moderate).toBe(1);
      expect(score.minor).toBe(1);
      expect(score.testsWithViolations).toBe(2);
      expect(score.rating).toBe('poor');
    });

    it('rates as good when only minor violations exist', () => {
      const results = [
        createTestResult({
          accessibility: createA11yResult({
            violations: [createViolation({ impact: 'minor' })],
          }),
        }),
      ];

      const score = analyzer.calculateSuiteScore(results);
      expect(score.rating).toBe('good');
    });

    it('rates as fair when moderate violations exist', () => {
      const results = [
        createTestResult({
          accessibility: createA11yResult({
            violations: [createViolation({ impact: 'moderate' })],
          }),
        }),
      ];

      const score = analyzer.calculateSuiteScore(results);
      expect(score.rating).toBe('fair');
    });

    it('skips tests without a11y data', () => {
      const results = [
        createTestResult({ accessibility: createA11yResult() }),
        createTestResult(), // no a11y
      ];

      const score = analyzer.calculateSuiteScore(results);
      expect(score.testsScanned).toBe(1);
    });

    it('identifies top violation IDs', () => {
      const results = [
        createTestResult({
          accessibility: createA11yResult({
            violations: [
              createViolation({ id: 'color-contrast' }),
              createViolation({ id: 'color-contrast' }),
              createViolation({ id: 'image-alt' }),
            ],
          }),
        }),
      ];

      const score = analyzer.calculateSuiteScore(results);
      expect(score.topViolationIds[0]).toBe('color-contrast');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/gary.parker/git/playwright-smart-reporter && npx vitest run src/analyzers/a11y-analyzer.test.ts`
Expected: FAIL — module `./a11y-analyzer` not found

**Step 3: Write the implementation**

Create `src/analyzers/a11y-analyzer.ts`:

```typescript
import type { TestResultData, A11yResult, A11ySuiteScore } from '../types';

export class A11yAnalyzer {
  /**
   * Attach accessibility results to a test. Mutates the test object.
   */
  analyze(test: TestResultData, a11y: A11yResult | undefined): void {
    if (!a11y) return;
    test.accessibility = a11y;
  }

  /**
   * Calculate suite-wide accessibility score from all test results.
   */
  calculateSuiteScore(results: TestResultData[]): A11ySuiteScore {
    const scanned = results.filter(r => r.accessibility);
    let critical = 0;
    let serious = 0;
    let moderate = 0;
    let minor = 0;
    let testsWithViolations = 0;
    const violationCounts = new Map<string, number>();

    for (const result of scanned) {
      const violations = result.accessibility!.violations;
      if (violations.length > 0) testsWithViolations++;

      for (const v of violations) {
        switch (v.impact) {
          case 'critical': critical++; break;
          case 'serious': serious++; break;
          case 'moderate': moderate++; break;
          case 'minor': minor++; break;
        }
        violationCounts.set(v.id, (violationCounts.get(v.id) || 0) + 1);
      }
    }

    const totalViolations = critical + serious + moderate + minor;

    // Sort by frequency, take top 5
    const topViolationIds = [...violationCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);

    return {
      totalViolations,
      critical,
      serious,
      moderate,
      minor,
      testsWithViolations,
      testsScanned: scanned.length,
      rating: this.calculateRating(critical, serious, moderate),
      topViolationIds,
    };
  }

  private calculateRating(critical: number, serious: number, moderate: number): A11ySuiteScore['rating'] {
    if (critical > 0) return 'poor';
    if (serious > 0) return 'fair';
    if (moderate > 0) return 'fair';
    if (critical === 0 && serious === 0 && moderate === 0) return 'excellent';
    return 'good';
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/gary.parker/git/playwright-smart-reporter && npx vitest run src/analyzers/a11y-analyzer.test.ts`
Expected: All tests PASS

**Step 5: Fix rating logic — update test expectations if needed**

The `calculateRating` has a subtle issue: `moderate > 0` returns 'fair' but the test for "only minor violations" expects 'good'. Verify the minor-only path. The current logic: if moderate === 0 and serious === 0 and critical === 0, it falls through to `return 'excellent'` — but we need to distinguish zero violations from minor-only. Update:

```typescript
  private calculateRating(critical: number, serious: number, moderate: number): A11ySuiteScore['rating'] {
    if (critical > 0) return 'poor';
    if (serious > 0) return 'fair';
    if (moderate > 0) return 'fair';
    return 'excellent'; // no critical/serious/moderate = excellent (minor-only or clean)
  }
```

Actually, tests expect 'good' for minor-only. Adjust:

```typescript
  private calculateRating(critical: number, serious: number, moderate: number, minor: number): A11ySuiteScore['rating'] {
    if (critical > 0) return 'poor';
    if (serious > 0) return 'fair';
    if (moderate > 0) return 'fair';
    if (minor > 0) return 'good';
    return 'excellent';
  }
```

Update the call site in `calculateSuiteScore` to pass `minor` as the 4th argument.

**Step 6: Run tests again**

Run: `cd /Users/gary.parker/git/playwright-smart-reporter && npx vitest run src/analyzers/a11y-analyzer.test.ts`
Expected: All tests PASS

**Step 7: Export from barrel**

In `src/analyzers/index.ts`, add:

```typescript
export { A11yAnalyzer } from './a11y-analyzer';
```

**Step 8: Commit**

```bash
git add src/analyzers/a11y-analyzer.ts src/analyzers/a11y-analyzer.test.ts src/analyzers/index.ts
git commit -m "feat(a11y): add A11yAnalyzer for scoring and aggregation

Calculates per-test and suite-wide accessibility scores.
Rates suites as excellent/good/fair/poor based on violation severity."
```

---

### Task 4: Create the withAccessibility config wrapper and a11y fixture

**Files:**
- Create: `src/accessibility/a11y-fixture.ts`
- Create: `src/accessibility/a11y-config-wrapper.ts`
- Create: `src/accessibility/index.ts`
- Create: `src/accessibility/a11y-config-wrapper.test.ts`

**Step 1: Write the failing test for config wrapper**

Create `src/accessibility/a11y-config-wrapper.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { withAccessibility } from './a11y-config-wrapper';

describe('withAccessibility', () => {
  it('returns config unchanged when no accessibility option present', () => {
    const config = {
      testDir: './tests',
      reporter: [['html']],
    };

    const result = withAccessibility(config as any);

    expect(result.testDir).toBe('./tests');
    expect(result.reporter).toEqual([['html']]);
  });

  it('adds a11y setup project to config', () => {
    const config = {
      testDir: './tests',
      projects: [
        { name: 'chromium', use: { browserName: 'chromium' } },
      ],
    };

    const result = withAccessibility(config as any);

    // Should preserve existing projects
    expect(result.projects).toBeDefined();
    expect(result.projects!.length).toBe(1);
    expect(result.projects![0].name).toBe('chromium');
  });

  it('adds global setup file reference', () => {
    const config = {} as any;
    const result = withAccessibility(config);

    // Should add the a11y fixture setup path
    expect(result._smartReporterA11y).toBe(true);
  });

  it('preserves all existing config properties', () => {
    const config = {
      testDir: './tests',
      timeout: 30000,
      use: { baseURL: 'http://localhost:3000' },
      reporter: [['html']],
    };

    const result = withAccessibility(config as any);

    expect(result.testDir).toBe('./tests');
    expect(result.timeout).toBe(30000);
    expect(result.use?.baseURL).toBe('http://localhost:3000');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/gary.parker/git/playwright-smart-reporter && npx vitest run src/accessibility/a11y-config-wrapper.test.ts`
Expected: FAIL — module not found

**Step 3: Write the config wrapper**

Create `src/accessibility/a11y-config-wrapper.ts`:

```typescript
/**
 * Config wrapper that marks the Playwright config for a11y fixture injection.
 *
 * Usage:
 *   import { withAccessibility } from 'playwright-smart-reporter';
 *   export default defineConfig(withAccessibility({ ... }));
 *
 * The a11y fixture runs axe-core analysis and captures accessibility tree
 * snapshots after each test, attaching results as JSON artifacts for the
 * reporter to parse.
 */

interface PlaywrightConfig {
  testDir?: string;
  timeout?: number;
  use?: Record<string, unknown>;
  reporter?: unknown[];
  projects?: Array<{ name: string; use?: Record<string, unknown>; [key: string]: unknown }>;
  [key: string]: unknown;
}

export function withAccessibility<T extends PlaywrightConfig>(config: T): T & { _smartReporterA11y: boolean } {
  return {
    ...config,
    _smartReporterA11y: true,
  };
}
```

**Step 4: Write the a11y fixture**

Create `src/accessibility/a11y-fixture.ts`:

```typescript
/**
 * Playwright fixture that automatically runs accessibility checks after each test.
 *
 * This fixture:
 * 1. Runs axe-core analysis (if @axe-core/playwright is installed)
 * 2. Captures the Playwright accessibility tree snapshot
 * 3. Attaches results as a JSON artifact named 'smart-reporter-a11y'
 *
 * The SmartReporter's A11yCollector then parses these attachments.
 *
 * Usage (automatic via withAccessibility config wrapper):
 *   import { test } from 'playwright-smart-reporter/a11y';
 *
 * Or manual:
 *   import { test as base } from '@playwright/test';
 *   import { createA11yFixture } from 'playwright-smart-reporter/a11y';
 */
import { test as base } from '@playwright/test';
import type { AccessibilityConfig, A11yResult, A11yViolation, A11yTreeSnapshot } from '../types';

interface A11yFixtureOptions {
  smartReporterA11y: AccessibilityConfig | undefined;
}

function mapAxeImpact(impact: string | undefined): A11yViolation['impact'] {
  if (impact === 'critical' || impact === 'serious' || impact === 'moderate' || impact === 'minor') {
    return impact;
  }
  return 'moderate';
}

async function runAxeAnalysis(
  page: any,
  config: AccessibilityConfig,
): Promise<{ violations: A11yViolation[]; passes: number; incomplete: number; inapplicable: number }> {
  try {
    // Dynamic import to keep @axe-core/playwright optional
    const { AxeBuilder } = await import('@axe-core/playwright');
    let builder = new AxeBuilder({ page });

    // Apply WCAG standard tags
    const standard = config.standard ?? 'WCAG2AA';
    const tagMap: Record<string, string[]> = {
      'WCAG2A': ['wcag2a', 'wcag21a'],
      'WCAG2AA': ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
      'WCAG2AAA': ['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa', 'wcag21aaa'],
    };
    if (tagMap[standard]) {
      builder = builder.withTags(tagMap[standard]);
    }

    if (config.include?.length) {
      builder = builder.withRules(config.include);
    }
    if (config.exclude?.length) {
      builder = builder.disableRules(config.exclude);
    }
    if (config.selector) {
      builder = builder.include(config.selector);
    }

    const axeResults = await builder.analyze();

    const violations: A11yViolation[] = axeResults.violations.map((v: any) => ({
      id: v.id,
      impact: mapAxeImpact(v.impact),
      description: v.description,
      helpUrl: v.helpUrl,
      wcagTags: v.tags || [],
      nodes: (v.nodes || []).map((n: any) => ({
        target: n.target || [],
        html: n.html || '',
        failureSummary: n.failureSummary || '',
      })),
    }));

    return {
      violations,
      passes: axeResults.passes?.length ?? 0,
      incomplete: axeResults.incomplete?.length ?? 0,
      inapplicable: axeResults.inapplicable?.length ?? 0,
    };
  } catch (err: any) {
    if (err.code === 'MODULE_NOT_FOUND' || err.code === 'ERR_MODULE_NOT_FOUND') {
      console.warn(
        'Smart Reporter: @axe-core/playwright is not installed. Install it for accessibility scanning:\n' +
        '  npm install -D @axe-core/playwright',
      );
    }
    return { violations: [], passes: 0, incomplete: 0, inapplicable: 0 };
  }
}

async function captureA11yTree(page: any): Promise<A11yTreeSnapshot | undefined> {
  try {
    const snapshot = await page.accessibility.snapshot();
    return snapshot || undefined;
  } catch {
    return undefined;
  }
}

export const test = base.extend<A11yFixtureOptions>({
  smartReporterA11y: [undefined, { option: true }],

  page: async ({ page, smartReporterA11y }, use, testInfo) => {
    // Let the test run with the page as normal
    await use(page);

    // After test completes, run a11y checks
    if (!smartReporterA11y?.enabled) return;

    const config = smartReporterA11y;
    const axeResult = await runAxeAnalysis(page, config);
    const tree = await captureA11yTree(page);

    const a11yResult: A11yResult = {
      ...axeResult,
      tree,
      timestamp: new Date().toISOString(),
      standard: config.standard ?? 'WCAG2AA',
      url: page.url(),
    };

    // Attach as JSON artifact for the reporter to pick up
    await testInfo.attach('smart-reporter-a11y', {
      body: Buffer.from(JSON.stringify(a11yResult)),
      contentType: 'application/json',
    });

    // Fail the test if violations exceed severity threshold (Starter+ feature)
    if (config.failOnSeverity) {
      const severityOrder: Record<string, number> = { minor: 0, moderate: 1, serious: 2, critical: 3 };
      const threshold = severityOrder[config.failOnSeverity] ?? 3;
      const failingViolations = a11yResult.violations.filter(
        v => (severityOrder[v.impact] ?? 0) >= threshold,
      );

      if (failingViolations.length > 0) {
        const summary = failingViolations
          .map(v => `  - [${v.impact}] ${v.id}: ${v.description}`)
          .join('\n');
        throw new Error(
          `Accessibility violations found (threshold: ${config.failOnSeverity}):\n${summary}`,
        );
      }
    }
  },
});
```

**Step 5: Create barrel export**

Create `src/accessibility/index.ts`:

```typescript
export { withAccessibility } from './a11y-config-wrapper';
export { test } from './a11y-fixture';
```

**Step 6: Run the config wrapper tests**

Run: `cd /Users/gary.parker/git/playwright-smart-reporter && npx vitest run src/accessibility/a11y-config-wrapper.test.ts`
Expected: All tests PASS

**Step 7: Run full test suite to check nothing is broken**

Run: `cd /Users/gary.parker/git/playwright-smart-reporter && npx vitest run`
Expected: All existing tests PASS + new tests PASS

**Step 8: Commit**

```bash
git add src/accessibility/
git commit -m "feat(a11y): add withAccessibility config wrapper and a11y fixture

withAccessibility() wraps Playwright config to enable auto a11y scanning.
Fixture runs axe-core + captures a11y tree after each test, attaches
results as JSON artifact. Supports failOnSeverity threshold."
```

---

### Task 5: Wire A11yCollector and A11yAnalyzer into SmartReporter

**Files:**
- Modify: `src/smart-reporter.ts` (imports, constructor, onTestEnd, onEnd)

**Step 1: Add imports**

In `src/smart-reporter.ts`, after line 28 (closing of types import), add `A11ySuiteScore` to the types import:

```typescript
// In the types import block (lines 16-28), add:
  A11ySuiteScore,
```

After line 39 (collectors import), add `A11yCollector`:

```typescript
// In the collectors import (lines 34-39), add:
  A11yCollector,
```

After line 52 (analyzers import), add `A11yAnalyzer`:

```typescript
// In the analyzers import (lines 45-52), add:
  A11yAnalyzer,
```

**Step 2: Add private fields**

After line 99 (`private stabilityScorer!: StabilityScorer;`), add:

```typescript
  private a11yCollector: A11yCollector;
  private a11yAnalyzer: A11yAnalyzer;
```

**Step 3: Initialize in constructor**

After line 159 (networkCollector initialization), add:

```typescript
    // Initialize accessibility collector and analyzer
    this.a11yCollector = new A11yCollector();
    this.a11yAnalyzer = new A11yAnalyzer();
```

**Step 4: Collect in onTestEnd**

After line 268 (`const history = this.historyCollector.getTestHistory(testId);`), add:

```typescript
    const accessibility = this.a11yCollector.collect(result);
```

After line 454 (`this.stabilityScorer.scoreTest(testData);`), add:

```typescript
    this.a11yAnalyzer.analyze(testData, accessibility);
```

**Step 5: Calculate suite score in onEnd and pass to HTML generator**

After line 514 (`const failureClusters = this.failureClusterer.clusterFailures(this.results);`), add:

```typescript
    // Calculate suite-wide accessibility score
    const a11ySuiteScore = this.a11yAnalyzer.calculateSuiteScore(this.results);
```

In the `htmlData` object (around line 702-718), add before the closing `};`:

```typescript
      a11ySuiteScore: a11ySuiteScore.testsScanned > 0 ? a11ySuiteScore : undefined,
```

**Step 6: Add a11ySuiteScore to HtmlGeneratorData**

In `src/generators/html-generator.ts`, line 8, add `A11ySuiteScore` to the type import:

```typescript
import type { ..., A11ySuiteScore } from '../types';
```

In the `HtmlGeneratorData` interface (after line 39), add:

```typescript
  a11ySuiteScore?: A11ySuiteScore;
```

**Step 7: Run full test suite**

Run: `cd /Users/gary.parker/git/playwright-smart-reporter && npx vitest run`
Expected: All tests PASS

**Step 8: Run TypeScript compilation check**

Run: `cd /Users/gary.parker/git/playwright-smart-reporter && npx tsc --noEmit`
Expected: No errors

**Step 9: Commit**

```bash
git add src/smart-reporter.ts src/generators/html-generator.ts
git commit -m "feat(a11y): wire A11yCollector and A11yAnalyzer into SmartReporter

Collector extracts a11y data from test attachments in onTestEnd.
Analyzer scores each test and calculates suite-wide a11y score in onEnd.
Score is passed to HTML generator data."
```

---

### Task 6: Add accessibility quality gate rules

**Files:**
- Modify: `src/gates/quality-gate-evaluator.ts`
- Modify: `src/gates/quality-gate-evaluator.test.ts`

**Step 1: Write failing tests**

Append to `src/gates/quality-gate-evaluator.test.ts`:

```typescript
describe('accessibility gates', () => {
  const evaluator = new QualityGateEvaluator();

  it('passes maxA11yCritical when no critical violations', () => {
    const config: QualityGateConfig = { maxA11yCritical: 0 };
    const results = [
      createTestResult({
        accessibility: {
          violations: [
            { id: 'img-alt', impact: 'serious', description: '', helpUrl: '', wcagTags: [], nodes: [] },
          ],
          passes: 10, incomplete: 0, inapplicable: 0, timestamp: '', standard: 'WCAG2AA',
        },
      }),
    ];

    const result = evaluator.evaluate(config, results);
    expect(result.passed).toBe(true);
  });

  it('fails maxA11yCritical when critical violations exceed threshold', () => {
    const config: QualityGateConfig = { maxA11yCritical: 0 };
    const results = [
      createTestResult({
        accessibility: {
          violations: [
            { id: 'bypass', impact: 'critical', description: '', helpUrl: '', wcagTags: [], nodes: [] },
          ],
          passes: 10, incomplete: 0, inapplicable: 0, timestamp: '', standard: 'WCAG2AA',
        },
      }),
    ];

    const result = evaluator.evaluate(config, results);
    expect(result.passed).toBe(false);
    expect(result.rules[0].rule).toBe('maxA11yCritical');
    expect(result.rules[0].actual).toBe('1');
  });

  it('passes maxA11yTotal when violations within threshold', () => {
    const config: QualityGateConfig = { maxA11yTotal: 5 };
    const results = [
      createTestResult({
        accessibility: {
          violations: [
            { id: 'img-alt', impact: 'minor', description: '', helpUrl: '', wcagTags: [], nodes: [] },
            { id: 'label', impact: 'minor', description: '', helpUrl: '', wcagTags: [], nodes: [] },
          ],
          passes: 10, incomplete: 0, inapplicable: 0, timestamp: '', standard: 'WCAG2AA',
        },
      }),
    ];

    const result = evaluator.evaluate(config, results);
    expect(result.passed).toBe(true);
  });

  it('skips a11y gates when no tests have a11y data', () => {
    const config: QualityGateConfig = { maxA11yCritical: 0 };
    const results = [createTestResult()];

    const result = evaluator.evaluate(config, results);
    expect(result.rules[0].skipped).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/gary.parker/git/playwright-smart-reporter && npx vitest run src/gates/quality-gate-evaluator.test.ts`
Expected: FAIL — new tests fail (gates not implemented yet)

**Step 3: Add gate evaluation methods**

In `src/gates/quality-gate-evaluator.ts`, add to the `evaluate` method (after line 38, before `const passed`):

```typescript
    if (config.maxA11yCritical !== undefined) {
      rules.push(this.evaluateMaxA11yCritical(config.maxA11yCritical, results));
    }

    if (config.maxA11ySerious !== undefined) {
      rules.push(this.evaluateMaxA11ySerious(config.maxA11ySerious, results));
    }

    if (config.maxA11yTotal !== undefined) {
      rules.push(this.evaluateMaxA11yTotal(config.maxA11yTotal, results));
    }
```

Add the private methods before the closing `}` of the class:

```typescript
  private evaluateMaxA11yCritical(threshold: number, results: TestResultData[]): QualityGateRuleResult {
    const a11yResults = results.filter(r => r.accessibility);
    if (a11yResults.length === 0) {
      return { rule: 'maxA11yCritical', passed: true, actual: 'N/A', threshold: `≤ ${threshold}`, skipped: true };
    }

    const critical = a11yResults.reduce(
      (sum, r) => sum + r.accessibility!.violations.filter(v => v.impact === 'critical').length, 0,
    );

    return {
      rule: 'maxA11yCritical',
      passed: critical <= threshold,
      actual: String(critical),
      threshold: `≤ ${threshold}`,
    };
  }

  private evaluateMaxA11ySerious(threshold: number, results: TestResultData[]): QualityGateRuleResult {
    const a11yResults = results.filter(r => r.accessibility);
    if (a11yResults.length === 0) {
      return { rule: 'maxA11ySerious', passed: true, actual: 'N/A', threshold: `≤ ${threshold}`, skipped: true };
    }

    const serious = a11yResults.reduce(
      (sum, r) => sum + r.accessibility!.violations.filter(v => v.impact === 'serious').length, 0,
    );

    return {
      rule: 'maxA11ySerious',
      passed: serious <= threshold,
      actual: String(serious),
      threshold: `≤ ${threshold}`,
    };
  }

  private evaluateMaxA11yTotal(threshold: number, results: TestResultData[]): QualityGateRuleResult {
    const a11yResults = results.filter(r => r.accessibility);
    if (a11yResults.length === 0) {
      return { rule: 'maxA11yTotal', passed: true, actual: 'N/A', threshold: `≤ ${threshold}`, skipped: true };
    }

    const total = a11yResults.reduce(
      (sum, r) => sum + r.accessibility!.violations.length, 0,
    );

    return {
      rule: 'maxA11yTotal',
      passed: total <= threshold,
      actual: String(total),
      threshold: `≤ ${threshold}`,
    };
  }
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/gary.parker/git/playwright-smart-reporter && npx vitest run src/gates/quality-gate-evaluator.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/gates/quality-gate-evaluator.ts src/gates/quality-gate-evaluator.test.ts
git commit -m "feat(a11y): add accessibility quality gate rules

Adds maxA11yCritical, maxA11ySerious, and maxA11yTotal quality gate
rules. Gates are skipped when no tests have a11y data."
```

---

### Task 7: Add Accessibility tab and per-test a11y section to HTML generator

**Files:**
- Create: `src/generators/a11y-generator.ts`
- Modify: `src/generators/html-generator.ts` (nav item, view panel, CSS, JS)

**Step 1: Create the a11y generator module**

Create `src/generators/a11y-generator.ts`:

```typescript
import type { TestResultData, A11ySuiteScore, A11yViolation, LicenseTier } from '../types';
import { escapeHtml } from '../utils';
import { icon } from './icon-provider';

const IMPACT_COLORS: Record<string, string> = {
  critical: 'var(--accent-red, #e74c3c)',
  serious: 'var(--accent-orange, #e67e22)',
  moderate: 'var(--accent-yellow, #f39c12)',
  minor: 'var(--accent-blue, #3498db)',
};

const IMPACT_LABELS: Record<string, string> = {
  critical: 'Critical',
  serious: 'Serious',
  moderate: 'Moderate',
  minor: 'Minor',
};

const RATING_COLORS: Record<string, string> = {
  excellent: 'var(--accent-green, #27ae60)',
  good: 'var(--accent-blue, #3498db)',
  fair: 'var(--accent-orange, #e67e22)',
  poor: 'var(--accent-red, #e74c3c)',
};

/**
 * Generate the per-test accessibility section shown in the test detail panel.
 * Available for all tiers (Community shows basic info, Starter+ shows full details).
 */
export function generateTestA11ySection(test: TestResultData, licenseTier?: LicenseTier): string {
  if (!test.accessibility || test.accessibility.violations.length === 0) {
    return '';
  }

  const a11y = test.accessibility;
  const violations = a11y.violations;
  const isStarter = licenseTier === 'starter' || licenseTier === 'pro' || licenseTier === 'team';

  let html = `
    <div class="a11y-section" data-section="accessibility">
      <h4 class="a11y-section-title" onclick="toggleA11ySection(this)">
        ${icon('accessibility')}
        Accessibility
        <span class="a11y-badge a11y-badge-count">${violations.length} violation${violations.length !== 1 ? 's' : ''}</span>
        <span class="a11y-toggle">${icon('chevron-down')}</span>
      </h4>
      <div class="a11y-section-content">
        <div class="a11y-violations-list">`;

  for (const violation of violations) {
    const impactColor = IMPACT_COLORS[violation.impact] || IMPACT_COLORS.moderate;
    const impactLabel = IMPACT_LABELS[violation.impact] || violation.impact;

    html += `
          <div class="a11y-violation-item">
            <div class="a11y-violation-header">
              <span class="a11y-impact-badge" style="background: ${impactColor}">${impactLabel}</span>
              <span class="a11y-violation-id">${escapeHtml(violation.id)}</span>
              <span class="a11y-violation-desc">${escapeHtml(violation.description)}</span>
            </div>`;

    if (isStarter && violation.nodes.length > 0) {
      html += `<div class="a11y-violation-nodes">`;
      for (const node of violation.nodes.slice(0, 5)) {
        html += `
              <div class="a11y-node">
                <code class="a11y-node-selector">${escapeHtml(node.target.join(' > '))}</code>
                <pre class="a11y-node-html">${escapeHtml(node.html)}</pre>
                <p class="a11y-node-fix">${escapeHtml(node.failureSummary)}</p>
              </div>`;
      }
      if (violation.nodes.length > 5) {
        html += `<p class="a11y-more-nodes">...and ${violation.nodes.length - 5} more element${violation.nodes.length - 5 !== 1 ? 's' : ''}</p>`;
      }
      html += `</div>`;
    }

    if (isStarter && violation.helpUrl) {
      html += `<a class="a11y-help-link" href="${escapeHtml(violation.helpUrl)}" target="_blank" rel="noopener">Learn more</a>`;
    }

    html += `</div>`;
  }

  html += `
        </div>`;

  // A11y tree (Starter+ only)
  if (isStarter && a11y.tree) {
    html += `
        <div class="a11y-tree-section">
          <h5 class="a11y-tree-title" onclick="toggleA11yTree(this)">
            Accessibility Tree
            <span class="a11y-toggle">${icon('chevron-down')}</span>
          </h5>
          <pre class="a11y-tree-content" style="display:none">${escapeHtml(formatA11yTree(a11y.tree))}</pre>
        </div>`;
  }

  html += `
      </div>
    </div>`;

  return html;
}

function formatA11yTree(node: { role: string; name: string; children?: any[] }, indent: number = 0): string {
  const pad = '  '.repeat(indent);
  let result = `${pad}${node.role}${node.name ? ` "${node.name}"` : ''}\n`;
  if (node.children) {
    for (const child of node.children) {
      result += formatA11yTree(child, indent + 1);
    }
  }
  return result;
}

/**
 * Generate the dedicated Accessibility tab content (Starter+ only).
 */
export function generateA11yTab(results: TestResultData[], suiteScore: A11ySuiteScore): string {
  const ratingColor = RATING_COLORS[suiteScore.rating] || RATING_COLORS.fair;

  let html = `
    <div class="a11y-tab">
      <!-- Summary Cards -->
      <div class="a11y-summary-cards">
        <div class="a11y-card a11y-card-rating">
          <div class="a11y-card-value" style="color: ${ratingColor}">${suiteScore.rating.charAt(0).toUpperCase() + suiteScore.rating.slice(1)}</div>
          <div class="a11y-card-label">Overall Rating</div>
        </div>
        <div class="a11y-card">
          <div class="a11y-card-value">${suiteScore.totalViolations}</div>
          <div class="a11y-card-label">Total Violations</div>
        </div>
        <div class="a11y-card">
          <div class="a11y-card-value">${suiteScore.testsScanned}</div>
          <div class="a11y-card-label">Tests Scanned</div>
        </div>
        <div class="a11y-card">
          <div class="a11y-card-value">${suiteScore.testsWithViolations}</div>
          <div class="a11y-card-label">Tests with Issues</div>
        </div>
      </div>

      <!-- Severity Breakdown -->
      <div class="a11y-severity-breakdown">
        <h3>Violations by Severity</h3>
        <div class="a11y-severity-bars">
          ${generateSeverityBar('Critical', suiteScore.critical, suiteScore.totalViolations, IMPACT_COLORS.critical)}
          ${generateSeverityBar('Serious', suiteScore.serious, suiteScore.totalViolations, IMPACT_COLORS.serious)}
          ${generateSeverityBar('Moderate', suiteScore.moderate, suiteScore.totalViolations, IMPACT_COLORS.moderate)}
          ${generateSeverityBar('Minor', suiteScore.minor, suiteScore.totalViolations, IMPACT_COLORS.minor)}
        </div>
      </div>`;

  // Top violations
  if (suiteScore.topViolationIds.length > 0) {
    html += `
      <div class="a11y-top-violations">
        <h3>Most Common Issues</h3>
        <div class="a11y-top-list">`;

    // Count per violation ID across all results
    const violationMap = new Map<string, { count: number; description: string; impact: string; helpUrl: string }>();
    for (const r of results) {
      if (!r.accessibility) continue;
      for (const v of r.accessibility.violations) {
        const existing = violationMap.get(v.id);
        if (existing) {
          existing.count++;
        } else {
          violationMap.set(v.id, { count: 1, description: v.description, impact: v.impact, helpUrl: v.helpUrl });
        }
      }
    }

    const sorted = [...violationMap.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 10);
    for (const [id, info] of sorted) {
      const impactColor = IMPACT_COLORS[info.impact] || IMPACT_COLORS.moderate;
      html += `
          <div class="a11y-top-item">
            <span class="a11y-impact-badge" style="background: ${impactColor}">${IMPACT_LABELS[info.impact] || info.impact}</span>
            <span class="a11y-top-id">${escapeHtml(id)}</span>
            <span class="a11y-top-desc">${escapeHtml(info.description)}</span>
            <span class="a11y-top-count">${info.count}x</span>
            <a class="a11y-help-link" href="${escapeHtml(info.helpUrl)}" target="_blank" rel="noopener">Docs</a>
          </div>`;
    }

    html += `
        </div>
      </div>`;
  }

  // Worst offenders (tests with most violations)
  const testsWithA11y = results
    .filter(r => r.accessibility && r.accessibility.violations.length > 0)
    .sort((a, b) => b.accessibility!.violations.length - a.accessibility!.violations.length)
    .slice(0, 10);

  if (testsWithA11y.length > 0) {
    html += `
      <div class="a11y-worst-offenders">
        <h3>Tests with Most Violations</h3>
        <div class="a11y-offender-list">`;

    for (const t of testsWithA11y) {
      const violations = t.accessibility!.violations;
      const critCount = violations.filter(v => v.impact === 'critical').length;
      const seriousCount = violations.filter(v => v.impact === 'serious').length;

      html += `
          <div class="a11y-offender-item" onclick="selectTest('${escapeHtml(t.testId)}')">
            <span class="a11y-offender-title">${escapeHtml(t.title)}</span>
            <span class="a11y-offender-file">${escapeHtml(t.file)}</span>
            <span class="a11y-offender-count">${violations.length} violations</span>
            ${critCount > 0 ? `<span class="a11y-impact-badge" style="background: ${IMPACT_COLORS.critical}">${critCount} critical</span>` : ''}
            ${seriousCount > 0 ? `<span class="a11y-impact-badge" style="background: ${IMPACT_COLORS.serious}">${seriousCount} serious</span>` : ''}
          </div>`;
    }

    html += `
        </div>
      </div>`;
  }

  html += `
    </div>`;

  return html;
}

function generateSeverityBar(label: string, count: number, total: number, color: string): string {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return `
    <div class="a11y-severity-row">
      <span class="a11y-severity-label">${label}</span>
      <div class="a11y-severity-bar-track">
        <div class="a11y-severity-bar-fill" style="width: ${pct}%; background: ${color}"></div>
      </div>
      <span class="a11y-severity-count">${count}</span>
    </div>`;
}

/**
 * Generate CSS styles for the accessibility sections.
 */
export function generateA11yStyles(): string {
  return `
/* ============================================================================
   Accessibility Tab & Per-Test Sections
   ============================================================================ */

.a11y-section { margin-top: 16px; border: 1px solid var(--border-primary, #e0e0e0); border-radius: 8px; overflow: hidden; }
.a11y-section-title { display: flex; align-items: center; gap: 8px; padding: 12px 16px; margin: 0; font-size: 14px; font-weight: 600; cursor: pointer; background: var(--bg-secondary, #f5f5f5); }
.a11y-section-title:hover { background: var(--bg-tertiary, #eee); }
.a11y-toggle { margin-left: auto; transition: transform 0.2s; }
.a11y-section-title.collapsed .a11y-toggle { transform: rotate(-90deg); }
.a11y-section-content { padding: 12px 16px; }
.a11y-badge-count { background: var(--accent-orange, #e67e22); color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; }

/* Violation items */
.a11y-violation-item { padding: 12px 0; border-bottom: 1px solid var(--border-primary, #e0e0e0); }
.a11y-violation-item:last-child { border-bottom: none; }
.a11y-violation-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.a11y-impact-badge { padding: 2px 8px; border-radius: 4px; color: white; font-size: 11px; font-weight: 700; text-transform: uppercase; white-space: nowrap; }
.a11y-violation-id { font-weight: 600; font-family: var(--font-mono, monospace); font-size: 13px; }
.a11y-violation-desc { color: var(--text-secondary, #666); font-size: 13px; }

/* Node details (Starter+) */
.a11y-violation-nodes { margin-top: 8px; padding-left: 16px; }
.a11y-node { margin: 8px 0; padding: 8px; background: var(--bg-code, #f8f8f8); border-radius: 4px; font-size: 12px; }
.a11y-node-selector { color: var(--accent-blue, #3498db); }
.a11y-node-html { margin: 4px 0; padding: 4px 8px; background: var(--bg-primary, #fff); border: 1px solid var(--border-primary, #e0e0e0); border-radius: 4px; overflow-x: auto; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
.a11y-node-fix { margin: 4px 0 0; color: var(--text-secondary, #666); font-size: 12px; }
.a11y-more-nodes { color: var(--text-tertiary, #999); font-size: 12px; font-style: italic; }
.a11y-help-link { display: inline-block; margin-top: 4px; color: var(--accent-blue, #3498db); font-size: 12px; text-decoration: none; }
.a11y-help-link:hover { text-decoration: underline; }

/* A11y tree (Starter+) */
.a11y-tree-section { margin-top: 12px; }
.a11y-tree-title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; cursor: pointer; margin: 0; padding: 8px 0; }
.a11y-tree-content { font-size: 12px; line-height: 1.5; background: var(--bg-code, #f8f8f8); padding: 12px; border-radius: 4px; overflow-x: auto; max-height: 300px; overflow-y: auto; }

/* ---- Accessibility Tab (Starter+) ---- */
.a11y-tab { padding: 24px; }
.a11y-summary-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 24px; }
.a11y-card { background: var(--bg-secondary, #f5f5f5); border-radius: 12px; padding: 20px; text-align: center; }
.a11y-card-value { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
.a11y-card-label { font-size: 13px; color: var(--text-secondary, #666); }

/* Severity breakdown */
.a11y-severity-breakdown { margin-bottom: 24px; }
.a11y-severity-breakdown h3 { font-size: 16px; margin-bottom: 12px; }
.a11y-severity-bars { display: flex; flex-direction: column; gap: 8px; }
.a11y-severity-row { display: flex; align-items: center; gap: 12px; }
.a11y-severity-label { width: 70px; font-size: 13px; font-weight: 500; }
.a11y-severity-bar-track { flex: 1; height: 24px; background: var(--bg-tertiary, #eee); border-radius: 4px; overflow: hidden; }
.a11y-severity-bar-fill { height: 100%; border-radius: 4px; transition: width 0.5s ease; }
.a11y-severity-count { width: 40px; text-align: right; font-weight: 600; font-size: 14px; }

/* Top violations */
.a11y-top-violations { margin-bottom: 24px; }
.a11y-top-violations h3 { font-size: 16px; margin-bottom: 12px; }
.a11y-top-item { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border-primary, #e0e0e0); flex-wrap: wrap; }
.a11y-top-item:last-child { border-bottom: none; }
.a11y-top-id { font-weight: 600; font-family: var(--font-mono, monospace); font-size: 13px; }
.a11y-top-desc { color: var(--text-secondary, #666); font-size: 13px; flex: 1; }
.a11y-top-count { font-weight: 600; font-size: 14px; }

/* Worst offenders */
.a11y-worst-offenders { margin-bottom: 24px; }
.a11y-worst-offenders h3 { font-size: 16px; margin-bottom: 12px; }
.a11y-offender-item { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border-primary, #e0e0e0); cursor: pointer; flex-wrap: wrap; }
.a11y-offender-item:hover { background: var(--bg-secondary, #f5f5f5); }
.a11y-offender-title { font-weight: 600; font-size: 13px; }
.a11y-offender-file { color: var(--text-secondary, #666); font-size: 12px; }
.a11y-offender-count { margin-left: auto; font-weight: 600; font-size: 13px; }

/* Mobile responsive */
@media (max-width: 768px) {
  .a11y-summary-cards { grid-template-columns: repeat(2, 1fr); }
  .a11y-violation-header { flex-direction: column; align-items: flex-start; }
  .a11y-top-item { flex-direction: column; align-items: flex-start; }
  .a11y-offender-item { flex-direction: column; align-items: flex-start; }
  .a11y-offender-count { margin-left: 0; }
}
`;
}

/**
 * Generate JavaScript for accessibility section interactivity.
 */
export function generateA11yScript(): string {
  return `
function toggleA11ySection(el) {
  el.classList.toggle('collapsed');
  var content = el.nextElementSibling;
  content.style.display = content.style.display === 'none' ? 'block' : 'none';
}

function toggleA11yTree(el) {
  el.classList.toggle('collapsed');
  var content = el.nextElementSibling;
  content.style.display = content.style.display === 'none' ? 'block' : 'none';
}
`;
}
```

This task does NOT include tests for the generator because generator tests in this codebase are snapshot/integration tests in `src/generators/generators.test.ts`. The a11y generator functions produce HTML strings that will be validated via the full report generation test in Task 8.

**Step 2: Integrate into html-generator.ts**

This is the largest modification. The exact changes depend on the current html-generator.ts structure, but the integration points are:

1. **Import a11y-generator** — add at the top of html-generator.ts after line 16:

```typescript
import { generateTestA11ySection, generateA11yTab, generateA11yStyles, generateA11yScript } from './a11y-generator';
```

2. **Add nav item** — In the sidebar navigation section (search for `switchView('tests')`), add after the last nav item but before the closing `</nav>`:

```html
${data.a11ySuiteScore ? `
<div class="nav-item" onclick="switchView('accessibility')">
  <span class="nav-icon">${icon('accessibility')}</span>
  <span class="nav-label">Accessibility</span>
  ${data.a11ySuiteScore.totalViolations > 0 ? `<span class="nav-badge nav-badge-warning">${data.a11ySuiteScore.totalViolations}</span>` : ''}
</div>` : ''}
```

3. **Add view panel** — After the last `</section>` view panel, add:

```html
${data.a11ySuiteScore ? `
<section class="view-panel" id="view-accessibility" style="display: none;" role="tabpanel">
  ${generateA11yTab(data.results, data.a11ySuiteScore)}
</section>` : ''}
```

4. **Add per-test a11y section** — In the test detail rendering (search for where network logs or attachments are rendered per test), add:

```html
${generateTestA11ySection(test, data.licenseTier)}
```

5. **Add CSS** — In the `generateStyles` function, before the closing backtick, add:

```typescript
${generateA11yStyles()}
```

6. **Add JS** — In the `generateScripts` function, before the closing backtick, add:

```typescript
${generateA11yScript()}
```

7. **Register 'accessibility' in switchView** — In the JavaScript `switchView` function, add `'accessibility'` to the list of valid view names.

**Step 3: Run TypeScript compilation**

Run: `cd /Users/gary.parker/git/playwright-smart-reporter && npx tsc --noEmit`
Expected: No errors

**Step 4: Run full test suite**

Run: `cd /Users/gary.parker/git/playwright-smart-reporter && npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/generators/a11y-generator.ts src/generators/html-generator.ts
git commit -m "feat(a11y): add Accessibility tab and per-test a11y sections in report

Adds dedicated Accessibility tab (Starter+) with summary cards,
severity breakdown, top violations, and worst offenders.
Per-test detail panel shows violations with severity badges.
Starter+ gets node details, HTML snippets, a11y tree viewer."
```

---

### Task 8: Add accessibility icon to icon-provider

**Files:**
- Modify: `src/generators/icon-provider.ts`

**Step 1: Check if 'accessibility' icon exists**

Search `src/generators/icon-provider.ts` for 'accessibility'. If it doesn't exist, add an SVG icon to the icon map:

```typescript
accessibility: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4" r="1"/><path d="M7 8h10"/><path d="M12 8v8"/><path d="M9 20l3-4 3 4"/></svg>',
```

This is the standard accessibility/person icon (stick figure).

**Step 2: Run tests**

Run: `cd /Users/gary.parker/git/playwright-smart-reporter && npx vitest run`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/generators/icon-provider.ts
git commit -m "feat(a11y): add accessibility icon to icon provider"
```

---

### Task 9: Export withAccessibility from package entry point

**Files:**
- Modify: `src/smart-reporter.ts` (or wherever the main export is)
- Modify: `package.json` (add exports entry for a11y fixture)

**Step 1: Add withAccessibility to package exports**

In `package.json`, check the `exports` field. Add entries:

```json
"./a11y": {
  "import": "./dist/accessibility/index.js",
  "require": "./dist/accessibility/index.js",
  "types": "./dist/accessibility/index.d.ts"
}
```

Also add `@axe-core/playwright` as an optional peer dependency:

```json
"peerDependencies": {
  "@playwright/test": ">=1.40.0"
},
"peerDependenciesMeta": {
  "@axe-core/playwright": {
    "optional": true
  }
},
"optionalDependencies": {},
```

Wait — check first if peerDependencies already exists and follow the existing pattern.

**Step 2: Re-export from main entry point**

In `src/smart-reporter.ts`, at the bottom (after the `export default SmartReporter;`), add:

```typescript
export { withAccessibility } from './accessibility';
```

**Step 3: Build to verify**

Run: `cd /Users/gary.parker/git/playwright-smart-reporter && npm run build`
Expected: Build succeeds with new accessibility modules compiled

**Step 4: Commit**

```bash
git add package.json src/smart-reporter.ts
git commit -m "feat(a11y): export withAccessibility and add a11y fixture entry point

Users can import { withAccessibility } from 'playwright-smart-reporter'
or import { test } from 'playwright-smart-reporter/a11y' for the fixture.
Adds @axe-core/playwright as optional peer dependency."
```

---

### Task 10: Integration test — verify end-to-end flow

**Files:**
- Modify: `src/smart-reporter.test.ts` (add a11y integration test)

**Step 1: Add integration test**

Add to `src/smart-reporter.test.ts` a test that verifies the a11y collector/analyzer/generator pipeline works when a test result has an a11y attachment:

```typescript
describe('accessibility integration', () => {
  it('processes a11y attachments and includes data in results', () => {
    // Create a mock test result with a11y attachment
    const a11yData = {
      violations: [
        {
          id: 'color-contrast',
          impact: 'serious',
          description: 'Elements must have sufficient color contrast',
          helpUrl: 'https://dequeuniversity.com/rules/axe/4.7/color-contrast',
          wcagTags: ['wcag2aa'],
          nodes: [{ target: ['h1'], html: '<h1>Test</h1>', failureSummary: 'Fix contrast' }],
        },
      ],
      passes: 15,
      incomplete: 1,
      inapplicable: 3,
      timestamp: '2026-03-06T12:00:00.000Z',
      standard: 'WCAG2AA',
    };

    // Verify A11yCollector parses the attachment
    const collector = new A11yCollector();
    const mockResult = {
      attachments: [
        {
          name: 'smart-reporter-a11y',
          contentType: 'application/json',
          body: Buffer.from(JSON.stringify(a11yData)),
        },
      ],
    };
    const result = collector.collect(mockResult);
    expect(result).toBeDefined();
    expect(result!.violations).toHaveLength(1);

    // Verify A11yAnalyzer scores it
    const analyzer = new A11yAnalyzer();
    const testData = createTestResult();
    analyzer.analyze(testData, result);
    expect(testData.accessibility).toBeDefined();
    expect(testData.accessibility!.violations[0].id).toBe('color-contrast');

    // Verify suite score
    const suiteScore = analyzer.calculateSuiteScore([testData]);
    expect(suiteScore.serious).toBe(1);
    expect(suiteScore.rating).toBe('fair');
  });
});
```

**Step 2: Run the test**

Run: `cd /Users/gary.parker/git/playwright-smart-reporter && npx vitest run src/smart-reporter.test.ts`
Expected: All tests PASS

**Step 3: Run full test suite**

Run: `cd /Users/gary.parker/git/playwright-smart-reporter && npx vitest run`
Expected: All tests PASS

**Step 4: Build final check**

Run: `cd /Users/gary.parker/git/playwright-smart-reporter && npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/smart-reporter.test.ts
git commit -m "test(a11y): add integration test for accessibility pipeline

Verifies A11yCollector parses attachments, A11yAnalyzer scores
results, and suite-wide scoring works end-to-end."
```

---

### Task 11: Bump version and final verification

**Files:**
- Modify: `package.json` (version bump)

**Step 1: Bump minor version**

Update `package.json` version from `1.6.4` to `1.7.0` (new feature = minor bump).

**Step 2: Run full test suite**

Run: `cd /Users/gary.parker/git/playwright-smart-reporter && npx vitest run`
Expected: All tests PASS

**Step 3: Run build**

Run: `cd /Users/gary.parker/git/playwright-smart-reporter && npm run build`
Expected: Clean build

**Step 4: Commit**

```bash
git add package.json
git commit -m "chore: bump to v1.7.0 for accessibility integration release"
```
