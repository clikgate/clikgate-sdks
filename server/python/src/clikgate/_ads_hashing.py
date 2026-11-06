"""Hashed email and phone for ad network matching.

The values Clikgate accepts as ``hashed_email``, ``hashed_phone_e164`` and ``hashed_phone_digits``: SHA-256 as 64
lowercase hex characters.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any, Mapping, Optional, TypedDict

from ._errors import local_error

__all__ = ["HASHED_FIELDS", "HashedIdentifiers", "check_hashed_fields", "hash_for_ads"]

#: The wire fields (also the Python option names).
HASHED_FIELDS = ("hashed_email", "hashed_phone_e164", "hashed_phone_digits")

_SHA256_HEX = re.compile(r"[0-9a-f]{64}")
_E164_DIGITS = re.compile(r"[1-9][0-9]{6,14}")
_NON_DIGIT = re.compile(r"[^0-9]")


class HashedIdentifiers(TypedDict, total=False):
    """What :func:`hash_for_ads` returns: only the fields for the values given, ready for ``**`` into ``goal()``."""

    #: SHA-256 of the email, trimmed and lowercased.
    hashed_email: str
    #: SHA-256 of the phone in E.164 with the ``+`` (``+2348031234567``).
    hashed_phone_e164: str
    #: SHA-256 of the phone digits with the country code, no ``+`` (``2348031234567``).
    hashed_phone_digits: str


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hash_for_ads(email: Optional[str] = None, phone: Optional[str] = None) -> HashedIdentifiers:
    """Normalise and hash an email and / or phone on your own server, for a goal's ad network matching.

    Pure and offline: no client needed. In private mode Clikgate never hashes for you: hash on your own server with
    this helper and send only the hashes. ``None`` (or a missing argument) gives no field.

    - ``email``: trimmed and lowercased; it must contain ``@``.
    - ``phone``: must include its country code (start with ``+`` or ``00``); spaces and punctuation are removed, and
      the result must be 7-15 digits starting with 1-9. A national number such as ``0803 123 4567`` is refused.

    Raises:
        InvalidRequestError: code ``invalid_argument``, ``param`` ``email`` or ``phone``; the input is never in the
            message.

    Example::

        clikgate.goal(
            "account_opened",
            reference="APP-55231",
            click_id=click_id,
            **hash_for_ads(email=customer.email, phone=customer.phone),  # e.g. "+234 803 123 4567"
        )
    """
    out: HashedIdentifiers = {}
    if email is not None:
        value = email.strip().lower() if isinstance(email, str) else ""
        if "@" not in value:
            raise local_error("invalid_argument", "email must be an email address (it contains @).", "email")
        out["hashed_email"] = _sha256(value)
    if phone is not None:
        trimmed = phone.strip() if isinstance(phone, str) else ""
        digits = _NON_DIGIT.sub("", trimmed)
        if trimmed.startswith("00"):
            digits = digits[2:]
        elif not trimmed.startswith("+"):
            digits = ""
        if not _E164_DIGITS.fullmatch(digits):
            raise local_error(
                "invalid_argument",
                'phone must include its country code, e.g. "+234 803 123 4567" (7-15 digits after the +).',
                "phone",
            )
        out["hashed_phone_e164"] = _sha256("+" + digits)
        out["hashed_phone_digits"] = _sha256(digits)
    return out


def check_hashed_fields(wire: Mapping[str, Any]) -> None:
    """Refuse a hashed wire field that isn't 64 lowercase hex characters (the value is never echoed)."""
    for field in HASHED_FIELDS:
        value = wire.get(field)
        if value is None:
            continue
        if not isinstance(value, str) or not _SHA256_HEX.fullmatch(value):
            raise local_error(
                "invalid_hashed_identifier",
                f"{field} must be a SHA-256 hash as 64 lowercase hex characters (use hash_for_ads).",
                field,
            )
