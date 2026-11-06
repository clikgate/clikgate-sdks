"""Click IDs (SPEC section 13): read them from requests, keep them in the web script's first-party cookie,
and find them in payment providers' payloads."""

from __future__ import annotations

import json
import re
from typing import Any, Callable, List, Mapping, NamedTuple, Optional, Tuple, TypedDict, Union
from urllib.parse import parse_qsl, unquote, urlsplit

from ._errors import local_error

__all__ = [
    "BROWSER_ENGINES",
    "CLICK_ID_HEADER",
    "CLICK_ID_PATTERN",
    "KEPT_BY",
    "KEPT_COOKIE",
    "PLATFORMS",
    "ClickContext",
    "ClickIds",
    "KeepResponse",
    "KeepRoute",
    "click_ids",
    "is_valid",
]

#: A prefixed ULID: ``clk_`` + 26 uppercase Crockford characters.
CLICK_ID_PATTERN = re.compile(r"clk_[0-9A-Z]{26}")
#: The header a caller (your mobile app or BFF) can use to pass the click ID.
CLICK_ID_HEADER = "Clikgate-Click-Id"
_DEFAULT_PARAM = "cgid"
_PAYMENT_KEYS = ("cg_click_id", "cgid", "clikgate_click_id")
_CONTAINERS = ("metadata", "meta", "meta_data", "note_attributes", "attributes", "custom_attributes", "customAttributes")
#: ``kept_by`` values (SPEC 9.1, change 16): how the click ID was kept.
KEPT_BY = ("server_cookie", "script_cookie", "form", "payment_metadata", "unknown")
#: ``browser_engine`` values (SPEC 9.1, change 16).
BROWSER_ENGINES = ("webkit_ios", "safari_mac", "chromium", "gecko", "other")
#: ``platform`` values (SPEC 9.1, change 16).
PLATFORMS = ("ios", "android", "macos", "windows", "linux", "other")
#: The marker cookie that says your server kept the click ID (the web script reports ``kept_by: server_cookie``).
KEPT_COOKIE = "_cg_kept"
_KEPT_VALUE = "s"
_KEEP_MAX_BODY = 1024
_NO_STORE = ("Cache-Control", "no-store, private")
_IOS = re.compile(r"iPhone|iPad|iPod")
_CHROMIUM = re.compile(r"Chrome/|Chromium/|Edg/|OPR/|SamsungBrowser/")


class ClickContext(TypedDict):
    """What ``click_ids.context(request)`` returns; its keys are goal options, so pass it as ``**context``."""

    click_id: Optional[str]
    kept_by: Optional[str]
    browser_engine: str
    platform: str


class KeepResponse(NamedTuple):
    """A ``/cg/keep`` answer: the status and the headers to send. The body is always empty."""

    status: int
    headers: List[Tuple[str, str]]
    body: bytes = b""


def browser_engine_of(user_agent: Optional[str]) -> str:
    """The ``browser_engine`` for a User-Agent (SPEC 13.1, checked in order)."""
    ua = user_agent or ""
    if _IOS.search(ua):
        return "webkit_ios"
    if "Firefox/" in ua:
        return "gecko"
    if _CHROMIUM.search(ua):
        return "chromium"
    if "Macintosh" in ua and "Safari/" in ua and "Version/" in ua:
        return "safari_mac"
    return "other"


def platform_of(user_agent: Optional[str]) -> str:
    """The ``platform`` for a User-Agent (SPEC 13.1, checked in order)."""
    ua = user_agent or ""
    if _IOS.search(ua):
        return "ios"
    if "Android" in ua:
        return "android"
    if "Macintosh" in ua or "Mac OS X" in ua:
        return "macos"
    if "Windows" in ua:
        return "windows"
    if "Linux" in ua or "X11" in ua:
        return "linux"
    return "other"


def kept_marker_header(*, days: float = 30, secure: Optional[bool] = None, domain: Optional[str] = None) -> str:
    """``_cg_kept=s`` with the click-ID cookie's attributes."""
    parts = [f"{KEPT_COOKIE}={_KEPT_VALUE}", "Path=/", f"Max-Age={round(days * 86400)}"]
    if domain:
        parts.append(f"Domain={domain}")
    parts.append("SameSite=Lax")
    if secure is None or secure:
        parts.append("Secure")
    return "; ".join(parts)


def is_valid(click_id: Any) -> bool:
    """True when ``click_id`` is a Clikgate click ID (``clk_`` + 26 characters).

    Example::

        is_valid("clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6")  # True
    """
    return isinstance(click_id, str) and CLICK_ID_PATTERN.fullmatch(click_id) is not None


