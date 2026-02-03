"""
Example: Basic usage of Playwright Smart Reporter Python bridge
"""
import pytest


def test_example_passing():
    """A test that passes."""
    assert 1 + 1 == 2


def test_example_with_math():
    """Test basic arithmetic."""
    assert 10 / 2 == 5
    assert 3 * 3 == 9


@pytest.mark.skip(reason="Example of a skipped test")
def test_example_skipped():
    """This test is skipped."""
    pass


def test_example_failing():
    """A test that fails to demonstrate error reporting."""
    result = {"name": "playwright", "type": "testing"}
    assert result["name"] == "pytest", "Expected pytest but got playwright"
