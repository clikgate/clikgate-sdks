"""Referrals: referrers, referrals, manual overrides, qualification steps and imports (SPEC section 28), sync and async."""

from __future__ import annotations

from datetime import datetime
from typing import Any, AsyncIterator, Dict, Iterator, List, Mapping, Optional, Sequence, Union, cast

from ._core import AsyncCore, Core
from ._currency import to_referral, to_referrer, to_referrer_result
from ._errors import NotFoundError, local_error
from ._http import ApiRequest, RequestOptions, encode_path_segment, format_date, require_id
from ._models import Job, Referral, ReferralPage, Referrer, ReferrerImportRow, ReferrerResult
from ._money import MoneyInput, format_value

__all__ = ["REFERRER_IMPORT_BATCH", "AsyncReferrals", "Referrals"]

#: The API's limit of referrers per import request.
REFERRER_IMPORT_BATCH = 1000

DateInput = Union[datetime, str]


def _seg(value: Any, name: str) -> str:
    return encode_path_segment(require_id(value, name))


def _defined(**fields: Any) -> Dict[str, Any]:
    return {k: v for k, v in fields.items() if v is not None}


def _program(program_id: str) -> str:
    return f"/v1/referral-programs/{_seg(program_id, 'program_id')}"


def _create_req(program_id: str, customer_id: str, display_name: Optional[str], external_code: Optional[str]) -> ApiRequest:
    body = _defined(customer_user_id=require_id(customer_id, "customer_id"), display_name=display_name, external_code=external_code)
    return ApiRequest("POST", f"{_program(program_id)}/referrers", body=body)


def _find_req(program_id: str, customer_id: Optional[str], code: Optional[str]) -> ApiRequest:
    base = _program(program_id)
    if (customer_id is None) == (code is None):
        raise local_error("invalid_argument", "Pass exactly one of customer_id and code.", "customer_id")
    if customer_id is not None:
        return ApiRequest("GET", f"{base}/referrers/by-user/{_seg(customer_id, 'customer_id')}")
    return ApiRequest("GET", f"{base}/referrers/by-code/{_seg(code, 'code')}")


def _list_query(
    program_id: Optional[str],
    referrer_id: Optional[str],
    referee_customer_id: Optional[str],
    status: Optional[str],
    from_: Optional[DateInput],
    to: Optional[DateInput],
    limit: Optional[int],
    starting_after: Optional[str],
    ending_before: Optional[str],
) -> Dict[str, Any]:
    return _defined(
        program_id=program_id,
        referrer_id=referrer_id,
        referee_customer_user_id=referee_customer_id,
        status=status,
        limit=limit,
        starting_after=starting_after,
        ending_before=ending_before,
        **{"from": from_, "to": to},
    )


def _page(data: Any) -> ReferralPage:
    page: Dict[str, Any] = dict(data) if isinstance(data, dict) else {}
    page["data"] = [to_referral(r) for r in page.get("data") or []]
    return cast(ReferralPage, page)


def _override_req(referral_id: str, action: str, reason: str) -> ApiRequest:
    return ApiRequest("POST", f"/v1/referrals/{_seg(referral_id, 'referral_id')}/override", body={"action": action, "reason": reason})


def _step_req(
    referral_id: str, goal: str, occurred_at: Optional[DateInput], value: Optional[MoneyInput], currency: Optional[str]
) -> ApiRequest:
    path = f"/v1/referrals/{_seg(referral_id, 'referral_id')}/steps"
    if occurred_at is None or occurred_at == "":
        raise local_error("invalid_argument", "occurred_at is required: when the step happened.", "occurred_at")
    body = _defined(
        goal=goal, occurred_at=format_date(occurred_at), value=None if value is None else format_value(value), currency=currency
    )
    return ApiRequest("POST", path, body=body)


