"""The ``Clikgate`` (sync) and ``AsyncClikgate`` clients (SPEC section 3)."""

from __future__ import annotations

import atexit
import contextlib
import logging
import os
import random as _random
import re
import threading
import weakref
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Dict, Literal, Mapping, Optional, Sequence, TypedDict, Union
from urllib.parse import urlsplit

import httpx

from . import webhooks as _webhooks
from ._click_ids import ClickIds
from ._config import AsyncConfigCache, ConfigCache, LoggerLike
from ._core import AsyncCore, Core, ErrorContext, OnError, PrivateMode, _CoreBase
from ._enums import Provider
from ._errors import ConfigurationError, as_clikgate_error, local_error
from ._goals import AsyncGoals, AsyncSender, Goals, SyncSender, build_goal_wire, check_before_send, send_request
from ._guard import guard_payload
from ._http import ApiRequest, AsyncRequester, Clock, Requester, RequestOptions, Settings
from ._identity import _create as _create_identity_token
from ._money import MoneyInput
from ._payments import AsyncPayments, Payments
from ._resources import AsyncClicks, AsyncConversions, AsyncLinks, Clicks, Conversions, Links
from ._types import ServerSdkConfig, WebhookEvent
from ._user_agent import user_agent
from .api import ApiClient, AsyncApiClient

__all__ = ["AsyncClikgate", "Clikgate"]

_KEY = re.compile(r"cg_(live|test)_[A-Za-z0-9_]+")
_PARAM = re.compile(r"[A-Za-z0-9_]{1,32}")
_LOCAL = {"localhost", "127.0.0.1", "::1"}
SendMode = Literal["background", "sync"]


def _key_type(k: str) -> str:
    if k.startswith("cg_sdk_"):
        return "a mobile SDK key (cg_sdk_…)"
    if k.startswith("cg_site_"):
        return "a web script site key (cg_site_…)"
    if k.startswith("cg_cli_"):
        return "a setup command token (cg_cli_…)"
    return "not a Clikgate server API key"


def _invalid(name: str, message: str) -> ConfigurationError:
    return ConfigurationError(message, code="invalid_option", param=name)


def _number(name: str, v: Any, lo: float, hi: float, integer: bool) -> Any:
    ok = isinstance(v, int) if integer else isinstance(v, (int, float))
    if isinstance(v, bool) or not ok or not (lo <= v <= hi) or (not integer and v <= 0):
        raise _invalid(name, f"{name} must be a number from {lo:g} to {hi:g}.")
    return v


@dataclass
class _Resolved:
    api_key: str
    mode: Literal["live", "test"]
    base_url: str
    timeout: float
    max_retries: int
    send_mode: SendMode
    private_mode: PrivateMode
    click_id_param: Optional[str]
    batch_size: int
    flush_interval: float
    max_queue_size: int
    logger: LoggerLike
    clock: Clock
    random: Callable[[], float]
    proxy: Union[str, Literal[False], None]


