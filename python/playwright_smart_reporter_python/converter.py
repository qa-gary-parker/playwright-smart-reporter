"""
JSON converter: pytest-json-report format -> Playwright Smart Reporter format
"""
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Union


def _to_ms(seconds: Optional[Union[float, int]]) -> int:
    """Convert seconds to milliseconds."""
    if seconds is None:
        return 0
    try:
        return int(float(seconds) * 1000)
    except (TypeError, ValueError):
        return 0


def _extract_error(test: Dict[str, Any]) -> Optional[str]:
    """Extract error message from pytest test result."""
    for phase in ("call", "setup", "teardown"):
        data = test.get(phase) or {}
        longrepr = data.get("longrepr")
        if longrepr:
            if isinstance(longrepr, str):
                return longrepr
            if isinstance(longrepr, dict):
                return longrepr.get("message") or json.dumps(longrepr)
            return str(longrepr)
    return None


def _status_from_outcome(outcome: Optional[str]) -> str:
    """Map pytest outcome to Playwright status."""
    if outcome == "passed":
        return "passed"
    if outcome == "failed":
        return "failed"
    if outcome == "skipped":
        return "skipped"
    return "failed"


def _playwright_outcome(outcome: Optional[str]) -> str:
    """Map pytest outcome to Playwright outcome enum."""
    if outcome == "passed":
        return "expected"
    if outcome == "skipped":
        return "skipped"
    return "unexpected"


def convert_pytest_json(pytest_json_path: Path) -> Dict[str, Any]:
    """
    Convert pytest JSON report to Playwright Smart Reporter data format.

    Args:
        pytest_json_path: Path to pytest-json-report output file

    Returns:
        Dictionary in Smart Reporter HtmlGeneratorData format
    """
    data = json.loads(pytest_json_path.read_text(encoding="utf-8"))
    created = data.get("created") or datetime.utcnow().timestamp()
    tests: List[Dict[str, Any]] = data.get("tests", [])

    results: List[Dict[str, Any]] = []

    for test in tests:
        nodeid = test.get("nodeid", "unknown::test")

        # Parse test file and name from nodeid
        if "::" in nodeid:
            parts = nodeid.split("::")
            file_part = parts[0]
            title = "::".join(parts[1:])
        else:
            file_part, title = "unknown", nodeid

        outcome = test.get("outcome")
        duration = test.get("duration")
        error = _extract_error(test)

        # Extract additional metadata
        keywords = test.get("keywords", [])

        results.append(
            {
                "testId": nodeid,
                "title": title,
                "file": file_part,
                "status": _status_from_outcome(outcome),
                "duration": _to_ms(duration),
                "error": error,
                "retry": 0,
                "outcome": _playwright_outcome(outcome),
                "expectedStatus": "passed",
                "steps": [],
                "history": [],
                "tags": keywords if isinstance(keywords, list) else [],
                "attachments": {
                    "screenshots": [],
                    "videos": [],
                    "traces": [],
                    "custom": [],
                },
            }
        )

    html_data: Dict[str, Any] = {
        "results": results,
        "history": {
            "runs": [],
            "tests": {},
            "summaries": [],
        },
        "startTime": int(float(created) * 1000),
        "options": {
            # Feature flags - enable what makes sense for pytest
            "enableTraceViewer": False,
            "enableNetworkLogs": False,
            "enableGalleryView": False,
            "enableComparison": False,
            "enableHistoryDrilldown": False,
            "enableAIRecommendations": True,
            "enableTrendsView": True,
            "enableStabilityScore": True,
            "enableFailureClustering": True,
            "enableRetryAnalysis": False,
        },
    }

    return html_data
