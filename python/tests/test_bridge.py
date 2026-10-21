import importlib.util
import json
import re
import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from playwright_smart_reporter_python.bridge import (
    SmartReporterBridge,
    _find_monorepo_root,
    _get_dist_root,
    _is_valid_root,
)

REPO_ROOT = Path(__file__).resolve().parents[2]


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
        bundled = tmp_path / "_bundled_dist" / "report-data"
        bundled.mkdir(parents=True)
        (bundled / "builder.js").write_text("// bundled")

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
        dist = monorepo / "dist" / "report-data"
        dist.mkdir(parents=True)
        (dist / "builder.js").write_text("// monorepo")

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
        bundled = tmp_path / "pkg" / "_bundled_dist" / "report-data"
        bundled.mkdir(parents=True)
        (bundled / "builder.js").write_text("// fake")

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

        bundled = tmp_path / "pkg" / "_bundled_dist" / "report-data"
        bundled.mkdir(parents=True)
        (bundled / "builder.js").write_text("// fake")

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


def _report_data(html):
    match = re.search(r"<script>window\.__SMART_DATA__=(.*?);</script>", html, re.S)
    assert match is not None, "report data is not embedded in the HTML"
    return json.loads(match.group(1))


def _load_bundler():
    spec = importlib.util.spec_from_file_location(
        "bundle_dist", REPO_ROOT / "python" / "scripts" / "bundle_dist.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestRoundTrip:
    """Runs Node on the compiled dist, so `npm run build` must run first."""

    def _assert_report(self, html_path, dist_root):
        html = html_path.read_text(encoding="utf-8")
        data = _report_data(html)
        assert data["schemaVersion"] == 4
        assert data["meta"]["startTime"] == 1700000000000
        assert [t["title"] for t in data["tests"]] == [
            "TestLogin::test_valid_credentials",
            "TestLogin::test_invalid_password",
            "test_widget_count",
            "test_export_csv",
        ]
        assert [t["status"] for t in data["tests"]] == [
            "passed",
            "failed",
            "passed",
            "skipped",
        ]
        summary = data["summary"]
        assert (
            summary["total"],
            summary["passed"],
            summary["failed"],
            summary["skipped"],
        ) == (4, 2, 1, 1)
        assert data["ai"]["analysisOff"] is True
        package = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))
        assert data["meta"]["reporterVersion"] == package["version"]
        assert data["config"]["features"]["live"] is False
        assert (dist_root / "ui" / "app.js").read_text(encoding="utf-8") in html

    def test_generates_report_from_built_dist(self, tmp_path, sample_report_path):
        bridge = SmartReporterBridge(project_root=tmp_path)
        output = tmp_path / "out" / "report.html"

        bridge.generate_report(pytest_json_path=sample_report_path, output_html=output)

        self._assert_report(output, bridge._dist_root)

    def test_bundled_dist_is_self_contained(self, tmp_path, sample_report_path):
        repo = tmp_path / "repo"
        package_dir = repo / "python" / "playwright_smart_reporter_python"
        package_dir.mkdir(parents=True)
        (repo / "dist").symlink_to(REPO_ROOT / "dist")
        (repo / "package.json").symlink_to(REPO_ROOT / "package.json")
        _load_bundler().bundle(repo)

        with patch(
            "playwright_smart_reporter_python.bridge.__file__",
            str(package_dir / "bridge.py"),
        ):
            bridge = SmartReporterBridge(project_root=tmp_path)
        assert bridge._dist_root == package_dir.resolve() / "_bundled_dist"

        output = tmp_path / "report.html"
        bridge.generate_report(pytest_json_path=sample_report_path, output_html=output)

        self._assert_report(output, bridge._dist_root)
