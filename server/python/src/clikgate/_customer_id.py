"""Your customer IDs in one canonical form (change 26 KC.1, R.24), the form the API stores and checks.

- canonical form: Unicode NFC, trimmed of Unicode whitespace (and U+FEFF) at both ends, case kept;
- warnings (first match wins): ``empty``, ``too_long`` (more than 128 characters), ``looks_like_email``,
  ``looks_like_national_id`` (exactly 11 digits, unless ``allow_11_digit_ids``), ``looks_like_phone``.

Use your own stable user ID (for example ``u_10482``), never an email, phone number, BVN or NIN.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Optional

__all__ = ["CUSTOMER_ID_MAX_LENGTH", "canonical_customer_id", "customer_id_warning"]

# Unicode White_Space characters plus U+FEFF (the byte-order mark)
_TRIM = (
    "\t\n\x0b\x0c\r \x85\xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)
#: The longest customer ID kept as a known customer, in Unicode code points.
CUSTOMER_ID_MAX_LENGTH = 128
_NATIONAL_ID = re.compile(r"[0-9]{11}")
_PHONE = re.compile(r"\+?[0-9]{10,15}")


def canonical_customer_id(customer_id: str) -> str:
    """The canonical form of a customer ID: NFC, trimmed, case kept."""
    return unicodedata.normalize("NFC", customer_id).strip(_TRIM)


def customer_id_warning(customer_id: str, *, allow_11_digit_ids: bool = False) -> Optional[str]:
    """Why Clikgate wouldn't keep this ID as a known customer, or ``None`` when it's fine.

    Example::

        customer_id_warning("ada@example.com")  # "looks_like_email"
    """
    cid = canonical_customer_id(customer_id)
    if not cid:
        return "empty"
    if len(cid) > CUSTOMER_ID_MAX_LENGTH:
        return "too_long"
    at = cid.find("@")
    if at >= 0 and "." in cid[at + 1 :]:
        return "looks_like_email"
    if _NATIONAL_ID.fullmatch(cid):
        return None if allow_11_digit_ids else "looks_like_national_id"
    if _PHONE.fullmatch(cid.replace(" ", "").replace("-", "")):
        return "looks_like_phone"
    return None
