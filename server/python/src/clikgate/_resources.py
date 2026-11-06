"""Conversions, links and clicks (SPEC sections 10 and 11), sync and async."""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, Iterator, Mapping, Optional, Union, cast

from ._ads_hashing import check_hashed_fields
from ._core import AsyncCore, Core
from ._guard import guard_payload
from ._http import ApiRequest, RawResponse, RequestOptions, encode_path_segment, require_id
from ._money import format_value
from ._types import Click, Conversion, GoalEvent, Link, LinkChangeRequest, LinkPage, LinkUpdateResult, QrCode

__all__ = ["AsyncClicks", "AsyncConversions", "AsyncLinks", "Clicks", "Conversions", "Links"]


def _with_value(params: Mapping[str, Any]) -> Dict[str, Any]:
    out = dict(params)
    if out.get("value") is not None:
        out["value"] = format_value(out["value"])
    return out


def _link_path(link_id: str, suffix: str = "") -> str:
    return f"/v1/links/{encode_path_segment(require_id(link_id))}{suffix}"


def _update_result(status: int, data: Any) -> LinkUpdateResult:
    if status == 202:
        return {"applied": False, "link": None, "change_request": cast(LinkChangeRequest, data), "warnings": []}
    link = cast(Link, data)
    warnings = link.get("warnings") if isinstance(link, dict) else None
    return {"applied": True, "link": link, "change_request": None, "warnings": list(warnings) if isinstance(warnings, list) else []}


def _qr_request(link_id: str, query: Mapping[str, Any], options: Optional[RequestOptions]) -> ApiRequest:
    return ApiRequest("GET", _link_path(link_id, "/qr"), query=query, raw=True).with_options(options)


def _qr(res: RawResponse) -> QrCode:
    return QrCode(content_type=res.headers.get("content-type", "application/octet-stream"), data=res.body)


class Conversions:
    """Conversions: the older API. New integrations should use goals."""

    def __init__(self, core: Core) -> None:
        self._core = core

    def create(self, *, request_options: Optional[RequestOptions] = None, **params: Any) -> Union[Conversion, GoalEvent]:
        """Report a conversion (``POST /v1/conversions``). ``params`` use the API's field names.

        In private mode only ``external_id``, ``goal``, ``click_id``, ``code``, ``reference``, ``value``,
        ``currency``, ``provider``, ``is_first``, ``occurred_at``, ``consent``, ``kept_by``, ``browser_engine``,
        ``platform`` and the hashed identifiers ``hashed_email``, ``hashed_phone_e164``, ``hashed_phone_digits``
        (64 lowercase hex; :func:`clikgate.hash_for_ads`) are allowed; a malformed hash is a local
        ``invalid_hashed_identifier``. With ``goal`` set to a Payment goal
        this is a trusted payment confirmation: send ``provider`` and the payment reference (``external_id``); the
        answer is then the goal event (``object == "goal_event"``) instead of a conversion.

        Example::

            clikgate.conversions.create(external_id="ORD-1001", click_id=click_id, goal="order_paid", value="1500.50", currency="NGN")
        """
        body = _with_value(params)
        check_hashed_fields(body)
        if self._core.guard_state().guard:
            guard_payload("conversion", body)
        _s, data, _h = self._core.requester.request(ApiRequest("POST", "/v1/conversions", body=body).with_options(request_options))
        return cast(Union[Conversion, GoalEvent], data)

    def reverse(self, conversion_id: str, *, request_options: Optional[RequestOptions] = None, **params: Any) -> Conversion:
        """Reverse a conversion, fully or partly (``amount_minor``).

        Example::

            clikgate.conversions.reverse("cnv_01J…", amount_minor=200000)
        """
        path = f"/v1/conversions/{encode_path_segment(require_id(conversion_id))}/reverse"
        body = _with_value(params)
        if self._core.guard_state().guard:
            guard_payload("reversal", body)
        _s, data, _h = self._core.requester.request(ApiRequest("POST", path, body=body).with_options(request_options))
        return cast(Conversion, data)


