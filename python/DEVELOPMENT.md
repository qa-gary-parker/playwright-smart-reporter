# Python Integration Setup Guide

This guide explains how to set up and use the Python integration in the monorepo.

## Repository Structure

```
playwright-smart-reporter/          [Monorepo root]
├── src/                            [TypeScript source - main reporter]
├── dist/                           [Compiled JavaScript]
├── package.json                    [npm package config]
├── python/                         [Python integration ← YOU ARE HERE]
│   ├── pyproject.toml             [Python package config]
│   ├── README.md                  [Python-specific docs]
│   ├── playwright_smart_reporter_python/
│   │   ├── __init__.py
│   │   ├── bridge.py              [Calls Node.js generator]
│   │   ├── converter.py           [pytest → Smart Reporter format]
│   │   └── plugin.py              [pytest plugin]
│   └── examples/
│       ├── test_basic.py
│       └── run_example.py
└── README.md                       [Main docs]
```

## Development Workflow

### 1. Build the TypeScript Project (Required)

The Python bridge calls the compiled JavaScript. You must build first:

```bash
# From repository root
npm install
npm run build
```

This creates `dist/` with the compiled reporter.

### 2. Install Python Package (Editable Mode)

```bash
cd python
pip install -e .
```

This installs the package in development mode. Changes to Python code take effect immediately.

### 3. Run Examples

```bash
cd python/examples
python run_example.py
```

This will:
1. Run pytest tests
2. Convert JSON to Smart Reporter format
3. Generate `smart-report.html`

### 4. Use in Your Own Projects

In any Python project:

```python
# conftest.py
pytest_plugins = ["playwright_smart_reporter"]
```

Then run:

```bash
pytest --smart-reporter
```

## Making Changes

### To TypeScript Code (Main Reporter)

1. Edit files in `src/`
2. Run `npm run build`
3. Python bridge automatically uses updated compiled code

### To Python Code

1. Edit files in `python/playwright_smart_reporter_python/`
2. Changes are live if installed with `pip install -e .`
3. No rebuild needed

### To Both (e.g., adding new feature)

1. Add TypeScript implementation in `src/`
2. Build: `npm run build`
3. Update Python converter/bridge if needed
4. Test with example: `cd python/examples && python run_example.py`

## Publishing

### Node.js Package

```bash
# From root
npm version patch|minor|major
npm publish
```

### Python Package

```bash
# From python/
python -m build
twine upload dist/*
```

Or use GitHub Actions (see `.github/workflows/` when created).

## Troubleshooting

### "Cannot find module '../dist/generators/html-generator'"

**Fix**: Run `npm run build` from repository root.

### "Node.js not found"

**Fix**: Install Node.js 18+ from https://nodejs.org

### "No module named pytest"

**Fix**: `pip install -e ".[dev]"` from `python/` directory

### Report not generating

1. Ensure TypeScript is compiled: `npm run build`
2. Check Node.js is installed: `node --version`
3. Check Python package is installed: `pip show playwright-smart-reporter-python`

## AI-Assisted Development Tips

Since you mentioned using AI tools for maintenance:

### Applying Changes Across Languages

When updating a feature:

1. **TypeScript**: Update `src/types.ts` → Rebuild
2. **Python**: Update `python/playwright_smart_reporter_python/converter.py`
3. **Tests**: Update both `test/` and `python/examples/`

### Using Copilot/AI

Example prompt:
```
Update both TypeScript and Python code to add support for [new feature].
- TypeScript: src/analyzers/new-analyzer.ts
- Python: python/playwright_smart_reporter_python/converter.py (add field to conversion)
```

The monorepo makes this easy because all code is in one place!

## Common Development Tasks

### Add New Test Result Field

1. **TypeScript** (`src/types.ts`):
```typescript
export interface TestResultData {
  // ... existing fields
  newField?: string;  // Add here
}
```

2. **Python** (`converter.py`):
```python
results.append({
    # ... existing fields
    "newField": extract_new_field(test),  # Add here
})
```

3. **Rebuild**: `npm run build`

### Add New Report Option

1. **TypeScript** (`src/types.ts`):
```typescript
export interface SmartReporterOptions {
  // ... existing options
  newOption?: boolean;
}
```

2. **Python** (`converter.py`):
```python
html_data = {
    # ...
    "options": {
        # ... existing options
        "newOption": True,  # Add here
    }
}
```

3. **Rebuild**: `npm run build`

## CI/CD Integration

The monorepo approach makes CI easier:

```yaml
# .github/workflows/test.yml
jobs:
  test-node:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm test
      - run: npm run build
  
  test-python:
    runs-on: ubuntu-latest
    needs: test-node  # Ensure TypeScript is built first
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - uses: actions/setup-python@v4
      - run: npm install
      - run: npm run build
      - run: cd python && pip install -e ".[dev]"
      - run: cd python/examples && python run_example.py
```

## Questions?

See main [README.md](../README.md) or open an issue on GitHub.
