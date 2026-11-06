"""Check the built wheel: py.typed and the add-ons are in, tests and examples are out, metadata lists httpx only."""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path

dist = Path(__file__).resolve().parents[1] / "dist"
wheels = sorted(dist.glob("clikgate-*.whl"))
if not wheels:
    sys.exit("no wheel in dist/; run python -m build first")
with zipfile.ZipFile(wheels[-1]) as z:
    names = set(z.namelist())
    meta = next(n for n in names if n.endswith("METADATA"))
    metadata = z.read(meta).decode()
required = {
    "clikgate/__init__.py",
    "clikgate/py.typed",
    "clikgate/api.py",
    "clikgate/django.py",
    "clikgate/flask.py",
    "clikgate/fastapi.py",
    "clikgate/starlette.py",
}
problems = [f"missing {n}" for n in sorted(required - names)]
problems += [f"unexpected {n}" for n in sorted(names) if n.startswith(("tests/", "examples/", "scripts/"))]
requires = [line.split(":", 1)[1].strip() for line in metadata.splitlines() if line.startswith("Requires-Dist:")]
core = [r for r in requires if "extra ==" not in r]
if len(core) != 1 or not core[0].startswith("httpx"):
    problems.append(f"core Requires-Dist must be httpx only, got {core}")
if "License-Expression: MIT" not in metadata:
    problems.append("License-Expression: MIT missing")
if problems:
    sys.exit("\n".join(problems))
print(f"{wheels[-1].name}: {len(names)} files ok; requires {core}")
