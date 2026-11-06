from __future__ import annotations

import json
from typing import Any, List

import httpx
import pytest

from clikgate import Clikgate, ErrorContext, GoalKind, GoalStatus, InvalidRequestError, Provider

from .conftest import KEY, Recorder


def client(rec: Recorder, **kw: Any) -> Clikgate:
    return Clikgate(KEY, http_client=httpx.Client(transport=httpx.MockTransport(rec)), shutdown_hooks=False, **kw)


def test_enum_values() -> None:
    assert [k.value for k in GoalKind] == ["standard", "payment"]
    assert [s.value for s in GoalStatus] == ["counted", "waiting", "refused"]
    assert GoalKind("payment") is GoalKind.PAYMENT
    assert isinstance(GoalKind.PAYMENT, str)
    assert str(GoalStatus.WAITING) == "waiting"
    assert Provider.PAYSTACK.value == "paystack"
    assert Provider.MTN_MOMO.value == "mtn_momo"
    assert {"shopify", "woocommerce", "custom"} <= {p.value for p in Provider}
    assert json.dumps({"s": GoalStatus.COUNTED}) == '{"s": "counted"}'


def test_provider_option_enum_and_string(recorder: Recorder) -> None:
    c = client(recorder, send_mode="sync", private_mode=False)
    c.goals.send("order_paid", reference="T1", value="7500", provider=Provider.PAYSTACK)
    c.goals.send("order_paid", reference="T2", value="10", provider="acme_pay")
    assert [b["provider"] for b in recorder.bodies()] == ["paystack", "acme_pay"]


@pytest.mark.parametrize("bad", ["Paystack", "mtn-momo", "", "p", 7])
def test_provider_validation(recorder: Recorder, bad: Any) -> None:
    c = client(recorder, send_mode="sync", private_mode=False)
    with pytest.raises(InvalidRequestError) as exc:
        c.goals.send("order_paid", reference="T1", provider=bad)
    assert exc.value.code == "invalid_provider"
    assert exc.value.param == "provider"
    assert exc.value.http_status is None
    with pytest.raises(InvalidRequestError) as batch:
        c.goals.send_batch([{"goal": "order_paid", "reference": "T0"}, {"goal": "order_paid", "reference": "T1", "provider": bad}])
    assert batch.value.code == "invalid_provider"
    assert batch.value.index == 1
    assert recorder.requests == []


def test_goal_invalid_provider_goes_to_on_error(recorder: Recorder) -> None:
    seen: List[str] = []

    def on_error(err: Any, _ctx: ErrorContext) -> None:
        seen.append(err.code)

    c = client(recorder, send_mode="background", private_mode=False, on_error=on_error)
    c.goal("order_paid", reference="T1", provider="Paystack")
    assert c.flush(1.0)
    assert seen == ["invalid_provider"]
    assert recorder.requests == []


def test_provider_allowed_in_private_mode(recorder: Recorder) -> None:
    c = client(recorder, send_mode="sync", private_mode=True)
    c.goals.send("order_paid", reference="T1", value="7500", provider=Provider.STRIPE)
    assert recorder.bodies()[0]["provider"] == "stripe"


def test_results_coerced_to_enums_and_unknown_kept() -> None:
    def handler(_r: httpx.Request) -> httpx.Response:
        return httpx.Response(
            201, json={"object": "goal_event", "id": "pcf_1", "status": "waiting", "goal_kind": "payment", "counted": False}
        )

    ev = client(Recorder(handler), send_mode="sync", private_mode=False).goals.send("order_paid", reference="T1", value="1")
    assert ev["status"] == "waiting"
    assert ev["status"] is GoalStatus.WAITING
    assert ev["goal_kind"] is GoalKind.PAYMENT

    def future(_r: httpx.Request) -> httpx.Response:
        return httpx.Response(201, json={"object": "goal_event", "status": "deferred", "goal_kind": "subscription", "new": 1})

    ev2 = client(Recorder(future), send_mode="sync", private_mode=False).goals.send("order_paid", reference="T1")
    assert ev2["status"] == "deferred"
    assert type(ev2["status"]) is str
    assert type(ev2["goal_kind"]) is str
    assert ev2["new"] == 1  # type: ignore[typeddict-item]


def test_batch_results_coerced() -> None:
    body = {
        "object": "list",
        "data": [
            {"index": 0, "ok": True, "status": 201, "goal_event": {"status": "counted", "goal_kind": "standard"}},
            {"index": 1, "ok": False, "status": 422, "goal_event": None, "error": {"code": "unknown_provider"}},
        ],
    }
    rec = Recorder(lambda _r: httpx.Response(200, json=body))
    res = client(rec, send_mode="sync", private_mode=False).goals.send_batch(
        [{"goal": "a_goal", "reference": "R0"}, {"goal": "a_goal", "reference": "R1"}]
    )
    first = res["data"][0].get("goal_event") or {}
    assert first.get("status") is GoalStatus.COUNTED
    assert first.get("goal_kind") is GoalKind.STANDARD


def test_payments_confirm_takes_provider_enum(recorder: Recorder) -> None:
    rec = Recorder(lambda _r: httpx.Response(200, json={"object": "payment_confirmation", "id": "pcf_1"}))
    client(rec, private_mode=False).payments.confirm(provider=Provider.FLUTTERWAVE, reference="F1", status="success", amount="10")
    assert rec.bodies()[0]["provider"] == "flutterwave"
    with pytest.raises(InvalidRequestError) as exc:
        client(rec, private_mode=False).payments.confirm(provider="Flutter Wave", reference="F1", status="success")
    assert exc.value.code == "invalid_provider"
