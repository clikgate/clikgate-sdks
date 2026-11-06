"""The one HTTP pipeline every call (hand-written and generated) goes through: headers, retries with
full-jitter backoff, ``Retry-After``, idempotency keys and typed errors (SPEC sections 4, 6, 7)."""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple, TypedDict, Union
from urllib.parse import quote

import httpx

from ._errors import ClikgateError, NetworkError, RateLimitError, ServerError, TimeoutError, error_from_response, local_error

__all__ = ["Clock", "RequestOptions", "SystemClock"]

_BACKOFF_BASE_MS = 500
_BACKOFF_CAP_MS = 20_000
_MAX_RETRY_AFTER_MS = 60_000
RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})


class Clock:
    """Clock and sleep, replaceable for tests (SPEC section 18). Times are in seconds, like :func:`time.time`.

    Example (a fake clock for tests)::

        class FakeClock(Clock):
            def __init__(self): self.t = 1_793_016_000.0; self.sleeps = []
            def now(self): return self.t
            def sleep(self, seconds): self.sleeps.append(seconds)
            async def async_sleep(self, seconds): self.sleeps.append(seconds)
    """

    def now(self) -> float:
        """Seconds since the epoch."""
        return time.time()

    def sleep(self, seconds: float) -> None:
        """Block the calling thread (sync client)."""
        time.sleep(seconds)

    async def async_sleep(self, seconds: float) -> None:
        """Wait without blocking a thread (async client)."""
        await asyncio.sleep(seconds)


SystemClock = Clock


class RequestOptions(TypedDict, total=False):
    """Per-call options accepted by every API method (``request_options=``)."""

    #: Override the ``Idempotency-Key`` (POST and PATCH only).
    idempotency_key: str
    #: Override the client's per-attempt timeout, in seconds.
    timeout: float
    #: Override the client's ``max_retries`` for this call.
    max_retries: int


_UNSET: Any = object()


@dataclass
class ApiRequest:
    """A request as the resources (and the generated layer) describe it."""

    method: str
    path: str
    query: Optional[Mapping[str, Any]] = None
    body: Any = _UNSET
    idempotency_key: Optional[str] = None
    timeout: Optional[float] = None
    max_retries: Optional[int] = None
    raw: bool = False

    def with_options(self, options: Optional[RequestOptions]) -> ApiRequest:
        if options:
            if "idempotency_key" in options:
                self.idempotency_key = options["idempotency_key"]
            if "timeout" in options:
                self.timeout = options["timeout"]
            if "max_retries" in options:
                self.max_retries = options["max_retries"]
        return self


@dataclass
class RawResponse:
    status: int
    headers: Dict[str, str]
    body: bytes

    def json(self) -> Any:
        text = self.body.decode("utf-8")
        return json.loads(text) if text.strip() else None


@dataclass
class Settings:
    api_key: str
    base_url: str
    timeout: float
    max_retries: int
    user_agent: str
    clock: Clock
    random: Callable[[], float]
    extra_headers: Dict[str, str] = field(default_factory=dict)


def encode_path_segment(s: str) -> str:
    """Percent-encode one path segment (RFC 3986 unreserved characters kept)."""
    return quote(s, safe="")


def build_path(template: str, params: Mapping[str, str]) -> str:
    """Fill ``{name}`` placeholders with encoded values (used by the generated layer)."""
    out = template
    for k, v in params.items():
        out = out.replace("{" + k + "}", encode_path_segment(require_id(v, k)))
    return out


def format_date(d: Union[datetime, str]) -> str:
    """RFC 3339 UTC (``YYYY-MM-DDTHH:MM:SSZ``, with ``.sss`` only when the milliseconds aren't zero); strings pass through."""
    if isinstance(d, str):
        return d
    if d.tzinfo is None:
        raise local_error("invalid_argument", "Datetimes must be timezone-aware (e.g. datetime.now(timezone.utc)).", "occurred_at")
    u = d.astimezone(timezone.utc)
    ms = u.microsecond // 1000
    base = u.strftime("%Y-%m-%dT%H:%M:%S")
    return f"{base}.{ms:03d}Z" if ms else f"{base}Z"


