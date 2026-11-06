from __future__ import annotations

import asyncio
import json
import logging
from decimal import Decimal
from typing import Any, Optional

import httpx
import pytest

from clikgate import (
    AsyncClikgate,
    Clikgate,
    InvalidRequestError,
    PrivateModeFieldRejectedError,
    build_from_flutterwave,
    build_from_monnify,
    build_from_paystack,
    build_from_stripe,
)

from .conftest import KEY, Recorder

CLICK = "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6"
CONFIRMED = {"object": "payment_confirmation", "id": "pcf_1", "duplicate": False}


def client(rec: Recorder, **kw: Any) -> Clikgate:
    return Clikgate(KEY, http_client=httpx.Client(transport=httpx.MockTransport(rec)), shutdown_hooks=False, private_mode=False, **kw)


def ps(amount: Any, currency: str = "NGN") -> Optional[str]:
    body = build_from_paystack({"data": {"reference": "T", "status": "success", "amount": amount, "currency": currency}})
    assert body is not None
    return body.get("amount")


def fw(amount: Any) -> Optional[str]:
    body = build_from_flutterwave({"data": {"tx_ref": "F", "status": "successful", "amount": amount, "currency": "NGN"}})
    assert body is not None
    return body.get("amount")


def test_amounts_are_exact_decimals() -> None:
    assert ps(750000) == "7500"
    assert ps(10050, "GHS") == "100.5"
    assert ps("5000") == "50"
    assert ps(1) == "0.01"
    assert ps(0) == "0"
    assert ps(10**20) == "1000000000000000000"
    assert ps(-100) is None
    assert ps("abc") is None
    assert ps(True) is None
    assert fw(0.1 + 0.2) == "0.30000000000000004"  # the float's own repr, never float arithmetic
    assert fw(1500.25) == "1500.25"
    assert fw(Decimal("10.70")) == "10.7"
    assert fw("1e3") == "1000"
    assert fw(1e21) == "1000000000000000000000"
    assert fw("0.000") == "0"


def test_json_text_is_parsed_with_decimals() -> None:
    body = build_from_flutterwave('{"data": {"tx_ref": "F", "status": "successful", "amount": 0.30000000000000000001, "currency": "NGN"}}')
    assert body is not None
    assert body.get("amount") == "0.30000000000000000001"


def test_stripe_currency_exponents() -> None:
    def st(amount: int, currency: str) -> Optional[str]:
        body = build_from_stripe(
            {"id": "pi_1", "object": "payment_intent", "status": "succeeded", "amount_received": amount, "currency": currency}
        )
        assert body is not None
        return body.get("amount")

    assert st(2000, "usd") == "20"
    assert st(500, "jpy") == "500"
    assert st(50000, "isk") == "500"
    assert st(50000, "ugx") == "500"
    assert st(1999, "eur") == "19.99"


@pytest.mark.parametrize(
    ("paid_on", "expected"),
    [
        ("2026-10-28T11:00:00+01:00", "2026-10-28T10:00:00Z"),
        ("2026-10-28 10:00:00.5", "2026-10-28T10:00:00.500Z"),
        ("2026-10-28T10:00:00.123456Z", "2026-10-28T10:00:00.123Z"),
        ("2026-10-28T12:00-0200", "2026-10-28T14:00:00Z"),
        ("28/10/2026 10:00:00 AM", None),
        ("2026-13-01T00:00:00Z", None),
        (1793016000, "2026-10-26T12:00:00Z"),
        (1793016000123, "2026-10-26T12:00:00.123Z"),
    ],
)
def test_times(paid_on: Any, expected: Optional[str]) -> None:
    body = build_from_monnify({"responseBody": {"paymentReference": "M", "paymentStatus": "PAID", "paidOn": paid_on}})
    assert body is not None
    assert body.get("occurred_at") == expected


