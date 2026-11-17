#!/usr/bin/env python3
"""
This repository is public. Fails when internal build material is committed: design specs, decision logs, progress
notes, release runbooks, or references to internal change numbers and those documents. Run from the repository root:
`python3 scripts/check_public_repo.py`. Scans the files git tracks (or the paths given as arguments).
"""

import re
import subprocess
import sys
from pathlib import Path

FORBIDDEN_PATHS = [
    re.compile(p)
    for p in (
        r"(^|/)docs/spec/",
        r"(^|/)DECISIONS\.md$",
        r"(^|/)PROGRESS\.md$",
        r"(^|/)RELEASING\.md$",
        r"(^|/)SERVER_SDKS\.md$",
        r"(^|/)AI_GUIDES_QA\.md$",
        r"(^|/)ai-qa-runs/",
        r"(^|/)(API_CONTRACT|SDK_BEHAVIOUR|PLATFORM_CHANNEL)\.md$",
        r"(^|/)__pycache__/",
        r"\.pyc$",
    )
]

FORBIDDEN_TEXT = [
    ("internal change number", re.compile(r"\bchange[ -]?\d{2}\b", re.I)),
    ("internal spec id", re.compile(r"\bC\d{1,2}-[A-Z]{1,2}\d")),
    (
        "internal document",
        re.compile(
            r"DECISIONS\.md|PROGRESS\.md|RELEASING\.md|SERVER_SDKS\.md|AI_GUIDES_QA|ai-qa-runs|docs/spec"
            r"|API_CONTRACT|SDK_BEHAVIOUR|PLATFORM_CHANNEL"
        ),
    ),
    ("internal process note", re.compile(r"owner decision|judge?ment call|build specification|\bcoordinator\b", re.I)),
    ("internal owner note", re.compile(r"\bowner,? 20\d{2}\b", re.I)),
    # Requirement codes of the internal plans: KC.1, X.E10, R.24, S.13, C21-B4, "C11 B2.2", "backend spec 13.3".
    # E.164 (the phone number format) is the one public name of this shape.
    ("internal requirement code", re.compile(r"(?<![\w.])(?!E\.164\b)[A-Z]{1,2}\.[A-Z]?\d+\b(?!\.\d)")),
    ("internal spec id", re.compile(r"\bC\d{2}-[BFS]\d+\b|\bC\d{1,2} B\d|\bbackend spec \d", re.I)),
    # Private repositories: say "the backend repository" or "the backend's public document" instead
    ("private repository", re.compile(r"\.\./clikgate_api|clikgate_api/|clikgate_frontend|clikgate_website|clikgate-sdk-internal")),
    # The backend's source layout (src/<module>/.../<file>.py, src/core/..., src/static/...); this repo's own Python
    # package lives under src/clikgate/, and "clikgate_api" as a quoted directory name in code builds that layout too
    (
        "backend source path",
        re.compile(
            r"(?<![\w./-])src/(?!clikgate/)[a-z_]+/(?:[a-z_]+/)*[a-z_]+\.(?:py|html)\b|(?<![\w./-])src/(?:core|static)/"
            r"|[\"']clikgate_api[\"']"
        ),
    ),
]

# Files whose job is to list the patterns above (release scanners and this check)
SKIP = {
    "scripts/check_public_repo.py",
    "scripts/scan_release_packages.py",
    "server/scripts/scan-package.mjs",
    "scripts/scan-package.mjs",
}

IGNORE_FILES = {".gitignore", ".pubignore", ".npmignore", ".dockerignore", ".gitattributes"}

# Generated from the backend's public OpenAPI document, which is checked in the backend repository. Never
# hand-edit them: fix the wording in the backend, then regenerate. Only the path-based checks apply to them here.
GENERATED_FROM_BACKEND = {
    "server/openapi/openapi-public.json",
    "server/openapi/openapi.json",
    "server/node/src/generated/index.ts",
}


def tracked() -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z"], check=True, capture_output=True).stdout
    return [p for p in out.decode().split("\0") if p]


def main(argv: list[str]) -> int:
    paths = argv or tracked()
    problems: list[str] = []
    for path in paths:
        if any(p.search(path) for p in FORBIDDEN_PATHS):
            problems.append(f"{path}: internal file in a public repository")
            continue
        # Ignore files name the internal files on purpose, to keep them out of git and out of published packages
        if path in SKIP or path in GENERATED_FROM_BACKEND or path.rsplit("/", 1)[-1] in IGNORE_FILES:
            continue
        file = Path(path)
        if not file.is_file():
            continue
        data = file.read_bytes()
        if b"\0" in data[:8192]:
            continue  # binary
        for number, line in enumerate(data.decode("utf-8", "replace").splitlines(), 1):
            for label, pattern in FORBIDDEN_TEXT:
                match = pattern.search(line)
                if match:
                    problems.append(f"{path}:{number}: {label}: {match.group(0)!r}")
    for problem in problems:
        print(problem)
    if problems:
        print(f"\n{len(problems)} problem(s). Internal material belongs in the private clikgate-sdk-internal repository.")
        return 1
    print(f"OK: {len(paths)} files, nothing internal.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