# -- request adapters (no framework imports) -------------------------------------------------------


def _header_getter(headers: Any) -> Callable[[str], Optional[str]]:
    if headers is None:
        return lambda _n: None
    if isinstance(headers, Mapping) and not hasattr(headers, "getlist") and not hasattr(headers, "get_all"):
        items = list(headers.items())

        def from_mapping(name: str) -> Optional[str]:
            values: List[str] = []
            for k, v in items:
                if str(k).lower() == name.lower():
                    values.extend(str(x) for x in v) if isinstance(v, (list, tuple)) else values.append(str(v))
            if not values:
                return None
            return ("; " if name.lower() == "cookie" else ", ").join(values)

        return from_mapping
    if isinstance(headers, (list, tuple)):  # ASGI-style [(b"name", b"value")] or [("name", "value")]
        pairs = [(_text(k), _text(v)) for k, v in headers]
        return _header_getter({k: [v for kk, v in pairs if kk.lower() == k.lower()] for k, _ in pairs})
    get = getattr(headers, "get", None)
    if callable(get):
        return lambda n: _opt_text(get(n))
    return lambda _n: None


def _text(v: Any) -> str:
    return v.decode("latin-1") if isinstance(v, (bytes, bytearray)) else str(v)


def _opt_text(v: Any) -> Optional[str]:
    return None if v is None else _text(v)


def _request_parts(request: Any) -> Tuple[Optional[str], Callable[[str], Optional[str]]]:
    """(the URL or query string, a header getter) for Django, Flask/Werkzeug, Starlette, WSGI environ, ASGI scope or ``{url, headers}``."""
    if isinstance(request, Mapping):
        if "wsgi.version" in request or "QUERY_STRING" in request or "REQUEST_METHOD" in request:
            env = request

            def from_environ(name: str) -> Optional[str]:
                v = env.get("HTTP_" + name.upper().replace("-", "_"))
                return None if v is None else str(v)

            return "?" + str(env.get("QUERY_STRING", "")), from_environ
        if request.get("type") in ("http", "websocket") and "query_string" in request:
            return "?" + _text(request.get("query_string") or b""), _header_getter(list(request.get("headers") or []))
        raw_url = request.get("url")
        return (None if raw_url is None else str(raw_url)), _header_getter(request.get("headers"))
    url: Optional[str] = None
    get_full_path = getattr(request, "get_full_path", None)  # Django
    if callable(get_full_path):
        url = str(get_full_path())
    elif isinstance(getattr(request, "full_path", None), str):  # Werkzeug / Flask
        url = request.full_path
    elif getattr(request, "url", None) is not None:  # Starlette, requests-like objects
        url = str(request.url)
    headers = getattr(request, "headers", None)
    if headers is None and isinstance(getattr(request, "META", None), Mapping):
        return url, _request_parts(request.META)[1]
    return url, _header_getter(headers)


def _query_values(url: Optional[str], name: str) -> List[str]:
    if not url:
        return []
    query = urlsplit(url).query if "?" in url or "://" in url else ""
    return [v for k, v in parse_qsl(query, keep_blank_values=True) if k == name]


def _cookie_values(cookie_header: Optional[str], name: str) -> List[str]:
    if not cookie_header:
        return []
    out = []
    for part in cookie_header.split(";"):
        if "=" not in part:
            continue
        k, v = part.split("=", 1)
        if k.strip() != name:
            continue
        v = v.strip()
        if len(v) >= 2 and v.startswith('"') and v.endswith('"'):
            v = v[1:-1]
        out.append(unquote(v))
    return out


# -- payment payloads -------------------------------------------------------------------------------


def _parse_json(s: str) -> Any:
    try:
        return json.loads(s)
    except ValueError:
        return None


def _as_map(container: Any) -> Optional[Mapping[str, Any]]:
    c = _parse_json(container) if isinstance(container, str) else container
    if isinstance(c, list):
        m = {}
        for item in c:
            if not isinstance(item, Mapping):
                continue
            k = next((item[n] for n in ("name", "key", "variable_name", "display_name") if item.get(n) is not None), None)
            if isinstance(k, str):
                m[k] = item.get("value")
        return m
    return c if isinstance(c, Mapping) else None


def _pick(m: Optional[Mapping[str, Any]], depth: int = 0) -> Optional[str]:
    if m is None:
        return None
    for k in _PAYMENT_KEYS:
        v = m.get(k)
        if is_valid(v):
            return str(v)
    if depth == 0 and isinstance(m.get("custom_fields"), list):
        return _pick(_as_map(m["custom_fields"]), 1)
    return None


