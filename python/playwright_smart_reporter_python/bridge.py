"""
Bridge to call the Node.js Playwright Smart Reporter from Python
"""
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

from .converter import convert_pytest_json


class SmartReporterBridge:
    """
    Bridge to generate Playwright Smart Reports from pytest results.
    
    This class handles:
    1. Converting pytest JSON to Smart Reporter format
    2. Ensuring Node.js dependencies are installed
    3. Calling the Node.js HTML generator
    """
    
    def __init__(self, project_root: Optional[Path] = None):
        """
        Initialize the bridge.
        
        Args:
            project_root: Root directory of the project. Defaults to cwd.
        """
        self.project_root = project_root or Path.cwd()
        
        # Find the monorepo root (where package.json with playwright-smart-reporter is)
        self.repo_root = self._find_repo_root()
        self.node_modules = self.repo_root / "node_modules"
        
    def _find_repo_root(self) -> Path:
        """
        Find the monorepo root by looking for package.json with playwright-smart-reporter.
        
        Returns:
            Path to repository root
        """
        # Start from the python package directory
        current = Path(__file__).parent.parent.parent
        
        # Look for package.json with playwright-smart-reporter
        for _ in range(5):  # Go up max 5 levels
            package_json = current / "package.json"
            if package_json.exists():
                try:
                    data = json.loads(package_json.read_text())
                    if data.get("name") == "playwright-smart-reporter":
                        return current
                except:
                    pass
            current = current.parent
            
        # Fallback: assume we're in python/ subdirectory
        return Path(__file__).parent.parent.parent
    
    def _ensure_node_deps(self) -> None:
        """Ensure Node.js dependencies are installed in the monorepo root."""
        if (self.node_modules / "playwright-smart-reporter").exists():
            return
            
        print("📦 Installing Node.js dependencies...")
        npm_cmd = "npm.cmd" if sys.platform.startswith("win") else "npm"
        
        try:
            result = subprocess.run(
                [npm_cmd, "install"],
                cwd=self.repo_root,
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                raise RuntimeError(f"npm install failed: {result.stderr}")
        except FileNotFoundError:
            raise RuntimeError(
                "Node.js not found. Please install Node.js 18+ from https://nodejs.org"
            )
    
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
        # Ensure dependencies
        self._ensure_node_deps()
        
        # Convert pytest JSON to Smart Reporter format
        html_data = convert_pytest_json(pytest_json_path)
        
        # Save intermediate data
        if data_json_path is None:
            data_json_path = self.project_root / ".smart-reporter-data.json"
        data_json_path.write_text(json.dumps(html_data, indent=2), encoding="utf-8")
        
        # Call Node.js generator using the compiled dist/generators/html-generator.js
        node_cmd = "node.exe" if sys.platform.startswith("win") else "node"
        generator_script = self._create_generator_script()
        
        cmd = [
            node_cmd,
            str(generator_script),
            str(data_json_path.absolute()),
            str(output_html.absolute()),
        ]
        
        result = subprocess.run(cmd, cwd=self.repo_root, capture_output=True, text=True)
        
        if result.returncode != 0:
            raise RuntimeError(f"Report generation failed: {result.stderr}")
    
    def _create_generator_script(self) -> Path:
        """
        Create a Node.js script that calls the HTML generator.
        
        Returns:
            Path to the generated script
        """
        script_path = self.repo_root / "python" / ".generate-report.js"
        script_content = """const fs = require('fs');
const path = require('path');
const { generateHtml } = require('../dist/generators/html-generator');

const inputPath = process.argv[2];
const outputPath = process.argv[3] || 'smart-report.html';

if (!inputPath) {
  console.error('Usage: node generate-report.js <data.json> [output.html]');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const html = generateHtml(data);

const outDir = path.dirname(outputPath);
if (outDir && outDir !== '.') {
  fs.mkdirSync(outDir, { recursive: true });
}

fs.writeFileSync(outputPath, html, 'utf8');
console.log(`✅ Smart Report generated: ${outputPath}`);
"""
        script_path.write_text(script_content, encoding="utf-8")
        return script_path
