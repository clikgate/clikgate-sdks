"""The backend of a mobile app, with Clikgate added. Run it with ``uvicorn app.main:app`` (see README.md)."""

from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

from clikgate import AsyncClikgate
from fastapi import FastAPI

from . import auth, payments, referrals, webhooks
from .config import Settings, load_settings
from .identity import ClikgateIdentity
from .rewards import ProcessedEvents, RewardStore
from .services import Services
from .users import UserStore


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        config = settings or load_settings()
        # Created inside the running event loop, which sends queued goals in the background.
        clikgate = AsyncClikgate(api_key=config.api_key, base_url=config.base_url, identity_secret=config.identity_secret)
        app.state.services = Services(
            settings=config,
            clikgate=clikgate,
            identity=ClikgateIdentity(clikgate, config.identity_secret),
            users=UserStore(),
            processed_events=ProcessedEvents(),
            rewards=RewardStore(),
        )
        yield
        await clikgate.close()  # sends any goals still queued

    app = FastAPI(title="Clikgate end-to-end sample", lifespan=lifespan)
    for module in (auth, payments, referrals, webhooks):
        app.include_router(module.router)
    return app


app = create_app()
