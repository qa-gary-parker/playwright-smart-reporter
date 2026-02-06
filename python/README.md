# Playwright Smart Reporter - Python

Python integration for [Playwright Smart Reporter](https://github.com/qa-gary-parker/playwright-smart-reporter) - brings AI-powered failure analysis, flakiness detection, and beautiful HTML reports to your pytest test suites.

## Features

All the features from the main Playwright Smart Reporter, now available for Python/pytest:

- **AI Failure Analysis** - Claude/OpenAI/Gemini powered suggestions
- **Smart Analytics** - Flakiness detection, performance regression alerts
- **Trend Charts** - Visual history of test health over time
- **Stability Scoring** - A+ to F grades for test reliability
- **Failure Clustering** - Group similar errors automatically
- **Modern Dashboard** - Interactive sidebar navigation, light/dark themes

## Prerequisites

- Python 3.9+
- Node.js 18+ (runtime only - no `npm install` needed)

## Installation

```bash
pip install playwright-smart-reporter-python
```

The package is self-contained. The compiled JavaScript report generator is bundled in the wheel - Node.js is only needed at runtime to execute it.

## Quick Start

### Option 1: Pytest Plugin (Automatic)

Run your tests with the `--smart-reporter` flag:

```bash
pytest --json-report --smart-reporter
```

Report automatically generated at `smart-report.html`.

### Option 2: Manual Generation

```python
from playwright_smart_reporter_python import SmartReporterBridge

bridge = SmartReporterBridge()
bridge.generate_report(
    pytest_json_path=".pytest-report.json",
    output_html="smart-report.html"
)
```

## Configuration

### pytest.ini / pyproject.toml

```ini
[pytest]
addopts =
    --json-report
    --json-report-file=.pytest-report.json
    --smart-reporter
    --smart-reporter-output=test-reports/smart-report.html
```

### Environment Variables

```bash
# AI Analysis (optional)
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
export GEMINI_API_KEY="..."
```

## Usage with Playwright for Python

```python
# test_example.py
from playwright.sync_api import Page

def test_homepage(page: Page):
    page.goto("https://playwright.dev")
    assert page.title() == "Fast and reliable end-to-end testing"
```

```bash
pytest --headed --smart-reporter
```

## How It Works

1. **pytest** runs your tests with JSON reporting enabled
2. **Converter** transforms pytest JSON to Playwright Smart Reporter format
3. **Node.js bridge** calls the bundled HTML generator
4. **Output** interactive HTML report

## Development

This is part of a monorepo. The Python package lives in `python/` and can use either the bundled JS dist (PyPI install) or the monorepo `dist/` (local development).

```bash
# From repository root
npm run build                      # Compile TypeScript
cd python
python scripts/bundle_dist.py      # Bundle JS into package
pip install -e ".[dev]"            # Editable install
pytest tests/ -v                   # Run tests
```

## Troubleshooting

### Node.js not found

The package needs Node.js at runtime to execute the report generator:

```bash
# macOS
brew install node

# Linux
sudo apt install nodejs

# Windows
# Download from https://nodejs.org
```

## License

MIT - See [LICENSE](LICENSE).

## Related

- [Playwright Smart Reporter (Node.js)](https://github.com/qa-gary-parker/playwright-smart-reporter) - Main package
- [Playwright for Python](https://playwright.dev/python/) - Playwright Python bindings
