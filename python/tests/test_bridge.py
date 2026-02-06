import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from playwright_smart_reporter_python.bridge import (
    _find_monorepo_root,
    _get_dist_root,
    _is_valid_root,
)


class TestIsValidRoot:
    def test_valid_root(self, tmp_path):
        pj = tmp_path / "package.json"
        pj.write_text('{"name": "playwright-smart-reporter"}')
        assert _is_valid_root(tmp_path) is True

    def test_wrong_name(self, tmp_path):
        pj = tmp_path / "package.json"
        pj.write_text('{"name": "some-other-package"}')
        assert _is_valid_root(tmp_path) is False

    def test_no_package_json(self, tmp_path):
        assert _is_valid_root(tmp_path) is False

    def test_invalid_json(self, tmp_path):
        pj = tmp_path / "package.json"
        pj.write_text("not json")
        assert _is_valid_root(tmp_path) is False


class TestGetDistRoot:
    def test_prefers_bundled_over_monorepo(self, tmp_path):
        """Bundled dist should be preferred when present."""
        # Create a fake bundled dist
        bundled = tmp_path / "_bundled_dist" / "generators"
        bundled.mkdir(parents=True)
        (bundled / "html-generator.js").write_text("// bundled")

        with patch(
            "playwright_smart_reporter_python.bridge.__file__",
            str(tmp_path / "bridge.py"),
        ):
            result = _get_dist_root()
            assert result == tmp_path / "_bundled_dist"

    def test_falls_back_to_monorepo(self, tmp_path):
        """When no bundled dist, should check monorepo."""
        monorepo = tmp_path / "repo"
        monorepo.mkdir()
        (monorepo / "package.json").write_text(
            '{"name": "playwright-smart-reporter"}'
        )
        dist = monorepo / "dist" / "generators"
        dist.mkdir(parents=True)
        (dist / "html-generator.js").write_text("// monorepo")

        with patch(
            "playwright_smart_reporter_python.bridge._find_monorepo_root",
            return_value=monorepo,
        ):
            # Ensure bundled doesn't exist by patching __file__
            with patch(
                "playwright_smart_reporter_python.bridge.__file__",
                str(tmp_path / "nonexistent" / "bridge.py"),
            ):
                result = _get_dist_root()
                assert result == monorepo / "dist"

    def test_raises_when_nothing_found(self):
        with patch(
            "playwright_smart_reporter_python.bridge.__file__",
            "/nonexistent/path/bridge.py",
        ):
            with patch(
                "playwright_smart_reporter_python.bridge._find_monorepo_root",
                return_value=None,
            ):
                with pytest.raises(RuntimeError, match="Cannot find"):
                    _get_dist_root()


class TestFindMonorepoRoot:
    def test_returns_none_when_not_in_monorepo(self):
        with patch(
            "playwright_smart_reporter_python.bridge.__file__",
            "/tmp/isolated/pkg/bridge.py",
        ):
            with patch("playwright_smart_reporter_python.bridge.Path.cwd") as mock_cwd:
                mock_cwd.return_value = Path("/tmp/isolated")
                result = _find_monorepo_root()
                assert result is None


class TestSmartReporterBridge:
    def test_node_failure_raises(self, tmp_path, sample_report_path):
        from playwright_smart_reporter_python.bridge import SmartReporterBridge

        # Create fake dist
        bundled = tmp_path / "pkg" / "_bundled_dist" / "generators"
        bundled.mkdir(parents=True)
        (bundled / "html-generator.js").write_text("// fake")

        with patch(
            "playwright_smart_reporter_python.bridge.__file__",
            str(tmp_path / "pkg" / "bridge.py"),
        ):
            bridge = SmartReporterBridge(project_root=tmp_path)

            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(
                    returncode=1,
                    stderr="Error: Cannot find module",
                    stdout="",
                )
                with pytest.raises(RuntimeError, match="Report generation failed"):
                    bridge.generate_report(
                        pytest_json_path=sample_report_path,
                        output_html=tmp_path / "report.html",
                    )

    def test_generate_report_calls_node(self, tmp_path, sample_report_path):
        from playwright_smart_reporter_python.bridge import SmartReporterBridge

        bundled = tmp_path / "pkg" / "_bundled_dist" / "generators"
        bundled.mkdir(parents=True)
        (bundled / "html-generator.js").write_text("// fake")

        with patch(
            "playwright_smart_reporter_python.bridge.__file__",
            str(tmp_path / "pkg" / "bridge.py"),
        ):
            bridge = SmartReporterBridge(project_root=tmp_path)

            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(
                    returncode=0, stderr="", stdout=""
                )
                bridge.generate_report(
                    pytest_json_path=sample_report_path,
                    output_html=tmp_path / "report.html",
                )

                mock_run.assert_called_once()
                args = mock_run.call_args[0][0]
                assert args[0] == "node"
                assert "generate-report" in args[1]