def _import_batches(
    program_id: str, rows: Sequence[Union[ReferrerImportRow, Mapping[str, Any]]], options: Optional[RequestOptions]
) -> List[ApiRequest]:
    path = f"{_program(program_id)}/referrers/import"
    raw: Any = rows
    if isinstance(raw, (str, bytes)) or not isinstance(raw, Sequence):
        raise local_error("invalid_argument", "rows must be a list.", "rows")
    wire = [
        _defined(
            customer_user_id=require_id(r.get("customer_id"), f"rows[{i}].customer_id"),
            external_code=r.get("external_code"),
            display_name=r.get("display_name"),
        )
        for i, r in enumerate(rows)
    ]
    batches = [wire[i : i + REFERRER_IMPORT_BATCH] for i in range(0, len(wire), REFERRER_IMPORT_BATCH)]
    key = (options or {}).get("idempotency_key")
    out: List[ApiRequest] = []
    for b, batch in enumerate(batches):
        req = ApiRequest("POST", path, body={"referrers": batch}).with_options(options)
        if key is not None and len(batches) > 1:
            req.idempotency_key = f"{key}-{b}"
        out.append(req)
    return out


def _referrer_path(referrer_id: str, suffix: str = "") -> str:
    return f"/v1/referrers/{_seg(referrer_id, 'referrer_id')}{suffix}"


