from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
from typing import Any

import httpx
import pytest

from clikgate import AsyncClikgate, Clikgate, EventType, WebhookEvent, currency_exponent, minor_to_amount, webhooks

from .conftest import KEY, Recorder

SECRET = "whsec_unit_typed"
NOW = 1_793_016_000


def _verify(type_: str, obj: Any) -> tuple[str, WebhookEvent]:
    body = json.dumps(
        {
            "id": "evt_1",
            "object": "event",
            "type": type_,
            "api_version": "2026-10-01",
            "created_at": "2026-10-26T12:00:00Z",
            "organization_id": "org_1",
            "livemode": False,
            "data": {"object": obj, "previous_attributes": None},
        }
    )
    sig = hmac.new(SECRET.encode(), f"{NOW}.{body}".encode(), hashlib.sha256).hexdigest()
    return body, webhooks.verify(body, f"t={NOW},v1={sig}", SECRET, now=NOW)


def test_minor_to_amount_uses_the_currency_exponent() -> None:
    assert minor_to_amount(50000, "NGN") == "500.00"
    assert minor_to_amount(5, "usd") == "0.05"
    assert minor_to_amount(1500, "JPY") == "1500"
    assert minor_to_amount(12345, "KWD") == "12.345"
    assert minor_to_amount(1, "CLF") == "0.0001"
    assert minor_to_amount(9007199254740993, "NGN") == "90071992547409.93"
    assert minor_to_amount(-250, "NGN") == "-2.50"
    assert currency_exponent("XYZ") == 2
    with pytest.raises(TypeError):
        minor_to_amount(1.5, "NGN")  # type: ignore[arg-type]


def test_webhook_accessors_and_raw_dict() -> None:
    referral = {"object": "referral", "id": "ref_1", "reward_snapshot": {"referrer": {"amount_minor": 50000, "currency": "NGN"}}}
    body, event = _verify(EventType.REFERRAL_QUALIFIED.value, referral)
    typed = event.as_referral()
    assert typed is not None
    snapshot = typed.get("reward_snapshot")
    assert snapshot is not None
    assert snapshot["referrer"]["amount"] == "500.00"
    assert event.as_referrer() is None
    assert event.as_goal_event() is None
    assert isinstance(event, dict)
    assert event["type"] == "referral.qualified" == event.type
    assert event.id == "evt_1"
    assert event.livemode is False
    assert event.api_version == "2026-10-01"
    assert json.loads(body) == event  # the raw event is unchanged
    assert "amount" not in event["data"]["object"]["reward_snapshot"]["referrer"]
    e = event.typed()
    assert e["type"] == "referral.qualified"
    assert e["data"]["object"]["id"] == "ref_1"


def test_webhook_accessors_every_family() -> None:
    goal = _verify("goal.completed", {"object": "goal_event", "id": "cnv_1"})[1].as_goal_event()
    assert goal is not None
    assert goal["id"] == "cnv_1"
    install = _verify("install.organic", {"id": "ins_1"})[1].as_install()
    assert install is not None
    assert install["id"] == "ins_1"
    payment = _verify("payment.refunded", {"id": "prp_1"})[1].as_payment()
    assert payment is not None
    assert payment["id"] == "prp_1"
    conversion = _verify("conversion.reversed", {"id": "cnv_2"})[1].as_conversion()
    assert conversion is not None
    assert conversion["id"] == "cnv_2"
    referrer = _verify("referrer.created", {"id": "rfr_1"})[1].as_referrer()
    assert referrer is not None
    assert referrer["id"] == "rfr_1"
    assert _verify("referral.created", "ref_1")[1].as_referral() is None
    assert _verify("app.reengaged", {"id": "ins_1"})[1].as_install() is None


def test_event_type_values() -> None:
    values = [e.value for e in EventType]
    assert len(values) == 97 == len(set(values))
    assert EventType.LINK_STATS_HOURLY.value == "link.stats.hourly"


def _referrer_handler(request: httpx.Request) -> httpx.Response:
    if request.url.path.endswith("/by-user/user-404"):
        return httpx.Response(404, json={"error": {"type": "not_found", "code": "resource_missing", "message": "No such referrer."}})
    return httpx.Response(201, json={"object": "referrer", "id": "rfr_1", "customer_user_id": "user-42"})


def test_referrals_sync() -> None:
    rec = Recorder(_referrer_handler)
    c = Clikgate(KEY, http_client=httpx.Client(transport=httpx.MockTransport(rec)), shutdown_hooks=False, max_retries=0)
    referrer = c.referrals.get_or_create_referrer("rpg_1", customer_id="user-42", display_name="Ada")
    assert referrer["created"] is True
    assert referrer["customer_user_id"] == "user-42"
    assert rec.bodies()[0] == {"customer_user_id": "user-42", "display_name": "Ada"}
    assert c.referrals.find_referrer("rpg_1", customer_id="user-404") is None
    c.links.create({"destination_url": "https://example.com"}, tags=["promo"])
    assert rec.bodies()[-1] == {"destination_url": "https://example.com", "tags": ["promo"]}


def test_referrals_async() -> None:
    rec = Recorder(_referrer_handler)

    async def run() -> None:
        c = AsyncClikgate(KEY, http_client=httpx.AsyncClient(transport=httpx.MockTransport(rec)), shutdown_hooks=False, max_retries=0)
        referrer = await c.referrals.get_or_create_referrer("rpg_1", customer_id="user-42")
        assert referrer["created"] is True
        assert await c.referrals.find_referrer("rpg_1", customer_id="user-404") is None
        await c.close(1.0)

    asyncio.run(run())


def test_as_device_change() -> None:
    obj = {"object": "device_change", "id": "dvc_1:switch", "kind": "switch", "from": {"platform": "android"}, "to": {"platform": "ios"}}
    change = _verify("person.device_changed", obj)[1].as_device_change()
    assert change is not None
    assert change["from"]["platform"] == "android"
    assert _verify("install.attributed", obj)[1].as_device_change() is None
