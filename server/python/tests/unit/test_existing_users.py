"""Identity token version 2, the canonical customer ID, customer_since on identify_user, known customers."""

from __future__ import annotations

import asyncio
import json
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

import httpx
import pytest

from clikgate import (
    AsyncClikgate,
    Clikgate,
    ConflictError,
    InvalidRequestError,
    PrivateModeFieldRejectedError,
    canonical_customer_id,
    create_identity_token,
    customer_id_warning,
)

from .conftest import KEY, Recorder

VECTORS_DIR = Path(__file__).resolve().parents[3] / "conformance" / "vectors"
TOKENS: Dict[str, Any] = json.loads((VECTORS_DIR / "identity-token-vectors.json").read_text(encoding="utf-8"))
IDS: Dict[str, Any] = json.loads((VECTORS_DIR / "customer-id-vectors.json").read_text(encoding="utf-8"))


def _client(rec: Recorder, **kw: Any) -> Clikgate:
    kw.setdefault("private_mode", False)
    return Clikgate(KEY, http_client=httpx.Client(transport=httpx.MockTransport(rec)), shutdown_hooks=False, **kw)


@pytest.mark.parametrize("v", TOKENS["v2"], ids=lambda v: v["name"])
def test_version_2_tokens_match_the_vectors(v: Dict[str, Any]) -> None:
    assert (
        create_identity_token(v["customer_id"], secret=v["secret"], issued_at=v["issued_at"], customer_since=v["customer_since"])
        == v["token"]
    )


def test_customer_since_as_datetime_and_date() -> None:
    v = next(x for x in TOKENS["v2"] if x["name"] == "v2_ascii")
    moment = datetime.fromtimestamp(v["customer_since"], tz=timezone.utc)
    assert create_identity_token("user_42", secret=v["secret"], issued_at=v["issued_at"], customer_since=moment) == v["token"]
    day = create_identity_token("user_42", secret=v["secret"], issued_at=v["issued_at"], customer_since=date(2024, 3, 2))
    assert day.endswith(".1709337600")


@pytest.mark.parametrize("bad", TOKENS["v2_invalid_customer_since"], ids=lambda v: v["name"])
def test_account_dates_out_of_range_are_refused(bad: Dict[str, Any]) -> None:
    with pytest.raises(InvalidRequestError) as e:
        create_identity_token("user_42", secret="cgis_unit", issued_at=bad["issued_at"], customer_since=bad["customer_since"])
    assert e.value.param == "customer_since"


def test_forgeries_differ_from_the_real_token() -> None:
    for f in TOKENS["forgeries"]:
        assert f["forged_token"] != f["real_token"]


@pytest.mark.parametrize("v", IDS["vectors"], ids=lambda v: v["name"])
def test_canonical_customer_ids_and_warnings(v: Dict[str, Any]) -> None:
    assert canonical_customer_id(v["input"]) == v["canonical"]
    assert customer_id_warning(v["input"], allow_11_digit_ids=v["allow_11_digit_ids"]) == v["warning"]


def _ok(_r: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"object": "person_identified", "person_id": "per_1", "label_ignored": None})


def test_identify_user_sends_customer_since() -> None:
    rec = Recorder(_ok)
    c = _client(rec)
    c.identify_user(customer_id="u_1", customer_since="2024-03-02")
    c.identify_user(customer_id="u_1", customer_since=1709370000, customer_since_replace=True)
    c.identify_user(customer_id="u_1", customer_since=datetime(2024, 3, 2, 9, 0, tzinfo=timezone.utc))
    c.identify_user(customer_id="u_1", customer_since=date(2024, 3, 2))
    assert rec.bodies() == [
        {"customer_id": "u_1", "customer_since": "2024-03-02"},
        {"customer_id": "u_1", "customer_since": "2024-03-02T09:00:00Z", "customer_since_replace": True},
        {"customer_id": "u_1", "customer_since": "2024-03-02T09:00:00Z"},
        {"customer_id": "u_1", "customer_since": "2024-03-02"},
    ]
    with pytest.raises(InvalidRequestError) as e:
        c.identify_user(app_id="app_1", installation_id="i", customer_since="2024-03-02")
    assert e.value.param == "customer_since"
    with pytest.raises(InvalidRequestError):
        c.identify_user(customer_id="u_1", customer_since="March 2024")
    assert len(rec.requests) == 4


