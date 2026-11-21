"""Settings, read only from the environment (see .env.example)."""

import os
from dataclasses import dataclass
from typing import Mapping, Optional


@dataclass(frozen=True)
class Settings:
    api_key: str
    #: Only set for a local fake of the API (the tests use one); the SDK defaults to the real API.
    base_url: str
    #: Optional: without it, responses carry no identity token and the app uses the installation header.
    identity_secret: Optional[str]
    webhook_secret: str
    #: One referral program ID in your configuration, never one per user.
    referral_program_id: str


def load_settings(env: Mapping[str, str] = os.environ) -> Settings:
    return Settings(
        api_key=_required(env, "CLIKGATE_API_KEY"),
        base_url=env.get("CLIKGATE_BASE_URL") or "https://api.clikgate.com",
        identity_secret=env.get("CLIKGATE_IDENTITY_SECRET") or None,
        webhook_secret=_required(env, "CLIKGATE_WEBHOOK_SECRET"),
        referral_program_id=_required(env, "CLIKGATE_REFERRAL_PROGRAM_ID"),
    )


def _required(env: Mapping[str, str], name: str) -> str:
    value = env.get(name)
    if not value:
        raise RuntimeError(f"{name} is not set (see .env.example)")
    return value