def _resolve(
    api_key: Optional[str],
    base_url: Optional[str],
    timeout: float,
    max_retries: int,
    send_mode: str,
    private_mode: Any,
    click_id_param: Optional[str],
    batch_size: int,
    flush_interval: float,
    max_queue_size: int,
    logger: Optional[LoggerLike],
    clock: Optional[Clock],
    random: Optional[Callable[[], float]],
    proxy: Any,
    unknown: Mapping[str, Any],
) -> _Resolved:
    if unknown:
        name = sorted(unknown)[0]
        raise _invalid(name, f"Unknown option {name!r}. See https://clikgate.com/docs/sdks/python#options.")
    key = api_key if api_key is not None else os.environ.get("CLIKGATE_API_KEY")
    if not key:
        raise ConfigurationError(
            "No API key: pass api_key=… or set CLIKGATE_API_KEY (cg_live_… or cg_test_…).", code="missing_api_key", param="api_key"
        )
    m = _KEY.fullmatch(key) if isinstance(key, str) else None
    if m is None:
        raise ConfigurationError(
            f"The API key is {_key_type(key if isinstance(key, str) else '')}. "
            "Server SDKs need a cg_live_… or cg_test_… API key from Developers → API keys.",
            code="invalid_api_key",
            param="api_key",
        )
    url = (base_url if base_url is not None else os.environ.get("CLIKGATE_BASE_URL") or "https://api.clikgate.com").rstrip("/")
    try:
        parts = urlsplit(url)
        host = parts.hostname or ""
        _ = parts.port
    except ValueError:
        raise _invalid("base_url", "base_url is not a URL.") from None
    if not host or not (parts.scheme == "https" or (parts.scheme == "http" and host in _LOCAL)):
        raise _invalid("base_url", "base_url must use https:// (http:// only for localhost).")
    if send_mode not in ("background", "sync"):
        raise _invalid("send_mode", "send_mode must be 'background' or 'sync'.")
    if private_mode not in ("auto", True, False) or (private_mode in (0, 1) and not isinstance(private_mode, bool)):
        raise _invalid("private_mode", "private_mode must be 'auto', True or False.")
    if click_id_param is not None and (not isinstance(click_id_param, str) or not _PARAM.fullmatch(click_id_param)):
        raise _invalid("click_id_param", "click_id_param must be 1-32 letters, digits or underscores.")
    if proxy is not None and proxy is not False and (not isinstance(proxy, str) or urlsplit(proxy).scheme not in ("http", "https")):
        raise _invalid("proxy", "proxy must be an http:// or https:// URL, or False.")
    return _Resolved(
        api_key=key,
        mode="live" if m.group(1) == "live" else "test",
        base_url=url,
        timeout=float(_number("timeout", timeout, 0.001, 600, integer=False)),
        max_retries=_number("max_retries", max_retries, 0, 10, integer=True),
        send_mode="sync" if send_mode == "sync" else "background",
        private_mode=private_mode,
        click_id_param=click_id_param,
        batch_size=_number("batch_size", batch_size, 1, 500, integer=True),
        flush_interval=float(_number("flush_interval", flush_interval, 0.001, 3600, integer=False)),
        max_queue_size=_number("max_queue_size", max_queue_size, 1, 1_000_000, integer=True),
        logger=logger if logger is not None else logging.getLogger("clikgate"),
        clock=clock if clock is not None else Clock(),
        random=random if random is not None else _random.random,
        proxy=proxy,
    )


def _settings(r: _Resolved) -> Settings:
    return Settings(
        api_key=r.api_key,
        base_url=r.base_url,
        timeout=r.timeout,
        max_retries=r.max_retries,
        user_agent=user_agent(),
        clock=r.clock,
        random=r.random,
    )


def _httpx_kwargs(r: _Resolved) -> dict[str, Any]:
    kw: dict[str, Any] = {"follow_redirects": False, "timeout": r.timeout, "trust_env": r.proxy is not False}
    if isinstance(r.proxy, str):
        kw["proxy"] = r.proxy
    return kw


class _Webhooks:
    """Webhook verification using the client's clock (also available as the module ``clikgate.webhooks``)."""

    def __init__(self, clock: Clock) -> None:
        self._clock = clock

    def verify(
        self,
        raw_body: _webhooks.RawBody,
        signature_header: Optional[str],
        secret: str,
        *,
        tolerance: int = 300,
        now: Optional[float] = None,
    ) -> WebhookEvent:
        """See :func:`clikgate.webhooks.verify`.

        Example::

            event = clikgate.webhooks.verify(body, request.headers.get("Clikgate-Signature"), secret)
        """
        return _webhooks.verify(raw_body, signature_header, secret, tolerance=tolerance, now=self._clock.now() if now is None else now)

    def verify_any(
        self,
        raw_body: _webhooks.RawBody,
        signature_header: Optional[str],
        secrets: Sequence[str],
        *,
        tolerance: int = 300,
        now: Optional[float] = None,
    ) -> WebhookEvent:
        """See :func:`clikgate.webhooks.verify_any`.

        Example::

            event = clikgate.webhooks.verify_any(body, header, [new_secret, old_secret])
        """
        return _webhooks.verify_any(raw_body, signature_header, secrets, tolerance=tolerance, now=self._clock.now() if now is None else now)


