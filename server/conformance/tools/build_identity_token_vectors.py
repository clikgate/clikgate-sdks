"""Build server/conformance/vectors/identity-token-vectors.json (change 22 I.1, R.27).

Every token is made by the backend's own signer, ``sign_identity_token`` in
``clikgate_api/src/sdk/utils/identity_tokens.py`` (loaded from the sibling checkout by file path), so every server
SDK's ``createIdentityToken()`` is tested against the exact function Clikgate verifies with.

    python3 server/conformance/tools/build_identity_token_vectors.py           # rewrite the vectors
    python3 server/conformance/tools/build_identity_token_vectors.py --check   # fail if the file is stale

The secrets and customer IDs below are invented for the vectors; none is a real secret or customer.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "vectors" / "identity-token-vectors.json"
BACKEND = HERE.parents[3] / "clikgate_api" / "src" / "sdk" / "utils" / "identity_tokens.py"

SECRET = "cgis_VectorOnly0000000000000000000000000000"
SECRET_2 = "cgis_VectorOnlyOtherApp00000000000000000000"

CASES = [
    ("ascii", SECRET, "user_42", 1767225600),
    ("dots_in_customer_id", SECRET, "acct.2026.0042", 1767225600),
    ("latin_with_combining_marks", SECRET, "adébáyọ̀_01", 1767225600),
    ("precomposed_e_acute", SECRET, "café", 1767225600),
    ("decomposed_e_acute", SECRET, "café", 1767225600),
    ("cjk", SECRET, "顧客-8812", 1767225600),
    ("emoji_outside_bmp", SECRET, "user_\U0001f981_7", 1767225600),
    ("arabic", SECRET, "عميل_19", 1767225600),
    ("max_length_255", SECRET, "c" * 254 + "é", 1767225600),
    ("issued_at_after_2038", SECRET, "user_42", 4102444800),
    ("issued_at_zero", SECRET, "user_42", 0),
    ("other_app_secret", SECRET_2, "user_42", 1767225600),
    ("non_ascii_secret", "cgis_Vectoréß☃", "user_42", 1767225600),
]

INVALID_CUSTOMER_IDS = [
    {"name": "empty", "customer_id": ""},
    {"name": "too_long_256", "customer_id": "c" * 256},
]


def load_signer():
    spec = importlib.util.spec_from_file_location("clikgate_identity_tokens", BACKEND)
    if spec is None or spec.loader is None:
        raise SystemExit(f"cannot load {BACKEND}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.sign_identity_token


def build() -> str:
    sign = load_signer()
    vectors = [
        {"name": name, "secret": secret, "customer_id": customer_id, "issued_at": issued_at, "token": sign(secret, customer_id, issued_at)}
        for name, secret, customer_id, issued_at in CASES
    ]
    doc = {
        "description": (
            "Change 22 I.1 / R.27 identity-token vectors. token = base64url_nopad(HMAC_SHA256(secret, customer_id + '.' + issued_at))"
            " + '.' + issued_at, with secret and message encoded as UTF-8 and no Unicode normalisation (the precomposed and"
            " decomposed e-acute vectors differ). Built by server/conformance/tools/build_identity_token_vectors.py from"
            " clikgate_api/src/sdk/utils/identity_tokens.py sign_identity_token. Every server SDK's createIdentityToken() must"
            " return `token` for each vector, and refuse every invalid_customer_ids entry (customer IDs are 1-255 characters,"
            " counted as Unicode code points, as the backend's identify schema does). The secrets and customer IDs are invented. Non-ASCII text is written as \\u escapes so no editor can normalise it."
        ),
        "vectors": vectors,
        "invalid_customer_ids": INVALID_CUSTOMER_IDS,
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
    print(f"wrote {len(CASES)} vectors to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
