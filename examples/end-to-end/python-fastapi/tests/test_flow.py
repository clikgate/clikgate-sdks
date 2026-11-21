"""The whole flow, from sign-up to a paid referral reward, against a fake Clikgate API."""

import hashlib
import hmac
import json
import time
from datetime import datetime
from typing import Dict, Iterator, Optional

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.fake_clikgate import FakeClikgate, referral_event

WEBHOOK_SECRET = "whsec_test_sample_only"
INSTALLATION = "app_01JAB3C4D5E6F7G8H9JKMNPQRS:6a1f0c2e-4b7d-4c1a-9e2f-0d3b5a7c9e11"


@pytest.fixture
def clikgate_api() -> Iterator[FakeClikgate]:
    fake = FakeClikgate()
    yield fake
    fake.stop()


def test_full_flow(clikgate_api: FakeClikgate) -> None:
    settings = Settings(
        api_key="cg_test_sample_only",
        base_url=clikgate_api.url,
        identity_secret="test-identity-secret-sample-only",
        webhook_secret=WEBHOOK_SECRET,
        referral_program_id="rpg_test_sample",
    )
    with TestClient(create_app(settings), headers={"Clikgate-Installation": INSTALLATION}) as client:
        # 1. Sign-up: the token carries the account date, and Path B identifies the installation from the header.
        sign_up = client.post("/auth/sign-up", json={"email": "ada@example.com", "password": "correct horse"})
        assert sign_up.status_code == 201
        session = sign_up.json()
        user_id = session["user"]["id"]
        created_at = int(datetime.fromisoformat(session["user"]["createdAt"]).timestamp())
        assert_token_has_account_date(session["clikgateIdentityToken"], created_at)

        identify = clikgate_api.requests_to("/v1/people/identify")[0].body
        assert identify["installation_id"] == "6a1f0c2e-4b7d-4c1a-9e2f-0d3b5a7c9e11"
        assert identify["app_id"] == "app_01JAB3C4D5E6F7G8H9JKMNPQRS"
        assert identify["customer_id"] == user_id
        assert identify["customer_since"]

        # 2. Sign-in: wrong password refused, right password gets a fresh token.
        assert client.post("/auth/sign-in", json={"email": "ada@example.com", "password": "nope"}).status_code == 401
        sign_in = client.post("/auth/sign-in", json={"email": "ada@example.com", "password": "correct horse"})
        assert_token_has_account_date(sign_in.json()["clikgateIdentityToken"], created_at)

        # 3. /me needs the session, and returns a token too.
        auth = {"Authorization": f"Bearer {session['accessToken']}"}
        assert client.get("/me").status_code == 401
        assert_token_has_account_date(client.get("/me", headers=auth).json()["clikgateIdentityToken"], created_at)

        # 4. Payment: confirmed from the (stubbed) gateway's answer, in normal units.
        assert client.post("/payments/paystack/confirm", json={"reference": "T123456"}, headers=auth).status_code == 200
        confirmation = clikgate_api.requests_to("/v1/payments/confirmations")[0].body
        assert (confirmation["provider"], confirmation["reference"], confirmation["amount"]) == ("paystack", "T123456", "7500")
        assert (confirmation["currency"], confirmation["goal"]) == ("NGN", "order_paid")

        # 5. Referral code: the same code on every call.
        first = client.get("/me/referral", headers=auth).json()
        second = client.get("/me/referral", headers=auth).json()
        assert first["code"] and first["code"] == second["code"]
        assert first["link"].startswith("https://")
        assert len(clikgate_api.requests_to("/v1/referral-programs/rpg_test_sample/referrers")) == 2
        assert clikgate_api.requests_to("/v1/referral-programs/rpg_test_sample/referrers")[0].body["customer_user_id"] == user_id

        # 6. Webhooks: verified, deduplicated, and the reward is paid once.
        rewards = client.app.state.services.rewards
        assert send_webhook(client, "evt_1", "referral.qualified", "ref_1", user_id) == 200
        assert send_webhook(client, "evt_1", "referral.qualified", "ref_1", user_id) == 200  # redelivery
        assert send_webhook(client, "evt_2", "referral.qualified", "ref_1", user_id) == 200  # same referral
        assert rewards.paid_count() == 1
        assert rewards.find("ref_1").referrer_user_id == user_id
        assert rewards.find("ref_1").referee_user_id == "user_friend"

        assert send_webhook(client, "evt_3", "referral.disqualified", "ref_2", user_id) == 200
        assert rewards.find("ref_2").status == "disqualified"
        assert send_webhook(client, "evt_4", "referral.qualified", "ref_3", user_id, secret="whsec_wrong") == 400
        assert rewards.find("ref_3") is None
        assert rewards.paid_count() == 1

    # 7. Leaving the block shuts the app down, which sends the queued server goal from sign-up.
    goals = [r for r in clikgate_api.requests if r.path.startswith("/v1/goals/events")]
    assert any("account_opened" in json.dumps(r.body) and user_id in json.dumps(r.body) for r in goals)
    # Every call to the API used the server key.
    assert all(r.authorization == "Bearer cg_test_sample_only" for r in clikgate_api.requests)


def assert_token_has_account_date(token: str, created_at_seconds: int) -> None:
    """A version 2 token ends with the account date in Unix seconds: <signature>.<issued at>.<customer since>"""
    parts = token.split(".")
    assert len(parts) == 3
    assert parts[2] == str(created_at_seconds)


def send_webhook(client: TestClient, event_id: str, event_type: str, referral_id: str, referrer_user_id: str,
                 secret: str = WEBHOOK_SECRET) -> int:
    body = json.dumps(referral_event(event_id, event_type, referral_id, "rpg_test_sample", referrer_user_id)).encode()
    t = int(time.time())
    signature = hmac.new(secret.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    headers: Dict[str, Optional[str]] = {"Content-Type": "application/json", "Clikgate-Signature": f"t={t},v1={signature}"}
    return client.post("/webhooks/clikgate", content=body, headers=headers).status_code
