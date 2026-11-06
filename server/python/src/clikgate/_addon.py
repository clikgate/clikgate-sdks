"""Shared by the framework add-ons (SPEC section 17)."""

from __future__ import annotations

import contextlib
import threading
from typing import Any, Optional, Union

from ._click_ids import ClickIds, click_ids

Client = Any  # Clikgate | AsyncClikgate (kept loose: the add-ons import no framework at module level)


def helpers_for(client: Optional[Client]) -> ClickIds:
    return client.click_ids if client is not None else click_ids


def warm_config(client: Optional[Client]) -> None:
    """Learn the organisation's ``click_id_param`` in the background; never blocks a request (SPEC 17)."""
    if client is None or getattr(client, "_clikgate_warmed", False):
        return
    try:
        client._clikgate_warmed = True
        config = getattr(client, "config", None)
        if config is None:
            return
        import inspect

        if inspect.iscoroutinefunction(config):
            import asyncio

            with contextlib.suppress(RuntimeError):
                asyncio.get_running_loop().create_task(config())
            return
        threading.Thread(target=_quiet, args=(config,), name="clikgate-config", daemon=True).start()
    except Exception:
        pass


def _quiet(fn: Any) -> None:
    with contextlib.suppress(Exception):
        fn()


def capture(helpers: ClickIds, request: Any) -> tuple[Optional[str], bool]:
    """The click ID from the request, and whether it came from the query string (then it is persisted)."""
    click_id = helpers.from_request(request)
    from_query = click_id is not None and helpers.from_query(request) == click_id
    return click_id, from_query


CookieDays = Union[int, float]
