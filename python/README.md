# Playwright Smart Reporter - Python

Python integration for [Playwright Smart Reporter](https://github.com/qa-gary-parker/playwright-smart-reporter) - brings AI-powered failure analysis, flakiness detection, and beautiful HTML reports to your pytest test suites.

## Features

All the features from the main Playwright Smart Reporter, now available for Python/pytest:

- 🤖 **AI Failure Analysis** - Claude/OpenAI/Gemini powered suggestions
- 📊 **Smart Analytics** - Flakiness detection, performance regression alerts
- 📈 **Trend Charts** - Visual history of test health over time  
- 🎯 **Stability Scoring** - A+ to F grades for test reliability
- 🔍 **Failure Clustering** - Group similar errors automatically
- 🎨 **Modern Dashboard** - Interactive sidebar navigation, light/dark themes

## Prerequisites

- Python 3.9+
- Node.js 18+ (required for the HTML generator)
- pytest

## Installation

```bash
pip install playwright-smart-reporter-python
```

**Note**: This package automatically installs the Node.js dependencies on first use.

## Quick Start

### Option 1: Automatic (Pytest Plugin)

Add to your `conftest.py`:

```python
pytest_plugins = ["playwright_smart_reporter"]
```

Then run your tests:

```bash
pytest
```

Report automatically generated at `smart-report.html` ✨

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

### Basic pytest.ini

```ini
[pytest]
addopts = 
    --json-report
    --json-report-file=.pytest-report.json
    --smart-reporter
```

### Advanced Configuration

Create a `.smart-reporter.json` in your project root:

```json
{
  "enableAI": true,
  "aiProvider": "anthropic",
  "maxHistoryRuns": 50,
  "outputFile": "test-reports/smart-report.html"
}
```

### Environment Variables

```bash
# AI Analysis (optional)
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
export GEMINI_API_KEY="..."
```

## Usage with pytest-playwright

For Playwright Python tests, this works seamlessly:

```python
# test_example.py
from playwright.sync_api import Page

def test_homepage(page: Page):
    page.goto("https://playwright.dev")
    assert page.title() == "Fast and reliable end-to-end testing"
```

Run with:

```bash
pytest --headed --smart-reporter
```

## Development

This is part of a monorepo. The Python package lives in `python/` and depends on the main npm package in the root.

### Local Development Setup

```bash
# From repository root
cd python
pip install -e ".[dev]"

# Run example
cd examples/basic_usage
python run_example.py
```

## How It Works

1. **pytest runs** your tests with JSON reporting enabled
2. **Converter** transforms pytest JSON → Playwright Smart Reporter format
3. **Node.js bridge** calls the main reporter to generate HTML
4. **Output** beautiful interactive HTML report

The bridge approach gives you 100% feature parity with the Node.js version while maintaining a clean Python API.

## Troubleshooting

### Node.js not found

```bash
# Install Node.js (required for HTML generation)
# Windows: https://nodejs.org
# macOS: brew install node
# Linux: sudo apt install nodejs
```

### npm install fails

The package will auto-install Node dependencies on first run. If this fails:

```bash
cd ~/.local/share/playwright-smart-reporter-python/node_modules
npm install playwright-smart-reporter
```

## Examples

See `examples/` directory for:
- Basic usage
- pytest-playwright integration
- Custom configuration
- CI/CD integration

## License

MIT - See LICENSE file in repository root.

## Contributing

This is part of the main Playwright Smart Reporter monorepo. See root README for contribution guidelines.

## Related

- [Playwright Smart Reporter (Node.js)](https://github.com/qa-gary-parker/playwright-smart-reporter) - Main package
- [Playwright for Python](https://playwright.dev/python/) - Playwright Python bindings
