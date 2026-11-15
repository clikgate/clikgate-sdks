"""Known customers (change 26 KC.3): people who were already your customers before you added Clikgate.

Clikgate uses them so an existing customer is never counted as a referral or a new customer. It stores a keyed
fingerprint of each ID, not the ID itself. Not available in private mode.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional, TypedDict, Union

from ._core import AsyncCore, Core
from ._errors import ConflictError, local_error
from ._http import ApiRequest, RequestOptions

__all__ = ["KNOWN_CUSTOMERS_BATCH", "AsyncKnownCustomers", "KnownCustomers", "KnownCustomersImportResult"]

#: The API's batch size; ``import_customers`` splits larger lists.
KNOWN_CUSTOMERS_BATCH = 10_000
_DAY = re.compile(r"\d{4}-\d{2}-\d{2}")
_SINCE_MESSAGE = "customer_since must be 'YYYY-MM-DD', a date, a datetime or Unix seconds."

#: One existing customer: ``{"customer_id": ..., "customer_since": "YYYY-MM-DD" | date | datetime | Unix seconds}``.
KnownCustomer = Mapping[str, Any]


class KnownCustomersImportResult(TypedDict):
    """The answer of ``import_customers``, summed over every batch. Refused rows are counted by reason, never returned."""

    accepted: int
    refused: int
    refused_by_reason: Dict[str, int]


def _since_day(value: Union[str, date, datetime, int]) -> str:
    if isinstance(value, str):
        if not _DAY.fullmatch(value):
            raise local_error("invalid_argument", _SINCE_MESSAGE, "customer_since")
        return value
    if isinstance(value, datetime):
        moment = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
        return moment.astimezone(timezone.utc).date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, bool) or not isinstance(value, int):
        raise local_error("invalid_argument", _SINCE_MESSAGE, "customer_since")
    return datetime.fromtimestamp(value, tz=timezone.utc).date().isoformat()


def _rows(customers: Iterable[KnownCustomer]) -> List[Dict[str, str]]:
    if isinstance(customers, (str, bytes, Mapping)):
        raise local_error("invalid_argument", "customers must be a list of {'customer_id', 'customer_since'} items.", "customers")
    rows: List[Dict[str, str]] = []
    for i, c in enumerate(customers):
        cid = c.get("customer_id") if isinstance(c, Mapping) else None
        if not isinstance(cid, str):
            raise local_error("invalid_argument", f"customers[{i}]['customer_id'] must be a string.", "customer_id")
        row = {"customer_id": cid}
        if c.get("customer_since") is not None:
            row["customer_since"] = _since_day(c["customer_since"])
        rows.append(row)
    return rows


def _private_mode_conflict() -> ConflictError:
    return ConflictError("Private mode is on: known customers can't be imported or removed.", code="private_mode_conflict")


def _batches(rows: List[Dict[str, str]], options: Optional[RequestOptions]) -> Iterable[ApiRequest]:
    several = len(rows) > KNOWN_CUSTOMERS_BATCH
    for n, i in enumerate(range(0, len(rows), KNOWN_CUSTOMERS_BATCH)):
        opts: Optional[RequestOptions] = options
        if several and options and options.get("idempotency_key"):
            # One idempotency key per batch: a key you pass gets the batch number appended
            opts = {**options, "idempotency_key": f"{options['idempotency_key']}-{n}"}
        yield ApiRequest("POST", "/v1/known-customers/import", body={"customers": rows[i : i + KNOWN_CUSTOMERS_BATCH]}).with_options(opts)


def _add(total: KnownCustomersImportResult, data: Any) -> None:
    data = data if isinstance(data, Mapping) else {}
    total["accepted"] += int(data.get("accepted") or 0)
    total["refused"] += int(data.get("refused") or 0)
    for reason, n in (data.get("refused_by_reason") or {}).items():
        total["refused_by_reason"][reason] = total["refused_by_reason"].get(reason, 0) + int(n or 0)


def _remove_request(customer_id: str, options: Optional[RequestOptions]) -> ApiRequest:
    if not isinstance(customer_id, str) or not customer_id:
        raise local_error("invalid_customer_id", "customer_id must be a non-empty string.", "customer_id")
    # The ID travels in the body, never in a URL
    return ApiRequest("POST", "/v1/known-customers/remove", body={"customer_id": customer_id}).with_options(options)


def _empty() -> KnownCustomersImportResult:
    return {"accepted": 0, "refused": 0, "refused_by_reason": {}}


class KnownCustomers:
    """``clikgate.known_customers``: import and remove existing customers (scope ``people:write``)."""

    def __init__(self, core: Core) -> None:
        self._core = core

    def import_customers(
        self, customers: Iterable[KnownCustomer], *, request_options: Optional[RequestOptions] = None
    ) -> KnownCustomersImportResult:
        """Import existing customers (``POST /v1/known-customers/import``), in batches of 10,000. Idempotent per
        customer ID. Use your own customer IDs, never emails or phone numbers.

        Example::

            result = clikgate.known_customers.import_customers([{"customer_id": "u_10482", "customer_since": "2024-03-02"}])
            print(result["accepted"], result["refused_by_reason"])
        """
        rows = _rows(customers)
        total = _empty()
        if not rows:
            return total
        if self._core.guard_state().guard:
            raise _private_mode_conflict()
        for request in _batches(rows, request_options):
            _s, data, _h = self._core.requester.request(request)
            _add(total, data)
        return total

    def remove(self, customer_id: str, *, request_options: Optional[RequestOptions] = None) -> Dict[str, bool]:
        """Remove one imported customer (``POST /v1/known-customers/remove``).

        Example::

            clikgate.known_customers.remove("u_10482")  # {"removed": True}
        """
        request = _remove_request(customer_id, request_options)
        if self._core.guard_state().guard:
            raise _private_mode_conflict()
        _s, data, _h = self._core.requester.request(request)
        return data  # type: ignore[no-any-return]


class AsyncKnownCustomers:
    """Known customers (async). See :class:`KnownCustomers`."""

    def __init__(self, core: AsyncCore) -> None:
        self._core = core

    async def import_customers(
        self, customers: Iterable[KnownCustomer], *, request_options: Optional[RequestOptions] = None
    ) -> KnownCustomersImportResult:
        """Import existing customers in batches of 10,000. See :meth:`KnownCustomers.import_customers`."""
        rows = _rows(customers)
        total = _empty()
        if not rows:
            return total
        if (await self._core.guard_state()).guard:
            raise _private_mode_conflict()
        for request in _batches(rows, request_options):
            _s, data, _h = await self._core.requester.request(request)
            _add(total, data)
        return total

    async def remove(self, customer_id: str, *, request_options: Optional[RequestOptions] = None) -> Dict[str, bool]:
        """Remove one imported customer. See :meth:`KnownCustomers.remove`."""
        request = _remove_request(customer_id, request_options)
        if (await self._core.guard_state()).guard:
            raise _private_mode_conflict()
        _s, data, _h = await self._core.requester.request(request)
        return data  # type: ignore[no-any-return]