class ClickIds:
    """Click-ID helpers bound to a ``click_id_param`` (``cgid`` unless configured)."""

    def __init__(self, param: Callable[[], str]) -> None:
        self._param = param

    @property
    def param_name(self) -> str:
        """The query parameter in use."""
        return self._param()

    @property
    def cookie_name(self) -> str:
        """``_cg_<param>``: the same first-party cookie the web script writes."""
        return f"_cg_{self._param()}"

    @staticmethod
    def is_valid(click_id: Any) -> bool:
        """True when ``click_id`` is a Clikgate click ID.

        Example::

            clikgate.click_ids.is_valid("clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6")  # True
        """
        return is_valid(click_id)

    def from_request(self, request: Any) -> Optional[str]:
        """Read the click ID: the query parameter, then the ``_cg_<param>`` cookie, then the ``Clikgate-Click-Id`` header.

        Accepts Django, Flask/Werkzeug and Starlette requests, a WSGI environ, an ASGI scope, or ``{"url": …, "headers": {…}}``.
        Only valid IDs are returned.

        Example::

            click_id = clikgate.click_ids.from_request(request)   # save it with the application
        """
        found = self._locate(request)
        return found[0] if found else None

    def _locate(self, request: Any) -> Optional[Tuple[str, str]]:
        """(the click ID, where it was found: ``query`` | ``cookie`` | ``header``)."""
        if request is None:
            return None
        url, header = _request_parts(request)
        for v in _query_values(url, self._param()):
            if is_valid(v):
                return v, "query"
        for v in _cookie_values(header("cookie"), self.cookie_name):
            if is_valid(v):
                return v, "cookie"
        h = header(CLICK_ID_HEADER)
        h = h.strip() if h is not None else None
        return (h, "header") if h is not None and is_valid(h) else None

    def context(self, request: Any) -> ClickContext:
        """The visitor context to send with a goal (SPEC 13.1): the click ID, how it was kept, and the browser engine
        and platform worked out from the ``User-Agent`` here in the SDK (the User-Agent itself is never sent).

        ``kept_by`` is ``server_cookie`` when the ID came from the cookie with the ``_cg_kept=s`` marker (your server set
        it: :meth:`keep_route`, :meth:`persist`), ``script_cookie`` for the cookie without it, ``form`` for the
        ``Clikgate-Click-Id`` header, and ``None`` when it came from the URL or there is none.

        Example::

            clikgate.goal("account_opened", reference=application.id, **clikgate.click_ids.context(request))
        """
        found = self._locate(request)
        header = _request_parts(request)[1] if request is not None else (lambda _n: None)
        kept_by: Optional[str] = None
        if found is not None and found[1] == "cookie":
            kept_by = "server_cookie" if _KEPT_VALUE in _cookie_values(header("cookie"), KEPT_COOKIE) else "script_cookie"
        elif found is not None and found[1] == "header":
            kept_by = "form"
        ua = header("user-agent")
        return {
            "click_id": found[0] if found else None,
            "kept_by": kept_by,
            "browser_engine": browser_engine_of(ua),
            "platform": platform_of(ua),
        }

    def keep_route(self, *, days: float = 30, secure: bool = True, domain: Optional[str] = None) -> KeepRoute:
        """The ``/cg/keep`` handler (SPEC 13.1) for the web script's ``data-server-endpoint="/cg/keep"``.

        Safari, and every browser on iPhone, keeps a click ID saved by a script for up to 7 days (sometimes less); a
        cookie your server sets lasts as long as you choose, up to the browser's limit. Serve it from the same host as
        your website. Only same-origin ``POST`` requests with a valid click ID matching the page URL's are accepted;
        every answer is ``no-store`` with an empty body. ``secure`` defaults to True here.

        Returns a :class:`KeepRoute`: ``handle_keep(method, headers, body)`` (framework-neutral), plus
        ``django_view``, ``flask_view`` and ``starlette_endpoint`` (also for FastAPI).

        Raises:
            InvalidRequestError: ``invalid_argument`` when ``days`` is not 1-400.

        Example::

            # urls.py
            path("cg/keep", clikgate.click_ids.keep_route().django_view)
        """
        return KeepRoute(self, days=days, secure=secure, domain=domain)

    def from_query(self, request: Any) -> Optional[str]:
        """The first valid click ID in the query string only (used by the add-ons to decide whether to persist)."""
        url, _h = _request_parts(request)
        return next((v for v in _query_values(url, self._param()) if is_valid(v)), None)

    def cookie_header(self, click_id: str, *, days: float = 30, secure: Optional[bool] = None, domain: Optional[str] = None) -> str:
        """The ``Set-Cookie`` value that keeps the click ID: ``SameSite=Lax``, ``Secure`` on HTTPS, not ``HttpOnly``
        (the web script reads it).

        Example::

            clikgate.click_ids.cookie_header(click_id)
            # '_cg_cgid=clk_…; Path=/; Max-Age=2592000; SameSite=Lax; Secure'
        """
        if not is_valid(click_id):
            raise local_error("invalid_click_id", "That is not a Clikgate click ID (clk_ + 26 characters).", "click_id")
        parts = [f"{self.cookie_name}={click_id}", "Path=/", f"Max-Age={round(days * 86400)}"]
        if domain:
            parts.append(f"Domain={domain}")
        parts.append("SameSite=Lax")
        if secure is None or secure:
            parts.append("Secure")
        return "; ".join(parts)

    def persist(
        self,
        response: Any,
        click_id: str,
        *,
        days: float = 30,
        secure: Optional[bool] = None,
        domain: Optional[str] = None,
        request: Any = None,
    ) -> None:
        """Add the click-ID cookie to a response, keeping any ``Set-Cookie`` headers already there.

        ``secure`` defaults to whether ``request`` was HTTPS (``X-Forwarded-Proto`` included), and to True when unknown.
        Works with Flask/Werkzeug, Starlette and Django responses, a list of ``(name, value)`` header pairs,
        or any object with ``headers.add`` / ``headers.append``.

        Example::

            click_id = clikgate.click_ids.from_request(request)
            if click_id:
                clikgate.click_ids.persist(response, click_id, request=request)
        """
        if secure is None:
            secure = _infer_secure(request)
        value = self.cookie_header(click_id, days=days, secure=secure, domain=domain)
        append_set_cookie(response, value, self.cookie_name, click_id, days, secure, domain)
        marker = kept_marker_header(days=days, secure=secure, domain=domain)
        append_set_cookie(response, marker, KEPT_COOKIE, _KEPT_VALUE, days, secure, domain)

    def from_payment_metadata(self, payload: Any) -> Optional[str]:
        """Find the click ID in a payment provider's payload: Paystack ``metadata`` (and ``custom_fields``),
        Flutterwave ``meta``, Shopify note or cart attributes, WooCommerce order meta, or your own webhook.

        Example::

            click_id = clikgate.click_ids.from_payment_metadata(request.json)   # a Paystack charge.success event
        """
        p = _parse_json(payload) if isinstance(payload, str) else payload
        if not isinstance(p, Mapping):
            return None
        candidates: List[Mapping[str, Any]] = [p]
        if isinstance(p.get("data"), Mapping):
            candidates.append(p["data"])
        for c in candidates:
            own = _pick(c)
            if own:
                return own
            for name in _CONTAINERS:
                if c.get(name) is None:
                    continue
                found = _pick(_as_map(c[name]))
                if found:
                    return found
        return None


