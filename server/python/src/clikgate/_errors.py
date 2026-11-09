"""Typed errors (SPEC section 5). Every error extends :class:`ClikgateError`.

Example::

    from clikgate import Clikgate, RateLimitError, InvalidRequestError

    try:
        clikgate.goals.send("account_opened", reference="APP-55231", value="2000000")
    except RateLimitError as err:
        print("retry in", err.retry_after, "s")
    except InvalidRequestError as err:
        print(err.code, err.param)
"""

from __future__ import annotations

import json
import math
import re
from datetime import timezone
from email.utils import parsedate_to_datetime
from typing import Any, List, Mapping, Optional

__all__ = [
    "AuthenticationError",
    "ClikgateError",
    "ConfigurationError",
    "ConflictError",
    "IdempotencyError",
    "InvalidRequestError",
    "LinkLockedError",
    "NetworkError",
    "NotFoundError",
    "PermissionError",
    "PrivateModeFieldRejectedError",
    "RateLimitError",
    "ServerError",
    "SignatureVerificationError",
    "TimeoutError",
]


class ClikgateError(Exception):
    """Base class of every error the SDK raises.

    Attributes:
        code: stable machine-readable code, e.g. ``invalid_value``, ``link_locked``, ``network_error``.
        http_status: the HTTP status, or ``None`` for local, network and timeout errors.
        request_id: the request ID (``req_…``) to quote to Clikgate support, when the API answered.
        param: the request field the error is about, when there is one.
        type: the envelope ``type`` (``invalid_request``, ``conflict``, …), or ``None`` for local errors.
        raw: the raw ``error`` object from the API, including extra keys such as ``required_plan``.
    """

    def __init__(
        self,
        message: str,
        *,
        code: str,
        http_status: Optional[int] = None,
        request_id: Optional[str] = None,
        param: Optional[str] = None,
        type: Optional[str] = None,
        raw: Optional[Mapping[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.http_status = http_status
        self.request_id = request_id
        self.param = param
        self.type = type
        self.raw: Optional[Mapping[str, Any]] = raw

    def __str__(self) -> str:
        return self.message

    def __repr__(self) -> str:
        return f"{type(self).__name__}(code={self.code!r}, http_status={self.http_status!r}, request_id={self.request_id!r})"

    def _raw(self, key: str) -> Any:
        return self.raw.get(key) if isinstance(self.raw, Mapping) else None


class ConfigurationError(ClikgateError):
    """Invalid client options. Raised by the constructor, never later."""


class AuthenticationError(ClikgateError):
    """401: the API key is missing, invalid, expired or revoked."""


class PermissionError(ClikgateError):
    """403: missing scope, role, feature or plan (``plan_limit_reached``, ``test_link_limit_reached``, ``cli_scope``, …)."""

    @property
    def required_plan(self) -> Optional[str]:
        """On ``plan_limit_reached`` / ``plan_upgrade_required``: the lowest plan that allows it."""
        v = self._raw("required_plan")
        return v if isinstance(v, str) else None

    @property
    def limit(self) -> Optional[int]:
        """On ``test_link_limit_reached``: the number of active test links allowed."""
        v = self._raw("limit")
        return v if isinstance(v, int) and not isinstance(v, bool) else None


class InvalidRequestError(ClikgateError):
    """400, 410, 422 and other 4xx; also local validation (``http_status`` is ``None``)."""

    def __init__(self, message: str, **kwargs: Any) -> None:
        super().__init__(message, **kwargs)
        #: For batch calls: the index of the event that failed local validation.
        self.index: Optional[int] = None

    @property
    def allowed(self) -> Optional[List[str]]:
        """On ``test_destination_not_allowed``: the allowed destination kinds."""
        v = self._raw("allowed")
        return [str(x) for x in v] if isinstance(v, list) else None

    @property
    def doc_url(self) -> Optional[str]:
        """On ``test_destination_not_allowed``: the docs page explaining test-link destinations."""
        v = self._raw("doc_url")
        return v if isinstance(v, str) else None


class PrivateModeFieldRejectedError(InvalidRequestError):
    """Private mode refused a field (locally, before sending, or by the API). Carries the field **name** only."""

    def __init__(self, message: str, *, field: str, **kwargs: Any) -> None:
        super().__init__(message, **kwargs)
        #: The refused field name, e.g. ``metadata``. Never its value.
        self.field = field


class NotFoundError(ClikgateError):
    """404."""


class ConflictError(ClikgateError):
    """409."""


class LinkLockedError(ConflictError):
    """409 ``link_locked``: destination, fallback and deep-link changes are refused. Never retried."""


class IdempotencyError(ClikgateError):
    """409 ``idempotency_*``: the key was used with a different request, or the first request is still running."""


class RateLimitError(ClikgateError):
    """429. ``retry_after`` is the number of seconds from ``Retry-After``, or ``None``."""

    def __init__(self, message: str, *, retry_after: Optional[int] = None, **kwargs: Any) -> None:
        super().__init__(message, **kwargs)
        self.retry_after = retry_after


class ServerError(ClikgateError):
    """5xx, or an unexpected status (redirects are never followed)."""

    def __init__(self, message: str, *, retry_after: Optional[int] = None, **kwargs: Any) -> None:
        super().__init__(message, **kwargs)
        self.retry_after = retry_after


class NetworkError(ClikgateError):
    """The connection failed (DNS, refused, reset, TLS)."""


class TimeoutError(ClikgateError):
    """The per-attempt timeout elapsed."""


class SignatureVerificationError(ClikgateError):
    """A webhook signature didn't verify.

    ``code`` is ``missing_signature``, ``malformed_signature``, ``timestamp_outside_tolerance``,
    ``no_matching_signature`` or ``invalid_payload``.
    """


class ClikgateServerOnlyError(ClikgateError):
    """``create_identity_token()`` ran in a browser or mobile build of Python: Pyodide or another
    Emscripten/WASI build, or CPython on iOS or Android. Identity tokens are signed with your identity secret, which
    must stay on your server. ``code`` is ``server_only``.
    """


_SNIPPET = 200
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_DIGITS = re.compile(r"[0-9]+")


def _retry_after_ms(headers: Mapping[str, str], now_ms: int) -> Optional[int]:
    value = headers.get("retry-after")
    if value is None:
        return None
    s = value.strip()
    if _DIGITS.fullmatch(s):
        return int(s) * 1000
    try:
        when = parsedate_to_datetime(s)
    except (TypeError, ValueError, IndexError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return max(0, int(when.timestamp() * 1000) - now_ms)


def _retry_after_seconds(headers: Mapping[str, str], now_ms: int) -> Optional[int]:
    ms = _retry_after_ms(headers, now_ms)
    return None if ms is None else math.ceil(ms / 1000)


def _str(v: Any) -> Optional[str]:
    return v if isinstance(v, str) else None


def error_from_response(status: int, headers: Mapping[str, str], body: bytes, now_ms: int) -> ClikgateError:
    """Map an HTTP response to a typed error (SPEC 5, rules 3-13). Header names are lowercase."""
    text = body.decode("utf-8", errors="replace")
    envelope: Optional[Mapping[str, Any]] = None
    refusal: Optional[Mapping[str, Any]] = None
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict) and isinstance(parsed.get("error"), dict):
            envelope = parsed["error"]
        elif _is_refusal_body(parsed):
            refusal = parsed
    except ValueError:
        envelope = None
    env: Mapping[str, Any] = envelope or {}
    request_id = _str(env.get("request_id")) or headers.get("x-request-id")
    redirect = 300 <= status < 400
    body_code = _str(env.get("code")) or (_str(refusal.get("reason")) if refusal else None)
    code = "unexpected_status" if redirect else (body_code or f"http_{status}")
    message = _str(env.get("message"))
    if message is None:
        message = f"HTTP {status}" + (f": {_CONTROL.sub(' ', text[:_SNIPPET])}" if text else "")
    kw: Any = {
        "code": code,
        "http_status": status,
        "request_id": request_id,
        "param": _str(env.get("param")),
        "type": _str(env.get("type")),
        "raw": envelope if envelope is not None else refusal,
    }
    if status == 429:
        kw["code"] = body_code or "rate_limit_exceeded"
        return RateLimitError(message, retry_after=_retry_after_seconds(headers, now_ms), **kw)
    if status >= 500:
        return ServerError(message, retry_after=_retry_after_seconds(headers, now_ms), **kw)
    if code == "private_mode_field_rejected":
        return PrivateModeFieldRejectedError(message, field=kw["param"] or "unknown", **kw)
    if status == 401:
        return AuthenticationError(message, **kw)
    if status == 403:
        return PermissionError(message, **kw)
    if status == 404:
        return NotFoundError(message, **kw)
    if status == 409 and (kw["type"] == "idempotency" or code.startswith("idempotency_")):
        return IdempotencyError(message, **kw)
    if status == 409 and code == "link_locked":
        return LinkLockedError(message, **kw)
    if status == 409:
        return ConflictError(message, **kw)
    if status >= 400:
        return InvalidRequestError(message, **kw)
    return ServerError(message, **kw)


def _is_refusal_body(v: Any) -> bool:
    """A goal refusal answered as a result body (``422 {"status": "refused", "reason": "unknown_goal", ...}``)."""
    return isinstance(v, dict) and v.get("status") == "refused" and isinstance(v.get("reason"), str) and v["reason"] != ""


def error_from_batch_item(status: int, error: Any) -> ClikgateError:
    """Map a batch item's ``{status, error}`` to a typed error."""
    body = json.dumps({"error": error if isinstance(error, dict) else {}}).encode()
    return error_from_response(status, {}, body, 0)


def local_error(code: str, message: str, param: Optional[str] = None) -> InvalidRequestError:
    """A local validation error (no HTTP request was made)."""
    return InvalidRequestError(message, code=code, param=param)


def as_clikgate_error(err: BaseException) -> ClikgateError:
    """Wrap anything raised inside a never-throwing path as a ClikgateError (the cause is kept)."""
    if isinstance(err, ClikgateError):
        return err
    code = "invalid_value" if isinstance(err, TypeError) else "unexpected_error"
    wrapped = (
        InvalidRequestError(str(err) or type(err).__name__, code=code)
        if code == "invalid_value"
        else ClikgateError(str(err) or type(err).__name__, code=code)
    )
    wrapped.__cause__ = err
    return wrapped
