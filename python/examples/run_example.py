"""
Run this example to generate a Smart Report from pytest tests.

Usage:
    python run_example.py
"""
import subprocess
import sys
from pathlib import Path

# Ensure we're in the examples directory
ROOT = Path(__file__).parent

def main():
    print("🧪 Running pytest tests...")
    
    # Run pytest with JSON reporting and Smart Reporter
    cmd = [
        sys.executable,
        "-m",
        "pytest",
        "test_basic.py",
        "--json-report",
        "--json-report-file=.pytest-report.json",
        "-v",
    ]
    
    result = subprocess.run(cmd, cwd=ROOT)
    
    # Generate the report manually (simulating what the plugin would do)
    if result.returncode in (0, 1):  # 0 = all passed, 1 = some failed
        print("\n📊 Generating Smart Report...")
        
        # Add parent directories to path to import the bridge
        sys.path.insert(0, str(ROOT.parent))
        
        from playwright_smart_reporter_python import SmartReporterBridge
        
        bridge = SmartReporterBridge(project_root=ROOT)
        bridge.generate_report(
            pytest_json_path=ROOT / ".pytest-report.json",
            output_html=ROOT / "smart-report.html",
        )
        
        print(f"✅ Report generated: {ROOT / 'smart-report.html'}")
        print(f"   Open file://{ROOT / 'smart-report.html'} in your browser")
    
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
