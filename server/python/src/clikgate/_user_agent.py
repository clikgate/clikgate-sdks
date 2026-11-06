"""The User-Agent (SPEC section 4). It is the only telemetry the SDK sends."""

from __future__ import annotations

import platform
import re
from typing import Optional

from ._version import VERSION

_ARCH = {"x86_64": "x64", "amd64": "x64", "x64": "x64", "aarch64": "arm64", "arm64": "arm64", "i386": "x86", "i686": "x86", "x86": "x86"}
_BAD = re.compile(r"[^0-9A-Za-z.+-]")


def sanitise(version: str) -> str:
    """Versions must match ``^[0-9][0-9A-Za-z.+-]{0,39}$`` for the backend parser."""
    v = version[1:] if version.startswith("v") else version
    return _BAD.sub("-", v)[:40]


def normalise_arch(machine: str) -> str:
    m = machine.lower().replace(" ", "")
    if m in _ARCH:
        return _ARCH[m]
    if m.startswith("armv") or m == "arm":
        return "arm"
    return m or "unknown"


def user_agent(system: Optional[str] = None, machine: Optional[str] = None, python_version: Optional[str] = None) -> str:
    """``clikgate-python/<v> (python <v>; <os> <arch>)``."""
    os_name = (system if system is not None else platform.system()).lower().replace(" ", "") or "unknown"
    arch = normalise_arch(machine if machine is not None else platform.machine())
    py = sanitise(python_version if python_version is not None else platform.python_version())
    return f"clikgate-python/{sanitise(VERSION)} (python {py}; {os_name} {arch})"
