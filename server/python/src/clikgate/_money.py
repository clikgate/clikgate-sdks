"""Money (SPEC section 8): ``value`` is in normal units and always goes on the wire as a decimal string."""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Union

__all__ = ["MoneyInput", "format_value"]

#: A money amount in normal units (₦2,000,000 is ``2000000``). ``float`` is refused: pass a ``Decimal`` or a string.
MoneyInput = Union[Decimal, int, str]

_DECIMAL = re.compile(r"[0-9]+(\.[0-9]+)?")


def format_value(value: MoneyInput) -> str:
    """Format a money value for the wire: always a plain decimal string.

    - strings are trimmed and must look like ``2000000`` or ``1500.50`` (no signs, exponents or separators);
    - ``int`` is sent as its digits;
    - ``Decimal`` is sent in plain notation with its scale kept (``Decimal("1500.50")`` → ``"1500.50"``).

    Raises:
        TypeError: for ``float`` and ``bool`` (and any other type). Floats can't hold exact money amounts.
        InvalidRequestError: code ``invalid_value`` for negative, non-finite or malformed values.

    Example::

        format_value("1500.50")           # "1500.50"
        format_value(2_000_000)           # "2000000"
        format_value(Decimal("1E+3"))     # "1000"
    """
    from ._errors import local_error

    def bad(why: str) -> Exception:
        return local_error("invalid_value", f"value {why}. Pass a decimal string in normal units, like '1500.50'.", "value")

    if isinstance(value, (bool, float)):
        raise TypeError(
            f"value must be a Decimal, int or str, not {type(value).__name__}: floats can't hold exact amounts. "
            "Pass Decimal('1500.50') or '1500.50'."
        )
    if isinstance(value, str):
        s = value.strip()
        if not _DECIMAL.fullmatch(s):
            raise bad("must be a non-negative decimal number")
        return s
    if isinstance(value, int):
        if value < 0:
            raise bad("must not be negative")
        return str(value)
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise bad("must be a finite number")
        if value.is_signed() and value != 0:
            raise bad("must not be negative")
        return format(abs(value) if value == 0 else value, "f")
    raise TypeError(f"value must be a Decimal, int or str, not {type(value).__name__}.")
