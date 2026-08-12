# Changelog

All notable changes to this project will be documented in this file.

## [1.7.0] - 2026-03-06

### Added

- **WCAG Accessibility Scanning** (all tiers; node-level detail, tree viewer, AI analysis and `failOnSeverity` are Starter+): Integrated axe-core-powered WCAG compliance scanning via a custom Playwright test fixture
  - Per-test accessibility violation cards with impact severity badges (critical, serious, moderate, minor)
  - Dedicated Accessibility tab with suite-wide score rating, severity breakdown bar, top issues, and worst offenders
  - WCAG criterion links (e.g., "WCAG 1.4.3") linking to W3C documentation for each violation
  - Copy Prompt button on each violation to generate AI-ready fix prompts for quick remediation
  - Accessibility tree viewer for visual tree snapshot inspection (when tree data is present)
  - AI-powered accessibility analysis summary (Starter+ with AI quota)
  - Accessibility quality gates: `maxA11yCritical`, `maxA11ySerious`, `maxA11yTotal`
  - Configurable scanning: WCAG standard level, rule include/exclude lists, CSS selector scoping
- New package export: `playwright-smart-reporter/accessibility`

### Changed

- Replaced `withAccessibility()` config wrapper with standard Playwright `test.extend()` fixture pattern
- "Starter" badge now displayed on Accessibility tab (matching Live tab pattern)
- Clipboard copy uses `navigator.clipboard.writeText` with `document.execCommand('copy')` fallback for non-HTTPS contexts

## [1.6.4] - 2026-03-05

### Added

- **Mobile responsive report**: Three-breakpoint responsive CSS (768px tablet, 600px phone, 480px small phone) — sidebar becomes overlay drawer on phones, hero stats stack to 2-col grid, master-detail stacks vertically, compact padding/fonts throughout, full-width menus on mobile

## [1.6.3] - 2026-03-04

### Added

- **Upgrade CTA Banner**: Dismissible banner at the top of the Overview tab for Local (free) tier users, linking to pricing
- **Contextual Upgrade Modals**: Clicking any gated feature (Quality Gates, Quarantine, AI Health Summary, PDF/JSON/JUnit exports, Live controls) now opens a descriptive modal with upgrade CTA instead of silently blocking
- **Feature Usage Summary Card**: "Your Plan: Local" card in Overview showing active vs locked features at a glance
- **Live tab always visible**: The Live tab now appears by default for all users; Local tier sees it gated as an upsell. Disable explicitly with `live: { enabled: false }`

### Changed

- Renamed "Community" tier label to "Local" across the report UI
- All pricing links now point to `stagewright.dev/#pricing` (was broken `/pricing` route)
- Updated README feature table with benefit-focused wording

## [1.6.0] - 2026-03-04

### Added

- **Live Section Starter Tier Gating**: Live execution controls (run/cancel/filter) now require Starter tier or above. Community tier users see the Live tab with a "Starter" badge and a greyed-out preview of the full interface
- **Enriched Live Failure Items**: Static failure feed now shows clickable cards with screenshot thumbnails, full error text, and "View Details" links that navigate to the Tests tab detail view
- **Live SSE Failure Context**: During live runs, failure items include structured layout with `data-testid` and a "View details after run completes" label
- **`prefers-reduced-motion` support**: Counter animations now respect the user's reduced motion preference

### Changed

- Error truncation in live SSE events increased from 200 to 500 characters for more useful failure previews
- Staggered list animations now play only once via `.animate-entrance` class (no re-triggering on tab switch)
- `setStatusAccent()` queries scoped to `#view-tests` to prevent cross-view side effects
- Design enhancement comments renumbered sequentially (1–9)

### Fixed

