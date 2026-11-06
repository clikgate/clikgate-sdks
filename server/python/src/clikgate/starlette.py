"""Starlette / FastAPI add-on (SPEC section 17): ``app.add_middleware(ClikgateMiddleware)`` and ``Depends(click_id)``.

A pure ASGI middleware: it stores the click ID in ``request.state.clikgate_click_id`` and adds the
first-party ``_cg_<param>`` cookie to the response when the ID came in the query string.

Example (FastAPI)::

    from fastapi import Depends, FastAPI
    from clikgate import AsyncClikgate
    from clikgate.fastapi import ClikgateMiddleware, click_id

    clikgate = AsyncClikgate()
    app = FastAPI()
    app.add_middleware(ClikgateMiddleware, client=clikgate)

    @app.post("/applications")
    async def create_application(cid: str | None = Depends(click_id)):
        ...

The ``/cg/keep`` route (change 16; the web script's ``data-server-endpoint="/cg/keep"``)::

    from clikgate.fastapi import keep_endpoint
    app.add_api_route("/cg/keep", keep_endpoint(client=clikgate), methods=["POST"])
    # Starlette: Route("/cg/keep", keep_endpoint(client=clikgate), methods=["POST"])

Needs ``pip install "clikgate[fastapi]"`` (or ``[starlette]``).
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable, List, MutableMapping, Optional

from starlette.requests import Request
from starlette.responses import Response

from ._addon import capture, helpers_for, warm_config
from ._click_ids import KeepRoute, kept_marker_header

__all__ = ["ClikgateMiddleware", "click_id", "keep_endpoint"]

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]
_STATE_KEY = "clikgate_click_id"


class ClikgateMiddleware:
    """Pure ASGI middleware. Options: ``client`` (``Clikgate`` or ``AsyncClikgate``; without it the parameter is
    ``cgid``), ``persist`` (default True), ``days`` (30) and ``domain``.

    Example::

        app.add_middleware(ClikgateMiddleware, client=clikgate, days=30)
    """

    def __init__(self, app: ASGIApp, client: Any = None, *, persist: bool = True, days: float = 30, domain: Optional[str] = None) -> None:
        self.app = app
        self.client = client
        self.helpers = helpers_for(client)
        self.persist = persist
        self.days = days
        self.domain = domain

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        warm_config(self.client)
        cid, from_query = capture(self.helpers, scope)
        scope.setdefault("state", {})[_STATE_KEY] = cid
        if not (cid and from_query and self.persist):
            await self.app(scope, receive, send)
            return
        secure = _scope_secure(scope)
        cookie = self.helpers.cookie_header(cid, days=self.days, secure=secure, domain=self.domain).encode("latin-1")
        marker = kept_marker_header(days=self.days, secure=secure, domain=self.domain).encode("latin-1")  # change 16

        async def send_with_cookie(message: Message) -> None:
            if message.get("type") == "http.response.start":
                message["headers"] = [*list(message.get("headers") or []), (b"set-cookie", cookie), (b"set-cookie", marker)]
            await send(message)

        await self.app(scope, receive, send_with_cookie)


def _scope_secure(scope: Scope) -> bool:
    for k, v in scope.get("headers") or []:
        if k.lower() == b"x-forwarded-proto":
            return bool(v.decode("latin-1").split(",")[0].strip().lower() == "https")
    scheme = scope.get("scheme")
    return scheme != "http" if isinstance(scheme, str) else True


def click_id(request: Request) -> Optional[str]:
    """FastAPI dependency: the click ID the middleware found (or, without the middleware, from the request).

    Example::

        @app.get("/")
        async def home(cid: Optional[str] = Depends(click_id)): ...
    """
    state = request.scope.get("state") or {}
    if _STATE_KEY in state:
        value = state[_STATE_KEY]
        return value if isinstance(value, str) else None
    return helpers_for(None).from_request(request)


def keep_endpoint(
    route: Optional[KeepRoute] = None, *, client: Any = None, days: float = 30, secure: bool = True, domain: Optional[str] = None
) -> Callable[[Request], Awaitable[Response]]:
    """The ``/cg/keep`` endpoint (SPEC 13.1) for Starlette and FastAPI. ``client`` (``Clikgate`` or ``AsyncClikgate``)
    gives the click-ID parameter; without it, ``cgid``.

    Example::

        app.add_api_route("/cg/keep", keep_endpoint(client=clikgate, days=90), methods=["POST"])
    """
    r = route if route is not None else helpers_for(client).keep_route(days=days, secure=secure, domain=domain)

    async def endpoint(request: Request) -> Response:
        body = b""
        if request.method.upper() == "POST":
            chunks: List[bytes] = []
            size = 0
            async for chunk in request.stream():
                chunks.append(chunk)
                size += len(chunk)
                if size > r.max_body:
                    break
            body = b"".join(chunks)
        out = r.handle_keep(request.method, request.headers, body)
        response = Response(status_code=out.status)
        for name, value in out.headers:
            response.headers.append(name, value)
        return response

    return endpoint