class Links:
    """Links: create, read, update (with approvals and locks), list and QR codes."""

    def __init__(self, core: Core) -> None:
        self._core = core

    def create(self, *, request_options: Optional[RequestOptions] = None, **params: Any) -> Link:
        """Create a link. Its ``warnings`` include ``no_preview`` when there is no preview title and image.

        Example::

            link = clikgate.links.create(destination_url="https://example.com/spring", og_title="Spring sale")
            print(link["short_url"], link.get("warnings"))
        """
        _s, data, _h = self._core.requester.request(ApiRequest("POST", "/v1/links", body=params).with_options(request_options))
        return cast(Link, data)

    def get(self, link_id: str, *, request_options: Optional[RequestOptions] = None) -> Link:
        """Fetch a link by ID.

        Example::

            link = clikgate.links.get("lnk_01J…")
        """
        _s, data, _h = self._core.requester.request(ApiRequest("GET", _link_path(link_id)).with_options(request_options))
        return cast(Link, data)

    def update(self, link_id: str, *, request_options: Optional[RequestOptions] = None, **params: Any) -> LinkUpdateResult:
        """Update a link. ``None`` clears a field.

        With two-person approval on, a destination change answers ``202``: the result is
        ``{"applied": False, "change_request": {…}}``. A locked link raises :class:`LinkLockedError`.

        Example::

            result = clikgate.links.update("lnk_01J…", destination_url="https://example.com/summer")
            if not result["applied"]:
                print("waiting for approval:", result["change_request"]["id"])
        """
        status, data, _h = self._core.requester.request(ApiRequest("PATCH", _link_path(link_id), body=params).with_options(request_options))
        return _update_result(status, data)

    def list_page(self, *, request_options: Optional[RequestOptions] = None, **params: Any) -> LinkPage:
        """Fetch one page of links (``limit`` 1-100, ``starting_after``, ``ending_before``, ``status``, ``tag``, …).

        Example::

            page = clikgate.links.list_page(limit=100, tag="promo")
        """
        _s, data, _h = self._core.requester.request(ApiRequest("GET", "/v1/links", query=params).with_options(request_options))
        return cast(LinkPage, data)

    def list(self, *, request_options: Optional[RequestOptions] = None, **params: Any) -> Iterator[Link]:
        """Iterate over every link, fetching pages lazily.

        Example::

            for link in clikgate.links.list(status="active", limit=100):
                print(link["short_url"])
        """
        cursor: Optional[str] = None
        while True:
            page = self.list_page(request_options=request_options, **({**params, "starting_after": cursor} if cursor else params))
            yield from page.get("data") or []
            if not page.get("has_more") or not page.get("next_cursor"):
                return
            cursor = page["next_cursor"]

    def qr(
        self,
        link_id: str,
        *,
        format: Optional[str] = None,
        size: Optional[int] = None,
        margin: Optional[int] = None,
        dark: Optional[str] = None,
        light: Optional[str] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> QrCode:
        """Download the link's QR code (``format`` ``svg`` or ``png``; ``size`` 256-2048).

        Example::

            qr = clikgate.links.qr("lnk_01J…", format="png", size=1024)
            Path("qr.png").write_bytes(qr.data)
        """
        query = {"format": format, "size": size, "margin": margin, "dark": dark, "light": light}
        return _qr(self._core.requester.send(_qr_request(link_id, query, request_options)))


class Clicks:
    """Clicks."""

    def __init__(self, core: Core) -> None:
        self._core = core

    def get(self, click_id: str, *, request_options: Optional[RequestOptions] = None) -> Click:
        """Fetch a click by its ID (``clk_…``).

        Example::

            click = clikgate.clicks.get(click_id)
            print(click.get("country"))
        """
        path = f"/v1/clicks/{encode_path_segment(require_id(click_id, 'click_id'))}"
        _s, data, _h = self._core.requester.request(ApiRequest("GET", path).with_options(request_options))
        return cast(Click, data)


class AsyncConversions:
    """Conversions (async). See :class:`Conversions`."""

    def __init__(self, core: AsyncCore) -> None:
        self._core = core

    async def create(self, *, request_options: Optional[RequestOptions] = None, **params: Any) -> Union[Conversion, GoalEvent]:
        """Report a conversion.

        Example::

            await clikgate.conversions.create(external_id="ORD-1001", goal="order_paid", value="1500.50")
        """
        body = _with_value(params)
        check_hashed_fields(body)
        if (await self._core.guard_state()).guard:
            guard_payload("conversion", body)
        _s, data, _h = await self._core.requester.request(ApiRequest("POST", "/v1/conversions", body=body).with_options(request_options))
        return cast(Union[Conversion, GoalEvent], data)

    async def reverse(self, conversion_id: str, *, request_options: Optional[RequestOptions] = None, **params: Any) -> Conversion:
        """Reverse a conversion.

        Example::

            await clikgate.conversions.reverse("cnv_01J…", amount_minor=200000)
        """
        path = f"/v1/conversions/{encode_path_segment(require_id(conversion_id))}/reverse"
        body = _with_value(params)
        if (await self._core.guard_state()).guard:
            guard_payload("reversal", body)
        _s, data, _h = await self._core.requester.request(ApiRequest("POST", path, body=body).with_options(request_options))
        return cast(Conversion, data)


class AsyncLinks:
    """Links (async). See :class:`Links`."""

    def __init__(self, core: AsyncCore) -> None:
        self._core = core

    async def create(self, *, request_options: Optional[RequestOptions] = None, **params: Any) -> Link:
        """Create a link.

        Example::

            link = await clikgate.links.create(destination_url="https://example.com/spring")
        """
        _s, data, _h = await self._core.requester.request(ApiRequest("POST", "/v1/links", body=params).with_options(request_options))
        return cast(Link, data)

    async def get(self, link_id: str, *, request_options: Optional[RequestOptions] = None) -> Link:
        """Fetch a link by ID.

        Example::

            link = await clikgate.links.get("lnk_01J…")
        """
        _s, data, _h = await self._core.requester.request(ApiRequest("GET", _link_path(link_id)).with_options(request_options))
        return cast(Link, data)

    async def update(self, link_id: str, *, request_options: Optional[RequestOptions] = None, **params: Any) -> LinkUpdateResult:
        """Update a link (``202`` → ``applied: False`` with ``change_request``; locked → LinkLockedError).

        Example::

            result = await clikgate.links.update("lnk_01J…", destination_url="https://example.com/summer")
        """
        status, data, _h = await self._core.requester.request(
            ApiRequest("PATCH", _link_path(link_id), body=params).with_options(request_options)
        )
        return _update_result(status, data)

    async def list_page(self, *, request_options: Optional[RequestOptions] = None, **params: Any) -> LinkPage:
        """Fetch one page of links.

        Example::

            page = await clikgate.links.list_page(limit=100)
        """
        _s, data, _h = await self._core.requester.request(ApiRequest("GET", "/v1/links", query=params).with_options(request_options))
        return cast(LinkPage, data)

    async def list(self, *, request_options: Optional[RequestOptions] = None, **params: Any) -> AsyncIterator[Link]:
        """Iterate over every link, fetching pages lazily.

        Example::

            async for link in clikgate.links.list(limit=100):
                print(link["short_url"])
        """
        cursor: Optional[str] = None
        while True:
            page = await self.list_page(request_options=request_options, **({**params, "starting_after": cursor} if cursor else params))
            for item in page.get("data") or []:
                yield item
            if not page.get("has_more") or not page.get("next_cursor"):
                return
            cursor = page["next_cursor"]

    async def qr(
        self,
        link_id: str,
        *,
        format: Optional[str] = None,
        size: Optional[int] = None,
        margin: Optional[int] = None,
        dark: Optional[str] = None,
        light: Optional[str] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> QrCode:
        """Download the link's QR code.

        Example::

            qr = await clikgate.links.qr("lnk_01J…", format="svg")
        """
        query = {"format": format, "size": size, "margin": margin, "dark": dark, "light": light}
        return _qr(await self._core.requester.send(_qr_request(link_id, query, request_options)))


class AsyncClicks:
    """Clicks (async)."""

    def __init__(self, core: AsyncCore) -> None:
        self._core = core

    async def get(self, click_id: str, *, request_options: Optional[RequestOptions] = None) -> Click:
        """Fetch a click by its ID.

        Example::

            click = await clikgate.clicks.get(click_id)
        """
        path = f"/v1/clicks/{encode_path_segment(require_id(click_id, 'click_id'))}"
        _s, data, _h = await self._core.requester.request(ApiRequest("GET", path).with_options(request_options))
        return cast(Click, data)
