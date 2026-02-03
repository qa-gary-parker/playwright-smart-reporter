"""
Playwright Smart Reporter - Python Bridge

This package provides Python/pytest integration for the Playwright Smart Reporter.
It converts pytest test results to the Smart Reporter format and generates 
beautiful HTML reports with AI-powered analysis.
"""

from .bridge import SmartReporterBridge

__version__ = "0.1.0"
__all__ = ["SmartReporterBridge"]
