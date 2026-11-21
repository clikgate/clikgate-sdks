"""Privacy requests, people, installs and codes (SPEC sections 30 and 32), sync and async."""

from __future__ import annotations

from datetime import datetime
from typing import Any, AsyncIterator, Dict, Iterator, Mapping, Optional, Union, cast

from ._core import AsyncCore, Core
from ._currency import to_referral
from ._http import ApiRequest, RequestOptions, encode_path_segment, format_date, require_id
from ._models import CodeRedemption, Install, Person, PersonSearchPage, PersonSummary, PrivacyRequest

__all__ = ["AsyncCodes", "AsyncInstalls", "AsyncPeople", "AsyncPrivacy", "Codes", "Installs", "People", "Privacy"]


def _defined(**fields: Any) -> Dict[str, Any]:
    return {k: v for k, v in fields.items() if v is not None}


def _privacy_create(type: str, subject_type: str, subject_id: str, app_id: Optional[str]) -> ApiRequest:
    return ApiRequest(
        "POST", "/v1/privacy/requests", body=_defined(type=type, subject_type=subject_type, subject_id=subject_id, app_id=app_id)
    )


def _privacy_get(request_id: str) -> ApiRequest:
    return ApiRequest("GET", f"/v1/privacy/requests/{encode_path_segment(require_id(request_id, 'request_id'))}")


def _person_path(person_id: str) -> str:
    return f"/v1/people/{encode_path_segment(require_id(person_id, 'person_id'))}"


def _search(q: str, cursor: Optional[str], limit: Optional[int]) -> ApiRequest:
    return ApiRequest("POST", "/v1/people/search", body=_defined(q=q, cursor=cursor, limit=limit))


def _install(kind: str, value: str, name: str, app_id: Optional[str]) -> ApiRequest:
    path = f"/v1/installs/{kind}/{encode_path_segment(require_id(value, name))}"
    return ApiRequest("GET", path, query=_defined(app_id=app_id))


def _redeem(
    external_id: str,
    code: str,
    channel: str,
    app_id: Optional[str],
    occurred_at: Optional[Union[datetime, str]],
    metadata: Optional[Mapping[str, Any]],
    subject: Optional[Mapping[str, Any]] = None,
    agent_id: Optional[str] = None,
    location: Optional[Mapping[str, Any]] = None,
) -> ApiRequest:
    body = _defined(
        external_id=external_id,
        code=code,
        channel=channel,
        app_id=app_id,
        occurred_at=None if occurred_at is None else format_date(occurred_at),
        metadata=None if metadata is None else dict(metadata),
        subject=None if subject is None else dict(subject),
        agent_id=agent_id,
        location=None if location is None else dict(location),
    )
    return ApiRequest("POST", "/v1/codes/redeem", body=body)


def _redemption(data: Any) -> CodeRedemption:
    if isinstance(data, dict) and isinstance(data.get("referral"), dict):
        return cast(CodeRedemption, {**data, "referral": to_referral(data["referral"])})
    return cast(CodeRedemption, data)


