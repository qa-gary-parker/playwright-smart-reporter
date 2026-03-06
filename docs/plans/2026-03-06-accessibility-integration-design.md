# Accessibility Integration Design

**Date:** 2026-03-06
**Status:** Approved

## Overview

Add accessibility checking to playwright-smart-reporter using @axe-core/playwright for WCAG violation detection and Playwright's accessibility tree snapshots for structural context. Results are displayed in reports with a dedicated Accessibility tab and per-test detail sections.

## User Experience

### Setup

Users wrap their Playwright config with `withAccessibility()` and add a reporter option:

```typescript
import { withAccessibility } from 'playwright-smart-reporter';

export default defineConfig(withAccessibility({
  reporter: [['playwright-smart-reporter', {
    accessibility: {
      enabled: true,
      standard: 'WCAG2AA',
      failOnSeverity: 'critical', // optional, Starter+
    }
  }]],
}));
```

`@axe-core/playwright` is an optional peer dependency — users install it themselves.

### Config Options

```typescript
accessibility: {
  enabled: boolean;              // Default: false
  standard: 'WCAG2A' | 'WCAG2AA' | 'WCAG2AAA';  // Default: 'WCAG2AA'
  failOnSeverity?: 'critical' | 'serious' | 'moderate' | 'minor';  // Starter+
  include?: string[];            // axe rule IDs to include
  exclude?: string[];            // axe rule IDs to exclude
  selector?: string;             // CSS selector to scope scan
}
```

## Architecture

### New Modules

Follows the existing collector → analyzer → generator pattern:

```
src/
  accessibility/
    a11y-fixture.ts        # Playwright fixture: runs axe + captures a11y tree
    a11y-config-wrapper.ts # withAccessibility() config helper
  collectors/
    a11y-collector.ts      # Parses a11y JSON attachments from test results
  analyzers/
    a11y-analyzer.ts       # Aggregates violations, scores severity, detects trends
  generators/
    a11y-generator.ts      # Renders Accessibility tab + per-test a11y sections
```

### Data Flow

1. `withAccessibility()` injects a Playwright project-level fixture
2. Fixture runs after each test: executes `AxeBuilder.analyze()` + `page.accessibility.snapshot()`
3. Results attached as `smart-reporter-a11y.json` artifact on each test
4. `A11yCollector` in `onTestEnd` detects and parses these attachments
5. `A11yAnalyzer` scores and aggregates violations across the suite
6. `A11yGenerator` renders the dedicated tab and per-test detail sections
7. Quality gates evaluate a11y thresholds (Starter+)

## Data Model

```typescript
interface A11yViolation {
  id: string;           // axe rule ID (e.g. 'color-contrast', 'image-alt')
  impact: 'minor' | 'moderate' | 'serious' | 'critical';
  description: string;
  helpUrl: string;      // Link to Deque's rule documentation
  wcagTags: string[];   // e.g. ['wcag2a', 'wcag21aa', 'best-practice']
  nodes: A11yNode[];    // Affected DOM elements
}

interface A11yNode {
  target: string[];     // CSS selector path
  html: string;         // Offending HTML snippet
  failureSummary: string;
}

interface A11yTreeSnapshot {
  role: string;
  name: string;
  children?: A11yTreeSnapshot[];
}

interface A11yResult {
  violations: A11yViolation[];
  passes: number;
  incomplete: number;
  inapplicable: number;
  tree?: A11yTreeSnapshot;
  timestamp: string;
  standard: string;     // 'WCAG2A' | 'WCAG2AA' | 'WCAG2AAA'
}

// Added to TestResultData:
accessibility?: A11yResult;
```

## Tier Split

| Feature | Community | Starter+ |
|---------|-----------|----------|
| Violation detection (axe-core) | Yes | Yes |
| Per-test violation list | Yes | Yes |
| Violation severity + count | Yes | Yes |
| Dedicated Accessibility tab | | Yes |
| A11y tree snapshots | | Yes |
| Severity threshold (failOnSeverity) | | Yes |
| Quality gate integration | | Yes |
| Historical a11y trend tracking | | Yes |

## Report UI

### Accessibility Tab (Starter+)

**Summary cards:**
- Total violations by severity (critical/serious/moderate/minor)
- Most common violation types (top 5)
- Tests with most violations (worst offenders)
- WCAG criteria coverage breakdown

**Violation table:**
- Sortable/filterable by severity, rule, WCAG criteria
- Expandable rows showing affected elements with HTML snippets
- Links to Deque's documentation for each rule

### Per-Test Detail Panel (All Tiers)

Collapsible "Accessibility" section below steps/attachments:
- Community: violation list with severity badges
- Starter+: adds a11y tree viewer, HTML snippets, help links

## Dependencies

- `@axe-core/playwright` — optional peer dependency (user-installed)
- No new direct dependencies added to the package

## Error Handling

- If `@axe-core/playwright` is not installed, log a warning and skip a11y checks
- If a11y scan fails on a page (e.g. page navigated away), attach partial results with error note
- If `failOnSeverity` is set and violations exceed threshold, fail the test with a clear error message listing violations
