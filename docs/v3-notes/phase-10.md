### Accessibility Scanning

Scan each test's final page for WCAG violations with axe-core. Scanning is opt-in. Runs without it are unchanged.

**Setup**

1. Install axe-core for Playwright:

```bash
npm install -D @axe-core/playwright
```

2. Import `test` from the accessibility entry point in the specs you want scanned:

```typescript
import { test } from 'playwright-smart-reporter/accessibility';
import { expect } from '@playwright/test';

test('home page', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page.locator('h1')).toBeVisible();
});
```

3. Wrap your config with `withAccessibility` and set the `accessibility` reporter option:

```typescript
import { defineConfig } from '@playwright/test';
import { withAccessibility } from 'playwright-smart-reporter';

export default withAccessibility(defineConfig({
  reporter: [
    ['playwright-smart-reporter', {
      accessibility: { enabled: true, standard: 'WCAG2AA' },
    }],
  ],
}));
```

`withAccessibility` copies the `accessibility` option into `use.smartReporterA11y` for the config and every project. With no `accessibility` option it uses `{ enabled: true, standard: 'WCAG2AA' }`. You can also set `use.smartReporterA11y` yourself instead of using the wrapper.

The scan runs after the test body, on the page the test ends on. Specs that import `test` from `@playwright/test` are not scanned.

**Options** (`accessibility`)

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | — | Turn scanning on |
| `standard` | `'WCAG2A'` \| `'WCAG2AA'` \| `'WCAG2AAA'` | `'WCAG2AA'` | WCAG level to check |
| `include` | string[] | — | Run only these axe rule IDs |
| `exclude` | string[] | — | Skip these axe rule IDs |
| `selector` | string | — | Scan only inside this CSS selector |
| `failOnSeverity` | `'minor'` \| `'moderate'` \| `'serious'` \| `'critical'` | — | Fail the test when a violation has this impact or higher |

**Quality gates**

```typescript
qualityGates: {
  maxA11yViolations: 10, // all impacts
  maxA11yCritical: 0,
  maxA11ySerious: 3,
},
```

A gate is reported as skipped when no test in the run was scanned. The CLI gate reads the JSON export (`exportJson: true`):

```bash
npx playwright-smart-reporter gate --config gates.json --data smart-report-data.json
node node_modules/playwright-smart-reporter/dist/bin/gate.js --max-a11y-violations 10
```

**Output**

- Each scanned test carries `a11y` (violations with impact, WCAG tags, help URL and failing nodes) in the JSON export and the report data.
- The report data has a run summary in `a11y`: totals by impact, violations per rule with the affected tests, tests scanned and pages scanned.