def test_private_mode_refuses_customer_since_and_known_customers() -> None:
    rec = Recorder(_ok)
    c = _client(rec, private_mode=True)
    with pytest.raises(PrivateModeFieldRejectedError):
        c.identify_user(app_id="app_1", installation_id="i", customer_id="u_1", customer_since="2024-03-02")
    with pytest.raises(ConflictError) as e:
        c.known_customers.import_customers([{"customer_id": "u_1"}])
    assert e.value.code == "private_mode_conflict"
    assert e.value.http_status is None
    with pytest.raises(ConflictError):
        c.known_customers.remove("u_1")
    assert rec.requests == []


def _import_answers() -> Recorder:
    answers: List[Dict[str, Any]] = [
        {"accepted": 9_990, "refused": 10, "refused_by_reason": {"looks_like_phone": 10}},
        {"accepted": 9_998, "refused": 2, "refused_by_reason": {"looks_like_phone": 1, "bad_date": 1}},
        {"accepted": 5, "refused": 0, "refused_by_reason": {}},
    ]
    return Recorder(lambda _r: httpx.Response(200, json=answers.pop(0)))


def _rows() -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = [{"customer_id": f"u_{i}"} for i in range(20_005)]
    rows[0]["customer_since"] = datetime(2024, 3, 2, 23, 30, tzinfo=timezone.utc)
    rows[1]["customer_since"] = 1709337600
    rows[2]["customer_since"] = None
    return rows


def _check_import(rec: Recorder, result: Dict[str, Any]) -> None:
    assert result == {"accepted": 19_993, "refused": 12, "refused_by_reason": {"looks_like_phone": 11, "bad_date": 1}}
    assert len(rec.requests) == 3
    first = rec.bodies()[0]["customers"]
    assert len(first) == 10_000
    assert first[:3] == [
        {"customer_id": "u_0", "customer_since": "2024-03-02"},
        {"customer_id": "u_1", "customer_since": "2024-03-02"},
        {"customer_id": "u_2"},
    ]
    assert len(rec.bodies()[2]["customers"]) == 5
    assert [r.headers["idempotency-key"] for r in rec.requests] == ["imp-1-0", "imp-1-1", "imp-1-2"]
    assert all(r.url.path == "/v1/known-customers/import" and r.method == "POST" for r in rec.requests)


def test_import_batches_by_10000_and_sums_counts() -> None:
    rec = _import_answers()
    c = _client(rec)
    _check_import(rec, dict(c.known_customers.import_customers(_rows(), request_options={"idempotency_key": "imp-1"})))
    assert c.known_customers.import_customers([]) == {"accepted": 0, "refused": 0, "refused_by_reason": {}}
    with pytest.raises(InvalidRequestError) as e:
        c.known_customers.import_customers([{"customer_id": "u", "customer_since": "02/03/2024"}])
    assert e.value.param == "customer_since"


def test_async_import_and_remove() -> None:
    rec = _import_answers()

    async def run() -> Dict[str, Any]:
        async with AsyncClikgate(
            KEY, http_client=httpx.AsyncClient(transport=httpx.MockTransport(rec)), shutdown_hooks=False, private_mode=False
        ) as c:
            return dict(await c.known_customers.import_customers(_rows(), request_options={"idempotency_key": "imp-1"}))

    _check_import(rec, asyncio.run(run()))


def test_remove_sends_the_id_in_the_body() -> None:
    rec = Recorder(lambda _r: httpx.Response(200, json={"removed": True}))
    c = _client(rec)
    assert c.known_customers.remove("u_10482") == {"removed": True}
    assert rec.requests[0].url.path == "/v1/known-customers/remove"
    assert "u_10482" not in str(rec.requests[0].url)
    assert rec.bodies() == [{"customer_id": "u_10482"}]