# One atexit hook for every client (SPEC 9.4)
_clients: weakref.WeakSet[Any] = weakref.WeakSet()
_hook_lock = threading.Lock()
_hook_installed = False
_SHUTDOWN_FLUSH_S = 5.0


def _at_exit() -> None:
    for c in list(_clients):
        with contextlib.suppress(Exception):
            c._at_exit()


def _register(client: Any) -> None:
    global _hook_installed
    with _hook_lock:
        _clients.add(client)
        if not _hook_installed:
            atexit.register(_at_exit)
            _hook_installed = True


def _shown(core: _CoreBase, key: Any, reference: Any) -> dict[str, str]:
    return {"goal": str(key), "reference": core.shown_reference(reference)}


class PersonIdentified(TypedDict):
    """The answer of ``identify_user``. ``label_ignored``: ``"plan"`` (below Growth the label isn't stored) or
    ``"lower_rank"`` (a label your team set was kept)."""

    object: str
    person_id: str
    label_ignored: Optional[str]


def _identify_body(
    click_id: Optional[str], app_id: Optional[str], installation_id: Optional[str], customer_id: Optional[str], label: Optional[str]
) -> Dict[str, Any]:
    if (app_id is None) != (installation_id is None):
        raise local_error("invalid_request", "Send app_id and installation_id together.", "app_id" if app_id is None else "installation_id")
    if click_id is None and installation_id is None and customer_id is None:
        raise local_error("invalid_request", "Send click_id, app_id + installation_id, or customer_id.", "click_id")
    body = {"click_id": click_id, "app_id": app_id, "installation_id": installation_id, "customer_id": customer_id, "label": label}
    return {k: v for k, v in body.items() if v is not None}


