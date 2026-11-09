"""create_identity_token (change 22 I.1, R.27) against the shared vectors made by the backend signer."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any, Dict

import pytest

from clikgate import (
    AsyncClikgate,
    Clikgate,
    ClikgateError,
    ClikgateServerOnlyError,
    ConfigurationError,
    InvalidRequestError,
    _identity,
    create_identity_token,
)

from .conftest import KEY

VECTORS: Dict[str, Any] = json.loads(
    (Path(__file__).resolve().parents[3] / "conformance" / "vectors" / "identity-token-vectors.json").read_text(encoding="utf-8")
)
BY_NAME = {v["name"]: v for v in VECTORS["vectors"]}


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CLIKGATE_IDENTITY_SECRET", raising=False)
    monkeypatch.delenv("CLIKGATE_IDENTITY_SECRETS", raising=False)


@pytest.mark.parametrize("vector", VECTORS["vectors"], ids=lambda v: v["name"])
def test_matches_the_shared_vectors(vector: Dict[str, Any]) -> None:
    assert create_identity_token(vector["customer_id"], secret=vector["secret"], issued_at=vector["issued_at"]) == vector["token"]


def test_secret_from_environment_and_per_app_map(monkeypatch: pytest.MonkeyPatch) -> None:
    a, other = BY_NAME["ascii"], BY_NAME["other_app_secret"]
    monkeypatch.setenv("CLIKGATE_IDENTITY_SECRET", a["secret"])
    assert create_identity_token("user_42", issued_at=a["issued_at"]) == a["token"]
    assert create_identity_token("user_42", app_id="app_unknown", issued_at=a["issued_at"]) == a["token"]
    monkeypatch.delenv("CLIKGATE_IDENTITY_SECRET")
    monkeypatch.setenv("CLIKGATE_IDENTITY_SECRETS", json.dumps({"app_shop": a["secret"], "app_rider": other["secret"]}))
    assert create_identity_token("user_42", app_id="app_rider", issued_at=other["issued_at"]) == other["token"]
    assert create_identity_token("user_42", app_id="app_shop", issued_at=a["issued_at"]) == a["token"]
    with pytest.raises(ConfigurationError) as e:
        create_identity_token("user_42")
    assert e.value.code == "missing_identity_secret"
    assert e.value.param == "app_id"


def test_missing_and_malformed_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ConfigurationError) as e:
        create_identity_token("user_42")
    assert e.value.code == "missing_identity_secret"
    monkeypatch.setenv("CLIKGATE_IDENTITY_SECRETS", "{not json")
    with pytest.raises(ConfigurationError) as e2:
        create_identity_token("user_42", app_id="app_shop")
    assert e2.value.code == "invalid_identity_secrets"
    assert "not json" not in str(e2.value)


def test_client_methods_use_their_options() -> None:
    a, other = BY_NAME["ascii"], BY_NAME["other_app_secret"]
    c = Clikgate(KEY, shutdown_hooks=False, identity_secret=a["secret"], identity_secrets={"app_rider": other["secret"]})
    try:
        assert c.create_identity_token("user_42", issued_at=a["issued_at"]) == a["token"]
        assert c.create_identity_token("user_42", app_id="app_rider", issued_at=other["issued_at"]) == other["token"]
    finally:
        c.close()
    ac = AsyncClikgate(KEY, shutdown_hooks=False, identity_secret=a["secret"])
    assert ac.create_identity_token("user_42", issued_at=a["issued_at"]) == a["token"]


def test_issued_at_defaults_to_now() -> None:
    before = int(time.time())
    token = create_identity_token("user_42", secret="cgis_unit")
    signature, _, issued = token.rpartition(".")
    assert before <= int(issued) <= before + 2
    assert len(signature) == 43
    assert "=" not in signature


@pytest.mark.parametrize("bad", VECTORS["invalid_customer_ids"], ids=lambda v: v["name"])
def test_invalid_customer_ids_are_refused_without_echo(bad: Dict[str, str]) -> None:
    with pytest.raises(InvalidRequestError) as e:
        create_identity_token(bad["customer_id"], secret="cgis_unit", issued_at=1)
    assert e.value.code == "invalid_customer_id"
    if bad["customer_id"]:
        assert bad["customer_id"] not in str(e.value)


def test_non_string_customer_id_and_issued_at() -> None:
    with pytest.raises(InvalidRequestError):
        create_identity_token(42, secret="cgis_unit")  # type: ignore[arg-type]
    with pytest.raises(InvalidRequestError):
        create_identity_token("user_42", secret="cgis_unit", issued_at=-1)


@pytest.mark.parametrize("platform", ["emscripten", "wasi", "ios", "android"])
def test_refuses_browser_and_mobile_builds(monkeypatch: pytest.MonkeyPatch, platform: str) -> None:
    assert _identity._is_browser_or_mobile(platform)
    monkeypatch.setattr(sys, "platform", platform)  # the same module object _identity reads
    with pytest.raises(ClikgateServerOnlyError) as e:
        create_identity_token("user_42", secret="cgis_unit")
    assert isinstance(e.value, ClikgateError)
    assert e.value.code == "server_only"
    assert "cgis_unit" not in str(e.value)


def test_servers_are_allowed() -> None:
    for platform in ("linux", "darwin", "win32", "cygwin", "freebsd14"):
        assert not _identity._is_browser_or_mobile(platform)