def _infer_secure(request: Any) -> bool:
    if request is None:
        return True
    _url, header = _request_parts(request)
    proto = header("x-forwarded-proto")
    if proto:
        return proto.split(",")[0].strip().lower() == "https"
    is_secure = getattr(request, "is_secure", None)
    if callable(is_secure):  # Django, Werkzeug
        return bool(is_secure())
    if isinstance(is_secure, bool):
        return is_secure
    scheme = getattr(getattr(request, "url", None), "scheme", None) or getattr(request, "scheme", None)
    if isinstance(scheme, str):
        return scheme == "https"
    return True


def append_set_cookie(response: Any, value: str, name: str, cookie_value: str, days: float, secure: bool, domain: Optional[str]) -> None:
    """Append a Set-Cookie header to any supported response type, keeping existing ones."""
    if isinstance(response, list):
        response.append(("Set-Cookie", value))
        return
    headers = getattr(response, "headers", None)
    # Django's HttpResponse can't hold two Set-Cookie headers; it renders response.cookies
    if (
        hasattr(response, "set_cookie")
        and hasattr(response, "cookies")
        and not hasattr(headers, "add")
        and not hasattr(response, "raw_headers")
    ):
        response.set_cookie(
            name, cookie_value, max_age=round(days * 86400), path="/", domain=domain or None, secure=secure, httponly=False, samesite="Lax"
        )
        return
    raw = getattr(response, "raw_headers", None)  # Starlette
    if isinstance(raw, list) and headers is not None and hasattr(headers, "append"):
        headers.append("set-cookie", value)
        return
    for method in ("add", "append", "add_header"):  # Werkzeug Headers.add, MutableHeaders.append, …
        fn = getattr(headers, method, None)
        if callable(fn):
            fn("Set-Cookie", value)
            return
    raise local_error(
        "invalid_argument", "persist() needs a Flask/Werkzeug, Starlette or Django response, or a list of header pairs.", "response"
    )


