"""Build server/conformance/vectors/identity-token-vectors.json (versions 1 and 2).

Every token is made by the backend's own signer, ``sign_identity_token``, loaded by file path from the module named
in ``CLIKGATE_IDENTITY_SIGNER``, so every server SDK's ``createIdentityToken()`` is tested against the exact function
Clikgate verifies with. The maintainers' notes say where that module is.

    CLIKGATE_IDENTITY_SIGNER=<path> python3 server/conformance/tools/build_identity_token_vectors.py          # rewrite
    CLIKGATE_IDENTITY_SIGNER=<path> python3 server/conformance/tools/build_identity_token_vectors.py --check  # stale?

Version 2 tokens (``sig.issued_at.customer_since``) are made by the reference signer below. When the backend exposes
``sign_identity_token_v2(secret, customer_id, customer_since=, issued_at=)`` it must agree with the reference.

The secrets and customer IDs below are invented for the vectors; none is a real secret or customer.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import importlib.util
import json
import os
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "vectors" / "identity-token-vectors.json"
SIGNER_ENV = "CLIKGATE_IDENTITY_SIGNER"

SECRET = "cgis_VectorOnly0000000000000000000000000000"
SECRET_2 = "cgis_VectorOnlyOtherApp00000000000000000000"

CASES = [
    ("ascii", SECRET, "user_42", 1767225600),
    ("dots_in_customer_id", SECRET, "acct.2026.0042", 1767225600),
    ("latin_with_combining_marks", SECRET, "ad\u00e9b\u00e1y\u1ecd\u0300_01", 1767225600),
    ("precomposed_e_acute", SECRET, "caf\u00e9", 1767225600),
    ("decomposed_e_acute", SECRET, "cafe\u0301", 1767225600),
    ("cjk", SECRET, "\u9867\u5ba2-8812", 1767225600),
    ("emoji_outside_bmp", SECRET, "user_\U0001f981_7", 1767225600),
    ("arabic", SECRET, "\u0639\u0645\u064a\u0644_19", 1767225600),
    ("max_length_255", SECRET, "c" * 254 + "\u00e9", 1767225600),
    ("issued_at_after_2038", SECRET, "user_42", 4102444800),
    ("issued_at_zero", SECRET, "user_42", 0),
    ("other_app_secret", SECRET_2, "user_42", 1767225600),
    ("non_ascii_secret", "cgis_Vector\u00e9\u00df\u2603", "user_42", 1767225600),
]

# Version 2: (name, secret, customer_id as passed, issued_at, customer_since)
V2_CASES = [
    ("v2_ascii", SECRET, "user_42", 1767225600, 1709370000),
    ("v2_dots_in_customer_id", SECRET, "acct.2026.0042", 1767225600, 1709370000),
    ("v2_precomposed_e_acute", SECRET, "caf\u00e9", 1767225600, 1709370000),
    # NFD input is signed in its canonical (NFC) form: the same token as the precomposed case
    ("v2_decomposed_e_acute_signs_nfc", SECRET, "cafe\u0301", 1767225600, 1709370000),
    ("v2_surrounding_whitespace_trimmed", SECRET, " \u00a0user_42\t\n", 1767225600, 1709370000),
    ("v2_yoruba", SECRET, "ad\u00e9b\u00e1y\u1ecd\u0300_01", 1767225600, 1709370000),
    ("v2_cjk", SECRET, "\u9867\u5ba2-8812", 1767225600, 1709370000),
    ("v2_emoji_outside_bmp", SECRET, "user_\U0001f981_7", 1767225600, 1709370000),
    ("v2_customer_since_1990", SECRET, "user_42", 1767225600, 631152000),
    ("v2_customer_since_equals_issued_at", SECRET, "user_42", 1767225600, 1767225600),
    ("v2_customer_since_within_clock_allowance", SECRET, "user_42", 1767225600, 1767225900),
    ("v2_other_app_secret", SECRET_2, "user_42", 1767225600, 1709370000),
]

# customer_since a server SDK must refuse locally (InvalidRequestError, param customer_since), given issued_at
V2_INVALID_CUSTOMER_SINCE = [
    {"name": "before_1990", "issued_at": 1767225600, "customer_since": 631151999},
    {"name": "after_issued_at_plus_300", "issued_at": 1767225600, "customer_since": 1767225901},
    {"name": "negative", "issued_at": 1767225600, "customer_since": -1},
]

# Cross-version forgery: a version 1 token whose customer ID smuggles the dates must never verify as version 2,
# and a version 2 token cut to two parts must never verify as version 1. `forged_token` != the real token; the backend
# must refuse `forged_token` for (customer_id, issued_at, customer_since).
FORGERY_CASES = [
    ("v1_token_relabelled_as_v2", SECRET, "user_42", 1767225600, 1709370000),
    ("v2_token_cut_to_v1", SECRET, "user_42", 1767225600, 1709370000),
]

INVALID_CUSTOMER_IDS = [
    {"name": "empty", "customer_id": ""},
    {"name": "too_long_256", "customer_id": "c" * 256},
]


# Unicode White_Space plus U+FEFF (the byte-order mark): trimmed from both ends by every SDK
TRIM = "\t\n\x0b\x0c\r \x85\xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


def canonical_customer_id(customer_id: str) -> str:
    """The canonical customer ID: Unicode NFC, trimmed (TRIM), case kept."""
    return unicodedata.normalize("NFC", customer_id).strip(TRIM)


def reference_sign_v2(secret: str, customer_id: str, issued_at: int, customer_since: int) -> str:
    cid = canonical_customer_id(customer_id)
    msg = f"v2\n{len(cid.encode())}:{cid}\n{issued_at}\n{customer_since}"
    digest = hmac.new(secret.encode(), msg.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode() + f".{issued_at}.{customer_since}"


def load_backend():
    path = os.environ.get(SIGNER_ENV, "").strip()
    if not path:
        raise SystemExit(f"set {SIGNER_ENV} to the backend's identity-token signer module (a .py file)")
    spec = importlib.util.spec_from_file_location("clikgate_identity_tokens", Path(path))
    if spec is None or spec.loader is None:
        raise SystemExit(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build() -> str:
    backend = load_backend()
    sign = backend.sign_identity_token
    backend_v2 = getattr(backend, "sign_identity_token_v2", None)

    def sign_v2(secret: str, cid: str, issued: int, since: int) -> str:
        nonlocal backend_v2
        token = reference_sign_v2(secret, cid, issued, since)
        if backend_v2 is not None:
            try:
                theirs = backend_v2(secret, cid, customer_since=since, issued_at=issued)
            except ImportError:
                # The backend signer imports from its package (loaded here by file path): its own tests compare it
                # with these vectors instead (the backend's tests/fixtures/identity-token-vectors.json).
                print("note: backend sign_identity_token_v2 needs its package; not cross-checked here", file=sys.stderr)
                backend_v2 = None
                return token
            if theirs != token:
                raise SystemExit("backend sign_identity_token_v2 disagrees with the reference signer")
        return token

    v2 = [
        {"name": n, "secret": sec, "customer_id": cid, "issued_at": ia, "customer_since": cs, "token": sign_v2(sec, cid, ia, cs)}
        for n, sec, cid, ia, cs in V2_CASES
    ]
    forgeries = []
    for n, sec, cid, ia, cs in FORGERY_CASES:
        real = sign_v2(sec, cid, ia, cs)
        if n == "v1_token_relabelled_as_v2":
            # v1 signature over "user_42.1767225600.1709370000" via customer ID "user_42.1767225600", issued_at = cs
            forged = sign(sec, f"{cid}.{ia}", cs).rpartition(".")[0] + f".{ia}.{cs}"
        else:
            forged = real.rsplit(".", 1)[0]
        assert forged != real
        forgeries.append({"name": n, "secret": sec, "customer_id": cid, "issued_at": ia, "customer_since": cs, "real_token": real, "forged_token": forged})
    vectors = [
        {"name": name, "secret": secret, "customer_id": customer_id, "issued_at": issued_at, "token": sign(secret, customer_id, issued_at)}
        for name, secret, customer_id, issued_at in CASES
    ]
    doc = {
        "description": (
            "Identity-token vectors. token = base64url_nopad(HMAC_SHA256(secret, customer_id + '.' + issued_at))"
            " + '.' + issued_at, with secret and message encoded as UTF-8 and no Unicode normalisation (the precomposed and"
            " decomposed e-acute vectors differ). Built by server/conformance/tools/build_identity_token_vectors.py with"
            " the backend's own sign_identity_token. Every server SDK's createIdentityToken() must"
            " return `token` for each vector, and refuse every invalid_customer_ids entry (customer IDs are 1-255 characters,"
            " counted as Unicode code points, as the backend's identify schema does). The secrets and customer IDs are invented. Non-ASCII text is written as \\u escapes so no editor can normalise it."
        ),
        "vectors": vectors,
        "invalid_customer_ids": INVALID_CUSTOMER_IDS,
        "v2_description": (
            "Version 2 tokens: token = base64url_nopad(HMAC_SHA256(secret, msg)) + '.' + issued_at +"
            " '.' + customer_since, msg = 'v2\\n' + utf8_byte_length(cid) + ':' + cid + '\\n' + issued_at + '\\n' +"
            " customer_since, cid = the canonical customer ID (Unicode NFC, trimmed of Unicode White_Space and U+FEFF, case"
            " kept). Dates are whole UTC Unix seconds. createIdentityToken(customer_id, {issuedAt, customerSince}) must"
            " return `token` for each v2 vector and refuse every v2_invalid_customer_since entry. Version 1 (above) is"
            " unchanged. `forgeries`: forged_token must never verify (backend) and never equal real_token."
        ),
        "v2": v2,
        "v2_invalid_customer_since": V2_INVALID_CUSTOMER_SINCE,
        "forgeries": forgeries,
    }
    return json.dumps(doc, ensure_ascii=True, indent=2) + "\n"


def main() -> int:
    text = build()
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
            print(f"{OUT} is stale: run python3 {Path(__file__).relative_to(HERE.parents[2])}", file=sys.stderr)
            return 1
        print("identity-token vectors are up to date")
        return 0
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {len(CASES)} v1 + {len(V2_CASES)} v2 vectors to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
