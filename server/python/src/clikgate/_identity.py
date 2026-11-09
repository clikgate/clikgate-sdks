"""Identity tokens (SDK spec 8.5).

Your server proves to Clikgate that a customer ID belongs to the person signed in to your app; the app passes the
token to the mobile SDK's ``identifyUser()``. ``token = base64url_nopad(HMAC_SHA256(secret, customer_id + "." +
issued_at)) + "." + issued_at``: the signer Clikgate verifies with. No network call.
Guide: https://clikgate.com/docs/identify-users

Browser and mobile builds: a normal Python server can't be bundled into a website or an app, so the usual
risk (a secret shipped to customers' devices) only exists in Pyodide / Emscripten / WASI builds and in CPython's
iOS and Android builds (``sys.platform`` ``ios`` / ``android``, Python 3.13+). There the function raises
:class:`ClikgateServerOnlyError`.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sys
import time
from typing import Mapping, Optional

from ._errors import ClikgateServerOnlyError, ConfigurationError, local_error

__all__ = ["IDENTITY_SECRETS_ENV", "IDENTITY_SECRET_ENV", "create_identity_token"]

#: The single secret's environment variable.
IDENTITY_SECRET_ENV = "CLIKGATE_IDENTITY_SECRET"  # noqa: S105 (a variable name, not a secret)
#: The per-app map's environment variable: a JSON object ``{"app_…": "cgis_…"}``.
IDENTITY_SECRETS_ENV = "CLIKGATE_IDENTITY_SECRETS"

_MAX_CUSTOMER_ID = 255
_CLIENT_PLATFORMS = frozenset({"emscripten", "wasi", "ios", "android"})


def _is_browser_or_mobile(platform: Optional[str] = None) -> bool:
    return (sys.platform if platform is None else platform) in _CLIENT_PLATFORMS


def _env_map() -> Optional[Mapping[str, str]]:
    raw = os.environ.get(IDENTITY_SECRETS_ENV, "")
    if not raw.strip():
        return None
    try:
        parsed = json.loads(raw)
    except ValueError:
        parsed = None
    if not isinstance(parsed, dict) or not all(isinstance(v, str) and v for v in parsed.values()):
        # Never echo the value: it holds secrets.
        raise ConfigurationError(
            f'{IDENTITY_SECRETS_ENV} must be a JSON object of app IDs to identity secrets, e.g. {{"app_…": "cgis_…"}}.',
            code="invalid_identity_secrets",
            param=IDENTITY_SECRETS_ENV,
        )
    return parsed


def _resolve_secret(
    secret: Optional[str], app_id: Optional[str], own_secret: Optional[str], own_secrets: Optional[Mapping[str, str]]
) -> str:
    if secret:
        return secret
    secrets = own_secrets if own_secrets is not None else _env_map()
    if app_id is not None and secrets and secrets.get(app_id):
        return secrets[app_id]
    single = own_secret or os.environ.get(IDENTITY_SECRET_ENV) or None
    if single:
        return single
    if app_id is None and secrets:
        raise ConfigurationError(
            f"Several apps' identity secrets are set ({IDENTITY_SECRETS_ENV}): pass app_id to choose one.",
            code="missing_identity_secret",
            param="app_id",
        )
    message = (
        f"No identity secret: set {IDENTITY_SECRET_ENV} on your server (Apps > your app > Identity secret)."
        if app_id is None
        else f"No identity secret for this app: add it to {IDENTITY_SECRETS_ENV} or set {IDENTITY_SECRET_ENV}."
    )
    raise ConfigurationError(message, code="missing_identity_secret", param="secret")


def _sign(secret: str, customer_id: str, issued_at: int) -> str:
    digest = hmac.new(secret.encode(), f"{customer_id}.{issued_at}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii") + f".{issued_at}"


def _create(
    customer_id: str,
    *,
    app_id: Optional[str],
    secret: Optional[str],
    issued_at: Optional[int],
    own_secret: Optional[str] = None,
    own_secrets: Optional[Mapping[str, str]] = None,
) -> str:
    if _is_browser_or_mobile():
        raise ClikgateServerOnlyError(
            "create_identity_token() runs on your server only: it needs your identity secret, which must never be in an"
            " app or website. Return the token from your sign-in response instead. See https://clikgate.com/docs/identify-users",
            code="server_only",
        )
    if not isinstance(customer_id, str) or not customer_id or len(customer_id) > _MAX_CUSTOMER_ID:
        # Never echo the customer ID.
        raise local_error(
            "invalid_customer_id",
            "customer_id must be your own user ID as a string of 1-255 characters (never an email or phone number).",
            "customer_id",
        )
    issued = int(time.time()) if issued_at is None else issued_at
    if isinstance(issued, bool) or not isinstance(issued, int) or issued < 0:
        raise local_error("invalid_argument", "issued_at must be whole Unix seconds.", "issued_at")
    return _sign(_resolve_secret(secret, app_id, own_secret, own_secrets), customer_id, issued)


def create_identity_token(
    customer_id: str,
    *,
    app_id: Optional[str] = None,
    secret: Optional[str] = None,
    issued_at: Optional[int] = None,
) -> str:
    """Create an identity token for the signed-in user (path A of https://clikgate.com/docs/identify-users).

    Return it in your sign-in and "current user" responses; the app passes it to ``identifyUser()``. Reads
    ``CLIKGATE_IDENTITY_SECRET``, or with ``app_id`` that app's secret from ``CLIKGATE_IDENTITY_SECRETS`` (a JSON
    object of app IDs to secrets). ``secret`` overrides both; ``issued_at`` (Unix seconds) defaults to now. No network
    call and no API key needed.

    Raises :class:`ClikgateServerOnlyError` in browser or mobile Python builds, :class:`ConfigurationError` when no
    secret is set, and :class:`InvalidRequestError` (``invalid_customer_id``) for an empty or over-long customer ID.

    Example::

        from clikgate import create_identity_token
        return {"user": user, "clikgate_identity_token": create_identity_token(str(user.id))}
    """
    return _create(customer_id, app_id=app_id, secret=secret, issued_at=issued_at)
