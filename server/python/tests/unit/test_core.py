from __future__ import annotations

import hashlib
import re
import uuid
from decimal import Decimal
from typing import Any, List, cast

import httpx
import pytest

from clikgate import (
    Clikgate,
    ConfigurationError,
    ErrorContext,
    InvalidRequestError,
    PrivateModeFieldRejectedError,
    __version__,
    format_value,
)
from clikgate._client import _clients
from clikgate._user_agent import normalise_arch, sanitise, user_agent

from .conftest import KEY, Recorder

UA = re.compile(
    r"^clikgate-(node|python|php|java|dotnet)/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?) \(([a-z]+) ([0-9][0-9A-Za-z.+-]{0,39}); ([^ ]+) ([^)]+)\)( .*)?$"
)


def client(rec: Recorder, **kw: Any) -> Clikgate:
    return Clikgate(KEY, http_client=httpx.Client(transport=httpx.MockTransport(rec)), shutdown_hooks=False, **kw)


def test_money_types() -> None:
    assert format_value(Decimal("1500.50")) == "1500.50"
    assert format_value(Decimal("1E+3")) == "1000"
    assert format_value(2_000_000) == "2000000"
    assert format_value(" 12 ") == "12"
    with pytest.raises(TypeError):
        format_value(1500.5)  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        format_value(True)
    with pytest.raises(InvalidRequestError):
        format_value(Decimal("-1"))
    with pytest.raises(InvalidRequestError):
        format_value(Decimal("NaN"))


def test_user_agent() -> None:
    assert sanitise("1.8.0_402") == "1.8.0-402"
    assert normalise_arch("AMD64") == "x64"
    assert normalise_arch("aarch64") == "arm64"
    assert normalise_arch("armv7l") == "arm"
    ua = user_agent("Windows", "AMD64", "3.9.0")
    assert ua == f"clikgate-python/{__version__} (python 3.9.0; windows x64)"
    assert UA.match(ua)
    assert UA.match(user_agent())
    assert UA.match(user_agent("Linux", "x86_64", "3.15.0rc1+"))


def test_options() -> None:
    with pytest.raises(ConfigurationError) as e:
        Clikgate()
    assert e.value.code == "missing_api_key"
    with pytest.raises(ConfigurationError) as e:
        Clikgate("cg_sdk_test_secretvalue123")
    assert e.value.code == "invalid_api_key"
    assert "secretvalue123" not in str(e.value)
    with pytest.raises(ConfigurationError) as e:
        Clikgate(KEY, retries=3)
    assert e.value.code == "invalid_option"
    assert e.value.param == "retries"
    with pytest.raises(ConfigurationError):
        Clikgate(KEY, proxy="socks5://localhost:1080")
    with pytest.raises(ConfigurationError):
        Clikgate(KEY, timeout=0)
    with pytest.raises(ConfigurationError):
        Clikgate(KEY, http_client=httpx.AsyncClient())  # type: ignore[arg-type]
    c = Clikgate("cg_live_abc", shutdown_hooks=False, base_url="http://[::1]:8080/")
    assert c.mode == "live"
    c.close(0.1)


def test_env_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLIKGATE_API_KEY", KEY)
    c = Clikgate(shutdown_hooks=False)
    assert c.mode == "test"
    c.close(0.1)


def test_guard_never_reaches_transport(recorder: Recorder) -> None:
    errors: List[Any] = []
    c = client(recorder, private_mode=True, on_error=lambda e, ctx: errors.append((e, ctx)))
    with pytest.raises(PrivateModeFieldRejectedError) as e:
        c.goals.send("account_opened", reference="APP-1", metadata={"email": "secret@example.com"})
    assert e.value.field == "metadata"
    assert "secret@example.com" not in str(e.value)
    with pytest.raises(PrivateModeFieldRejectedError):
        c.goals.send_batch(
            [{"goal": "order_paid", "reference": "R-1"}, cast(Any, {"goal": "order_paid", "reference": "R-2", "email": "x@y.z"})]
        )
    with pytest.raises(PrivateModeFieldRejectedError):
        c.conversions.create(external_id="ORD-1", customer={"email": "x@y.z"})
    with pytest.raises(PrivateModeFieldRejectedError):
        c.goals.reverse("order_paid", "R-1", reason="refund for x@y.z")
    c.goal("account_opened", reference="APP-SECRET", metadata={"ads": True})
    c.goal("account_opened", reference="APP-OK")
    assert c.flush(5)
    assert all("metadata" not in b and "consent" not in b and "email" not in str(b) for b in recorder.bodies())
    assert len(recorder.requests) == 1
    assert recorder.bodies()[0] == {"events": [{"goal": "account_opened", "reference": "APP-OK"}]}
    assert len(errors) == 1
    err, ctx = errors[0]
    assert isinstance(err, PrivateModeFieldRejectedError)
    assert isinstance(ctx, ErrorContext)
    assert ctx.events == [{"goal": "account_opened", "reference": "[redacted]"}]
    c.close(1)