def _update_body(display_name: Optional[str], attributes: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    return _defined(display_name=display_name, attributes=None if attributes is None else dict(attributes))


class Referrals:
    """Referrals: referrers, referrals, manual overrides, qualification steps and imports."""

    def __init__(self, core: Core) -> None:
        self._core = core

    def _send(self, req: ApiRequest, options: Optional[RequestOptions]) -> Any:
        return self._core.requester.request(req.with_options(options))[1]

    def get_or_create_referrer(
        self,
        program_id: str,
        *,
        customer_id: str,
        display_name: Optional[str] = None,
        external_code: Optional[str] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> ReferrerResult:
        """Get the referrer for one of your customers in a program, creating it (with its code and link) the first time.

        ``created`` is true when it was just created.

        Example::

            referrer = clikgate.referrals.get_or_create_referrer("rpg_01J…", customer_id=user.id, display_name=user.first_name)
            print(referrer["code"], referrer["url"], referrer["created"])
        """
        status, data, _h = self._core.requester.request(
            _create_req(program_id, customer_id, display_name, external_code).with_options(request_options)
        )
        return to_referrer_result(data, status)

    def get_referrer(self, referrer_id: str, *, request_options: Optional[RequestOptions] = None) -> Referrer:
        """Fetch a referrer by ID.

        Example::

            referrer = clikgate.referrals.get_referrer("rfr_01J…")
        """
        return to_referrer(self._send(ApiRequest("GET", _referrer_path(referrer_id)), request_options))

    def find_referrer(
        self,
        program_id: str,
        *,
        customer_id: Optional[str] = None,
        code: Optional[str] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> Optional[Referrer]:
        """Find a referrer by your customer ID or by code (exactly one). ``None`` when there is none (404); other errors raise.

        Example::

            referrer = clikgate.referrals.find_referrer("rpg_01J…", customer_id=user.id)
        """
        req = _find_req(program_id, customer_id, code)
        try:
            return to_referrer(self._send(req, request_options))
        except NotFoundError:
            return None

    def get(self, referral_id: str, *, request_options: Optional[RequestOptions] = None) -> Referral:
        """Fetch a referral. Reward sides carry ``amount`` (normal units) next to ``amount_minor``.

        Example::

            referral = clikgate.referrals.get("ref_01J…")
            print(referral["status"], ((referral.get("reward_snapshot") or {}).get("referrer") or {}).get("amount"))
        """
        return to_referral(self._send(ApiRequest("GET", f"/v1/referrals/{_seg(referral_id, 'referral_id')}"), request_options))

    def list_page(
        self,
        *,
        program_id: Optional[str] = None,
        referrer_id: Optional[str] = None,
        referee_customer_id: Optional[str] = None,
        status: Optional[str] = None,
        from_: Optional[DateInput] = None,
        to: Optional[DateInput] = None,
        limit: Optional[int] = None,
        starting_after: Optional[str] = None,
        ending_before: Optional[str] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> ReferralPage:
        """Fetch one page of referrals (``from_`` and ``to`` are sent as ``from`` and ``to``).

        Example::

            page = clikgate.referrals.list_page(program_id="rpg_01J…", status="qualified", limit=100)
        """
        query = _list_query(program_id, referrer_id, referee_customer_id, status, from_, to, limit, starting_after, ending_before)
        return _page(self._send(ApiRequest("GET", "/v1/referrals", query=query), request_options))

    def list(
        self,
        *,
        program_id: Optional[str] = None,
        referrer_id: Optional[str] = None,
        referee_customer_id: Optional[str] = None,
        status: Optional[str] = None,
        from_: Optional[DateInput] = None,
        to: Optional[DateInput] = None,
        limit: Optional[int] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> Iterator[Referral]:
        """Iterate over every referral, fetching pages lazily.

        Example::

            for referral in clikgate.referrals.list(program_id="rpg_01J…", status="qualified"):
                print(referral["id"], referral["referee"]["customer_user_id"])
        """
        cursor: Optional[str] = None
        while True:
            page = self.list_page(
                program_id=program_id,
                referrer_id=referrer_id,
                referee_customer_id=referee_customer_id,
                status=status,
                from_=from_,
                to=to,
                limit=limit,
                starting_after=cursor,
                request_options=request_options,
            )
            yield from page.get("data") or []
            if not page.get("has_more") or not page.get("next_cursor"):
                return
            cursor = page["next_cursor"]

    def qualify(self, referral_id: str, *, reason: str, request_options: Optional[RequestOptions] = None) -> Referral:
        """Qualify a referral by hand (a manual override), with your reason.

        Example::

            clikgate.referrals.qualify("ref_01J…", reason="Checked by support")
        """
        return to_referral(self._send(_override_req(referral_id, "qualify", reason), request_options))

    def disqualify(self, referral_id: str, *, reason: str, request_options: Optional[RequestOptions] = None) -> Referral:
        """Disqualify a referral by hand (a manual override), with your reason.

        Example::

            clikgate.referrals.disqualify("ref_01J…", reason="Same household")
        """
        return to_referral(self._send(_override_req(referral_id, "disqualify", reason), request_options))

    def complete_step(
        self,
        referral_id: str,
        *,
        goal: str,
        occurred_at: DateInput,
        value: Optional[MoneyInput] = None,
        currency: Optional[str] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> Referral:
        """Complete the referral's current qualification step from your server. ``occurred_at`` (when it happened) is required.

        Example::

            clikgate.referrals.complete_step("ref_01J…", goal="first_order", occurred_at=paid_at, value="1500.50", currency="NGN")
        """
        req = _step_req(referral_id, goal, occurred_at, value, currency)
        return to_referral(self._send(req, request_options))

    def import_referrers(
        self,
        program_id: str,
        rows: Sequence[Union[ReferrerImportRow, Mapping[str, Any]]],
        *,
        request_options: Optional[RequestOptions] = None,
    ) -> List[Job]:
        """Import referrers (with their old codes). Rows are sent in batches of 1000; the result is one job per batch.

        Example::

            jobs = clikgate.referrals.import_referrers("rpg_01J…", [{"customer_id": "user-42", "external_code": "ADA-OLD"}])
        """
        return [cast(Job, self._core.requester.request(req)[1]) for req in _import_batches(program_id, rows, request_options)]

    def block_referrer(
        self, referrer_id: str, *, reason: Optional[str] = None, request_options: Optional[RequestOptions] = None
    ) -> Referrer:
        """Block a referrer: their code and link stop creating referrals.

        Example::

            clikgate.referrals.block_referrer("rfr_01J…", reason="Fake installs")
        """
        return to_referrer(
            self._send(ApiRequest("POST", _referrer_path(referrer_id, "/block"), body=_defined(reason=reason)), request_options)
        )

    def unblock_referrer(self, referrer_id: str, *, request_options: Optional[RequestOptions] = None) -> Referrer:
        """Unblock a referrer.

        Example::

            clikgate.referrals.unblock_referrer("rfr_01J…")
        """
        return to_referrer(self._send(ApiRequest("POST", _referrer_path(referrer_id, "/unblock")), request_options))

    def update_referrer(
        self,
        referrer_id: str,
        *,
        display_name: Optional[str] = None,
        attributes: Optional[Mapping[str, Any]] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> Referrer:
        """Update a referrer's display name or your own free-form ``attributes``; unset fields are left as they are.

        Example::

            clikgate.referrals.update_referrer("rfr_01J…", display_name="Ada O.", attributes={"tier": "gold"})
        """
        body = _update_body(display_name, attributes)
        return to_referrer(self._send(ApiRequest("PATCH", _referrer_path(referrer_id), body=body), request_options))


class AsyncReferrals:
    """Referrals (async). See :class:`Referrals`."""

    def __init__(self, core: AsyncCore) -> None:
        self._core = core

    async def _send(self, req: ApiRequest, options: Optional[RequestOptions]) -> Any:
        return (await self._core.requester.request(req.with_options(options)))[1]

    async def get_or_create_referrer(
        self,
        program_id: str,
        *,
        customer_id: str,
        display_name: Optional[str] = None,
        external_code: Optional[str] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> ReferrerResult:
        """Get or create the referrer for one of your customers.

        Example::

            referrer = await clikgate.referrals.get_or_create_referrer("rpg_01J…", customer_id=user.id)
        """
        status, data, _h = await self._core.requester.request(
            _create_req(program_id, customer_id, display_name, external_code).with_options(request_options)
        )
        return to_referrer_result(data, status)

    async def get_referrer(self, referrer_id: str, *, request_options: Optional[RequestOptions] = None) -> Referrer:
        """Fetch a referrer by ID.

        Example::

            referrer = await clikgate.referrals.get_referrer("rfr_01J…")
        """
        return to_referrer(await self._send(ApiRequest("GET", _referrer_path(referrer_id)), request_options))

    async def find_referrer(
        self,
        program_id: str,
        *,
        customer_id: Optional[str] = None,
        code: Optional[str] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> Optional[Referrer]:
        """Find a referrer by customer ID or code; ``None`` on 404.

        Example::

            referrer = await clikgate.referrals.find_referrer("rpg_01J…", code="ADA42")
        """
        req = _find_req(program_id, customer_id, code)
        try:
            return to_referrer(await self._send(req, request_options))
        except NotFoundError:
            return None

    async def get(self, referral_id: str, *, request_options: Optional[RequestOptions] = None) -> Referral:
        """Fetch a referral.

        Example::

            referral = await clikgate.referrals.get("ref_01J…")
        """
        return to_referral(await self._send(ApiRequest("GET", f"/v1/referrals/{_seg(referral_id, 'referral_id')}"), request_options))

    async def list_page(
        self,
        *,
        program_id: Optional[str] = None,
        referrer_id: Optional[str] = None,
        referee_customer_id: Optional[str] = None,
        status: Optional[str] = None,
        from_: Optional[DateInput] = None,
        to: Optional[DateInput] = None,
        limit: Optional[int] = None,
        starting_after: Optional[str] = None,
        ending_before: Optional[str] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> ReferralPage:
        """Fetch one page of referrals.

        Example::

            page = await clikgate.referrals.list_page(status="qualified")
        """
        query = _list_query(program_id, referrer_id, referee_customer_id, status, from_, to, limit, starting_after, ending_before)
        return _page(await self._send(ApiRequest("GET", "/v1/referrals", query=query), request_options))

    async def list(
        self,
        *,
        program_id: Optional[str] = None,
        referrer_id: Optional[str] = None,
        referee_customer_id: Optional[str] = None,
        status: Optional[str] = None,
        from_: Optional[DateInput] = None,
        to: Optional[DateInput] = None,
        limit: Optional[int] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> AsyncIterator[Referral]:
        """Iterate over every referral, fetching pages lazily.

        Example::

            async for referral in clikgate.referrals.list(status="qualified"):
                print(referral["id"])
        """
        cursor: Optional[str] = None
        while True:
            page = await self.list_page(
                program_id=program_id,
                referrer_id=referrer_id,
                referee_customer_id=referee_customer_id,
                status=status,
                from_=from_,
                to=to,
                limit=limit,
                starting_after=cursor,
                request_options=request_options,
            )
            for item in page.get("data") or []:
                yield item
            if not page.get("has_more") or not page.get("next_cursor"):
                return
            cursor = page["next_cursor"]

    async def qualify(self, referral_id: str, *, reason: str, request_options: Optional[RequestOptions] = None) -> Referral:
        """Qualify a referral by hand.

        Example::

            await clikgate.referrals.qualify("ref_01J…", reason="Checked by support")
        """
        return to_referral(await self._send(_override_req(referral_id, "qualify", reason), request_options))

    async def disqualify(self, referral_id: str, *, reason: str, request_options: Optional[RequestOptions] = None) -> Referral:
        """Disqualify a referral by hand.

        Example::

            await clikgate.referrals.disqualify("ref_01J…", reason="Same household")
        """
        return to_referral(await self._send(_override_req(referral_id, "disqualify", reason), request_options))

    async def complete_step(
        self,
        referral_id: str,
        *,
        goal: str,
        occurred_at: DateInput,
        value: Optional[MoneyInput] = None,
        currency: Optional[str] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> Referral:
        """Complete the referral's current qualification step.

        Example::

            await clikgate.referrals.complete_step("ref_01J…", goal="first_order")
        """
        req = _step_req(referral_id, goal, occurred_at, value, currency)
        return to_referral(await self._send(req, request_options))

    async def import_referrers(
        self,
        program_id: str,
        rows: Sequence[Union[ReferrerImportRow, Mapping[str, Any]]],
        *,
        request_options: Optional[RequestOptions] = None,
    ) -> List[Job]:
        """Import referrers in batches of 1000; one job per batch.

        Example::

            jobs = await clikgate.referrals.import_referrers("rpg_01J…", [{"customer_id": "user-42"}])
        """
        return [cast(Job, (await self._core.requester.request(req))[1]) for req in _import_batches(program_id, rows, request_options)]

    async def block_referrer(
        self, referrer_id: str, *, reason: Optional[str] = None, request_options: Optional[RequestOptions] = None
    ) -> Referrer:
        """Block a referrer.

        Example::

            await clikgate.referrals.block_referrer("rfr_01J…", reason="Fake installs")
        """
        return to_referrer(
            await self._send(ApiRequest("POST", _referrer_path(referrer_id, "/block"), body=_defined(reason=reason)), request_options),
        )

    async def unblock_referrer(self, referrer_id: str, *, request_options: Optional[RequestOptions] = None) -> Referrer:
        """Unblock a referrer.

        Example::

            await clikgate.referrals.unblock_referrer("rfr_01J…")
        """
        return to_referrer(await self._send(ApiRequest("POST", _referrer_path(referrer_id, "/unblock")), request_options))

    async def update_referrer(
        self,
        referrer_id: str,
        *,
        display_name: Optional[str] = None,
        attributes: Optional[Mapping[str, Any]] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> Referrer:
        """Update a referrer's display name or attributes.

        Example::

            await clikgate.referrals.update_referrer("rfr_01J…", display_name="Ada O.")
        """
        body = _update_body(display_name, attributes)
        return to_referrer(await self._send(ApiRequest("PATCH", _referrer_path(referrer_id), body=body), request_options))
