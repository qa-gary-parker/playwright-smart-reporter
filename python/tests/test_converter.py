import json
from pathlib import Path

import pytest

from playwright_smart_reporter_python.converter import (
    _extract_error,
    _playwright_outcome,
    _status_from_outcome,
    _to_ms,
    convert_pytest_json,
)


class TestToMs:
    def test_seconds_to_ms(self):
        assert _to_ms(1.5) == 1500

    def test_zero(self):
        assert _to_ms(0) == 0

    def test_none_returns_zero(self):
        assert _to_ms(None) == 0

    def test_int_input(self):
        assert _to_ms(3) == 3000

    def test_string_numeric(self):
        assert _to_ms("2.5") == 2500

    def test_invalid_string(self):
        assert _to_ms("not-a-number") == 0


class TestStatusFromOutcome:
    def test_passed(self):
        assert _status_from_outcome("passed") == "passed"

    def test_failed(self):
        assert _status_from_outcome("failed") == "failed"

    def test_skipped(self):
        assert _status_from_outcome("skipped") == "skipped"

    def test_unknown_defaults_to_failed(self):
        assert _status_from_outcome("error") == "failed"

    def test_none_defaults_to_failed(self):
        assert _status_from_outcome(None) == "failed"


class TestPlaywrightOutcome:
    def test_passed_is_expected(self):
        assert _playwright_outcome("passed") == "expected"

    def test_skipped(self):
        assert _playwright_outcome("skipped") == "skipped"

    def test_failed_is_unexpected(self):
        assert _playwright_outcome("failed") == "unexpected"

    def test_none_is_unexpected(self):
        assert _playwright_outcome(None) == "unexpected"


class TestExtractError:
    def test_string_longrepr(self):
        test = {"call": {"longrepr": "AssertionError: bad value"}}
        assert _extract_error(test) == "AssertionError: bad value"

    def test_dict_longrepr_with_message(self):
        test = {"call": {"longrepr": {"message": "timeout exceeded"}}}
        assert _extract_error(test) == "timeout exceeded"

    def test_dict_longrepr_without_message(self):
        test = {"call": {"longrepr": {"chain": []}}}
        result = _extract_error(test)
        assert result is not None
        assert "chain" in result

    def test_setup_phase_error(self):
        test = {"setup": {"longrepr": "fixture error"}}
        assert _extract_error(test) == "fixture error"

    def test_no_error(self):
        test = {"call": {"outcome": "passed"}}
        assert _extract_error(test) is None

    def test_empty_test(self):
        assert _extract_error({}) is None


class TestConvertPytestJson:
    def test_structure(self, sample_report_path):
        data = convert_pytest_json(sample_report_path)
        assert "results" in data
        assert "history" in data
        assert "startTime" in data
        assert "options" in data

    def test_result_count(self, sample_report_path):
        data = convert_pytest_json(sample_report_path)
        assert len(data["results"]) == 4

    def test_passed_test_fields(self, sample_report_path):
        data = convert_pytest_json(sample_report_path)
        passed = data["results"][0]
        assert passed["status"] == "passed"
        assert passed["outcome"] == "expected"
        assert passed["title"] == "TestLogin::test_valid_credentials"
        assert passed["file"] == "tests/test_login.py"
        assert passed["duration"] == 1234
        assert passed["error"] is None

    def test_failed_test_has_error(self, sample_report_path):
        data = convert_pytest_json(sample_report_path)
        failed = data["results"][1]
        assert failed["status"] == "failed"
        assert failed["outcome"] == "unexpected"
        assert "AssertionError" in failed["error"]

    def test_skipped_test(self, sample_report_path):
        data = convert_pytest_json(sample_report_path)
        skipped = data["results"][3]
        assert skipped["status"] == "skipped"
        assert skipped["outcome"] == "skipped"

    def test_start_time_is_ms(self, sample_report_path):
        data = convert_pytest_json(sample_report_path)
        assert data["startTime"] == 1700000000000

    def test_tags_from_keywords(self, sample_report_path):
        data = convert_pytest_json(sample_report_path)
        assert data["results"][0]["tags"] == ["login", "smoke"]

    def test_result_has_required_keys(self, sample_report_path):
        data = convert_pytest_json(sample_report_path)
        required = {
            "testId", "title", "file", "status", "duration",
            "error", "retry", "outcome", "expectedStatus",
            "steps", "history", "tags", "attachments",
        }
        for result in data["results"]:
            assert required.issubset(result.keys())
