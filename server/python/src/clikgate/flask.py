"""Flask add-on: ``Clikgate(app)`` (SPEC section 17).

It sets ``g.clikgate_click_id`` before each request, keeps a click ID that arrives in the query string in
the first-party ``_cg_<param>`` cookie, and exposes the client as ``app.extensions["clikgate"].client``.

Example::

    from flask import Flask, g
    from clikgate.flask import Clikgate

    app = Flask(__name__)
    clikgate = Clikgate(app)              # reads CLIKGATE_API_KEY (or app.config["CLIKGATE_API_KEY"])

    @app.post("/applications")
    def create_application():
        save(click_id=g.clikgate_click_id)

    clikgate.client.goal("account_opened", click_id=application.click_id, reference=application.id)

Config keys: ``CLIKGATE_API_KEY``, ``CLIKGATE_PERSIST`` (default True), ``CLIKGATE_COOKIE_DAYS`` (30),
``CLIKGATE_COOKIE_DOMAIN``, and ``CLIKGATE_OPTIONS`` (a dict of other client options).
The ``/cg/keep`` route (the web script's ``data-server-endpoint="/cg/keep"``)::

    from clikgate.flask import keep_view
    app.add_url_rule("/cg/keep", "clikgate_keep", keep_view(), methods=["POST"])

Needs ``pip install "clikgate[flask]"``.
"""

from __future__ import annotations

from typing import Any, Callable, Optional

from ._addon import capture, helpers_for, warm_config
from ._click_ids import ClickIds, KeepRoute, click_ids
from ._client import Clikgate as _Client
from ._errors import ConfigurationError

__all__ = ["Clikgate", "keep_view"]


class Clikgate:
    """The Flask extension. ``Clikgate(app)``, or ``Clikgate()`` then ``init_app(app)`` for app factories.

    Example::

        ext = Clikgate()
        def create_app():
            app = Flask(__name__)
            ext.init_app(app)
            return app
    """

    def __init__(self, app: Any = None, *, client: Optional[_Client] = None) -> None:
        self._client = client
        if app is not None:
            self.init_app(app)

    @property
    def client(self) -> _Client:
        """The core client (create one and reuse it)."""
        if self._client is None:
            from flask import current_app

            cfg = current_app.config
            self._client = _Client(cfg.get("CLIKGATE_API_KEY"), **(cfg.get("CLIKGATE_OPTIONS") or {}))
        return self._client

    def _helpers(self) -> ClickIds:
        try:
            client = self.client
        except ConfigurationError:
            return helpers_for(None)
        warm_config(client)
        return helpers_for(client)

    def init_app(self, app: Any) -> None:
        """Register the request hooks on ``app``.

        Example::

            Clikgate().init_app(app)
        """
        from flask import g, request

        app.extensions["clikgate"] = self

        @app.before_request
        def _clikgate_before() -> None:
            click_id, from_query = capture(self._helpers(), request)
            g.clikgate_click_id = click_id
            g._clikgate_from_query = from_query

        @app.after_request
        def _clikgate_after(response: Any) -> Any:
            click_id = g.get("clikgate_click_id")
            if click_id and g.get("_clikgate_from_query") and app.config.get("CLIKGATE_PERSIST", True):
                self._helpers().persist(
                    response,
                    click_id,
                    days=app.config.get("CLIKGATE_COOKIE_DAYS", 30),
                    domain=app.config.get("CLIKGATE_COOKIE_DOMAIN"),
                    request=request,
                )
            return response


def keep_view(
    route: Optional[KeepRoute] = None, *, days: float = 30, secure: bool = True, domain: Optional[str] = None
) -> Callable[[], Any]:
    """The ``/cg/keep`` view (SPEC 13.1). Without ``route`` it uses the ``Clikgate(app)`` extension's click-ID
    parameter when there is one (else ``cgid``).

    Example::

        app.add_url_rule("/cg/keep", "clikgate_keep", keep_view(days=90), methods=["POST"])
    """
    fixed = route if route is not None else click_ids.keep_route(days=days, secure=secure, domain=domain)  # validates days

    def view() -> Any:
        from flask import Response, current_app, request

        r = fixed
        ext = current_app.extensions.get("clikgate")
        if route is None and isinstance(ext, Clikgate):
            r = ext._helpers().keep_route(days=days, secure=secure, domain=domain)
        body = request.stream.read(r.max_body + 1) if request.method.upper() == "POST" else b""
        out = r.handle_keep(request.method, request.headers, body)
        response = Response(b"", status=out.status, headers=out.headers)
        if out.status == 204:
            response.headers.pop("Content-Type", None)
        return response

    return view