- Live section no longer flashes during tab switch when gated (disabled `viewFadeIn` animation on `.live-section-gated`)
- Run-row visibility now uses CSS class (`.live-run-row-hidden`) instead of inline style, fixing specificity issues with gated override
- Dark theme hover fallback changed from `rgba(0,0,0,0.04)` to `rgba(128,128,128,0.1)` for visibility
- Removed duplicate `.hero-stat-card` and `.insight-card` transition/hover rules (overridden by design enhancements)
- Moved `position: relative` to canonical `.top-bar` rule (was duplicated)
- Removed unnecessary `!important` from `barGrow` keyframe
- Screenshot thumbnails in failure feed guard against base64 data URIs to prevent report bloat

### Security

- Live run controls are cosmetic-only gating (CSS + JS) — documented that actual run capability requires server-side license validation on the `/run` endpoint

## [1.5.0] - 2026-03-02

### Added

- **AI Suite Health Summary** (Starter+): AI-generated executive summary in the Overview tab combining failure clusters, flakiness trends, performance regressions, and historical pass rate into natural-language insights. Enabled by default; disable with `enableAISuiteHealth: false` to preserve AI quota (counts as 1 AI request per run).

## [1.4.0] - 2026-02-28

### Added

- **Smooth area curves with gradient fills** on Trends tab — replaces flat bar charts with modern area visualisations matching the Overview sparkline style
- **Chart display toggles** — global "3-run avg" and "Bars" buttons in the Trends header let teams switch between area curves and bar charts, and show/hide the moving average line
- **Smooth moving average line** — the 3-run average now uses monotone cubic interpolation instead of straight-segment polylines

### Changed

- Moving average line colour changed from yellow (`#ffcc00`) to sky blue (`#38bdf8`) to avoid collision with the Flaky Tests chart colour
- Overview sparklines (Quality Gates, Quarantine) now include the current run as the rightmost data point, matching the Trends tab data exactly
- Overview sparklines now use fixed y-axis scaling (0–100 for pass rate, 0–max for flaky count) to match Trends chart proportions
- Anomaly markers simplified to red dots only (removed dashed bar stroke)

### Fixed

- Defensive `?? 0` for `s.flaky` in sparkline data to prevent `NaN` from legacy history files missing the flaky field
- Trend controls now correctly hide when the Trends section is collapsed

### Removed

- Dead `.chart-bar-anomaly` CSS class (no longer referenced after anomaly marker simplification)

## [1.3.0] - 2026-02-26

### Added