class Clikgate:
    """The Clikgate client. Create one and reuse it: it is thread-safe.

    Every option is keyword-only and optional; the API key defaults to ``CLIKGATE_API_KEY``.

    Example::

        from clikgate import Clikgate
        clikgate = Clikgate()                      # reads CLIKGATE_API_KEY
        clikgate.goal("account_opened", click_id=click_id, reference="APP-55231", value=Decimal("2000000"))

    Args:
        api_key: ``cg_live_…`` or ``cg_test_…``. The mode comes from the prefix (``client.mode``).
        base_url: default ``CLIKGATE_BASE_URL``, else ``https://api.clikgate.com``.
        timeout: per-attempt timeout in seconds (default 10).
        max_retries: retries for network errors, timeouts and HTTP 429, 500, 502, 503 and 504 (default 3, at most 10).
        send_mode: ``background`` (default: ``goal()`` queues and batches) or ``sync`` (``goal()`` sends each event at once).
        private_mode: ``"auto"`` (default: follow the organisation's setting), ``True`` (always guard) or ``False``.
        click_id_param: the click-ID query parameter (default: from config, else ``cgid``).
        logger: a :class:`logging.Logger` (default ``logging.getLogger("clikgate")``; warnings use ``extra={"clikgate_code": …}``).
        on_error: called with ``(error, context)`` for failures that can't be raised (background sends, ``goal()``).
        http_client: an ``httpx.Client`` to send with (proxies, mTLS, corporate networks). Default: a built-in one.
        proxy: an ``http(s)://user:pass@host:port`` proxy URL, or ``False`` to ignore ``HTTPS_PROXY``. Default: the environment.
        batch_size: background batch size, 1-500 (default 100).
        flush_interval: background flush interval in seconds (default 1).
        max_queue_size: background queue bound (default 10,000); when full, the oldest event is dropped.
        shutdown_hooks: flush at interpreter exit (``atexit``; default True).
        clock: advanced (tests): a :class:`Clock` replacing time and sleep.
        random: advanced (tests): the random source for backoff jitter, in [0, 1).
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: Optional[str] = None,
        timeout: float = 10.0,
        max_retries: int = 3,
        send_mode: SendMode = "background",
        private_mode: PrivateMode = "auto",
        click_id_param: Optional[str] = None,
        logger: Optional[LoggerLike] = None,
        on_error: Optional[OnError] = None,
        http_client: Optional[httpx.Client] = None,
        proxy: Union[str, Literal[False], None] = None,
        batch_size: int = 100,
        flush_interval: float = 1.0,
        max_queue_size: int = 10_000,
        shutdown_hooks: bool = True,
        identity_secret: Optional[str] = None,
        identity_secrets: Optional[Mapping[str, str]] = None,
        clock: Optional[Clock] = None,
        random: Optional[Callable[[], float]] = None,
        **unknown: Any,
    ) -> None:
        r = _resolve(
            api_key,
            base_url,
            timeout,
            max_retries,
            send_mode,
            private_mode,
            click_id_param,
            batch_size,
            flush_interval,
            max_queue_size,
            logger,
            clock,
            random,
            proxy,
            unknown,
        )
        if http_client is not None and not isinstance(http_client, httpx.Client):
            raise _invalid("http_client", "http_client must be an httpx.Client (use AsyncClikgate for httpx.AsyncClient).")
        #: ``live`` or ``test``, from the API key prefix.
        self.mode: Literal["live", "test"] = r.mode
        self._owns_http = http_client is None
        self._http = http_client if http_client is not None else httpx.Client(**_httpx_kwargs(r))
        requester = Requester(_settings(r), self._http)
        config = ConfigCache(requester, r.logger, r.timeout)
        self._core = Core(requester, config, r.logger, r.private_mode, on_error)
        self._send_mode = r.send_mode
        self._identity_secret = identity_secret
        self._identity_secrets: Optional[Mapping[str, str]] = dict(identity_secrets) if identity_secrets is not None else None
        self._sender = SyncSender(self._core, r.batch_size, r.max_queue_size, r.flush_interval)
        self._closed = False
        #: Goal events.
        self.goals = Goals(self._core)
        #: Conversions (older API).
        self.conversions = Conversions(self._core)
        #: Payments your server has verified: ``confirm``, ``from_paystack``, ``from_flutterwave``, ``from_monnify``, ``from_stripe``.
        self.payments = Payments(self._core)
        #: Links.
        self.links = Links(self._core)
        #: Clicks.
        self.clicks = Clicks(self._core)
        explicit = r.click_id_param
        #: Click-ID helpers using this client's ``click_id_param`` (or the organisation's, from config).
        self.click_ids = ClickIds(lambda: explicit or (config.peek() or {}).get("click_id_param") or "cgid")
        #: Every API-key operation, generated from openapi.json ("advanced").
        self.api = ApiClient(requester)
        #: Webhook verification (also available without a client: ``from clikgate import webhooks``).
        self.webhooks = _Webhooks(r.clock)
        if shutdown_hooks:
            _register(self)

    def goal(
        self,
        key: str,
        *,
        reference: str,
        click_id: Optional[str] = None,
        code: Optional[str] = None,
        value: Optional[MoneyInput] = None,
        currency: Optional[str] = None,
        is_first: Optional[bool] = None,
        occurred_at: Union[datetime, str, None] = None,
        metadata: Optional[Mapping[str, Any]] = None,
        consent: Optional[Mapping[str, Any]] = None,
        extra: Optional[Mapping[str, Any]] = None,
        provider: Union[Provider, str, None] = None,
        label: Optional[str] = None,
        kept_by: Optional[str] = None,
        browser_engine: Optional[str] = None,
        platform: Optional[str] = None,
        hashed_email: Optional[str] = None,
        hashed_phone_e164: Optional[str] = None,
        hashed_phone_digits: Optional[str] = None,
    ) -> None:
        """Record a goal without waiting. **Never raises**: failures go to ``logger`` and ``on_error``.

        In background mode the event is queued and sent in batches from a daemon thread; call
        ``clikgate.flush()`` before a short-lived process (a serverless function, a CLI command) exits.

        ``hashed_email``, ``hashed_phone_e164`` and ``hashed_phone_digits`` are your own SHA-256 hashes for
        ad network matching, used when the business has turned on matching by hashed email or phone for a destination:
        make them with :func:`clikgate.hash_for_ads` (``**hash_for_ads(email=..., phone=...)``). In private mode, hash
        on your own server: Clikgate never hashes for you there.

        Example::

            clikgate.goal("account_opened", click_id=application.click_id, reference="APP-55231", value=Decimal("2000000"), currency="NGN")
        """
        core = self._core
        try:
            if self._closed:
                core.report(
                    local_error("client_closed", "This Clikgate client is closed."),
                    ErrorContext("goal", [_shown(core, key, reference)], True),
                )
                return
            try:
                wire = build_goal_wire(
                    key,
                    reference,
                    click_id,
                    code,
                    value,
                    currency,
                    is_first,
                    occurred_at,
                    metadata,
                    consent,
                    extra,
                    provider,
                    label,
                    kept_by=kept_by,
                    browser_engine=browser_engine,
                    platform=platform,
                    hashed_email=hashed_email,
                    hashed_phone_e164=hashed_phone_e164,
                    hashed_phone_digits=hashed_phone_digits,
                )
            except Exception as err:
                core.report(as_clikgate_error(err), ErrorContext("goal", [_shown(core, key, reference)], True))
                return
            if self._send_mode == "background":
                self._sender.enqueue(wire)
                return

            def job() -> None:
                try:
                    check_before_send(core, core.guard_state(), wire)
                    _s, data, _h = core.requester.request(send_request(wire, None))
                    core.note_refused_goal(key, data.get("reason") if isinstance(data, dict) else None)
                except Exception as err:
                    error = as_clikgate_error(err)
                    core.note_refused_goal(key, error.code)
                    core.report(error, ErrorContext("goal", [_shown(core, key, reference)], True))

            self._sender.post(job)
        except Exception:  # goal() never raises, whatever happens
            pass

    def create_identity_token(self, customer_id: str, *, app_id: Optional[str] = None, issued_at: Optional[int] = None) -> str:
        """Create an identity token for the signed-in user (path A of
        https://clikgate.com/docs/identify-users). Uses ``identity_secret`` / ``identity_secrets`` from the options,
        else ``CLIKGATE_IDENTITY_SECRET`` / ``CLIKGATE_IDENTITY_SECRETS``. No network call (also on
        :class:`AsyncClikgate`, where it is a plain method). See :func:`clikgate.create_identity_token`.

        Example::

            return {"user": user, "clikgate_identity_token": clikgate.create_identity_token(str(user.id))}
        """
        return _create_identity_token(
            customer_id,
            app_id=app_id,
            secret=None,
            issued_at=issued_at,
            own_secret=self._identity_secret,
            own_secrets=self._identity_secrets,
        )

    def identify_user(
        self,
        *,
        click_id: Optional[str] = None,
        app_id: Optional[str] = None,
        installation_id: Optional[str] = None,
        customer_id: Optional[str] = None,
        label: Optional[str] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> PersonIdentified:
        """Tell Clikgate who a person is (``POST /v1/people/identify``): a click, an app installation (``app_id`` +
        ``installation_id``) or your ``customer_id``, at least one. With a click or installation, ``customer_id``
        links it to that customer. ``label`` is what your team sees instead of the click ID (1-80 characters, ``""``
        clears it; Growth and up). Always verified (your server), so it also satisfies a referral program's
        ``require_identity_token``. In private mode ``customer_id`` is refused locally and ``label`` needs "Allow
        labels in private mode".

        Path B of https://clikgate.com/docs/identify-users (no identity secret or token): the app reads
        ``getInstallationId()`` and sends it in its sign-in request; your server calls this with ``app_id``,
        ``installation_id``, ``customer_id`` and optionally ``label``, after sign-in and at every signed-in app open.
        When the app sends no installation ID (tracking is off), skip the call. Clikgate accepts installations active
        in the last 7 days.

        Example::

            clikgate.identify_user(click_id=order.click_id, customer_id="user_42", label="Ada (VIP)")
            if installation_id:
                clikgate.identify_user(app_id="app_…", installation_id=installation_id, customer_id=str(user.id))
        """
        body = _identify_body(click_id, app_id, installation_id, customer_id, label)
        if self._core.guard_state().guard:
            guard_payload("identify", body)
        _s, data, _h = self._core.requester.request(ApiRequest("POST", "/v1/people/identify", body=body).with_options(request_options))
        return data  # type: ignore[no-any-return]

    def config(self) -> Optional[ServerSdkConfig]:
        """The organisation's server SDK config (private mode, click-ID parameter, goals), cached for 10 minutes.
        ``None`` when it can't be loaded.

        Example::

            config = clikgate.config()
            if config and config["private_mode"]:
                print("private mode is on")
        """
        return self._core.config.get()

    def flush(self, timeout: float = 10.0) -> bool:
        """Send everything queued (and wait for sends in flight). Returns True when done within ``timeout`` seconds.
        Never raises.

        Example::

            def handler(event, context):        # AWS Lambda
                clikgate.goal("order_paid", reference=event["order_id"], value=event["amount"])
                clikgate.flush()
        """
        try:
            return self._sender.flush(timeout)
        except Exception:
            return False

    def close(self, timeout: float = 10.0) -> bool:
        """Flush, then stop the sender thread and release connections. Later ``goal()`` calls go to ``on_error``
        (``client_closed``). Returns whether the flush finished within ``timeout`` seconds.

        Example::

            clikgate.close()
        """
        if self._closed:
            return self.flush(timeout)
        self._closed = True
        _clients.discard(self)
        done = self.flush(timeout)
        self._sender.stop()
        if self._owns_http and done:
            with contextlib.suppress(Exception):
                self._http.close()
        return done

    def __enter__(self) -> Clikgate:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def _at_exit(self) -> None:
        if self._sender.busy:
            self.flush(_SHUTDOWN_FLUSH_S)


class AsyncClikgate:
    """The asyncio client, with the same options as :class:`Clikgate` (``http_client`` is an ``httpx.AsyncClient``).

    ``goal()`` is a plain (non-async) method that never raises; it must be called while an event loop runs.
    In background mode a task on the running loop batches the events; ``await clikgate.close()`` on shutdown
    (the FastAPI/Starlette lifespan, for example) so nothing queued is lost.

    Example::

        from clikgate import AsyncClikgate
        clikgate = AsyncClikgate()
        event = await clikgate.goals.send("account_opened", click_id=click_id, reference="APP-55231", value="2000000")
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: Optional[str] = None,
        timeout: float = 10.0,
        max_retries: int = 3,
        send_mode: SendMode = "background",
        private_mode: PrivateMode = "auto",
        click_id_param: Optional[str] = None,
        logger: Optional[LoggerLike] = None,
        on_error: Optional[OnError] = None,
        http_client: Optional[httpx.AsyncClient] = None,
        proxy: Union[str, Literal[False], None] = None,
        batch_size: int = 100,
        flush_interval: float = 1.0,
        max_queue_size: int = 10_000,
        shutdown_hooks: bool = True,
        identity_secret: Optional[str] = None,
        identity_secrets: Optional[Mapping[str, str]] = None,
        clock: Optional[Clock] = None,
        random: Optional[Callable[[], float]] = None,
        **unknown: Any,
    ) -> None:
        r = _resolve(
            api_key,
            base_url,
            timeout,
            max_retries,
            send_mode,
            private_mode,
            click_id_param,
            batch_size,
            flush_interval,
            max_queue_size,
            logger,
            clock,
            random,
            proxy,
            unknown,
        )
        if http_client is not None and not isinstance(http_client, httpx.AsyncClient):
            raise _invalid("http_client", "http_client must be an httpx.AsyncClient (use Clikgate for httpx.Client).")
        #: ``live`` or ``test``, from the API key prefix.
        self.mode: Literal["live", "test"] = r.mode
        self._owns_http = http_client is None
        self._http = http_client if http_client is not None else httpx.AsyncClient(**_httpx_kwargs(r))
        requester = AsyncRequester(_settings(r), self._http)
        config = AsyncConfigCache(requester, r.logger, r.timeout)
        self._core = AsyncCore(requester, config, r.logger, r.private_mode, on_error)
        self._send_mode = r.send_mode
        self._identity_secret = identity_secret
        self._identity_secrets: Optional[Mapping[str, str]] = dict(identity_secrets) if identity_secrets is not None else None
        self._sender = AsyncSender(self._core, r.batch_size, r.max_queue_size, r.flush_interval)
        self._closed = False
        self.goals = AsyncGoals(self._core)
        self.conversions = AsyncConversions(self._core)
        self.payments = AsyncPayments(self._core)
        self.links = AsyncLinks(self._core)
        self.clicks = AsyncClicks(self._core)
        explicit = r.click_id_param
        self.click_ids = ClickIds(lambda: explicit or (config.peek() or {}).get("click_id_param") or "cgid")
        self.api = AsyncApiClient(requester)
        self.webhooks = _Webhooks(r.clock)
        if shutdown_hooks:
            _register(self)

    def goal(
        self,
        key: str,
        *,
        reference: str,
        click_id: Optional[str] = None,
        code: Optional[str] = None,
        value: Optional[MoneyInput] = None,
        currency: Optional[str] = None,
        is_first: Optional[bool] = None,
        occurred_at: Union[datetime, str, None] = None,
        metadata: Optional[Mapping[str, Any]] = None,
        consent: Optional[Mapping[str, Any]] = None,
        extra: Optional[Mapping[str, Any]] = None,
        provider: Union[Provider, str, None] = None,
        label: Optional[str] = None,
        kept_by: Optional[str] = None,
        browser_engine: Optional[str] = None,
        platform: Optional[str] = None,
        hashed_email: Optional[str] = None,
        hashed_phone_e164: Optional[str] = None,
        hashed_phone_digits: Optional[str] = None,
    ) -> None:
        """Record a goal without waiting (call it from async code). **Never raises.**

        Example::

            clikgate.goal("account_opened", click_id=click_id, reference="APP-55231", value="2000000")
        """
        core = self._core
        try:
            if self._closed:
                core.report(
                    local_error("client_closed", "This Clikgate client is closed."),
                    ErrorContext("goal", [_shown(core, key, reference)], True),
                )
                return
            try:
                wire = build_goal_wire(
                    key,
                    reference,
                    click_id,
                    code,
                    value,
                    currency,
                    is_first,
                    occurred_at,
                    metadata,
                    consent,
                    extra,
                    provider,
                    label,
                    kept_by=kept_by,
                    browser_engine=browser_engine,
                    platform=platform,
                    hashed_email=hashed_email,
                    hashed_phone_e164=hashed_phone_e164,
                    hashed_phone_digits=hashed_phone_digits,
                )
            except Exception as err:
                core.report(as_clikgate_error(err), ErrorContext("goal", [_shown(core, key, reference)], True))
                return
            try:
                if self._send_mode == "background":
                    self._sender.enqueue(wire)
                    return

                async def job() -> None:
                    try:
                        check_before_send(core, await core.guard_state(), wire)
                        _s, data, _h = await core.requester.request(send_request(wire, None))
                        core.note_refused_goal(key, data.get("reason") if isinstance(data, dict) else None)
                    except Exception as err:
                        error = as_clikgate_error(err)
                        core.note_refused_goal(key, error.code)
                        core.report(error, ErrorContext("goal", [_shown(core, key, reference)], True))

                self._sender.post(job)
            except RuntimeError:
                core.report(
                    local_error("no_running_loop", "AsyncClikgate.goal() needs a running event loop; use Clikgate in sync code."),
                    ErrorContext("goal", [_shown(core, key, reference)], True),
                )
        except Exception:
            pass

    def create_identity_token(self, customer_id: str, *, app_id: Optional[str] = None, issued_at: Optional[int] = None) -> str:
        """Create an identity token for the signed-in user (path A of
        https://clikgate.com/docs/identify-users). Uses ``identity_secret`` / ``identity_secrets`` from the options,
        else ``CLIKGATE_IDENTITY_SECRET`` / ``CLIKGATE_IDENTITY_SECRETS``. No network call (also on
        :class:`AsyncClikgate`, where it is a plain method). See :func:`clikgate.create_identity_token`.

        Example::

            return {"user": user, "clikgate_identity_token": clikgate.create_identity_token(str(user.id))}
        """
        return _create_identity_token(
            customer_id,
            app_id=app_id,
            secret=None,
            issued_at=issued_at,
            own_secret=self._identity_secret,
            own_secrets=self._identity_secrets,
        )

    async def identify_user(
        self,
        *,
        click_id: Optional[str] = None,
        app_id: Optional[str] = None,
        installation_id: Optional[str] = None,
        customer_id: Optional[str] = None,
        label: Optional[str] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> PersonIdentified:
        """Tell Clikgate who a person is (``POST /v1/people/identify``): a click, an app installation (``app_id`` +
        ``installation_id``) or your ``customer_id``, at least one. With a click or installation, ``customer_id``
        links it to that customer. ``label`` is what your team sees instead of the click ID (1-80 characters, ``""``
        clears it; Growth and up). Always verified (your server), so it also satisfies a referral program's
        ``require_identity_token``. In private mode ``customer_id`` is refused locally and ``label`` needs "Allow
        labels in private mode".

        Path B of https://clikgate.com/docs/identify-users (no identity secret or token): the app reads
        ``getInstallationId()`` and sends it in its sign-in request; your server calls this with ``app_id``,
        ``installation_id``, ``customer_id`` and optionally ``label``, after sign-in and at every signed-in app open.
        When the app sends no installation ID (tracking is off), skip the call. Clikgate accepts installations active
        in the last 7 days.

        Example::

            await clikgate.identify_user(click_id=order.click_id, customer_id="user_42", label="Ada (VIP)")
            if installation_id:
                await clikgate.identify_user(app_id="app_…", installation_id=installation_id, customer_id=str(user.id))
        """
        body = _identify_body(click_id, app_id, installation_id, customer_id, label)
        if (await self._core.guard_state()).guard:
            guard_payload("identify", body)
        _s, data, _h = await self._core.requester.request(
            ApiRequest("POST", "/v1/people/identify", body=body).with_options(request_options)
        )
        return data  # type: ignore[no-any-return]

    async def config(self) -> Optional[ServerSdkConfig]:
        """The organisation's server SDK config, cached for 10 minutes (``None`` when unavailable).

        Example::

            config = await clikgate.config()
        """
        return await self._core.config.get()

    async def flush(self, timeout: float = 10.0) -> bool:
        """Send everything queued (and wait for sends in flight). Never raises.

        Example::

            await clikgate.flush()
        """
        try:
            return await self._sender.flush(timeout)
        except Exception:
            return False

    async def close(self, timeout: float = 10.0) -> bool:
        """Flush, stop the sender task and release connections.

        Example::

            await clikgate.close()
        """
        if self._closed:
            return await self.flush(timeout)
        self._closed = True
        _clients.discard(self)
        done = await self.flush(timeout)
        self._sender.stop()
        if self._owns_http and done:
            with contextlib.suppress(Exception):
                await self._http.aclose()
        return done

    async def __aenter__(self) -> AsyncClikgate:
        return self

    async def __aexit__(self, *_exc: object) -> None:
        await self.close()

    def _at_exit(self) -> None:
        if self._sender.busy:
            self._core.logger.error(
                f"AsyncClikgate exited with {len(self._sender.logic)} queued goal event(s) not sent: "
                "await clikgate.close() before the event loop stops."
            )
