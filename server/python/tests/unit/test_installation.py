"""The Clikgate-Installation header: the parser, identify_user(installation=...), and the framework add-ons."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

import httpx
import pytest

from clikgate import (
    INSTALLATION_HEADER,
    AsyncClikgate,
    Clikgate,
    ConflictError,
    Installation,
    InvalidRequestError,
    installation_from_request,
    parse_installation_header,
)

from .conftest import KEY, Recorder

APP = "app_01JCK8Z9V7Q4M2N6P8R0S2T4AP"
INST = "6a1f0c2e-0000-4000-8000-000000000001"
HEADER = f"{APP}:{INST}"
PARSED = Installation(APP, INST)


def _ok(_r: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"object": "person_identified", "person_id": "per_1", "label_ignored": None})


def _client(rec: Recorder) -> Clikgate:
    return Clikgate(KEY, http_client=httpx.Client(transport=httpx.MockTransport(rec)), shutdown_hooks=False, private_mode=False)


@pytest.mark.parametrize(
    "bad",
    [
        f"{APP}:{INST.upper()}",
        f"{APP.lower()}:{INST}",
        f"{HEADER}:x",
        f"{APP}::{INST}",
        f"{APP}{INST}",
        f"{APP}:",
        f":{INST}",
        f"cli_01JCK8Z9V7Q4M2N6P8R0S2T4AP:{INST}",
        " " * 70 + HEADER,
        f"{HEADER}\n{HEADER}",
        f"{HEADER}, {HEADER}",
        "",
        "   ",
        "x" * 10_000,
        None,
        42,
        b"bytes",
        [HEADER],
    ],
)
def test_parse_refuses_anything_else(bad: Any) -> None:
    assert parse_installation_header(bad) is None


def test_parse_accepts_the_contract_trimmed() -> None:
    assert parse_installation_header(HEADER) == PARSED
    assert parse_installation_header(f"\t{HEADER}  ") == PARSED
    assert INSTALLATION_HEADER == "Clikgate-Installation"


def test_from_request_shapes() -> None:
    assert installation_from_request({"headers": {"clikgate-installation": HEADER}}) == PARSED
    assert installation_from_request({"headers": {"Clikgate-Installation": [HEADER, HEADER]}}) is None
    assert installation_from_request({"QUERY_STRING": "", "HTTP_CLIKGATE_INSTALLATION": HEADER}) == PARSED
    scope = {"type": "http", "query_string": b"", "headers": [(b"clikgate-installation", HEADER.encode())]}
    assert installation_from_request(scope) == PARSED
    assert installation_from_request({"headers": {}}) is None
    assert installation_from_request(None) is None

    class Boom:
        @property
        def headers(self) -> Any:
            raise RuntimeError("boom")

    assert installation_from_request(Boom()) is None


def test_identify_user_with_the_header_and_without_app_id(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    rec = Recorder(_ok)
    c = _client(rec)
    c.identify_user(installation=f" {HEADER} ", customer_id="user_42")
    c.identify_user(installation_id=INST, customer_id="user_42")
    c.identify_user(installation=HEADER, installation_id="6a1f0c2e-0000-4000-8000-000000000002", customer_id="user_42")
    c.identify_user(installation="secret-header-value", click_id="clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6")
    c.identify_user(app_id=APP, installation_id=INST, customer_id="user_42")
    assert rec.bodies() == [
        {"app_id": APP, "installation_id": INST, "customer_id": "user_42"},
        {"installation_id": INST, "customer_id": "user_42"},
        {"installation_id": "6a1f0c2e-0000-4000-8000-000000000002", "customer_id": "user_42"},
        {"click_id": "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6"},
        {"app_id": APP, "installation_id": INST, "customer_id": "user_42"},
    ]
    with pytest.raises(InvalidRequestError) as e:
        c.identify_user(installation="secret-header-value")
    assert e.value.param == "click_id"
    assert "secret-header-value" not in str(e.value)
    with pytest.raises(InvalidRequestError) as e2:
        c.identify_user(app_id=APP)
    assert e2.value.param == "installation_id"
    assert len(rec.requests) == 5
    assert "secret-header-value" not in caplog.text
    c.close(0.1)


def test_several_apps_is_a_conflict() -> None:
    def several(_r: httpx.Request) -> httpx.Response:
        return httpx.Response(
            409,
            json={
                "error": {
                    "type": "conflict",
                    "code": "installation_in_several_apps",
                    "message": "Send app_id.",
                    "param": "app_id",
                    "request_id": "req_1",
                }
            },
        )

    c = _client(Recorder(several))
    with pytest.raises(ConflictError) as e:
        c.identify_user(installation_id=INST, customer_id="user_42")
    assert (e.value.code, e.value.param, e.value.http_status) == ("installation_in_several_apps", "app_id", 409)
    c.close(0.1)


def test_async_identify_user_with_the_header() -> None:
    rec = Recorder(_ok)

    async def run() -> None:
        c = AsyncClikgate(KEY, http_client=httpx.AsyncClient(transport=httpx.MockTransport(rec)), shutdown_hooks=False, private_mode=False)
        await c.identify_user(installation=HEADER, customer_id="user_42")
        await c.close(0.1)

    asyncio.run(run())
    assert rec.bodies() == [{"app_id": APP, "installation_id": INST, "customer_id": "user_42"}]


def test_flask_sets_g_clikgate_installation() -> None:
    flask = pytest.importorskip("flask")
    from clikgate.flask import Clikgate as FlaskClikgate

    app = flask.Flask(__name__)
    app.config["CLIKGATE_API_KEY"] = "cg_test_flask000"
    app.config["CLIKGATE_OPTIONS"] = {"shutdown_hooks": False, "private_mode": False}
    ext = FlaskClikgate(app)

    @app.get("/me")
    def me() -> Any:
        inst = flask.g.clikgate_installation
        return {"installation": None if inst is None else [inst.app_id, inst.installation_id]}

    with app.test_client() as tc:
        assert tc.get("/me", headers={"Clikgate-Installation": HEADER}).json == {"installation": [APP, INST]}
        bad = tc.get("/me", headers={"Clikgate-Installation": "x" * 500})
        assert bad.status_code == 200
        assert bad.json == {"installation": None}
        assert tc.get("/me").json == {"installation": None}
    ext.client.close(0.1)


def test_fastapi_installation_dependency() -> None:
    pytest.importorskip("starlette")
    fastapi = pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient

    from clikgate.fastapi import ClikgateMiddleware, installation

    for with_middleware in (True, False):
        app = fastapi.FastAPI()
        if with_middleware:
            app.add_middleware(ClikgateMiddleware)

        @app.get("/me")
        async def me(inst: Optional[Installation] = fastapi.Depends(installation)) -> Any:  # noqa: B008
            return {"installation": None if inst is None else [inst.app_id, inst.installation_id]}

        tc = TestClient(app)
        assert tc.get("/me", headers={"Clikgate-Installation": HEADER}).json() == {"installation": [APP, INST]}
        bad = tc.get("/me", headers={"Clikgate-Installation": f"{APP}:{INST.upper()}"})
        assert bad.status_code == 200
        assert bad.json() == {"installation": None}
        assert tc.get("/me").json() == {"installation": None}


def test_django_sets_request_clikgate_installation() -> None:
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

    from clikgate.django import ClikgateMiddleware

    def view(request: Any) -> HttpResponse:
        inst = request.clikgate_installation
        return HttpResponse("none" if inst is None else f"{inst.app_id}|{inst.installation_id}")

    mw = ClikgateMiddleware(view)
    rf = RequestFactory()
    assert mw(rf.get("/me", HTTP_CLIKGATE_INSTALLATION=HEADER)).content.decode() == f"{APP}|{INST}"
    assert mw(rf.get("/me", HTTP_CLIKGATE_INSTALLATION="nope")).content.decode() == "none"
    assert mw(rf.get("/me")).content.decode() == "none"
