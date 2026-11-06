"""pyproject.toml, src/clikgate/_version.py and (on a tag) server-python-v<version> must agree; httpx is the only dependency."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.9/3.10
    tomllib = None  # type: ignore[assignment]

root = Path(__file__).resolve().parents[1]
text = (root / "pyproject.toml").read_text("utf-8")
if tomllib is not None:
    project = tomllib.loads(text)["project"]
    version, deps = project["version"], project["dependencies"]
else:
    version = re.search(r'^version = "([^"]+)"', text, re.M).group(1)  # type: ignore[union-attr]
    deps = re.findall(r'"([^"]+)"', re.search(r"^dependencies = \[(.*?)\]", text, re.M | re.S).group(1))  # type: ignore[union-attr]
src = re.search(r'VERSION = "([^"]+)"', (root / "src/clikgate/_version.py").read_text("utf-8")).group(1)  # type: ignore[union-attr]
ref = os.environ.get("GITHUB_REF_NAME", "")
tag = ref[len("server-python-v") :] if ref.startswith("server-python-v") else None
problems = []
if src != version:
    problems.append(f"_version.py says {src}, pyproject.toml says {version}")
if tag and tag != version:
    problems.append(f"tag says {tag}, pyproject.toml says {version}")
if [re.split(r"[<>=!~ ;\[]", d)[0] for d in deps] != ["httpx"]:
    problems.append(f"the only runtime dependency must be httpx (S.13), got {deps}")
if problems:
    sys.exit("\n".join(problems))
print(f"version {version} ok")
