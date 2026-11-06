from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List

import httpx
import pytest

from clikgate import AsyncClikgate, Clikgate, ErrorContext, InvalidRequestError, PrivateModeFieldRejectedError, hash_for_ads

from .conftest import KEY, Recorder

# The website's vectors (clikgate_website apps/www/samples/ads-hashing/, SPEC 25)
H_EMAIL = "0f096d5de5ccb3a1e50f34246aab7d9c539de7bd63498d5fae420ecfba31aaed"
H_E164 = "6b39248188406864f30420963a3e793bf8571e2fa733f767889f9fa882b5d14c"
H_DIGITS = "fe144b034b54f22ea55473f479fe83b2ccbc55af8cdb280ef65ef280bcd4bf17"
CLICK = "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6"


def client(rec: Recorder, **kw: Any) -> Clikgate:
    return Clikgate(KEY, http_client=httpx.Client(transport=httpx.MockTransport(rec)), shutdown_hooks=False, **kw)


def test_hash_for_ads_vectors() -> None:
    assert hash_for_ads(email="  Ada.Obi@Example.com ", phone="+234 803 123 4567") == {
        "hashed_email": H_EMAIL,
        "hashed_phone_e164": H_E164,
        "hashed_phone_digits": H_DIGITS,
    }
    assert hash_for_ads(phone="00234 (803) 123-4567") == {"hashed_phone_e164": H_E164, "hashed_phone_digits": H_DIGITS}
    assert hash_for_ads(phone="\t+2348031234567\n") == {"hashed_phone_e164": H_E164, "hashed_phone_digits": H_DIGITS}
    assert hash_for_ads(email="ADA.OBI@EXAMPLE.COM", phone=None) == {"hashed_email": H_EMAIL}
    assert hash_for_ads() == {}


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("phone", "0803 123 4567"),
        ("phone", "2348031234567"),
        ("phone", "+12345"),
        ("phone", "+0803 123 4567"),
        ("phone", "+1234567890123456"),
        ("phone", ""),
        ("email", "ada.obi.example.com"),
        ("email", "   "),
    ],
)
def test_hash_for_ads_refuses_without_echoing(field: str, value: str) -> None:
    with pytest.raises(InvalidRequestError) as exc:
        hash_for_ads(**{field: value})
    assert exc.value.code == "invalid_argument"
    assert exc.value.param == field
    assert exc.value.http_status is None
    if value.strip():
        assert value.strip() not in str(exc.value)


def test_goal_wire_and_local_refusal(recorder: Recorder) -> None:
    c = client(recorder, send_mode="sync", private_mode=False)
    c.goals.send("account_opened", reference="APP-1", click_id=CLICK, **hash_for_ads(email="ada.obi@example.com", phone="+2348031234567"))
    assert recorder.bodies() == [
        {
            "goal": "account_opened",
            "reference": "APP-1",
            "click_id": CLICK,
            "hashed_email": H_EMAIL,
            "hashed_phone_e164": H_E164,
            "hashed_phone_digits": H_DIGITS,
        }
    ]
    for field, value in (("hashed_email", H_EMAIL.upper()), ("hashed_phone_e164", "+2348031234567"), ("hashed_phone_digits", H_DIGITS[1:])):
        option: Dict[str, Any] = {field: value}
        with pytest.raises(InvalidRequestError) as exc:
            c.goals.send("account_opened", reference="APP-2", **option)
        assert exc.value.code == "invalid_hashed_identifier"
        assert exc.value.param == field
        assert value not in str(exc.value)
    with pytest.raises(InvalidRequestError) as batch:
        c.goals.send_batch(
            [
                {"goal": "account_opened", "reference": "APP-1"},
                {"goal": "account_opened", "reference": "APP-2", "hashed_phone_digits": "abc"},
            ]
        )
    assert batch.value.code == "invalid_hashed_identifier"
    assert batch.value.index == 1
    with pytest.raises(InvalidRequestError) as conv:
        c.conversions.create(external_id="ORD-1", hashed_email="ada@example.com")
    assert conv.value.code == "invalid_hashed_identifier"
    assert conv.value.param == "hashed_email"
    assert len(recorder.requests) == 1


def test_goal_never_logs_hashes(recorder: Recorder, caplog: pytest.LogCaptureFixture) -> None:
    seen: List[Any] = []

    def on_error(err: Any, ctx: ErrorContext) -> None:
        seen.append((err, ctx))

    c = client(recorder, send_mode="background", private_mode=False, on_error=on_error)
    with caplog.at_level(logging.DEBUG):
        c.goal("account_opened", reference="APP-1", hashed_email=H_EMAIL, hashed_phone_e164=H_E164.upper())
        c.goal("account_opened", reference="APP-2", hashed_email=H_EMAIL, hashed_phone_digits=H_DIGITS)
        assert c.flush(1.0)
    assert [e.code for e, _ctx in seen] == ["invalid_hashed_identifier"]
    assert recorder.bodies()[0]["events"][0]["hashed_phone_digits"] == H_DIGITS
    shown = caplog.text + repr([(str(e), ctx.events) for e, ctx in seen])
    for h in (H_EMAIL, H_E164, H_E164.upper(), H_DIGITS):
        assert h not in shown


def test_private_mode_guard_allows_hashes_not_customer(recorder: Recorder) -> None:
    c = client(recorder, send_mode="sync", private_mode=True)
    c.goals.send("account_opened", reference="APP-1", hashed_email=H_EMAIL)
    c.conversions.create(external_id="ORD-1", goal="order_paid", hashed_phone_e164=H_E164, hashed_phone_digits=H_DIGITS)
    with pytest.raises(PrivateModeFieldRejectedError):
        c.conversions.create(external_id="ORD-2", customer={"email": "ada@example.com"})
    assert len(recorder.requests) == 2
    assert recorder.bodies()[1]["hashed_phone_digits"] == H_DIGITS


def test_async_goal_and_conversion(recorder: Recorder) -> None:
    async def main() -> None:
        c = AsyncClikgate(KEY, http_client=httpx.AsyncClient(transport=httpx.MockTransport(recorder)), private_mode=True)
        await c.goals.send("account_opened", reference="APP-1", **hash_for_ads(phone="+234 803 123 4567"))
        with pytest.raises(InvalidRequestError) as exc:
            await c.conversions.create(external_id="ORD-1", hashed_email=H_EMAIL.upper())
        assert exc.value.code == "invalid_hashed_identifier"
        assert recorder.bodies() == [
            {"goal": "account_opened", "reference": "APP-1", "hashed_phone_e164": H_E164, "hashed_phone_digits": H_DIGITS}
        ]
        assert await c.close(1)

    asyncio.run(main())
