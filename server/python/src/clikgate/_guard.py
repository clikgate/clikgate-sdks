"""The private-mode guard (SPEC 12.2): refuse every non-allowed field before the HTTP layer sees it."""

from __future__ import annotations

from typing import Any, Dict, Mapping

from ._errors import PrivateModeFieldRejectedError

_GOAL = (
    "goal",
    "click_id",
    "code",
    "reference",
    "value",
    "currency",
    "is_first",
    "occurred_at",
    "consent",
    "provider",
    "kept_by",
    "browser_engine",
    "platform",
    # SPEC 25: the API accepts them in private mode only while a destination matches by hashed email or phone
    "hashed_email",
    "hashed_phone_e164",
    "hashed_phone_digits",
)
# ``label`` is allowed: the API accepts it in private mode only with "Allow labels in private mode" (SPEC 24)
PRIVATE_ALLOWED: Dict[str, tuple[str, ...]] = {
    "goal": (*_GOAL, "label"),
    "conversion": (*_GOAL, "external_id"),
    "identify": ("click_id", "app_id", "installation_id", "label"),
    "reversal": ("goal", "reference", "value", "external_id", "amount_minor"),
    "payment_confirmation": (
        "provider",
        "reference",
        "status",
        "amount",
        "amount_minor",
        "currency",
        "occurred_at",
        "aliases",
        "click_id",
        "goal",
        "test",
        "refund_id",
        "source_plugin",
    ),
}

#: Shown instead of a reference while private mode is on.
REDACTED = "[redacted]"


def guard_payload(kind: str, wire: Mapping[str, Any]) -> None:
    """Raise PrivateModeFieldRejectedError for the first refused (non-null) wire field:
    ``metadata``, then ``consent``, then the rest alphabetically. The message names the field only."""
    allowed = PRIVATE_ALLOWED[kind]
    refused = [k for k, v in wire.items() if v is not None and k not in allowed]
    if not refused:
        return
    refused.sort(key=lambda k: (0 if k == "metadata" else 1 if k == "consent" else 2, k))
    name = refused[0]
    raise PrivateModeFieldRejectedError(
        f'Private mode is on: the field "{name}" can\'t be sent. Only {", ".join(allowed)} are allowed.',
        code="private_mode_field_rejected",
        param=name,
        field=name,
    )