class Privacy:
    """Privacy requests: access, export, delete or erase a subject's data."""

    def __init__(self, core: Core) -> None:
        self._core = core

    def create_request(
        self,
        *,
        type: str,
        subject_type: str,
        subject_id: str,
        app_id: Optional[str] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> PrivacyRequest:
        """Ask for a subject's data to be exported or erased (``type``: ``access``, ``export``, ``delete``, ``erasure``).

        Example::

            request = clikgate.privacy.create_request(type="erasure", subject_type="customer_user", subject_id=user.id)
        """
        req = _privacy_create(type, subject_type, subject_id, app_id).with_options(request_options)
        return cast(PrivacyRequest, self._core.requester.request(req)[1])

    def get_request(self, request_id: str, *, request_options: Optional[RequestOptions] = None) -> PrivacyRequest:
        """Fetch a privacy request (a completed export's ``result`` has its download link).

        Example::

            request = clikgate.privacy.get_request("prq_01J…")
        """
        return cast(PrivacyRequest, self._core.requester.request(_privacy_get(request_id).with_options(request_options))[1])


class People:
    """People: one customer across clicks, installs and your customer ID."""

    def __init__(self, core: Core) -> None:
        self._core = core

    def get(self, person_id: str, *, request_options: Optional[RequestOptions] = None) -> Person:
        """Fetch a person.

        Example::

            person = clikgate.people.get("per_01J…")
        """
        return cast(Person, self._core.requester.request(ApiRequest("GET", _person_path(person_id)).with_options(request_options))[1])

    def search_page(
        self, q: str, *, cursor: Optional[str] = None, limit: Optional[int] = None, request_options: Optional[RequestOptions] = None
    ) -> PersonSearchPage:
        """Fetch one page of people matching a label, customer ID or click ID (the text goes in the body, never the URL).

        Example::

            page = clikgate.people.search_page("Ada", limit=20)
        """
        return cast(PersonSearchPage, self._core.requester.request(_search(q, cursor, limit).with_options(request_options))[1])

    def search(self, q: str, *, limit: Optional[int] = None, request_options: Optional[RequestOptions] = None) -> Iterator[PersonSummary]:
        """Iterate over every person matching the text, fetching pages lazily.

        Example::

            for person in clikgate.people.search("Ada"):
                print(person["id"], person.get("label"))
        """
        cursor: Optional[str] = None
        while True:
            page = self.search_page(q, cursor=cursor, limit=limit, request_options=request_options)
            yield from page.get("data") or []
            if not page.get("has_more") or not page.get("next_cursor"):
                return
            cursor = page["next_cursor"]

    def set_label(self, person_id: str, label: Optional[str], *, request_options: Optional[RequestOptions] = None) -> Person:
        """Set a person's label (``None`` clears it).

        Example::

            clikgate.people.set_label("per_01J…", "Ada (VIP)")
        """
        req = ApiRequest("PATCH", _person_path(person_id), body={"label": label}).with_options(request_options)
        return cast(Person, self._core.requester.request(req)[1])


class Installs:
    """Installs of your apps."""

    def __init__(self, core: Core) -> None:
        self._core = core

    def get_by_customer(
        self, customer_id: str, *, app_id: Optional[str] = None, request_options: Optional[RequestOptions] = None
    ) -> Install:
        """The latest install of one of your customers. The API currently needs ``app_id``.

        Example::

            install = clikgate.installs.get_by_customer(user.id, app_id="app_01J…")
        """
        req = _install("by-customer-user", customer_id, "customer_id", app_id).with_options(request_options)
        return cast(Install, self._core.requester.request(req)[1])

    def get_by_installation(
        self, installation_id: str, *, app_id: Optional[str] = None, request_options: Optional[RequestOptions] = None
    ) -> Install:
        """An install by its installation ID (from the ``Clikgate-Installation`` header). The API currently needs ``app_id``.

        Example::

            install = clikgate.installs.get_by_installation(installation.installation_id, app_id=installation.app_id)
        """
        req = _install("by-installation", installation_id, "installation_id", app_id).with_options(request_options)
        return cast(Install, self._core.requester.request(req)[1])


class Codes:
    """Offline and referral codes."""

    def __init__(self, core: Core) -> None:
        self._core = core

    def redeem(
        self,
        *,
        external_id: str,
        code: str,
        channel: str,
        app_id: Optional[str] = None,
        occurred_at: Optional[Union[datetime, str]] = None,
        metadata: Optional[Mapping[str, Any]] = None,
        subject: Optional[Mapping[str, Any]] = None,
        agent_id: Optional[str] = None,
        location: Optional[Mapping[str, Any]] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> CodeRedemption:
        """Redeem a code received offline (USSD, a till, an agent). A referral code can create a referral. ``subject``
        (``{"type": ..., "id": ...}``) and ``location`` (``{"country", "region", "city", "store_id"}``) are sent as given.

        Example::

            redemption = clikgate.codes.redeem(external_id="POS-991", code="ADA42", channel="pos")
        """
        req = _redeem(external_id, code, channel, app_id, occurred_at, metadata, subject, agent_id, location).with_options(request_options)
        return _redemption(self._core.requester.request(req)[1])


class AsyncPrivacy:
    """Privacy requests (async). See :class:`Privacy`."""

    def __init__(self, core: AsyncCore) -> None:
        self._core = core

    async def create_request(
        self,
        *,
        type: str,
        subject_type: str,
        subject_id: str,
        app_id: Optional[str] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> PrivacyRequest:
        """Create a privacy request.

        Example::

            request = await clikgate.privacy.create_request(type="export", subject_type="customer_user", subject_id=user.id)
        """
        req = _privacy_create(type, subject_type, subject_id, app_id).with_options(request_options)
        return cast(PrivacyRequest, (await self._core.requester.request(req))[1])

    async def get_request(self, request_id: str, *, request_options: Optional[RequestOptions] = None) -> PrivacyRequest:
        """Fetch a privacy request.

        Example::

            request = await clikgate.privacy.get_request("prq_01J…")
        """
        return cast(PrivacyRequest, (await self._core.requester.request(_privacy_get(request_id).with_options(request_options)))[1])


class AsyncPeople:
    """People (async). See :class:`People`."""

    def __init__(self, core: AsyncCore) -> None:
        self._core = core

    async def get(self, person_id: str, *, request_options: Optional[RequestOptions] = None) -> Person:
        """Fetch a person.

        Example::

            person = await clikgate.people.get("per_01J…")
        """
        return cast(
            Person, (await self._core.requester.request(ApiRequest("GET", _person_path(person_id)).with_options(request_options)))[1]
        )

    async def search_page(
        self, q: str, *, cursor: Optional[str] = None, limit: Optional[int] = None, request_options: Optional[RequestOptions] = None
    ) -> PersonSearchPage:
        """Fetch one page of people.

        Example::

            page = await clikgate.people.search_page("Ada")
        """
        return cast(PersonSearchPage, (await self._core.requester.request(_search(q, cursor, limit).with_options(request_options)))[1])

    async def search(
        self, q: str, *, limit: Optional[int] = None, request_options: Optional[RequestOptions] = None
    ) -> AsyncIterator[PersonSummary]:
        """Iterate over every person matching the text, fetching pages lazily.

        Example::

            async for person in clikgate.people.search("Ada"):
                print(person["id"])
        """
        cursor: Optional[str] = None
        while True:
            page = await self.search_page(q, cursor=cursor, limit=limit, request_options=request_options)
            for item in page.get("data") or []:
                yield item
            if not page.get("has_more") or not page.get("next_cursor"):
                return
            cursor = page["next_cursor"]

    async def set_label(self, person_id: str, label: Optional[str], *, request_options: Optional[RequestOptions] = None) -> Person:
        """Set a person's label.

        Example::

            await clikgate.people.set_label("per_01J…", "Ada (VIP)")
        """
        req = ApiRequest("PATCH", _person_path(person_id), body={"label": label}).with_options(request_options)
        return cast(Person, (await self._core.requester.request(req))[1])


class AsyncInstalls:
    """Installs (async). See :class:`Installs`."""

    def __init__(self, core: AsyncCore) -> None:
        self._core = core

    async def get_by_customer(
        self, customer_id: str, *, app_id: Optional[str] = None, request_options: Optional[RequestOptions] = None
    ) -> Install:
        """The latest install of one of your customers.

        Example::

            install = await clikgate.installs.get_by_customer(user.id, app_id="app_01J…")
        """
        req = _install("by-customer-user", customer_id, "customer_id", app_id).with_options(request_options)
        return cast(Install, (await self._core.requester.request(req))[1])

    async def get_by_installation(
        self, installation_id: str, *, app_id: Optional[str] = None, request_options: Optional[RequestOptions] = None
    ) -> Install:
        """An install by its installation ID.

        Example::

            install = await clikgate.installs.get_by_installation(installation_id, app_id="app_01J…")
        """
        req = _install("by-installation", installation_id, "installation_id", app_id).with_options(request_options)
        return cast(Install, (await self._core.requester.request(req))[1])


class AsyncCodes:
    """Codes (async). See :class:`Codes`."""

    def __init__(self, core: AsyncCore) -> None:
        self._core = core

    async def redeem(
        self,
        *,
        external_id: str,
        code: str,
        channel: str,
        app_id: Optional[str] = None,
        occurred_at: Optional[Union[datetime, str]] = None,
        metadata: Optional[Mapping[str, Any]] = None,
        subject: Optional[Mapping[str, Any]] = None,
        agent_id: Optional[str] = None,
        location: Optional[Mapping[str, Any]] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> CodeRedemption:
        """Redeem a code received offline.

        Example::

            redemption = await clikgate.codes.redeem(external_id="POS-991", code="ADA42", channel="pos")
        """
        req = _redeem(external_id, code, channel, app_id, occurred_at, metadata, subject, agent_id, location).with_options(request_options)
        return _redemption((await self._core.requester.request(req))[1])
