from __future__ import annotations

import asyncio

import httpx
import pytest

from clikgate import AsyncClikgate, Clikgate, ConflictError

from .conftest import KEY, Recorder

REFERRER = {"object": "referrer", "id": "rfr_1", "customer_user_id": "user-42", "code": "ADA2026", "external_code": "ada-old"}
TAKEN = {
    "error": {
        "type": "conflict",
        "code": "code_taken",
        "message": "Another referrer or link in this organisation has this code.",
        "param": "code",
    }
}


def _client(rec: Recorder) -> Clikgate:
    return Clikgate(KEY, http_client=httpx.Client(transport=httpx.MockTransport(rec)), shutdown_hooks=False, max_retries=0)


def test_code_and_external_code_are_sent() -> None:
    rec = Recorder(lambda _r: httpx.Response(201, json=REFERRER))
    referrer = _client(rec).referrals.get_or_create_referrer(
        "rpg_1", customer_id="user-42", display_name="Ada", code="ADA2026", external_code="ada-old"
    )
    assert rec.bodies()[0] == {"customer_user_id": "user-42", "display_name": "Ada", "code": "ADA2026", "external_code": "ada-old"}
    assert referrer["code"] == "ADA2026"
    assert referrer["created"] is True


def test_code_is_omitted_when_not_given() -> None:
    rec = Recorder(lambda _r: httpx.Response(200, json=REFERRER))
    referrer = _client(rec).referrals.get_or_create_referrer("rpg_1", customer_id="user-42")
    assert rec.bodies()[0] == {"customer_user_id": "user-42"}
    assert referrer["created"] is False


def test_code_taken_is_a_conflict_error() -> None:
    rec = Recorder(lambda _r: httpx.Response(409, json=TAKEN))
    with pytest.raises(ConflictError) as info:
        _client(rec).referrals.get_or_create_referrer("rpg_1", customer_id="user-42", code="ADA2026")
    assert info.value.code == "code_taken"
    assert info.value.param == "code"
    assert info.value.http_status == 409
    assert len(rec.requests) == 1


def test_async_sends_code() -> None:
    rec = Recorder(lambda _r: httpx.Response(201, json=REFERRER))

    async def run() -> None:
        c = AsyncClikgate(KEY, http_client=httpx.AsyncClient(transport=httpx.MockTransport(rec)), shutdown_hooks=False, max_retries=0)
        referrer = await c.referrals.get_or_create_referrer("rpg_1", customer_id="user-42", code="ADA2026")
        assert referrer["code"] == "ADA2026"
        rec.handler = lambda _r: httpx.Response(409, json=TAKEN)
        with pytest.raises(ConflictError):
            await c.referrals.get_or_create_referrer("rpg_1", customer_id="user-43", code="ADA2026")
        await c.close(1.0)

    asyncio.run(run())
    assert rec.bodies()[0] == {"customer_user_id": "user-42", "code": "ADA2026"}


def test_update_referrer_sends_external_code() -> None:
    rec = Recorder(lambda _r: httpx.Response(200, json=REFERRER))
    _client(rec).referrals.update_referrer("rfr_1", external_code="ADA-NEW")
    assert rec.bodies()[0] == {"external_code": "ADA-NEW"}
