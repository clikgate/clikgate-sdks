"""The objects every route shares, built once at startup and handed to routes with ``Depends(services)``."""

from dataclasses import dataclass

from clikgate import AsyncClikgate
from fastapi import Request

from .config import Settings
from .identity import ClikgateIdentity
from .rewards import ProcessedEvents, RewardStore
from .users import UserStore


@dataclass
class Services:
    settings: Settings
    #: One client for the whole process: it is safe to share, and it sends queued goals in the background.
    clikgate: AsyncClikgate
    identity: ClikgateIdentity
    users: UserStore
    processed_events: ProcessedEvents
    rewards: RewardStore


def services(request: Request) -> Services:
    return request.app.state.services
