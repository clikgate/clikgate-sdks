"""Reward amounts: minor units to normal units with the currency's ISO 4217 exponent (SPEC section 28)."""

from __future__ import annotations

from typing import Any, Dict, Optional, cast

from ._models import Referral, Referrer, ReferrerResult, RewardInfo

__all__ = ["currency_exponent", "minor_to_amount"]

# ISO 4217 exponents other than 2 (the backend's list); every other code has 2.
_EXPONENTS = {
    "BHD": 3, "BIF": 0, "CLF": 4, "CLP": 0, "DJF": 0, "GNF": 0, "IQD": 3, "ISK": 0, "JOD": 3, "JPY": 0, "KMF": 0,
    "KRW": 0, "KWD": 3, "LYD": 3, "OMR": 3, "PYG": 0, "RWF": 0, "TND": 3, "UGX": 0, "UYI": 0, "UYW": 4, "VND": 0,
    "VUV": 0, "XAF": 0, "XOF": 0, "XPF": 0,
}  # fmt: skip


def currency_exponent(currency: str) -> int:
    """The ISO 4217 minor-unit exponent of a currency (2 when unknown).

    Example::

        currency_exponent("JPY")  # 0
    """
    return _EXPONENTS.get(currency.upper(), 2)


def minor_to_amount(amount_minor: int, currency: str) -> str:
    """Minor units to a decimal string in normal units with exactly the currency's exponent of fraction digits.

    No float is involved: ``minor_to_amount(50000, "NGN") == "500.00"``, ``minor_to_amount(1500, "JPY") == "1500"``.
    """
    if isinstance(amount_minor, bool) or not isinstance(amount_minor, int):
        raise TypeError("amount_minor must be an int")
    exp = currency_exponent(currency)
    negative = amount_minor < 0
    digits = str(abs(amount_minor)).rjust(exp + 1, "0")
    whole = digits if exp == 0 else f"{digits[:-exp]}.{digits[-exp:]}"
    return f"-{whole}" if negative else whole


def _side(v: Any) -> Any:
    if not isinstance(v, dict):
        return v
    out: Dict[str, Any] = dict(v)
    minor, currency = v.get("amount_minor"), v.get("currency")
    if isinstance(minor, int) and not isinstance(minor, bool) and isinstance(currency, str) and currency:
        out["amount"] = minor_to_amount(minor, currency)
    return out


def reward_info(v: Any) -> Optional[RewardInfo]:
    """Add ``amount`` next to each reward side's ``amount_minor``."""
    if not isinstance(v, dict):
        return cast(Optional[RewardInfo], v)
    out: Dict[str, Any] = dict(v)
    for k in ("referrer", "referee"):
        if k in v:
            out[k] = _side(v[k])
    return cast(RewardInfo, out)


def to_referral(data: Any) -> Referral:
    """A referral with reward amounts."""
    if not isinstance(data, dict):
        return cast(Referral, data)
    out: Dict[str, Any] = dict(data)
    if isinstance(data.get("reward_snapshot"), dict):
        out["reward_snapshot"] = reward_info(data["reward_snapshot"])
    for k in ("referrer", "referee"):
        ref = data.get(k)
        if isinstance(ref, dict):
            out[k] = {**ref, "customer_id": ref.get("customer_user_id")}
    return cast(Referral, out)


def to_referrer(data: Any) -> Referrer:
    """A referrer with ``customer_id`` next to ``customer_user_id``."""
    if not isinstance(data, dict):
        return cast(Referrer, data)
    return cast(Referrer, {**data, "customer_id": data.get("customer_user_id")})


def to_referrer_result(data: Any, status: int) -> ReferrerResult:
    """A referrer with ``created`` (true for 201)."""
    out: Dict[str, Any] = dict(to_referrer(data)) if isinstance(data, dict) else {}
    out["created"] = status == 201
    return cast(ReferrerResult, out)
