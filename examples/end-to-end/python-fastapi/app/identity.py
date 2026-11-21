"""Tells Clikgate which of your users is using the app. Two ways, and the sample shows both:

- Path A: an identity token in every response that says who is signed in. The app passes it to the mobile SDK.
- Path B: no secret. The app sends its ``Clikgate-Installation`` header, and the server calls ``identify_user``.

Your app needs only one of them.
"""

import logging
from typing import Optional

from clikgate import AsyncClikgate, ClikgateError, Installation

from .users import AppUser

log = logging.getLogger(__name__)


class ClikgateIdentity:
    def __init__(self, clikgate: AsyncClikgate, identity_secret: Optional[str]) -> None:
        self._clikgate = clikgate
        self._tokens_enabled = bool(identity_secret)

    # #region identity-token
    def identity_token(self, user: AppUser) -> Optional[str]:
        """Path A. Signed here with the identity secret, with no network call. Always pass the date the account was
        created (never "now" at sign-in), so Clikgate can tell an existing customer from a new one. Make a new token
        for each response, never store it, and never log it."""
        if not self._tokens_enabled:
            return None  # no identity secret configured: the app uses Path B
        return self._clikgate.create_identity_token(user.id, customer_since=user.created_at)
    # #endregion

    # #region identify-installation
    async def identify_installation(self, user: AppUser, installation: Optional[Installation]) -> None:
        """Path B. Call it only after your own sign-in check, with the user from your own session: the header names the
        app installation, never the customer. The dependency gives None for a missing or invalid header (tracking is
        off on that phone), and then there is nothing to do."""
        if installation is None:
            return
        try:
            await self._clikgate.identify_user(
                installation=installation,
                customer_id=user.id,
                customer_since=user.created_at,
            )
        except ClikgateError as err:
            # Never block sign-in on this: the app calls /me at its next open, which tries again.
            log.warning("Clikgate identify_user failed: %s", err.code)
    # #endregion