# -- /cg/keep (SPEC 13.1) ---------------------------------------------------------------------------


def _expected_host(header: Callable[[str], Optional[str]]) -> Optional[str]:
    forwarded = header("x-forwarded-host")
    if forwarded and forwarded.split(",")[0].strip():
        return forwarded.split(",")[0].strip()
    host = header("host")
    return host.strip() if host and host.strip() else None


def _same_origin(header: Callable[[str], Optional[str]]) -> bool:
    site = header("sec-fetch-site")
    if site is not None:
        return site.strip().lower() == "same-origin"
    origin = (header("origin") or "").strip().lower()
    host = (_expected_host(header) or "").lower()
    if not origin or not host:
        return False
    return origin in (f"https://{host}", f"http://{host}")


class KeepRoute:
    """The ``/cg/keep`` route (SPEC 13.1). Every adapter calls :meth:`handle_keep`. Never logs or echoes the input."""

    #: Request bodies above this many bytes are refused (400).
    max_body = _KEEP_MAX_BODY

    def __init__(self, helpers: ClickIds, *, days: float = 30, secure: bool = True, domain: Optional[str] = None) -> None:
        if isinstance(days, bool) or not isinstance(days, (int, float)) or not 1 <= days <= 400:  # NaN fails too
            raise local_error("invalid_argument", "days must be between 1 and 400 (browsers keep a cookie for at most 400 days).", "days")
        self._helpers = helpers
        self.days = days
        self.secure = secure
        self.domain = domain

    def handle_keep(self, method: str, headers: Any, body: Union[bytes, bytearray, str, None]) -> KeepResponse:
        """The framework-neutral core: ``headers`` is any mapping (names in any case), a list of pairs or an object
        with ``get``; ``body`` the raw request body (read at most ``max_body + 1`` bytes of it). The query string is
        never read.

        Example::

            res = route.handle_keep("POST", {"Host": "shop.example.com", "Sec-Fetch-Site": "same-origin"}, raw_body)
            # res.status == 204, res.headers == [("Cache-Control", "no-store, private"), ("Set-Cookie", …), …]
        """
        if str(method).upper() != "POST":
            return KeepResponse(405, [_NO_STORE, ("Allow", "POST")])
        refused = KeepResponse(400, [_NO_STORE])
        if not _same_origin(_header_getter(headers)):
            return KeepResponse(403, [_NO_STORE])
        raw = body.encode("utf-8") if isinstance(body, str) else bytes(body or b"")
        if not raw or len(raw) > _KEEP_MAX_BODY:
            return refused
        try:
            data = json.loads(raw.decode("utf-8"))
        except ValueError:  # includes UnicodeDecodeError
            return refused
        if not isinstance(data, dict):
            return refused
        click_id, page_click_id = data.get("click_id"), data.get("page_click_id")
        if not isinstance(click_id, str) or not is_valid(click_id) or not is_valid(page_click_id) or click_id != page_click_id:
            return refused
        cookie = self._helpers.cookie_header(click_id, days=self.days, secure=self.secure, domain=self.domain)
        marker = kept_marker_header(days=self.days, secure=self.secure, domain=self.domain)
        return KeepResponse(204, [_NO_STORE, ("Set-Cookie", cookie), ("Set-Cookie", marker)])

    @property
    def django_view(self) -> Callable[[Any], Any]:
        """A Django view (CSRF-exempt: the same-origin check replaces the token). ``path("cg/keep", route.django_view)``."""
        from .django import keep_view

        return keep_view(self)

    @property
    def flask_view(self) -> Callable[[], Any]:
        """A Flask view: ``app.add_url_rule("/cg/keep", "clikgate_keep", route.flask_view, methods=["POST"])``."""
        from .flask import keep_view

        return keep_view(self)

    @property
    def starlette_endpoint(self) -> Callable[[Any], Any]:
        """A Starlette / FastAPI endpoint: ``app.add_api_route("/cg/keep", route.starlette_endpoint, methods=["POST"])``."""
        from .starlette import keep_endpoint

        return keep_endpoint(self)


#: Click-ID helpers with the default parameter (``cgid``), usable without a client.
click_ids = ClickIds(lambda: _DEFAULT_PARAM)