def _scalar(v: Any) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, datetime):
        return format_date(v)
    if isinstance(v, Decimal):
        return format(v, "f")
    return str(v)


def query_string(query: Optional[Mapping[str, Any]]) -> str:
    if not query:
        return ""
    parts: List[str] = []
    for k, v in query.items():
        if isinstance(v, Mapping):
            # A map (e.g. ``metadata={"seller_id": "sel_ada"}``) is sent as ``metadata[seller_id]=sel_ada`` (SPEC section 21).
            for sub, sv in v.items():
                if sv is not None:
                    parts.append(f"{quote(f'{k}[{sub}]', safe='')}={quote(_scalar(sv), safe='')}")
            continue
        for item in v if isinstance(v, (list, tuple)) else [v]:
            if item is None:
                continue
            parts.append(f"{quote(str(k), safe='')}={quote(_scalar(item), safe='')}")
    return "?" + "&".join(parts) if parts else ""


def _json_default(v: Any) -> Any:
    if isinstance(v, datetime):
        return format_date(v)
    if isinstance(v, Decimal):
        return format(v, "f")
    if isinstance(v, (set, frozenset, tuple)):
        return list(v)
    raise TypeError(f"Object of type {type(v).__name__} is not JSON serializable")


def to_json(body: Any) -> bytes:
    """UTF-8 JSON; explicit ``None`` values are kept (PATCH uses them to clear a field)."""
    return json.dumps(body, ensure_ascii=False, separators=(",", ":"), default=_json_default).encode("utf-8")


def require_id(value: Any, name: str = "id") -> str:
    if not isinstance(value, str) or not value:
        raise local_error("invalid_argument", f"{name} must be a non-empty string.", name)
    return value


def is_retryable(err: BaseException) -> bool:
    """Whether the error class is retryable at the batch level (SPEC 9.3)."""
    if isinstance(err, (NetworkError, TimeoutError, RateLimitError)):
        return True
    return isinstance(err, ServerError) and err.http_status is not None and err.http_status in RETRYABLE_STATUS


def _timeout_error(seconds: float) -> TimeoutError:
    return TimeoutError(f"The request timed out after {round(seconds * 1000)} ms.", code="timeout")


def _network_error(err: BaseException) -> NetworkError:
    detail = type(err).__name__
    return NetworkError(f"Could not reach the Clikgate API ({detail}).", code="network_error")


@dataclass
class _Prepared:
    url: str
    headers: Dict[str, str]
    body: Optional[bytes]
    timeout: float
    max_retries: int


class _Base:
    """What the sync and async requesters share: request preparation and the retry decision."""

    def __init__(self, settings: Settings) -> None:
        self.s = settings

    def now_ms(self) -> int:
        return int(self.s.clock.now() * 1000)

    def backoff_ms(self, n: int) -> int:
        """Full-jitter backoff for retry number ``n`` (0-based)."""
        return int(self.s.random() * min(_BACKOFF_CAP_MS, _BACKOFF_BASE_MS * 2**n))

    def prepare(self, req: ApiRequest) -> _Prepared:
        headers = {
            "Authorization": f"Bearer {self.s.api_key}",
            "User-Agent": self.s.user_agent,
            "Accept": "application/json",
            **self.s.extra_headers,
        }
        body: Optional[bytes] = None
        if req.body is not _UNSET:
            body = to_json(req.body)
            headers["Content-Type"] = "application/json"
        if req.method in ("POST", "PATCH"):
            headers["Idempotency-Key"] = req.idempotency_key or str(uuid.uuid4())
        return _Prepared(
            url=f"{self.s.base_url}{req.path}{query_string(req.query)}",
            headers=headers,
            body=body,
            timeout=req.timeout if req.timeout is not None else self.s.timeout,
            max_retries=req.max_retries if req.max_retries is not None else self.s.max_retries,
        )

    def decide(
        self, attempt: int, p: _Prepared, outcome: Union[RawResponse, ClikgateError]
    ) -> Tuple[Optional[RawResponse], Optional[ClikgateError], int]:
        """Returns (response, None, 0) on success, (None, error, -1) to raise, or (None, error, delay_ms) to retry."""
        if isinstance(outcome, ClikgateError):
            if attempt >= p.max_retries:
                return None, outcome, -1
            return None, outcome, self.backoff_ms(attempt)
        res = outcome
        if 200 <= res.status < 300:
            return res, None, 0
        error = error_from_response(res.status, res.headers, res.body, self.now_ms())
        if res.status not in RETRYABLE_STATUS:
            return None, error, -1
        delay = self.backoff_ms(attempt)
        if res.status in (429, 503):
            from ._errors import _retry_after_ms

            ra = _retry_after_ms(res.headers, self.now_ms())
            if ra is not None:
                if ra > _MAX_RETRY_AFTER_MS:
                    return None, error, -1
                delay = ra
        if attempt >= p.max_retries:
            return None, error, -1
        return None, error, delay


