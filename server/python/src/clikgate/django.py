"""Django add-on: ``clikgate.django.ClikgateMiddleware`` (SPEC section 17).

Add it to ``MIDDLEWARE``; it sets ``request.clikgate_click_id`` (``None`` when there is none) and keeps a
click ID that arrives in the query string in the first-party ``_cg_<param>`` cookie (last click wins).

Settings (all optional)::

    CLIKGATE = {
        "api_key": env("CLIKGATE_API_KEY"),   # default: the CLIKGATE_API_KEY environment variable
        "persist": True,                      # write the cookie for ?cgid=… (default True)
        "cookie_days": 30,
        "cookie_domain": None,
        # any other Clikgate(...) option: "send_mode", "private_mode", "click_id_param", …
    }

Then, anywhere::

    from clikgate.django import get_client
    get_client().goal("account_opened", click_id=application.click_id, reference=application.reference)

The ``/cg/keep`` route (the web script's ``data-server-endpoint="/cg/keep"``)::

    # urls.py
    from clikgate.django import keep_view
    urlpatterns = [path("cg/keep", keep_view()), …]

Works with sync and async (ASGI) Django. Needs ``pip install "clikgate[django]"``.
"""

from __future__ import annotations

import contextlib
import inspect
import threading
from typing import Any, Callable, Dict, Optional

from ._addon import capture, helpers_for, warm_config
from ._click_ids import KeepRoute, click_ids
from ._client import Clikgate
from ._errors import ConfigurationError

__all__ = ["ClikgateMiddleware", "get_client", "keep_view"]

_ADDON_KEYS = ("persist", "cookie_days", "cookie_domain")
_client: Optional[Clikgate] = None
_lock = threading.Lock()


def _settings() -> Dict[str, Any]:
    from django.conf import settings

    value = getattr(settings, "CLIKGATE", None) or {}
    return dict(value)


def get_client() -> Clikgate:
    """The process-wide client, built once from ``settings.CLIKGATE`` (create one client and reuse it).

    Example::

        from clikgate.django import get_client
        get_client().goal("account_opened", click_id=app.click_id, reference=app.reference)
    """
    global _client
    with _lock:
        if _client is None:
            options = {k: v for k, v in _settings().items() if k not in _ADDON_KEYS}
            _client = Clikgate(**options)
        return _client


class ClikgateMiddleware:
    """Sets ``request.clikgate_click_id`` and persists a click ID from the query string.

    Example (``settings.py``)::

        MIDDLEWARE = [
            # …
            "clikgate.django.ClikgateMiddleware",
        ]
    """

    sync_capable = True
    async_capable = True

    def __init__(self, get_response: Callable[[Any], Any]) -> None:
        self.get_response = get_response
        settings = _settings()
        self.persist = settings.get("persist", True)
        self.days = settings.get("cookie_days", 30)
        self.domain = settings.get("cookie_domain")
        try:
            self.client: Optional[Clikgate] = get_client()
        except ConfigurationError:
            self.client = None  # no API key: still capture with the default parameter (cgid)
        self.helpers = helpers_for(self.client)
        self.is_async = inspect.iscoroutinefunction(get_response)
        if self.is_async:
            from asgiref.sync import markcoroutinefunction

            markcoroutinefunction(self)

    def _before(self, request: Any) -> tuple[Optional[str], bool]:
        warm_config(self.client)
        click_id, from_query = capture(self.helpers, request)
        request.clikgate_click_id = click_id
        return click_id, from_query

    def _after(self, request: Any, response: Any, click_id: Optional[str], from_query: bool) -> Any:
        if click_id and from_query and self.persist:
            self.helpers.persist(response, click_id, days=self.days, domain=self.domain, request=request)
        return response

    def __call__(self, request: Any) -> Any:
        if self.is_async:
            return self.__acall__(request)
        click_id, from_query = self._before(request)
        return self._after(request, self.get_response(request), click_id, from_query)

    async def __acall__(self, request: Any) -> Any:
        click_id, from_query = self._before(request)
        response = await self.get_response(request)
        return self._after(request, response, click_id, from_query)


def keep_view(
    route: Optional[KeepRoute] = None, *, days: float = 30, secure: bool = True, domain: Optional[str] = None
) -> Callable[[Any], Any]:
    """The ``/cg/keep`` view (SPEC 13.1). It is CSRF-exempt on purpose: the route checks that the request comes from
    your own site (``Sec-Fetch-Site``, else ``Origin`` against ``Host``) and only sets the click-ID cookie.

    Without ``route`` it uses the ``settings.CLIKGATE`` client's click-ID parameter (else ``cgid``).

    Example::

        # urls.py
        from clikgate.django import keep_view
        urlpatterns = [path("cg/keep", keep_view(days=90))]
    """
    fixed = route if route is not None else click_ids.keep_route(days=days, secure=secure, domain=domain)  # validates days

    def current() -> KeepRoute:
        if route is not None:
            return route
        try:
            helpers = get_client().click_ids
        except ConfigurationError:
            return fixed
        return helpers.keep_route(days=days, secure=secure, domain=domain)

    def view(request: Any) -> Any:
        from django.http import HttpResponse

        r = current()
        body = b""
        if str(request.method).upper() == "POST":
            try:
                body = request.read(r.max_body + 1)
            except Exception:  # the body was already read (RawPostDataException): use it
                body = request.body
        out = r.handle_keep(request.method, request.headers, body)
        response = HttpResponse(status=out.status)
        for name, value in out.headers:
            if name == "Set-Cookie":
                cookie_name, _, rest = value.partition("=")
                response.set_cookie(
                    cookie_name,
                    rest.split(";", 1)[0],
                    max_age=round(r.days * 86400),
                    path="/",
                    domain=r.domain or None,
                    secure=r.secure,
                    httponly=False,
                    samesite="Lax",
                )
            else:
                response[name] = value
        if out.status == 204:
            with contextlib.suppress(KeyError):
                del response["Content-Type"]
        return response

    view.csrf_exempt = True  # type: ignore[attr-defined]
    return view
