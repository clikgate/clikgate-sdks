"""Payments confirmed by your server (SPEC section 22), sync and async.

Call these **right after your own server has verified the payment with the gateway**, never with data from the
browser or the app. Clikgate matches the confirmation with the report your website or app sent (a Payment goal
sent with ``goal()``, with ``provider`` and ``reference``) and counts the Payment goal with the confirmed amount.
These methods never talk to a gateway and never take a gateway key.
"""

from __future__ import annotations

import json
import math
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple, Union, cast

from ._click_ids import is_valid as is_valid_click_id
from ._core import AsyncCore, Core
from ._enums import Provider
from ._errors import InvalidRequestError, local_error
from ._guard import guard_payload
from ._http import ApiRequest, RequestOptions, format_date
from ._money import MoneyInput, format_value
from ._types import PaymentConfirmation, PaymentConfirmationBody

__all__ = [
    "AsyncPayments",
    "Payments",
    "build_confirm_wire",
    "build_from_flutterwave",
    "build_from_monnify",
    "build_from_paystack",
    "build_from_stripe",
]

_PROVIDER = re.compile(r"[a-z][a-z0-9_]{1,29}")
_GOAL_KEY = re.compile(r"[a-z][a-z0-9_]{1,39}")
_CURRENCY = re.compile(r"[A-Za-z]{3}")
_STATUSES = ("success", "partial", "pending", "failed", "refunded", "reversed")
_STRIPE_ZERO_DECIMAL = frozenset(("BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "VND", "VUV", "XAF", "XOF", "XPF"))
_PAYSTACK_STATUS = {
    "success": "success",
    "failed": "failed",
    "abandoned": "failed",
    "reversed": "reversed",
    "ongoing": "pending",
    "pending": "pending",
    "processing": "pending",
    "queued": "pending",
}
_MONNIFY_STATUS = {
    "PAID": "success",
    "OVERPAID": "success",
    "PARTIALLY_PAID": "partial",
    "FAILED": "failed",
    "CANCELLED": "failed",
    "ABANDONED": "failed",
    "EXPIRED": "failed",
    "PENDING": "pending",
    "REVERSED": "reversed",
}
_STRIPE_PI_STATUS = {"succeeded": "success", "canceled": "failed", "processing": "pending"}

Obj = Dict[str, Any]


def _as_obj(value: Any) -> Optional[Obj]:
    """An object, or JSON text of one (parsed with exact decimals); else None."""
    if isinstance(value, (str, bytes, bytearray)):
        try:
            value = json.loads(value, parse_float=Decimal)
        except ValueError:
            return None
    return cast(Obj, value) if isinstance(value, Mapping) else None


def _unwrap(root: Obj, key: str) -> Obj:
    inner = root.get(key)
    return cast(Obj, inner) if isinstance(inner, Mapping) else root


def _str(value: Any) -> Optional[str]:
    """A trimmed string; numbers as their digits; empty or anything else is None."""
    if isinstance(value, str):
        t = value.strip()
        return t or None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value)
    if isinstance(value, Decimal):
        return format(value, "f") if value.is_finite() else None
    if isinstance(value, float):
        return repr(value) if math.isfinite(value) else None
    return None


def _first(*values: Any) -> Any:
    for v in values:
        if v is not None and v != "":
            return v
    return None


# ---- exact decimals (never float arithmetic) --------------------------------------------------------

_DEC_TEXT = re.compile(r"([+-]?)(\d+\.?\d*|\.\d+)(?:[eE]([+-]?\d+))?")


def _parse_dec(value: Any) -> Optional[Tuple[str, int]]:
    """``(digits, scale)`` meaning digits x 10^-scale; None when absent, unparsable or negative."""
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        text = value.strip()
    elif isinstance(value, int):
        text = str(value)
    elif isinstance(value, Decimal):
        if not value.is_finite():
            return None
        text = format(value, "f")
    elif isinstance(value, float):
        if not math.isfinite(value):
            return None
        text = repr(value)  # the float's shortest round-trip text
    else:
        return None
    m = _DEC_TEXT.fullmatch(text)
    if not m:
        return None
    int_part, _, frac = m.group(2).partition(".")
    digits = (int_part + frac).lstrip("0")
    scale = len(frac) - int(m.group(3) or 0)
    if not digits:
        return ("0", 0)
    if m.group(1) == "-":
        return None
    if scale < 0:
        digits += "0" * -scale
        scale = 0
    return (digits, scale)


def _format_dec(dec: Tuple[str, int], shift: int = 0) -> str:
    """The shortest exact decimal text: no exponent, no trailing fractional zeros."""
    digits, scale = dec[0], dec[1] + shift
    while scale > 0 and digits.endswith("0"):
        digits = digits[:-1]
        scale -= 1
    if not digits.strip("0"):
        return "0"
    if scale == 0:
        return digits
    padded = digits.rjust(scale + 1, "0")
    return f"{padded[:-scale]}.{padded[-scale:]}"


def _amount(value: Any, shift: int = 0) -> Optional[str]:
    dec = _parse_dec(value)
    return None if dec is None else _format_dec(dec, shift)


# ---- times ---------------------------------------------------------------------------------------

_ISO = re.compile(r"(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?([Zz]|[+-]\d{2}:?\d{2})?")
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _time(value: Any) -> Optional[str]:
    """Unix seconds (milliseconds above 10^11) or ISO 8601 text, in UTC; anything else is None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float, Decimal)):
        number = Decimal(repr(value)) if isinstance(value, float) else Decimal(value)
        if not number.is_finite():
            return None
        ms = int(number if number > 10**11 else number * 1000)
        try:
            return format_date(_EPOCH + timedelta(milliseconds=ms))
        except OverflowError:
            return None
    if not isinstance(value, str):
        return None
    m = _ISO.fullmatch(value.strip())
    if not m:
        return None
    frac = (m.group(7) or "")[:3].ljust(3, "0")
    zone = m.group(8)
    tz = timezone.utc
    if zone and zone.upper() != "Z":
        z = zone.replace(":", "")
        minutes = int(z[1:3]) * 60 + int(z[3:5])
        tz = timezone(timedelta(minutes=-minutes if z[0] == "-" else minutes))
    try:
        parts = [int(m.group(i) or 0) for i in range(1, 7)]
        dt = datetime(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5], int(frac) * 1000, tzinfo=tz)
    except ValueError:
        return None
    return format_date(dt)


def _metadata_click(meta: Any) -> Optional[str]:
    m = _as_obj(meta)
    value = m.get("cg_click_id") if m is not None else None
    return value if is_valid_click_id(value) else None


def _aliases(reference: str, *values: Any) -> Optional[List[str]]:
    out: List[str] = []
    for v in values:
        a = _str(v)
        if a is not None and a != reference and a not in out:
            out.append(a)
    return out[:5] or None


def _currency(value: Any) -> Optional[str]:
    s = _str(value)
    return s.upper() if s is not None else None


def _finish(body: Dict[str, Any], goal: Optional[str], click_id: Optional[str]) -> PaymentConfirmationBody:
    if click_id is not None:
        body["click_id"] = click_id
    if goal is not None:
        body["goal"] = goal
    return cast(PaymentConfirmationBody, {k: v for k, v in body.items() if v is not None})


def _lower(value: Any) -> str:
    return value.strip().lower() if isinstance(value, str) else ""


# ---- the builders (pure) ---------------------------------------------------------------------------


def build_from_paystack(response: Any, *, goal: Optional[str] = None, click_id: Optional[str] = None) -> Optional[PaymentConfirmationBody]:
    """Build the confirmation body from a Paystack ``GET /transaction/verify/{reference}`` response (or its
    ``data``) without sending it. Returns None when there is nothing to send. Reads only the reference, status,
    amount (÷ 100), currency, time, ``domain`` and ``metadata.cg_click_id``.

    Example::

        body = build_from_paystack(verify_response)  # {"provider": Provider.PAYSTACK.value, "status": "success", "amount": "7500", ...}
    """
    root = _as_obj(response)
    if root is None:
        return None
    d = _unwrap(root, "data")
    reference = _str(d.get("reference"))
    status = _PAYSTACK_STATUS.get(_lower(d.get("status")))
    if reference is None or status is None:
        return None
    domain = _str(d.get("domain"))
    return _finish(
        {
            "provider": Provider.PAYSTACK.value,
            "reference": reference,
            "status": status,
            "amount": _amount(d.get("amount"), 2),
            "currency": _currency(d.get("currency")),
            "occurred_at": _time(_first(d.get("paid_at"), d.get("paidAt"), d.get("created_at"))),
            "test": None if domain is None else domain.lower() == "test",
            "click_id": _metadata_click(d.get("metadata")),
        },
        goal,
        click_id,
    )


def build_from_flutterwave(
    response: Any, *, goal: Optional[str] = None, click_id: Optional[str] = None
) -> Optional[PaymentConfirmationBody]:
    """Build the confirmation body from a Flutterwave v3 verify response (``GET /v3/transactions/{id}/verify`` or
    ``verify_by_reference``, or its ``data``) without sending it. Returns None when there is nothing to send.

    Example::

        body = build_from_flutterwave(verify_response)
    """
    root = _as_obj(response)
    if root is None:
        return None
    d = _unwrap(root, "data")
    reference = _str(d.get("tx_ref")) or _str(d.get("reference"))
    if reference is None:
        return None
    raw = _lower(d.get("status"))
    status = "success" if raw in ("successful", "succeeded") else "failed" if raw in ("failed", "voided") else "pending"
    return _finish(
        {
            "provider": Provider.FLUTTERWAVE.value,
            "reference": reference,
            "aliases": _aliases(reference, d.get("id"), d.get("flw_ref")),
            "status": status,
            "amount": _amount(d.get("amount")),
            "currency": _currency(d.get("currency")),
            "occurred_at": _time(_first(d.get("created_at"), d.get("created_datetime"))),
            "click_id": _metadata_click(d.get("meta")) or _metadata_click(d.get("meta_data")),
        },
        goal,
        click_id,
    )


def build_from_monnify(response: Any, *, goal: Optional[str] = None, click_id: Optional[str] = None) -> Optional[PaymentConfirmationBody]:
    """Build the confirmation body from a Monnify transaction status response (``GET /api/v2/transactions/{ref}``
    or ``.../query?paymentReference=``, or its ``responseBody``; a webhook's ``eventData`` works too) without
    sending it. Returns None when there is nothing to send.

    Example::

        body = build_from_monnify(status_response)
    """
    root = _as_obj(response)
    if root is None:
        return None
    d = _unwrap(_unwrap(root, "responseBody"), "eventData")
    reference = _str(d.get("paymentReference"))
    raw = d.get("paymentStatus")
    status = _MONNIFY_STATUS.get(raw.strip().upper()) if isinstance(raw, str) else None
    if reference is None or status is None:
        return None
    return _finish(
        {
            "provider": Provider.MONNIFY.value,
            "reference": reference,
            "aliases": _aliases(reference, d.get("transactionReference")),
            "status": status,
            "amount": _amount(d.get("amountPaid")),
            "currency": _currency(_first(d.get("currency"), d.get("currencyCode"))),
            "occurred_at": _time(d.get("paidOn")),
            "click_id": _metadata_click(d.get("metaData")),
        },
        goal,
        click_id,
    )


def _is_no_payment_required(obj: Optional[Obj]) -> bool:
    return obj is not None and obj.get("object") == "checkout.session" and _lower(obj.get("payment_status")) == "no_payment_required"


def build_from_stripe(obj: Any, *, goal: Optional[str] = None, click_id: Optional[str] = None) -> Optional[PaymentConfirmationBody]:
    """Build the confirmation body from a Stripe PaymentIntent (``pi_...``) or Checkout Session (``cs_...``)
    object without sending it. Returns None when there is nothing to send (for example a session with
    ``payment_status: "no_payment_required"``).

    Example::

        body = build_from_stripe(payment_intent)
    """
    o = _as_obj(obj)
    if o is None:
        return None
    currency = _currency(o.get("currency"))
    shift = 0 if currency in _STRIPE_ZERO_DECIMAL else 2
    livemode = o.get("livemode")
    common: Dict[str, Any] = {
        "currency": currency,
        "occurred_at": _time(o.get("created")),
        "test": (not livemode) if isinstance(livemode, bool) else None,
        "click_id": _metadata_click(o.get("metadata")),
    }
    kind = o.get("object")
    if kind == "payment_intent":
        raw = _lower(o.get("status"))
        status = _STRIPE_PI_STATUS.get(raw) or ("pending" if raw.startswith("requires_") else None)
        reference = _str(o.get("id"))
        if status is None or reference is None:
            return None
        received = _parse_dec(o.get("amount_received"))
        amount = o.get("amount_received") if received is not None and received[0] != "0" else o.get("amount")
        return _finish(
            {"provider": Provider.STRIPE.value, "reference": reference, "status": status, "amount": _amount(amount, shift), **common},
            goal,
            click_id,
        )
    if kind == "checkout.session":
        payment_status = _lower(o.get("payment_status"))
        if payment_status == "no_payment_required":
            return None
        status = "success" if payment_status == "paid" else "failed" if o.get("status") == "expired" else "pending"
        session_id = _str(o.get("id"))
        intent = o.get("payment_intent")
        reference = _str(intent.get("id") if isinstance(intent, Mapping) else intent) or session_id
        if reference is None:
            return None
        return _finish(
            {
                "provider": Provider.STRIPE.value,
                "reference": reference,
                "aliases": _aliases(reference, session_id, o.get("client_reference_id")),
                "status": status,
                "amount": _amount(o.get("amount_total"), shift),
                **common,
            },
            goal,
            click_id,
        )
    return None


# ---- confirm -----------------------------------------------------------------------------------------


def build_confirm_wire(
    provider: Any,
    reference: Any,
    status: Any,
    amount: Optional[MoneyInput] = None,
    amount_minor: Optional[int] = None,
    currency: Optional[str] = None,
    occurred_at: Union[datetime, str, None] = None,
    aliases: Optional[Sequence[str]] = None,
    click_id: Optional[str] = None,
    goal: Optional[str] = None,
    test: Optional[bool] = None,
    extra: Optional[Mapping[str, Any]] = None,
) -> PaymentConfirmationBody:
    """Validate ``confirm`` parameters and build the wire body (SPEC 22.2). Raises :class:`InvalidRequestError`."""
    if isinstance(provider, Provider):
        provider = provider.value
    if not isinstance(provider, str) or not _PROVIDER.fullmatch(provider):
        raise local_error("invalid_provider", 'provider must be a provider key such as "paystack" or "stripe" (lower case).', "provider")
    if not isinstance(reference, str) or not 1 <= len(reference) <= 128:
        raise local_error("invalid_reference", "reference is required: the gateway's payment reference, 1-128 characters.", "reference")
    if not isinstance(status, str) or status not in _STATUSES:
        raise local_error("invalid_status", "status must be success, partial, pending, failed, refunded or reversed.", "status")
    if amount is not None and amount_minor is not None:
        raise local_error("amount_and_amount_minor", "Send either amount or amount_minor, not both.", "amount")
    amount_text: Optional[str] = None
    if amount is not None:
        try:
            amount_text = format_value(amount)
        except InvalidRequestError:
            raise local_error(
                "invalid_amount", "amount must be a non-negative decimal in normal units, like '7500.00'.", "amount"
            ) from None
    if amount_minor is not None and (isinstance(amount_minor, bool) or not isinstance(amount_minor, int) or amount_minor < 0):
        raise local_error("invalid_amount", "amount_minor must be a non-negative integer (ISO 4217 minor units).", "amount_minor")
    if currency is not None and (not isinstance(currency, str) or not _CURRENCY.fullmatch(currency)):
        raise local_error("invalid_currency", "currency must be an ISO 4217 code such as NGN or USD.", "currency")
    if aliases is not None and (isinstance(aliases, (str, bytes)) or len(aliases) > 5 or any(not isinstance(a, str) for a in aliases)):
        raise local_error("invalid_aliases", "aliases must be a list of at most 5 strings.", "aliases")
    if goal is not None and (not isinstance(goal, str) or not _GOAL_KEY.fullmatch(goal)):
        raise local_error("invalid_goal_key", "goal must be a goal key: snake_case, 2-40 characters.", "goal")
    wire: Dict[str, Any] = {
        "provider": provider,
        "reference": reference,
        "status": status,
        "amount": amount_text,
        "amount_minor": amount_minor,
        "currency": currency,
        "occurred_at": None if occurred_at is None else format_date(occurred_at),
        "aliases": list(aliases) if aliases else None,
        "click_id": click_id,
        "goal": goal,
        "test": test,
        **dict(extra or {}),
    }
    return cast(PaymentConfirmationBody, {k: v for k, v in wire.items() if v is not None})


_PATH = "/v1/payments/confirmations"
_BUILDERS = {
    "Paystack": build_from_paystack,
    "Flutterwave": build_from_flutterwave,
    "Monnify": build_from_monnify,
    "Stripe": build_from_stripe,
}


def _confirm_kwargs(body: PaymentConfirmationBody) -> Dict[str, Any]:
    b = cast(Dict[str, Any], body)
    return {
        k: b.get(k) for k in ("provider", "reference", "status", "amount", "currency", "occurred_at", "aliases", "click_id", "goal", "test")
    }


class _Builders:
    """The pure builders, also available as methods."""

    @staticmethod
    def build_from_paystack(
        response: Any, *, goal: Optional[str] = None, click_id: Optional[str] = None
    ) -> Optional[PaymentConfirmationBody]:
        """See :func:`clikgate.build_from_paystack`."""
        return build_from_paystack(response, goal=goal, click_id=click_id)

    @staticmethod
    def build_from_flutterwave(
        response: Any, *, goal: Optional[str] = None, click_id: Optional[str] = None
    ) -> Optional[PaymentConfirmationBody]:
        """See :func:`clikgate.build_from_flutterwave`."""
        return build_from_flutterwave(response, goal=goal, click_id=click_id)

    @staticmethod
    def build_from_monnify(
        response: Any, *, goal: Optional[str] = None, click_id: Optional[str] = None
    ) -> Optional[PaymentConfirmationBody]:
        """See :func:`clikgate.build_from_monnify`."""
        return build_from_monnify(response, goal=goal, click_id=click_id)

    @staticmethod
    def build_from_stripe(obj: Any, *, goal: Optional[str] = None, click_id: Optional[str] = None) -> Optional[PaymentConfirmationBody]:
        """See :func:`clikgate.build_from_stripe`."""
        return build_from_stripe(obj, goal=goal, click_id=click_id)


class Payments(_Builders):
    """Payments your server has verified. Call them right after your own verification with the gateway."""

    def __init__(self, core: Core) -> None:
        self._core = core

    def confirm(
        self,
        *,
        provider: Union[Provider, str],
        reference: str,
        status: str,
        amount: Optional[MoneyInput] = None,
        amount_minor: Optional[int] = None,
        currency: Optional[str] = None,
        occurred_at: Union[datetime, str, None] = None,
        aliases: Optional[Sequence[str]] = None,
        click_id: Optional[str] = None,
        goal: Optional[str] = None,
        test: Optional[bool] = None,
        extra: Optional[Mapping[str, Any]] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> PaymentConfirmation:
        """Confirm a payment your server has verified (``POST /v1/payments/confirmations``). Also for refunds
        (``status="refunded"``, ``amount`` = the refunded amount).

        Example::

            # right after your own verification with the gateway:
            clikgate.payments.confirm(provider="paystack", reference="T_ref_001", status="success", amount="7500.00", currency="NGN")
        """
        body = build_confirm_wire(
            provider, reference, status, amount, amount_minor, currency, occurred_at, aliases, click_id, goal, test, extra
        )
        if self._core.guard_state().guard:
            guard_payload("payment_confirmation", body)
        _s, data, _h = self._core.requester.request(ApiRequest("POST", _PATH, body=body).with_options(request_options))
        return cast(PaymentConfirmation, data)

    def _send(
        self, gateway: str, response: Any, goal: Optional[str], click_id: Optional[str], request_options: Optional[RequestOptions]
    ) -> Optional[PaymentConfirmation]:
        body = _BUILDERS[gateway](response, goal=goal, click_id=click_id)
        if body is None:
            if not (gateway == "Stripe" and _is_no_payment_required(_as_obj(response))):
                self._core.warn(
                    "unrecognised_payment_response",
                    f"The {gateway} response has no reference or no status the helper knows; nothing was sent to Clikgate.",
                )
            return None
        return self.confirm(**_confirm_kwargs(body), request_options=request_options)

    def from_paystack(
        self, response: Any, *, goal: Optional[str] = None, click_id: Optional[str] = None, request_options: Optional[RequestOptions] = None
    ) -> Optional[PaymentConfirmation]:
        """Send a Paystack verify response, right after your own ``GET /transaction/verify/{reference}`` call.
        Only the reference, status, amount (÷ 100), currency, time, test flag and ``metadata.cg_click_id`` are sent.
        Returns None when there is nothing to send.

        Example::

            verify = paystack.get(f"/transaction/verify/{reference}").json()  # your own call, with your key
            clikgate.payments.from_paystack(verify, goal="order_paid")
        """
        return self._send("Paystack", response, goal, click_id, request_options)

    def from_flutterwave(
        self, response: Any, *, goal: Optional[str] = None, click_id: Optional[str] = None, request_options: Optional[RequestOptions] = None
    ) -> Optional[PaymentConfirmation]:
        """Send a Flutterwave verify response, right after your own ``GET /v3/transactions/{id}/verify`` call.

        Example::

            clikgate.payments.from_flutterwave(flutterwave.get(f"/v3/transactions/{tx_id}/verify").json())
        """
        return self._send("Flutterwave", response, goal, click_id, request_options)

    def from_monnify(
        self, response: Any, *, goal: Optional[str] = None, click_id: Optional[str] = None, request_options: Optional[RequestOptions] = None
    ) -> Optional[PaymentConfirmation]:
        """Send a Monnify transaction status response, right after your own ``GET /api/v2/transactions/{ref}`` call.

        Example::

            clikgate.payments.from_monnify(monnify.get(f"/api/v2/transactions/{quote(ref)}").json())
        """
        return self._send("Monnify", response, goal, click_id, request_options)

    def from_stripe(
        self, obj: Any, *, goal: Optional[str] = None, click_id: Optional[str] = None, request_options: Optional[RequestOptions] = None
    ) -> Optional[PaymentConfirmation]:
        """Send a Stripe PaymentIntent or Checkout Session you retrieved, or received in a webhook you verified.
        A session with ``no_payment_required`` sends nothing and returns None.

        Example::

            clikgate.payments.from_stripe(stripe.PaymentIntent.retrieve(intent_id))
        """
        return self._send("Stripe", obj, goal, click_id, request_options)


class AsyncPayments(_Builders):
    """Async :class:`Payments`."""

    def __init__(self, core: AsyncCore) -> None:
        self._core = core

    async def confirm(
        self,
        *,
        provider: Union[Provider, str],
        reference: str,
        status: str,
        amount: Optional[MoneyInput] = None,
        amount_minor: Optional[int] = None,
        currency: Optional[str] = None,
        occurred_at: Union[datetime, str, None] = None,
        aliases: Optional[Sequence[str]] = None,
        click_id: Optional[str] = None,
        goal: Optional[str] = None,
        test: Optional[bool] = None,
        extra: Optional[Mapping[str, Any]] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> PaymentConfirmation:
        """Async :meth:`Payments.confirm`.

        Example::

            await clikgate.payments.confirm(provider="paystack", reference="T_ref_001", status="success", amount="7500.00", currency="NGN")
        """
        body = build_confirm_wire(
            provider, reference, status, amount, amount_minor, currency, occurred_at, aliases, click_id, goal, test, extra
        )
        if (await self._core.guard_state()).guard:
            guard_payload("payment_confirmation", body)
        _s, data, _h = await self._core.requester.request(ApiRequest("POST", _PATH, body=body).with_options(request_options))
        return cast(PaymentConfirmation, data)

    async def _send(
        self, gateway: str, response: Any, goal: Optional[str], click_id: Optional[str], request_options: Optional[RequestOptions]
    ) -> Optional[PaymentConfirmation]:
        body = _BUILDERS[gateway](response, goal=goal, click_id=click_id)
        if body is None:
            if not (gateway == "Stripe" and _is_no_payment_required(_as_obj(response))):
                self._core.warn(
                    "unrecognised_payment_response",
                    f"The {gateway} response has no reference or no status the helper knows; nothing was sent to Clikgate.",
                )
            return None
        return await self.confirm(**_confirm_kwargs(body), request_options=request_options)

    async def from_paystack(
        self, response: Any, *, goal: Optional[str] = None, click_id: Optional[str] = None, request_options: Optional[RequestOptions] = None
    ) -> Optional[PaymentConfirmation]:
        """Async :meth:`Payments.from_paystack`: right after your own Paystack verification.

        Example::

            await clikgate.payments.from_paystack(verify, goal="order_paid")
        """
        return await self._send("Paystack", response, goal, click_id, request_options)

    async def from_flutterwave(
        self, response: Any, *, goal: Optional[str] = None, click_id: Optional[str] = None, request_options: Optional[RequestOptions] = None
    ) -> Optional[PaymentConfirmation]:
        """Async :meth:`Payments.from_flutterwave`: right after your own Flutterwave verification.

        Example::

            await clikgate.payments.from_flutterwave(verify)
        """
        return await self._send("Flutterwave", response, goal, click_id, request_options)

    async def from_monnify(
        self, response: Any, *, goal: Optional[str] = None, click_id: Optional[str] = None, request_options: Optional[RequestOptions] = None
    ) -> Optional[PaymentConfirmation]:
        """Async :meth:`Payments.from_monnify`: right after your own Monnify status check.

        Example::

            await clikgate.payments.from_monnify(status)
        """
        return await self._send("Monnify", response, goal, click_id, request_options)

    async def from_stripe(
        self, obj: Any, *, goal: Optional[str] = None, click_id: Optional[str] = None, request_options: Optional[RequestOptions] = None
    ) -> Optional[PaymentConfirmation]:
        """Async :meth:`Payments.from_stripe`: a PaymentIntent or Checkout Session you retrieved or verified.

        Example::

            await clikgate.payments.from_stripe(intent)
        """
        return await self._send("Stripe", obj, goal, click_id, request_options)
