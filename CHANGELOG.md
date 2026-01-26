# Changelog

All notable changes to this project will be documented in this file.

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