- **CSP-safe external files** (#31): When `cspSafe: true`, the reporter now generates companion `.css` and `.js` files alongside the HTML report. Styles and scripts are loaded via `<link>` and `<script src>` instead of inline tags. Report data is embedded in `<script type="application/json">` tags. This enables reports to render under Jenkins' Content Security Policy (requires `script-src 'self' 'unsafe-inline'`).
- `GeneratedReport` type exported from `html-generator` for programmatic access to companion file contents

### Fixed

- **Skipped test navigation broken** (#33): Clicking status counts in the overview now correctly filters tests. `filterByStatus()` was updating DOM chip classes but not the `activeFilters` state, causing `applyFilters()` to read stale data.
- **Flaky filter mismatch** (#30): The "Flaky" filter now catches tests that are flaky by either outcome (passed on retry) or history (flakinessScore >= 0.3). Previously, the sidebar count used outcome-based detection while the filter chip used history-based detection, causing mismatches.
- **Tests labeled "New" despite history** (#30): Tests with all-skipped history are now labeled "Skipped" instead of "New". Path normalization in `getTestId()` (forward slashes, strip leading `./`) reduces history lookup misses across CI environments.
- Removed duplicate inline flakiness/performance calculation in `SmartReporter.onTestEnd()` — analyzers are now the sole authority
- Companion file paths now use `path.join()` instead of regex replacement for robustness

### Security

- HTML-escaped `outputBasename` and `data-theme` attribute values to prevent attribute injection
- Fixed JSON entity-escaping order (`&` now replaced before `<`/`>` to prevent double-encoding)
- CSP JS extraction uses explicit `@csp-split` marker instead of fragile `indexOf` string matching

## [1.2.0] - 2026-02-25

### Breaking Changes

- **AI analysis is now a managed service** — BYOK provider keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`) are no longer used. AI is powered by GPT-4o-mini via the StageWright proxy and requires a Starter or Pro license.

### Added

- **Managed AI Proxy**: failure analysis calls `stagewright.dev/api/ai/analyze` with automatic license validation and rate limiting
- **Starter Tier** (£5/mo, ~$6): 2,000 AI analyses/month, 6 extra themes, PDF/JSON/JUnit export, quality gates, quarantine, custom branding
- **Pro Tier** (£9/mo, ~$12): 5,000 AI analyses/month, fully custom theme colours, 3 PDF styles, priority email support
- AI quota tracking with remaining count and reset date logged after first analysis

### Changed

- `AIAnalyzer` rewritten to call StageWright proxy instead of direct provider APIs
- AI gated behind Starter/Pro license — community tier shows upsell message
- `NetworkLogEntry.requestBody` and `responseBody` types changed from `any` to `unknown`

### Removed

- BYOK AI provider support (Anthropic, OpenAI, Gemini direct API calls)
- `AIConfig` interface (`model`, `systemPrompt`, `promptTemplate`, `maxTokens` options)
- `ai-analyzer-config.test.ts` (obsolete BYOK tests)

### Fixed

- AI proxy URL corrected (`/api/ai/analyze`, not `/api/v1/ai/analyze`)
- `resetAt` type mismatch between server (ISO string) and client (expected number)
- Duplicate upsell console.log removed from `AIAnalyzer.analyzeFailed()`
- `tryParseJson` return type changed from `any` to `unknown`

### Security

- 20KB prompt size limit on AI proxy
- Explicit tier allowlist for AI access
- Module-scope rate limiter (not re-created per request)
- Rate limit key normalized to prevent bypasses
- Payment status verified before license issuance

## [1.1.1] - 2026-02-24

### Changed

- Updated README with Pro features documentation, screenshots, and pricing info
- Added dark theme screenshots
- Improved npm keywords for discoverability

## [1.1.0] - 2026-02-24

### Added

- **Pro Tier** — premium features behind ES256 JWT license validation
- **Quality Gates**: configurable thresholds (min pass rate, max flaky rate, min stability grade) with CI exit codes via `npx playwright-smart-reporter gate`
- **Flaky Test Quarantine**: auto-detection and JSON-based tracking with `getQuarantinedPattern()` helper for `test.skip()`
- **Executive PDF Export**: three themed variants (Corporate, Minimal, Dark) via pdfkit with PDF style picker modal in HTML report
- **6 Themes**: Ocean, Sunset, Dracula, Cyberpunk, Forest, Rose
- **Custom Branding**: configurable report title, footer text, accent colours, and logo
- **AI Health Digest**: weekly/daily/monthly trend summaries from history data via `npx playwright-smart-reporter digest`
- **Notification System**: Slack, Microsoft Teams, email (SendGrid), and PagerDuty integrations with configurable rules
- **Cloud Upload**: StageWright Cloud integration with presigned artifact uploads
- **CLI Tools**: `gate` (quality gate evaluation), `serve` (local HTTP server with trace viewer CORS), `view-trace`, `merge-history`
- 36 new tests for collectors, notifiers, exporters, gates, quarantine, and digest

### Security

- XSS escaping for JS contexts in HTML generator
- Path traversal prevention in serve CLI
- Webhook URL validation for notification endpoints
- `.npmignore` hardening to exclude keys, tests, and examples from published package

## [1.0.8] - 2026-02-06

### Added

- **Step Timeline**: flamechart visualisation with colour-coded categories (navigation, assertion, action, API, wait) for step-level timing analysis
- **Enhanced Trend Charts**: moving averages and 2-sigma anomaly detection for pass rate, duration, flaky count, and slow test trends
- **CI Environment Detection**: auto-detect GitHub Actions, GitLab CI, CircleCI, Jenkins, Azure DevOps, and Buildkite; display CI badge in report header
- **Configurable Thresholds**: `ThresholdConfig` for flakiness, performance regression percentages, stability weights, and grade boundaries
- **AI Analysis Batching**: concurrent batched requests (3 at a time) for large test suites
- **Virtual Scroll Pagination**: smooth rendering for test lists with 500+ tests
- **Keyboard Navigation**: `1-5` switch views, `j/k` navigate tests, `f` focus search, `e` export summary
- **Exportable Summary Card**: one-click export of test run summary
- **Python/pytest Integration**: monorepo bridge approach with PyPI-publishable package (#28)

### Security

- Sanitise `runId` in HTML attributes and filenames to prevent XSS and path traversal
- Guard empty project names in test IDs

## [1.0.7] - 2026-02-03

### Added

- **Browser/Project Badges**: display browser badges (chromium, firefox, webkit) and project names for multi-browser/multi-project setups ([#23](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/23))
- **Full Annotations Support**: capture and display all test annotations (`@slow`, `@fixme`, `@skip`, custom) with icons and coloured badges
- **Step Filtering**: `filterPwApiSteps` option to hide verbose `pw:api` steps and show only custom `test.step()` entries ([#22](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/22))
- **Path Resolution**: `relativeToCwd` option to resolve `outputFile` and `historyFile` relative to CWD instead of Playwright's rootDir ([#20](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/20))
- **Project History Isolation**: `projectName` option with `{project}` placeholder in `historyFile` path for per-project history ([#21](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/21))
- Cucumber integration documentation (playwright-bdd and cucumber-playwright)

### Fixed

- **RangeError with Large Test Suites** ([#19](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/19)): prevent crash when processing suites with many tests
- Improved badge layout with dedicated row, visual separators, and consistent spacing
- Project name extraction uses Playwright project config directly

## [1.0.5] - 2026-01-26

### Fixed

- **Retries Double-Counted** ([#17](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/17))
  - Test retries no longer inflate test counts (e.g., 509 tests showing as 530)
  - Only the final attempt for each test is counted
  - Uses Playwright's `test.outcome()` to properly identify flaky tests

- **Expected Failures Incorrectly Reported** ([#16](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/16))
  - Tests marked with `test.fail()` that actually fail are now counted as passed (expected behavior)
  - Uses Playwright's `expectedStatus` to determine expected outcomes
  - Expected failures are excluded from failure clustering

### Added

- **Improved Tag Extraction** ([#15](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/15))
  - Tags now extracted from `test.tags` property (Playwright's built-in collection)
  - Falls back to annotations and title parsing for backwards compatibility
  - Tags are visible in the test cards and sidebar filters

- **Better Console Output** ([#15](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/15))
  - Report path now includes helpful commands to open the report
  - Shows `npx playwright show-report` and `open` commands

- **Custom Attachments Support** ([#15](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/15))
  - Attachments added via `testInfo.attach()` are now collected and displayed
  - Custom attachments appear in test details with appropriate icons

- **Inline Trace Viewer** ([#13](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/13))
  - View Playwright traces directly in the dashboard without CLI commands
  - Full-featured viewer with timeline, actions, snapshots, console, and network tabs
  - Includes JSZip for client-side trace extraction
  - Fallback to CLI command when viewing from file:// protocol

- **Attachment Gallery** ([#14](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/14))
  - Gallery view displays all screenshots, videos, and traces in a grid
  - Lightbox support for screenshot viewing with keyboard navigation
  - Filter by attachment type (screenshots, videos, traces)

## [1.0.4] - 2026-01-26

### Added

- **Google Gemini AI Support** ([#18](https://github.com/qa-gary-parker/playwright-smart-reporter/pull/18))
  - Added `GEMINI_API_KEY` environment variable for Google Gemini API integration
  - Uses `gemini-2.5-flash` model for fast, cost-effective failure analysis
  - Provider priority: Anthropic Claude → OpenAI → Google Gemini
  - Comprehensive test coverage for AI analyzer (31 new tests)
  - Thanks to [@TheAntz](https://github.com/TheAntz) for this contribution!

## [1.0.3] - 2026-01-21

### Fixed

- **Timed Out Tests Now Counted as Failed** ([#12](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/12))
  - Tests with `timedOut` status are now correctly counted as failed in summary stats
  - Comparison detection for new failures and fixed tests now includes timedOut status
  - Previously, timedOut tests showed as 0 failed in stats

## [1.0.2] - 2026-01-21

### Added

- **Network Logs**: Zero-config extraction of network requests from Playwright trace files
  - View HTTP method, URL, status code, duration, and payload sizes
  - Expandable entries show headers, request body, and timing breakdown
  - Configurable via `enableNetworkLogs`, `networkLogExcludeAssets`, `networkLogMaxEntries`
- **Tag-Based Filtering**: Filter tests by tags like `@smoke`, `@critical`
  - Tags extracted from test annotations and test titles
  - Tags displayed as badges on test cards
- **Suite-Based Filtering**: Filter by test suite from `test.describe()` blocks
  - Suite name shown in test card header
  - Hierarchical suite support

### Changed

- **Branding Update**: Renamed to "StageWright Local" with tagline "Get your test stage right."

### Fixed

- **Sidebar Stats Click**: Clicking Passed/Failed/Flaky stats now works from any view (switches to Tests view)
- **Expand/Collapse in Detail Panel**: Test cards in detail panel now expand correctly
  - Fixed event handling for cloned cards
  - Removed redundant expand icon from detail panel cards

## [1.0.0] - 2026-01-20

### Major Release - Full Reporter Redesign

This release represents a complete visual overhaul of the Smart Reporter, featuring a modern sidebar-based navigation system and numerous UX improvements.

**Special thanks to [Filip Gajic](https://github.com/Morph93) (@Morph93) for designing and implementing the core UI redesign!**

### Added

- **Sidebar Navigation**: New collapsible sidebar with organized views (Overview, Tests, Trends, Comparison, Gallery)
- **Theme Support**: Light, dark, and system theme modes with persistent preference
- **Interactive Trend Charts**: Clickable chart bars to navigate to historical runs
- **Historical Run Navigation**: View test results from any previous run with "Back to Current Run" functionality
- **Per-Test History Dots**: Click through historical results for individual tests
- **Attention-Based Filtering**: Visual badges and filters for New Failures, Regressions, and Fixed tests
- **Failure Clusters**: Enhanced error grouping showing error preview, affected test names, and file locations
- **Quick Insights Cards**: Clickable cards for Slowest Test, Most Flaky Test, and Test Distribution
- **Interactive Mini-Bars**: Click test distribution bars to filter by status
- **Clickable Progress Ring**: Navigate to tests view by clicking the pass rate indicator
- **Suite Health Grade**: Overall health score with pass rate, stability, and performance metrics
- **Trace Viewer Integration**: Per-test trace viewer access
- **Generator Smoke Tests**: Comprehensive test coverage for HTML, chart, and card generators
- **ARIA Accessibility**: Improved keyboard navigation and screen reader support

### Changed

- **Navigation Layout**: Reorganized from single-page scroll to multi-view navigation
- **Sidebar Behavior**: Persistent sidebar (no overlay) with smooth close animation
- **Duration Formatting**: Cleaner display with whole milliseconds and 1 decimal for seconds/minutes
- **Filter Chips**: Rounded design with improved hover states
- **Section Headers**: Refined styling with bottom borders
- **Test Cards**: Subtle box shadows for better visual hierarchy
- **Stat Cards**: Colored left borders matching their status

### Fixed

- Button element CSS reset for styled navigation buttons
- SVG coordinate precision in chart generation
- Duration bar height calculations in test cards
- Step bar width calculations

## [0.9.0] - Previous Release

- Initial Smart Reporter implementation
- AI-powered failure analysis
- Flakiness detection and scoring
- Performance regression alerts
- Retry analysis
- Stability scoring
