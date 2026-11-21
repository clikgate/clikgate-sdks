"""Users and sessions, kept in memory so the sample runs with nothing else installed.

In your app this is your database (a users table) and your existing session or token handling.
"""

import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional


@dataclass(frozen=True)
class AppUser:
    #: Your own user ID: the same string goes to Clikgate as the customer ID, in the app and on the server.
    id: str
    email: str
    #: When the account was created. Clikgate uses it to tell existing customers from new ones.
    created_at: datetime
    password_hash: str = field(repr=False)

    def to_json(self) -> Dict[str, Any]:
        return {"id": self.id, "email": self.email, "createdAt": self.created_at.isoformat()}


class UserStore:
    def __init__(self) -> None:
        self._by_email: Dict[str, AppUser] = {}
        self._by_id: Dict[str, AppUser] = {}
        self._user_ids_by_session: Dict[str, str] = {}

    def create(self, email: str, password: str) -> Optional[AppUser]:
        """Creates the account, or returns None when the email is taken."""
        if email in self._by_email:
            return None
        user = AppUser(f"user_{uuid.uuid4()}", email, datetime.now(timezone.utc), _hash_password(password))
        self._by_email[email] = self._by_id[user.id] = user
        return user

    def sign_in(self, email: str, password: str) -> Optional[AppUser]:
        """Your own sign-in check: the user when the email and password match."""
        user = self._by_email.get(email)
        return user if user and _password_matches(password, user.password_hash) else None

    def start_session(self, user: AppUser) -> str:
        access_token = secrets.token_urlsafe(32)
        self._user_ids_by_session[access_token] = user.id
        return access_token

    def find_by_session(self, access_token: str) -> Optional[AppUser]:
        return self._by_id.get(self._user_ids_by_session.get(access_token, ""))


# Salted scrypt hashes, so even the sample never keeps a plain password. Use your framework's own.
def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    return f"{salt.hex()}:{hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1).hex()}"


def _password_matches(password: str, stored: str) -> bool:
    salt, expected = stored.split(":")
    actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1).hex()
    return hmac.compare_digest(actual, expected)
