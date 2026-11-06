"""Webhook verification (``Clikgate-Signature``). No API key or client needed.

``Clikgate-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>]`` with
``hex = HMAC-SHA256(key = the whole secret including "whsec_", message = "<t>." + raw body)``.

Example (Flask)::

    from clikgate import webhooks, SignatureVerificationError

    @app.post("/webhooks/clikgate")
    def clikgate_webhook():
        try:
            event = webhooks.verify(request.get_data(), request.headers.get("Clikgate-Signature"), os.environ["CLIKGATE_WEBHOOK_SECRET"])
        except SignatureVerificationError as err:
            return err.code, 400
        if event["type"] == "goal.completed":
            ...   # dedupe on event["id"]: delivery is at-least-once
        return "", 200
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
from typing import Any, List, Optional, Sequence, Tuple, Union, cast

from ._errors import SignatureVerificationError, local_error
from ._types import WebhookEvent

__all__ = ["RawBody", "verify", "verify_any"]

#: The raw request body exactly as received.
RawBody = Union[str, bytes, bytearray, memoryview]
_DIGITS = re.compile(r"[0-9]+")


def _fail(code: str, message: str) -> SignatureVerificationError:
    return SignatureVerificationError(message, code=code)


def _to_bytes(raw: Any) -> bytes:
    if isinstance(raw, str):
        return raw.encode("utf-8")
    if isinstance(raw, (bytes, bytearray, memoryview)):
        return bytes(raw)
    raise _fail(
        "invalid_payload", "Pass the raw request body (str or bytes), not parsed JSON: re-serialising changes the bytes Clikgate signed."
    )


def _parse_header(header: Any) -> Tuple[int, List[str]]:
    if not isinstance(header, str) or not header.strip():
        raise _fail("missing_signature", "The Clikgate-Signature header is missing.")
    t: Optional[int] = None
    bad = False
    v1: List[str] = []
    for part in header.split(","):
        p = part.strip()
        if "=" not in p:
            continue
        key, value = (x.strip() for x in p.split("=", 1))
        if key == "t":
            if _DIGITS.fullmatch(value):
                t = int(value)
            else:
                bad = True
        elif key == "v1":
            v1.append(value)
    if bad or t is None or not v1:
        raise _fail("malformed_signature", "The Clikgate-Signature header is malformed (expected t=<unix seconds>,v1=<hex>).")
    return t, v1


def _verify(
    raw_body: RawBody, signature_header: Optional[str], secrets: Sequence[str], tolerance: int, now: Optional[float]
) -> WebhookEvent:
    body = _to_bytes(raw_body)
    t, v1 = _parse_header(signature_header)
    current = int(now if now is not None else time.time())
    if tolerance > 0 and abs(current - t) > tolerance:
        raise _fail(
            "timestamp_outside_tolerance",
            f"The signature timestamp is more than {tolerance} s from now; the request may be a replay, or this server's clock is wrong.",
        )
    message = f"{t}.".encode() + body
    matched = False
    for secret in secrets:
        expected = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest().encode()
        for candidate in v1:
            c = candidate.encode("utf-8")
            if len(c) == len(expected) and hmac.compare_digest(expected, c):
                matched = True
    if not matched:
        raise _fail("no_matching_signature", "No signature matches: check the endpoint secret, and that you pass the raw body.")
    try:
        event = json.loads(body.decode("utf-8"))
    except ValueError:
        raise _fail("invalid_payload", "The body is not JSON.") from None
    if not isinstance(event, dict):
        raise _fail("invalid_payload", "The body is not an event object.")
    return cast(WebhookEvent, event)


def verify(
    raw_body: RawBody, signature_header: Optional[str], secret: str, *, tolerance: int = 300, now: Optional[float] = None
) -> WebhookEvent:
    """Verify a delivery and return the parsed event. Raises :class:`SignatureVerificationError`.

    ``tolerance`` is the maximum age (and future skew) in seconds; ``0`` disables the check (tests only).
    ``now`` is the current unix time in seconds (for tests).

    Example::

        event = webhooks.verify(request.body, request.headers.get("Clikgate-Signature"), os.environ["CLIKGATE_WEBHOOK_SECRET"])
    """
    if not isinstance(secret, str) or not secret:
        raise local_error("invalid_argument", "secret must be the endpoint secret (whsec_…).", "secret")
    return _verify(raw_body, signature_header, [secret], tolerance, now)


def verify_any(
    raw_body: RawBody, signature_header: Optional[str], secrets: Sequence[str], *, tolerance: int = 300, now: Optional[float] = None
) -> WebhookEvent:
    """Like :func:`verify`, accepting any of several secrets (while you rotate your own).

    Example::

        event = webhooks.verify_any(body, header, [new_secret, old_secret])
    """
    if isinstance(secrets, str) or not secrets or any(not isinstance(s, str) or not s for s in secrets):
        raise local_error("invalid_argument", "secrets must be a non-empty list of endpoint secrets.", "secrets")
    return _verify(raw_body, signature_header, list(secrets), tolerance, now)
