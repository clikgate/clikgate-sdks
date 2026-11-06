from __future__ import annotations

from typing import Any, Optional

import pytest

from clikgate import click_ids

CID = "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6"
CID2 = "clk_01JCK8Z9V7Q4M2N6P8R0S2T4WU"


def test_from_request_shapes() -> None:
    assert click_ids.from_request({"url": f"/x?cgid={CID}", "headers": {}}) == CID
    assert click_ids.from_request({"QUERY_STRING": "", "HTTP_COOKIE": f"a=1; _cg_cgid={CID}"}) == CID
    scope = {"type": "http", "query_string": b"", "headers": [(b"clikgate-click-id", f" {CID} ".encode())]}
    assert click_ids.from_request(scope) == CID
    assert click_ids.from_request(None) is None


def test_flask() -> None:
    flask = pytest.importorskip("flask")
    from clikgate.flask import Clikgate as FlaskClikgate

    app = flask.Flask(__name__)
    app.config["CLIKGATE_API_KEY"] = "cg_test_flask000"
    app.config["CLIKGATE_OPTIONS"] = {"shutdown_hooks": False, "private_mode": False}
    ext = FlaskClikgate(app)

    @app.get("/")
    def home() -> str:
        return str(flask.g.clikgate_click_id)

    with app.test_client() as tc:
        tc.set_cookie("session", "abc")
        r = tc.get(f"/?cgid={CID}", headers={"X-Forwarded-Proto": "https"})
        assert r.text == CID
        cookies = r.headers.getlist("Set-Cookie")
        assert any(c.startswith(f"_cg_cgid={CID}; Path=/; Max-Age=2592000; SameSite=Lax; Secure") for c in cookies)
    with app.test_client(use_cookies=False) as tc2:
        r2 = tc2.get("/", headers={"Cookie": f"_cg_cgid={CID2}"})
        assert r2.text == CID2
        assert r2.headers.getlist("Set-Cookie") == []  # only query-string IDs are persisted
    ext.client.close(0.1)


def test_starlette_and_fastapi() -> None:
    pytest.importorskip("starlette")
    fastapi = pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient

    from clikgate.fastapi import ClikgateMiddleware, click_id

    app = fastapi.FastAPI()
    app.add_middleware(ClikgateMiddleware)

    @app.get("/")
    async def home(cid: Optional[str] = fastapi.Depends(click_id)) -> Any:
        return {"cid": cid}

    tc = TestClient(app, base_url="https://testserver")
    r = tc.get(f"/?cgid={CID}")
    assert r.json() == {"cid": CID}
    assert r.headers.get_list("set-cookie") == [
        f"_cg_cgid={CID}; Path=/; Max-Age=2592000; SameSite=Lax; Secure",
        "_cg_kept=s; Path=/; Max-Age=2592000; SameSite=Lax; Secure",  # the marker (change 16)
    ]
    tc.cookies.clear()
    r = tc.get("/", headers={"Clikgate-Click-Id": CID2})
    assert r.json() == {"cid": CID2}
    assert "set-cookie" not in r.headers


def test_django() -> None:
    pytest.importorskip("django")
    from django.conf import settings

    if not settings.configured:
        settings.configure(
            DEBUG=True,
            ALLOWED_HOSTS=["*"],
            ROOT_URLCONF=__name__,
            MIDDLEWARE=["clikgate.django.ClikgateMiddleware"],
            CLIKGATE={"api_key": "cg_test_django000", "shutdown_hooks": False, "private_mode": False},
        )
    import django

    django.setup()
    from django.http import HttpResponse
    from django.test import RequestFactory

    from clikgate.django import ClikgateMiddleware, get_client

    def view(request: Any) -> HttpResponse:
        return HttpResponse(str(request.clikgate_click_id))

    mw = ClikgateMiddleware(view)
    rf = RequestFactory()
    res = mw(rf.get("/", {"cgid": CID}, secure=True))
    assert res.content.decode() == CID
    morsel = res.cookies["_cg_cgid"]
    assert morsel.value == CID
    assert morsel["samesite"] == "Lax"
    assert morsel["secure"]
    assert not morsel["httponly"]
    assert morsel["max-age"] == 2592000
    assert res.cookies["_cg_kept"].value == "s"
    assert res.cookies["_cg_kept"]["max-age"] == 2592000
    res = mw(rf.get("/", HTTP_COOKIE=f"_cg_cgid={CID2}"))
    assert res.content.decode() == CID2
    assert "_cg_cgid" not in res.cookies

    import asyncio

    async def aview(request: Any) -> HttpResponse:
        return HttpResponse(str(request.clikgate_click_id))

    amw = ClikgateMiddleware(aview)
    res = asyncio.run(amw(rf.get("/", {"cgid": CID})))
    assert res.content.decode() == CID
    get_client().close(0.1)


def test_persist_response_types() -> None:
    werkzeug = pytest.importorskip("werkzeug.wrappers")
    r = werkzeug.Response("x")
    r.headers.add("Set-Cookie", "session=abc; Path=/")
    click_ids.persist(r, CID, secure=False, days=7)
    assert r.headers.getlist("Set-Cookie") == [
        "session=abc; Path=/",
        f"_cg_cgid={CID}; Path=/; Max-Age=604800; SameSite=Lax",
        "_cg_kept=s; Path=/; Max-Age=604800; SameSite=Lax",
    ]
    responses = pytest.importorskip("starlette.responses")
    s = responses.Response("x")
    s.set_cookie("session", "abc")
    click_ids.persist(s, CID)
    assert [v.decode() for k, v in s.raw_headers if k == b"set-cookie"][-2].startswith(f"_cg_cgid={CID}")
    assert [v.decode() for k, v in s.raw_headers if k == b"set-cookie"][-1].startswith("_cg_kept=s; Path=/")
    assert len([1 for k, _ in s.raw_headers if k == b"set-cookie"]) == 3