def test_goal_never_raises(recorder: Recorder) -> None:
    errors: List[Any] = []
    c = client(recorder, send_mode="sync", on_error=lambda e, ctx: errors.append(e.code))
    c.goal("Bad-Key", reference="R-1")
    c.goal("order_paid", reference="R-1", value=1.5)  # type: ignore[arg-type]
    c.goal("order_paid", reference="R-1", occurred_at=__import__("datetime").datetime(2026, 1, 1))  # naive
    assert c.flush(2)
    assert errors == ["invalid_goal_key", "invalid_value", "invalid_argument"]
    assert recorder.requests == []

    def boom(_e: Any, _c: Any) -> None:
        raise RuntimeError("broken callback")

    c2 = client(recorder, send_mode="sync", on_error=boom)
    c2.goal("Bad-Key", reference="R-1")  # the callback raising is swallowed
    c.close(1)
    c2.close(1)


def test_sync_goal_sends_a_random_key_per_call(recorder: Recorder) -> None:
    c = client(recorder, send_mode="sync", private_mode=False)
    c.goal("account_opened", reference="APP-55231", value=Decimal("2000000"))
    assert c.flush(5)
    (req,) = recorder.requests
    key = req.headers["idempotency-key"]
    assert uuid.UUID(key).version == 4
    assert key != hashlib.sha256(b"account_opened:APP-55231").hexdigest()
    assert req.headers["user-agent"].startswith("clikgate-python/")
    assert recorder.bodies() == [{"goal": "account_opened", "reference": "APP-55231", "value": "2000000"}]
    c.close(1)


def test_background_thread_batches_and_shutdown_registry(recorder: Recorder) -> None:
    recorder.handler = lambda _r: httpx.Response(200, json={"object": "list", "data": []})
    c = Clikgate(
        KEY, http_client=httpx.Client(transport=httpx.MockTransport(recorder)), private_mode=False, batch_size=2, flush_interval=0.05
    )
    assert c in _clients
    for i in range(5):
        c.goal("order_paid", reference=f"R-{i}")
    assert c.flush(5)
    sizes = [len(b["events"]) for b in recorder.bodies()]
    assert sum(sizes) == 5
    assert max(sizes) <= 2
    c._at_exit()  # nothing queued: no extra request
    assert sum(len(b["events"]) for b in recorder.bodies()) == 5
    c.close(1)
    assert c not in _clients
    # the interval timer sends without flush()
    t = Clikgate(
        KEY,
        http_client=httpx.Client(transport=httpx.MockTransport(recorder)),
        private_mode=False,
        flush_interval=0.05,
        shutdown_hooks=False,
    )
    before = len(recorder.requests)
    t.goal("order_paid", reference="R-timer")
    import time

    deadline = time.time() + 5
    while len(recorder.requests) == before and time.time() < deadline:
        time.sleep(0.01)
    assert len(recorder.requests) == before + 1
    t.close(1)


def test_thread_safety(recorder: Recorder) -> None:
    import threading

    recorder.handler = lambda _r: httpx.Response(200, json={"object": "list", "data": []})
    c = client(recorder, private_mode=False, batch_size=50)

    def worker(n: int) -> None:
        for i in range(100):
            c.goal("order_paid", reference=f"T{n}-{i}")

    threads = [threading.Thread(target=worker, args=(n,)) for n in range(8)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    assert c.flush(10)
    refs = [e["reference"] for b in recorder.bodies() for e in b["events"]]
    assert len(refs) == 800
    assert len(set(refs)) == 800
    c.close(1)


def test_api_layer_uses_the_same_pipeline(recorder: Recorder) -> None:
    recorder.handler = lambda _r: httpx.Response(200, json={"object": "link", "id": "lnk_1"})
    c = client(recorder)
    link = c.api.links.fetch_link("lnk_a/b")
    assert link["id"] == "lnk_1"
    (req,) = recorder.requests
    assert req.url.raw_path == b"/v1/links/lnk_a%2Fb"
    assert req.headers["authorization"] == f"Bearer {KEY}"
    assert "idempotency-key" not in req.headers
    c.close(1)


def test_proxy_option_is_passed_to_httpx() -> None:
    c = Clikgate(KEY, proxy="http://user:pass@proxy.example:3128", shutdown_hooks=False)
    assert c._http._mounts  # httpx mounted the proxy transport
    c.close(0.1)
    c2 = Clikgate(KEY, proxy=False, shutdown_hooks=False)
    assert c2._http.trust_env is False
    c2.close(0.1)


def test_metadata_filter_and_end_goal_value(recorder: Recorder) -> None:
    """Change 10: analytics and link lists take ``metadata={...}``, sent as ``metadata[<key>]=<value>``."""
    page = {
        "object": "list",
        "data": [{"group": "sel_ada", "end_goal_value": {"NGN": "18500.00"}, "end_goal_value_minor": {"NGN": 1850000}}],
        "has_more": False,
        "next_cursor": None,
    }
    recorder.handler = lambda _r: httpx.Response(200, json=page)
    c = client(recorder)
    res = c.api.analytics.analytics_summary(group_by="metadata.product_id", metadata={"seller_id": "sel_ada"})
    assert recorder.requests[0].url.raw_path == b"/v1/analytics/summary?group_by=metadata.product_id&metadata%5Bseller_id%5D=sel_ada"
    # end_goal_value is decimal strings per currency, next to end_goal_value_minor (X.E10).
    assert res["data"][0]["end_goal_value"] == {"NGN": "18500.00"}
    c.links.list_page(metadata={"seller_id": "sel ada"}, limit=5)
    assert recorder.requests[1].url.raw_path == b"/v1/links?metadata%5Bseller_id%5D=sel%20ada&limit=5"
    c.close(1)
