"""Run the unit tests and/or the conformance suite (sync and async clients).

python scripts/run_tests.py [--unit] [--conformance]
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
args = sys.argv[1:]
unit = "--unit" in args or "--conformance" not in args
conformance = "--conformance" in args or "--unit" not in args
code = 0
if unit:
    code |= subprocess.call([sys.executable, "-m", "pytest", "tests/unit"], cwd=root)
if conformance:
    runner = str(root / "tests" / "conformance" / "runner.py")
    code |= subprocess.call([sys.executable, runner], cwd=root)
    code |= subprocess.call([sys.executable, runner, "--async"], cwd=root)
sys.exit(code)
