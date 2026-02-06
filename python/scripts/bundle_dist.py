#!/usr/bin/env python3
"""
Bundle the pre-built Node.js dist/ files into the Python package.

Run from the python/ directory (or repo root) after `npm run build`:
    python scripts/bundle_dist.py
"""
import shutil
import sys
from pathlib import Path

# Files required by html-generator.js and its dependency tree
REQUIRED_FILES = [
    "generators/html-generator.js",
    "generators/card-generator.js",
    "generators/chart-generator.js",
    "generators/comparison-generator.js",
    "generators/gallery-generator.js",
    "generators/trace-viewer-generator.js",
    "utils/index.js",
    "utils/formatters.js",
    "utils/markdown-lite.js",
    "utils/sanitizers.js",
    "vendors/jszip-source.js",
]


def bundle(repo_root: Path) -> None:
    dist_src = repo_root / "dist"
    if not dist_src.is_dir():
        print(f"ERROR: {dist_src} not found. Run 'npm run build' first.", file=sys.stderr)
        sys.exit(1)

    dest = repo_root / "python" / "playwright_smart_reporter_python" / "_bundled_dist"

    # Clean and recreate
    if dest.exists():
        shutil.rmtree(dest)

    missing = []
    for rel in REQUIRED_FILES:
        src = dist_src / rel
        if not src.exists():
            missing.append(rel)
            continue
        target = dest / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, target)

    if missing:
        print(f"ERROR: Missing files in dist/: {missing}", file=sys.stderr)
        sys.exit(1)

    print(f"Bundled {len(REQUIRED_FILES)} JS files into {dest}")


def main() -> None:
    # Support running from python/ or repo root
    cwd = Path.cwd()
    if (cwd / "package.json").exists():
        repo_root = cwd
    elif (cwd.parent / "package.json").exists():
        repo_root = cwd.parent
    else:
        # Try relative to this script
        repo_root = Path(__file__).resolve().parent.parent.parent
        if not (repo_root / "package.json").exists():
            print("ERROR: Cannot find repo root (package.json)", file=sys.stderr)
            sys.exit(1)

    bundle(repo_root)


if __name__ == "__main__":
    main()
