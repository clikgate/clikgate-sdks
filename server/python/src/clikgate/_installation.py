"""The ``Clikgate-Installation`` header (SPEC section 24.1).

The mobile SDKs give the app a value ``<app_id>:<installation_id>`` to send to its own backend at sign-in and on
signed-in requests. It is not a secret. Your server passes it to ``identify_user(installation=...)``, so it never needs
to know which Clikgate app ID belongs to which platform.

The header only names the app installation. The customer ID always comes from your own signed-in user, never from the
request.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Optional

from ._click_ids import _request_parts

__all__ = [
    "INSTALLATION_HEADER",
    "INSTALLATION_HEADER_MAX_LENGTH",
    "INSTALLATION_PATTERN",
    "Installation",
    "installation_from_request",
    "parse_installation_header",
]

#: The header name the app sends to your backend.
INSTALLATION_HEADER = "Clikgate-Installation"
#: Longer header values are refused before they are looked at.
INSTALLATION_HEADER_MAX_LENGTH = 128
#: ``app_`` + a 26-character ID, one colon, a lowercase UUID.
INSTALLATION_PATTERN = re.compile(r"(app_[0-9A-Z]{26}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})")


@dataclass(frozen=True)
class Installation:
    """An app installation read from the ``Clikgate-Installation`` header."""

    #: The Clikgate app ID (``app_…``).
    app_id: str
    #: The SDK's installation ID (a lowercase UUID).
    installation_id: str


def parse_installation_header(value: Any) -> Optional[Installation]:
    """Parse a ``Clikgate-Installation`` header value. ``None`` for anything that isn't exactly
    ``<app_id>:<installation_id>`` (after trimming, at most 128 characters, lowercase UUID). Never raises.

    Example::

        installation = parse_installation_header(request.headers.get("Clikgate-Installation"))
        # Installation(app_id="app_01J…", installation_id="3f2b…") or None
    """
    if not isinstance(value, str) or len(value) > INSTALLATION_HEADER_MAX_LENGTH:
        return None
    match = INSTALLATION_PATTERN.fullmatch(value.strip(" \t\r\n\f\v"))
    return Installation(match.group(1), match.group(2)) if match else None


def to_installation(value: Any) -> Optional[Installation]:
    """An installation from the raw header (a ``str``) or a parsed :class:`Installation` (from the framework helpers),
    through the same strict check. ``None`` for anything else. Never raises."""
    if isinstance(value, str):
        return parse_installation_header(value)
    if isinstance(value, Installation) and isinstance(value.app_id, str) and isinstance(value.installation_id, str):
        return parse_installation_header(f"{value.app_id}:{value.installation_id}")
    return None


def installation_from_request(request: Any) -> Optional[Installation]:
    """The installation from a request's ``Clikgate-Installation`` header, or ``None`` when it is missing, invalid or
    sent more than once. Accepts Django, Flask/Werkzeug and Starlette requests, a WSGI environ, an ASGI scope, or
    ``{"headers": {…}}``. Never raises.

    Example::

        installation = installation_from_request(request)
    """
    try:
        _url, header = _request_parts(request)
        return parse_installation_header(header(INSTALLATION_HEADER))
    except Exception:
        return None
