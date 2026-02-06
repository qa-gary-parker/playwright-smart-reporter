"""
Bridge to call the Node.js Playwright Smart Reporter from Python.
"""
import json
import subprocess
import sys
from pathlib import Path
from typing import Optional

from .converter import convert_pytest_json

# Template for the Node.js script. {generators_dir} is injected as an absolute
# path so require() resolves correctly regardless of cwd.  Internal relative
# requires (../utils, ./card-generator, etc.) resolve relative to the loaded
# file's own directory, so the preserved directory structure keeps them working.
_GENERATE_SCRIPT_TEMPLATE = """\
const fs = require('fs');
const path = require('path');
const {{ generateHtml }} = require('{generators_dir}/html-generator');

const inputPath = process.argv[2];
const outputPath = process.argv[3] || 'smart-report.html';

if (!inputPath) {{
  console.error('Usage: node .generate-report.js <data.json> [output.html]');
  process.exit(1);
}}

const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const html = generateHtml(data);

const outDir = path.dirname(outputPath);
if (outDir && outDir !== '.') {{
  fs.mkdirSync(outDir, {{ recursive: true }});
}}

fs.writeFileSync(outputPath, html, 'utf8');
"""


def _get_dist_root() -> Path:
    """
    Locate the dist directory containing the compiled JS generators.

    Checks in order:
    1. Bundled dist shipped inside the Python package (PyPI install)
    2. Monorepo dist/ at the repository root (development)

    Returns the directory that contains generators/html-generator.js.
    """
    # 1) Bundled inside the installed package
    bundled = Path(__file__).resolve().parent / "_bundled_dist"
    if (bundled / "generators" / "html-generator.js").is_file():
        return bundled

    # 2) Monorepo layout
    monorepo = _find_monorepo_root()
    if monorepo is not None:
        dist = monorepo / "dist"
        if (dist / "generators" / "html-generator.js").is_file():
            return dist

    raise RuntimeError(
        "Cannot find the compiled Smart Reporter JS files.\n"
        "If installed via pip, the package may be corrupt - try reinstalling.\n"
        "If developing locally, run 'npm run build' from the repo root."
    )


def _find_monorepo_root() -> Optional[Path]:
    """
    Walk upward looking for the playwright-smart-reporter package.json.

    Returns the repo root Path or None.
    """
    # This file: python/playwright_smart_reporter_python/bridge.py
    # Two parents up → monorepo root
    candidate = Path(__file__).resolve().parent.parent.parent
    if _is_valid_root(candidate):
        return candidate

    # Also try walking up from cwd (covers editable installs run from subdir)
    current = Path.cwd()
    for _ in range(6):
        if _is_valid_root(current):
            return current
        current = current.parent

    return None


def _is_valid_root(p: Path) -> bool:
    pj = p / "package.json"
    if not pj.exists():
        return False
    try:
        data = json.loads(pj.read_text(encoding="utf-8"))
        return data.get("name") == "playwright-smart-reporter"
    except Exception:
        return False


class SmartReporterBridge:
    """
    Bridge to generate Playwright Smart Reports from pytest results.

    This class handles:
    1. Converting pytest JSON to Smart Reporter format
    2. Locating the compiled JS generators (bundled or monorepo)
    3. Calling the Node.js HTML generator
    """

    def __init__(self, project_root: Optional[Path] = None):
        self.project_root = project_root or Path.cwd()
        self._dist_root = _get_dist_root()

    def generate_report(
        self,
        pytest_json_path: Path,
        output_html: Path,
        data_json_path: Optional[Path] = None,
    ) -> None:
        """
        Generate Smart Report from pytest JSON results.

        Args:
            pytest_json_path: Path to pytest-json-report output
            output_html: Path for output HTML report
            data_json_path: Optional path to save intermediate data JSON
        """
        # Convert pytest JSON to Smart Reporter format
        html_data = convert_pytest_json(pytest_json_path)

        # Save intermediate data
        if data_json_path is None:
            data_json_path = self.project_root / ".smart-reporter-data.json"
        data_json_path.write_text(json.dumps(html_data, indent=2), encoding="utf-8")

        # Build the generator script with absolute path to generators dir
        generators_dir = (self._dist_root / "generators").resolve()
        # Normalise to forward slashes for Node.js on all platforms
        gen_dir_str = str(generators_dir).replace("\\", "/")
        script_content = _GENERATE_SCRIPT_TEMPLATE.format(generators_dir=gen_dir_str)

        script_path = self.project_root / ".generate-report.js"
        script_path.write_text(script_content, encoding="utf-8")

        try:
            node_cmd = "node.exe" if sys.platform.startswith("win") else "node"
            cmd = [
                node_cmd,
                str(script_path),
                str(Path(data_json_path).resolve()),
                str(Path(output_html).resolve()),
            ]

            result = subprocess.run(cmd, capture_output=True, text=True)

            if result.returncode != 0:
                stderr = result.stderr or result.stdout
                raise RuntimeError(f"Report generation failed:\n{stderr}")
        finally:
            # Clean up the temporary script
            if script_path.exists():
                script_path.unlink()
