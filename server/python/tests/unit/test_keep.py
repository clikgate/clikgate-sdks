"""The /cg/keep route, the _cg_kept marker and click_ids.context (change 16, SPEC 13.1)."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Tuple

import httpx
import pytest

from clikgate import Clikgate, InvalidRequestError, PrivateModeFieldRejectedError, click_ids

from .conftest import KEY, Recorder

CID = "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6"
OTHER = "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W7"
BODY = json.dumps({"click_id": CID, "page_click_id": CID}).encode()
SAME = {"Host": "shop.example.com", "Sec-Fetch-Site": "same-origin"}
COOKIES = [
    f"_cg_cgid={CID}; Path=/; Max-Age=2592000; SameSite=Lax; Secure",
    "_cg_kept=s; Path=/; Max-Age=2592000; SameSite=Lax; Secure",
]
IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1"
MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"


def cookies(headers: List[Tuple[str, str]]) -> List[str]:
    return [v for k, v in headers if k == "Set-Cookie"]


def test_keep_sets_the_cookie_and_the_marker() -> None:
    res = click_ids.keep_route().handle_keep("POST", SAME, BODY)
    assert res.status == 204
    assert res.body == b""
    assert ("Cache-Control", "no-store, private") in res.headers
    assert cookies(res.headers) == COOKIES
    assert all("httponly" not in c.lower() for c in cookies(res.headers))
    assert not any(k.lower() == "location" for k, _ in res.headers)


def test_keep_options_apply_to_both_cookies() -> None:
    res = click_ids.keep_route(days=400, secure=False, domain=".example.com").handle_keep("POST", SAME, BODY)
    assert cookies(res.headers) == [
        f"_cg_cgid={CID}; Path=/; Max-Age=34560000; Domain=.example.com; SameSite=Lax",
        "_cg_kept=s; Path=/; Max-Age=34560000; Domain=.example.com; SameSite=Lax",
    ]


@pytest.mark.parametrize("days", [0, 401, -1, float("nan"), True, "30"])
def test_keep_days_out_of_range(days: Any) -> None:
    with pytest.raises(InvalidRequestError) as e:
        click_ids.keep_route(days=days)
    assert e.value.code == "invalid_argument"
    assert e.value.param == "days"


def test_keep_cookie_name_from_configuration() -> None:
    c = Clikgate(KEY, click_id_param="ref", shutdown_hooks=False, private_mode=False)
    body = json.dumps({"click_id": CID, "page_click_id": CID, "name": "session", "param": "evil"})
    res = c.click_ids.keep_route().handle_keep("POST", SAME, body)
    assert cookies(res.headers)[0].startswith(f"_cg_ref={CID};")
    c.close(0.1)


@pytest.mark.parametrize(
    ("headers", "status"),
    [
        ({"host": "shop.example.com", "sec-fetch-site": "same-origin"}, 204),
        ({"host": "shop.example.com", "SEC-FETCH-SITE": "Same-Origin"}, 204),
        ({"host": "shop.example.com", "sec-fetch-site": "cross-site", "origin": "https://shop.example.com"}, 403),
        ({"host": "shop.example.com", "sec-fetch-site": "same-site"}, 403),
        ({"host": "shop.example.com", "origin": "https://shop.example.com"}, 204),
        ({"host": "Shop.Example.com", "origin": "https://shop.example.COM"}, 204),
        ({"host": "shop.example.com:8080", "origin": "http://shop.example.com:8080"}, 204),
        ({"host": "shop.example.com", "origin": "https://shop.example.com:8443"}, 403),
        ({"host": "shop.example.com", "origin": "https://evil.example.net"}, 403),
        ({"host": "shop.example.com", "origin": "ftp://shop.example.com"}, 403),
        ({"host": "shop.example.com", "origin": "null"}, 403),
        ({"host": "shop.example.com"}, 403),
        ({"host": "app:8000", "x-forwarded-host": "shop.example.com, proxy.internal", "origin": "https://shop.example.com"}, 204),
        ({"host": "shop.example.com", "x-forwarded-host": "proxy.internal", "origin": "https://shop.example.com"}, 403),
    ],
)
def test_keep_same_origin(headers: Dict[str, str], status: int) -> None:
    res = click_ids.keep_route().handle_keep("POST", headers, BODY)
    assert res.status == status
    assert ("Cache-Control", "no-store, private") in res.headers
    if status != 204:
        assert cookies(res.headers) == []


@pytest.mark.parametrize("method", ["GET", "PUT", "DELETE", "OPTIONS", "HEAD"])
def test_keep_post_only(method: str) -> None:
    res = click_ids.keep_route().handle_keep(method, SAME, BODY)
    assert res.status == 405
    assert ("Allow", "POST") in res.headers
    assert ("Cache-Control", "no-store, private") in res.headers
    assert cookies(res.headers) == []


@pytest.mark.parametrize(
    "body",
    [
        b"",
        None,
        b"not json",
        b"[]",
        b"null",
        json.dumps(CID).encode(),
        json.dumps({"click_id": CID}).encode(),
        json.dumps({"click_id": CID, "page_click_id": OTHER}).encode(),
        json.dumps({"click_id": "<script>alert(1)</script>", "page_click_id": "<script>alert(1)</script>"}).encode(),
        json.dumps({"click_id": CID.lower(), "page_click_id": CID.lower()}).encode(),
        json.dumps({"click_id": 42, "page_click_id": 42}).encode(),
        json.dumps({"click_id": CID, "page_click_id": CID, "pad": "x" * 1024}).encode(),
        b"\xff\xfe{}",
    ],
)
def test_keep_bad_bodies(body: Any) -> None:
    res = click_ids.keep_route().handle_keep("POST", SAME, body)
    assert res.status == 400
    assert res.body == b""
    assert cookies(res.headers) == []
    assert not any(k.lower() == "location" for k, _ in res.headers)


def test_keep_exactly_1024_bytes() -> None:
    base = json.dumps({"click_id": CID, "page_click_id": CID, "p": ""})
    body = json.dumps({"click_id": CID, "page_click_id": CID, "p": "x" * (1024 - len(base))}).encode()
    assert len(body) == 1024
    assert click_ids.keep_route().handle_keep("POST", SAME, body).status == 204


def test_keep_never_logs(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    route = click_ids.keep_route()
    route.handle_keep("POST", SAME, BODY)
    route.handle_keep("POST", SAME, b'{"click_id":"<b>x</b>"}')
    assert caplog.records == []


def test_keep_flask() -> None:
    flask = pytest.importorskip("flask")
    from clikgate.flask import keep_view

    app = flask.Flask(__name__)
    app.add_url_rule("/cg/keep", "clikgate_keep", keep_view(days=90), methods=["GET", "POST"])
    app.add_url_rule("/cg/keep2", "clikgate_keep2", click_ids.keep_route().flask_view, methods=["POST"])
    with app.test_client() as tc:
        r = tc.post("/cg/keep", data=BODY, headers={"Sec-Fetch-Site": "same-origin", "Content-Type": "application/json"})
        assert r.status_code == 204
        assert r.data == b""
        assert r.headers["Cache-Control"] == "no-store, private"
        assert r.headers.getlist("Set-Cookie") == [c.replace("2592000", "7776000") for c in COOKIES]
        big = json.dumps({"click_id": CID, "page_click_id": CID, "pad": "x" * 5000}).encode()
        assert tc.post("/cg/keep", data=big, headers={"Sec-Fetch-Site": "same-origin"}).status_code == 400
        r = tc.get("/cg/keep", headers={"Sec-Fetch-Site": "same-origin"})
        assert r.status_code == 405
        assert r.headers["Allow"] == "POST"
        r = tc.post("/cg/keep2", data=BODY, headers={"Origin": "https://evil.example.net"})
        assert r.status_code == 403
        assert r.headers.getlist("Set-Cookie") == []
        assert "Location" not in r.headers
        # the test client's Host is "localhost"
        assert tc.post("/cg/keep2", data=BODY, headers={"Origin": "http://localhost"}).status_code == 204


def test_keep_starlette_and_fastapi() -> None:
    pytest.importorskip("starlette")
    fastapi = pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient
    from starlette.applications import Starlette
    from starlette.routing import Route

    from clikgate.fastapi import keep_endpoint

    api = fastapi.FastAPI()
    api.add_api_route("/cg/keep", keep_endpoint(days=90), methods=["POST", "GET"])
    star = Starlette(routes=[Route("/cg/keep", click_ids.keep_route().starlette_endpoint, methods=["POST"])])
    for app, max_age in ((api, "7776000"), (star, "2592000")):
        tc = TestClient(app, base_url="https://shop.example.com")
        r = tc.post("/cg/keep", content=BODY, headers={"Sec-Fetch-Site": "same-origin"})
        assert r.status_code == 204
        assert r.content == b""
        assert r.headers["cache-control"] == "no-store, private"
        assert r.headers.get_list("set-cookie") == [c.replace("2592000", max_age) for c in COOKIES]
        r = tc.post("/cg/keep", content=BODY, headers={"Origin": "https://shop.example.com"})
        assert r.status_code == 204
        r = tc.post("/cg/keep", content=BODY, headers={"Origin": "https://evil.example.net"})
        assert r.status_code == 403
        big = json.dumps({"click_id": CID, "page_click_id": CID, "pad": "x" * 5000}).encode()
        assert tc.post("/cg/keep", content=big, headers={"Sec-Fetch-Site": "same-origin"}).status_code == 400
    r = TestClient(api).get("/cg/keep", headers={"Sec-Fetch-Site": "same-origin"})
    assert r.status_code == 405
    assert r.headers["allow"] == "POST"


def test_keep_django() -> None:
    pytest.importorskip("django")
    from django.conf import settings

    if not settings.configured:
        settings.configure(
            DEBUG=True,
            ALLOWED_HOSTS=["*"],
            CLIKGATE={"api_key": "cg_test_django000", "shutdown_hooks": False, "private_mode": False},
        )
    import django

    django.setup()
    from django.test import RequestFactory

    from clikgate.django import keep_view

    view = keep_view(days=90)
    assert getattr(view, "csrf_exempt", False) is True
    rf = RequestFactory()
    res = view(rf.post("/cg/keep", data=BODY, content_type="application/json", HTTP_SEC_FETCH_SITE="same-origin"))
    assert res.status_code == 204
    assert res.content == b""
    assert res["Cache-Control"] == "no-store, private"
    morsel = res.cookies["_cg_cgid"]
    assert morsel.value == CID
    assert morsel["max-age"] == 7776000
    assert morsel["samesite"] == "Lax"
    assert morsel["secure"]
    assert not morsel["httponly"]
    assert res.cookies["_cg_kept"].value == "s"
    assert res.cookies["_cg_kept"]["max-age"] == 7776000
    res = view(rf.post("/cg/keep", data=BODY, content_type="application/json", HTTP_ORIGIN="https://evil.example.net"))
    assert res.status_code == 403
    assert not res.cookies
    res = view(rf.post("/cg/keep", data=BODY, content_type="application/json", HTTP_ORIGIN="http://testserver", HTTP_HOST="testserver"))
    assert res.status_code == 204
    res = view(rf.get("/cg/keep", HTTP_SEC_FETCH_SITE="same-origin"))
    assert res.status_code == 405
    assert res["Allow"] == "POST"
    big = json.dumps({"click_id": CID, "page_click_id": CID, "pad": "x" * 5000})
    assert view(rf.post("/cg/keep", data=big, content_type="application/json", HTTP_SEC_FETCH_SITE="same-origin")).status_code == 400
    assert (
        click_ids.keep_route()
        .django_view(rf.post("/", data=BODY, content_type="application/json", HTTP_SEC_FETCH_SITE="same-origin"))
        .status_code
        == 204
    )


def test_context() -> None:
    req = {"url": "/checkout", "headers": {"cookie": f"_cg_cgid={CID}; _cg_kept=s", "user-agent": IPHONE_CHROME}}
    assert click_ids.context(req) == {"click_id": CID, "kept_by": "server_cookie", "browser_engine": "webkit_ios", "platform": "ios"}
    assert click_ids.context({"url": "/", "headers": {"Cookie": f"_cg_cgid={CID}", "User-Agent": MAC_SAFARI}})["kept_by"] == "script_cookie"
    assert click_ids.context({"url": "/", "headers": {"Cookie": f"_cg_cgid={CID}; _cg_kept=x"}})["kept_by"] == "script_cookie"
    assert click_ids.context({"url": "/", "headers": {"Clikgate-Click-Id": CID}})["kept_by"] == "form"
    assert click_ids.context({"url": f"/?cgid={CID}", "headers": {"cookie": f"_cg_cgid={OTHER}; _cg_kept=s"}})["kept_by"] is None
    assert click_ids.context({"url": "/", "headers": {}}) == {
        "click_id": None,
        "kept_by": None,
        "browser_engine": "other",
        "platform": "other",
    }
    assert click_ids.context(None)["click_id"] is None
    # a WSGI environ works too
    environ = {"REQUEST_METHOD": "GET", "QUERY_STRING": "", "HTTP_COOKIE": f"_cg_cgid={CID}; _cg_kept=s", "HTTP_USER_AGENT": MAC_SAFARI}
    assert click_ids.context(environ) == {"click_id": CID, "kept_by": "server_cookie", "browser_engine": "safari_mac", "platform": "macos"}


def test_goal_context_fields(recorder: Recorder) -> None:
    c = Clikgate(KEY, http_client=httpx.Client(transport=httpx.MockTransport(recorder)), shutdown_hooks=False, private_mode=True)
    ctx = click_ids.context({"url": "/", "headers": {"cookie": f"_cg_cgid={CID}; _cg_kept=s", "user-agent": IPHONE_CHROME}})
    c.goals.send("account_opened", reference="APP-1", **ctx)
    assert recorder.bodies()[0] == {
        "goal": "account_opened",
        "reference": "APP-1",
        "click_id": CID,
        "kept_by": "server_cookie",
        "browser_engine": "webkit_ios",
        "platform": "ios",
    }
    bads: List[Dict[str, Any]] = [{"kept_by": "cookie"}, {"browser_engine": "blink"}, {"platform": "ipados"}]
    for bad in bads:
        with pytest.raises(InvalidRequestError) as e:
            c.goals.send("account_opened", reference="APP-2", **bad)
        assert not isinstance(e.value, PrivateModeFieldRejectedError)
        assert e.value.code == "invalid_argument"
        assert e.value.http_status is None
    c.goals.send_batch([{"goal": "order_paid", "reference": "R-1", "platform": "android"}])
    assert recorder.bodies()[1] == {"events": [{"goal": "order_paid", "reference": "R-1", "platform": "android"}]}
    assert len(recorder.requests) == 2
    c.close(0.1)
