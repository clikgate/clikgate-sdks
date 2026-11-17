from __future__ import annotations

import json
from typing import Any, Callable, Dict, List

import httpx
import pytest

KEY = "cg_test_unit000000000000"


class Recorder:
    """A capturing transport: records every request that reaches the HTTP layer."""

    def __init__(self, handler: Callable[[httpx.Request], httpx.Response] | None = None) -> None:
        self.requests: List[httpx.Request] = []
        self.handler = handler or (lambda _r: httpx.Response(201, json={"object": "goal_event", "id": "gev_1", "counted": True}))

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.handler(request)

    def bodies(self) -> List[Dict[str, Any]]:
        return [json.loads(r.content) for r in self.requests if r.content]


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for k in ("CLIKGATE_API_KEY", "CLIKGATE_BASE_URL", "HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"):
        monkeypatch.delenv(k, raising=False)


@pytest.fixture
def recorder() -> Recorder:
    return Recorder()


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    """
    Stop the SDK's background threads before the interpreter shuts down. Tests leave clients with a running
    ``clikgate-sender`` (and a one-shot ``clikgate-config`` warm-up); a daemon thread still busy at interpreter
    shutdown can abort the process ("could not acquire lock for <stderr> at interpreter shutdown") after every test
    passed, which fails CI on Linux runners.
    """
    import threading

    for thread in threading.enumerate():
        if not thread.name.startswith("clikgate-") or thread is threading.current_thread():
            continue
        owner = getattr(getattr(thread, "_target", None), "__self__", None)
        stop = getattr(owner, "stop", None)
        if callable(stop):
            stop()
        thread.join(timeout=5)
