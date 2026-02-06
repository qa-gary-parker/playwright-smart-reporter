"""
Pytest plugin for automatic Smart Reporter generation.

Registered via the pytest11 entry point in pyproject.toml.
"""
import json
from pathlib import Path
from typing import Optional

import pytest

from .bridge import SmartReporterBridge


def pytest_addoption(parser):
    """Add command-line options for Smart Reporter."""
    group = parser.getgroup("smart-reporter")
    group.addoption(
        "--smart-reporter",
        action="store_true",
        default=False,
        help="Generate Playwright Smart Report after test run",
    )
    group.addoption(
        "--smart-reporter-output",
        action="store",
        default="smart-report.html",
        help="Output path for Smart Report HTML (default: smart-report.html)",
    )


def pytest_configure(config):
    """Configure the plugin: enable json-report and register the session plugin."""
    # Only activate when --smart-reporter is passed
    if not config.getoption("--smart-reporter", default=False):
        return

    # Ensure pytest-json-report is configured
    if hasattr(config.option, "json_report"):
        config.option.json_report = True
        config.option.json_report_file = ".pytest-report.json"

    # Register marker
    config.addinivalue_line(
        "markers",
        "smart_reporter: Generate Playwright Smart Report after tests",
    )

    # Register our session-finish plugin
    config.pluginmanager.register(
        SmartReporterPlugin(config), "smart_reporter_plugin"
    )


class SmartReporterPlugin:
    """Pytest plugin to generate Smart Reports after the session finishes."""

    def __init__(self, config):
        self.config = config
        self.output_path = Path(config.getoption("--smart-reporter-output"))

    @pytest.hookimpl(trylast=True)
    def pytest_sessionfinish(self, session, exitstatus):
        """Generate report after all tests complete."""
        pytest_json = Path(".pytest-report.json")
        if not pytest_json.exists():
            print("\n⚠️  pytest-json-report file not found, skipping Smart Report")
            return

        try:
            bridge = SmartReporterBridge()
            bridge.generate_report(
                pytest_json_path=pytest_json,
                output_html=self.output_path,
            )
            print(f"\n📊 Smart Report generated: {self.output_path.absolute()}")
        except Exception as e:
            print(f"\n❌ Failed to generate Smart Report: {e}")
