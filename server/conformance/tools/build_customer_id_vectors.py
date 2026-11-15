"""Build server/conformance/vectors/customer-id-vectors.json (change 26 KC.1, R.24).

One canonical form of a business's customer ID, and one validator, shared by the API (import, identify, account dates)
and every server SDK:

- canonical form: Unicode NFC, then trimmed of Unicode White_Space characters and U+FEFF at both ends; case kept;
- validator, in this order (first match wins):
  1. ``empty``: the canonical form is empty;
  2. ``too_long``: more than 128 Unicode code points;
  3. ``looks_like_email``: contains ``@`` with a ``.`` somewhere after the first ``@``;
  4. ``looks_like_national_id``: exactly 11 ASCII digits (BVN or NIN), unless the organisation turned on
     "My IDs are 11-digit numbers" (``allow_11_digit_ids``), which makes exactly 11 ASCII digits valid;
  5. ``looks_like_phone``: after removing spaces (U+0020) and dashes (U+002D), an optional ``+`` then 10-15 ASCII digits.

    python3 server/conformance/tools/build_customer_id_vectors.py           # rewrite the vectors
    python3 server/conformance/tools/build_customer_id_vectors.py --check   # fail if the file is stale

Every ID below is invented.
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "vectors" / "customer-id-vectors.json"

TRIM = "\t\n\x0b\x0c\r \x85\xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
MAX_LENGTH = 128
PHONE = re.compile(r"\+?[0-9]{10,15}")
NATIONAL_ID = re.compile(r"[0-9]{11}")


def canonical(customer_id: str) -> str:
    return unicodedata.normalize("NFC", customer_id).strip(TRIM)


def check(customer_id: str, allow_11_digit_ids: bool = False) -> str | None:
    cid = canonical(customer_id)
    if not cid:
        return "empty"
    if len(cid) > MAX_LENGTH:
        return "too_long"
    at = cid.find("@")
    if at >= 0 and "." in cid[at + 1 :]:
        return "looks_like_email"
    if NATIONAL_ID.fullmatch(cid) and cid.isascii():
        return None if allow_11_digit_ids else "looks_like_national_id"
    compact = cid.replace(" ", "").replace("-", "")
    if PHONE.fullmatch(compact) and compact.isascii():
        return "looks_like_phone"
    return None


# (name, input, allow_11_digit_ids)
CASES = [
    ("plain", "user_42", False),
    ("prefixed_numeric", "u_10482", False),
    ("short_number", "10482", False),
    ("case_kept", "User_ABC", False),
    ("inner_space_kept", "user 42", False),
    ("nfd_to_nfc", "cafe\u0301", False),
    ("already_nfc", "caf\u00e9", False),
    ("yoruba_marks", "ad\u00e9b\u00e1y\u1ecd\u0300_01", False),
    ("trim_ascii_whitespace", "  user_42\t\n", False),
    ("trim_nbsp_and_bom", "\ufeff\u00a0user_42\u3000", False),
    ("whitespace_only", " \t\u00a0", False),
    ("empty", "", False),
    ("emoji_outside_bmp", "user_\U0001f981_7", False),
    ("cjk", "\u9867\u5ba2-8812", False),
    ("length_128", "c" * 127 + "\u00e9", False),
    ("length_129", "c" * 129, False),
    ("length_128_after_nfc", "c" * 127 + "e\u0301", False),
    ("email", "ada@example.com", False),
    ("email_with_spaces_trimmed", " ada.obi@mail.example.ng ", False),
    ("at_without_dot_after", "ada@localhost", False),
    ("dot_only_before_at", "a.b@c", False),
    ("trailing_at", "user@", False),
    ("national_id_11_digits", "22212345678", False),
    ("national_id_allowed", "22212345678", True),
    ("phone_local_11_digits_with_spaces", "0803 123 4567", False),
    ("phone_local_11_digits_with_spaces_allowed_flag", "0803 123 4567", True),
    ("phone_international", "+2348031234567", False),
    ("phone_dashes", "234-803-123-4567", False),
    ("phone_10_digits", "8031234567", False),
    ("phone_15_digits", "+123456789012345", False),
    ("digits_16_not_phone", "1234567890123456", False),
    ("digits_9_not_phone", "803123456", False),
    ("plus_11_digits_is_phone", "+23480312345", False),
    ("arabic_indic_digits_not_phone", "\u0660\u0668\u0660\u0663\u0661\u0662\u0663\u0664\u0665\u0666\u0667", False),
    ("letters_and_digits", "a8031234567", False),
]


def build() -> str:
    vectors = [
        {
            "name": name,
            "input": value,
            "allow_11_digit_ids": allow,
            "canonical": canonical(value),
            "warning": check(value, allow),
        }
        for name, value, allow in CASES
    ]
    doc = {
        "description": (
            "Change 26 KC.1 / R.24 customer-ID vectors. canonical = Unicode NFC, then trimmed of Unicode White_Space and"
            " U+FEFF at both ends (case kept). warning (first match wins): empty; too_long (more than 128 code points);"
            " looks_like_email (an '@' with a '.' after the first '@'); looks_like_national_id (exactly 11 ASCII digits,"
            " unless allow_11_digit_ids, which makes them valid); looks_like_phone (after removing spaces and '-', an"
            " optional '+' then 10-15 ASCII digits); else null. Built by"
            " server/conformance/tools/build_customer_id_vectors.py. The API and every server SDK must agree on"
            " `canonical` and `warning` for each vector. Every ID is invented. Non-ASCII text is written as \\u escapes."
        ),
        "max_length": MAX_LENGTH,
        "vectors": vectors,
    }
    return json.dumps(doc, ensure_ascii=True, indent=2) + "\n"


def main() -> int:
    text = build()
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
            print(f"{OUT} is stale: run python3 {Path(__file__).relative_to(HERE.parents[2])}", file=sys.stderr)
            return 1
        print("customer-id vectors are up to date")
        return 0
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {len(CASES)} vectors to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