def _headers(res: httpx.Response) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for k, v in res.headers.multi_items():
        key = k.lower()
        out[key] = f"{out[key]}, {v}" if key in out else v
    return out


def _timeout(seconds: float) -> httpx.Timeout:
    return httpx.Timeout(seconds)


class Requester(_Base):
    """The sync pipeline (``httpx.Client``)."""

    def __init__(self, settings: Settings, client: httpx.Client) -> None:
        super().__init__(settings)
        self.client = client

    def attempt(self, method: str, p: _Prepared) -> Union[RawResponse, ClikgateError]:
        try:
            res = self.client.request(method, p.url, headers=p.headers, content=p.body, timeout=_timeout(p.timeout), follow_redirects=False)
            return RawResponse(res.status_code, _headers(res), res.content)
        except httpx.TimeoutException:
            return _timeout_error(p.timeout)
        except (httpx.HTTPError, OSError) as err:
            return _network_error(err)

    def send(self, req: ApiRequest) -> RawResponse:
        """Send a request; returns the 2xx response or raises a typed error (after retries)."""
        p = self.prepare(req)
        attempt = 0
        while True:
            res, err, delay = self.decide(attempt, p, self.attempt(req.method, p))
            if res is not None:
                return res
            assert err is not None
            if delay < 0:
                raise err
            self.s.clock.sleep(delay / 1000)
            attempt += 1

    def request(self, req: ApiRequest) -> Tuple[int, Any, Dict[str, str]]:
        """Send a JSON request and parse the JSON answer (``None`` for an empty body)."""
        res = self.send(req)
        return res.status, res.json(), res.headers


class AsyncRequester(_Base):
    """The async pipeline (``httpx.AsyncClient``). Never blocks a thread."""

    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        super().__init__(settings)
        self.client = client

    async def attempt(self, method: str, p: _Prepared) -> Union[RawResponse, ClikgateError]:
        try:
            res = await self.client.request(
                method, p.url, headers=p.headers, content=p.body, timeout=_timeout(p.timeout), follow_redirects=False
            )
            return RawResponse(res.status_code, _headers(res), res.content)
        except httpx.TimeoutException:
            return _timeout_error(p.timeout)
        except (httpx.HTTPError, OSError) as err:
            return _network_error(err)

    async def send(self, req: ApiRequest) -> RawResponse:
        p = self.prepare(req)
        attempt = 0
        while True:
            res, err, delay = self.decide(attempt, p, await self.attempt(req.method, p))
            if res is not None:
                return res
            assert err is not None
            if delay < 0:
                raise err
            await self.s.clock.async_sleep(delay / 1000)
            attempt += 1

    async def request(self, req: ApiRequest) -> Tuple[int, Any, Dict[str, str]]:
        res = await self.send(req)
        return res.status, res.json(), res.headers