def test_helpers_never_read_customer_data() -> None:
    body = build_from_paystack(
        {
            "data": {
                "reference": "T",
                "status": "success",
                "amount": 100,
                "currency": "ngn",
                "customer": {"email": "ada@example.com"},
                "authorization": {"last4": "4081"},
                "metadata": json.dumps({"cg_click_id": CLICK, "email": "x"}),
            }
        }
    )
    assert body == {"provider": "paystack", "reference": "T", "status": "success", "amount": "1", "currency": "NGN", "click_id": CLICK}


def test_aliases() -> None:
    body = build_from_flutterwave({"data": {"tx_ref": "F", "status": "successful", "id": 12, "flw_ref": " 12 "}})
    assert body is not None
    assert body.get("aliases") == ["12"]
    body = build_from_flutterwave({"data": {"tx_ref": "12", "status": "successful", "id": 12}})
    assert body is not None
    assert "aliases" not in body


def test_confirm_local_validation_sends_nothing(recorder: Recorder) -> None:
    c = client(recorder)
    with pytest.raises(InvalidRequestError) as e:
        c.payments.confirm(provider="paystack", reference="T", status="paid")
    assert e.value.code == "invalid_status"
    with pytest.raises(InvalidRequestError) as e:
        c.payments.confirm(provider="paystack", reference="T", status="success", amount="1", amount_minor=100)
    assert e.value.code == "amount_and_amount_minor"
    with pytest.raises(TypeError):
        c.payments.confirm(provider="paystack", reference="T", status="success", amount=1.5)  # type: ignore[arg-type]
    assert recorder.requests == []


def test_private_mode_guard_before_transport() -> None:
    rec = Recorder(lambda _r: httpx.Response(200, json=CONFIRMED))
    c = Clikgate(KEY, http_client=httpx.Client(transport=httpx.MockTransport(rec)), shutdown_hooks=False, private_mode=True)
    with pytest.raises(PrivateModeFieldRejectedError) as e:
        c.payments.confirm(provider="paystack", reference="T", status="success", extra={"email": "ada@example.com"})
    assert e.value.field == "email"
    assert "ada@" not in str(e.value)
    assert rec.requests == []
    c.payments.confirm(
        provider="paystack",
        reference="T",
        status="success",
        amount=Decimal("7500"),
        currency="NGN",
        aliases=["A"],
        click_id=CLICK,
        goal="order_paid",
        test=False,
    )
    assert rec.requests[0].url.path == "/v1/payments/confirmations"
    assert rec.bodies() == [
        {
            "provider": "paystack",
            "reference": "T",
            "status": "success",
            "amount": "7500",
            "currency": "NGN",
            "aliases": ["A"],
            "click_id": CLICK,
            "goal": "order_paid",
            "test": False,
        }
    ]


def test_nothing_to_send_and_warning(recorder: Recorder, caplog: pytest.LogCaptureFixture) -> None:
    c = client(recorder)
    with caplog.at_level(logging.WARNING, logger="clikgate"):
        assert c.payments.from_stripe({"id": "cs_1", "object": "checkout.session", "payment_status": "no_payment_required"}) is None
        assert c.payments.from_paystack({"status": False}) is None
    codes = [getattr(r, "clikgate_code", None) for r in caplog.records]
    assert codes == ["unrecognised_payment_response"]
    assert recorder.requests == []


def test_async_from_paystack() -> None:
    rec = Recorder(lambda _r: httpx.Response(200, json=CONFIRMED))

    async def run() -> Any:
        c = AsyncClikgate(KEY, http_client=httpx.AsyncClient(transport=httpx.MockTransport(rec)), shutdown_hooks=False, private_mode=False)
        try:
            return await c.payments.from_paystack(
                {"data": {"reference": "T", "status": "success", "amount": 750000, "currency": "NGN"}}, goal="order_paid"
            )
        finally:
            await c.close()

    assert asyncio.run(run())["id"] == "pcf_1"
    assert rec.bodies() == [
        {"provider": "paystack", "reference": "T", "status": "success", "amount": "7500", "currency": "NGN", "goal": "order_paid"}
    ]
