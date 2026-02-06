from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def sample_report_path():
    return FIXTURES_DIR / "sample_pytest_report.json"
