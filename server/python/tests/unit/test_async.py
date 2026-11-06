from __future__ import annotations

import asyncio
from typing import Any, List

import httpx
import pytest

from clikgate import AsyncClikgate, PrivateModeFieldRejectedError

from .conftest import KEY, Recorder


def run(coro: Any) -> Any:
    return asyncio.run(coro)


def test_async_send_and_background(recorder: Recorder) -> None:
    async def main() -> None:
        errors: List[Any] = []
        c = AsyncClikgate(
            KEY,
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(recorder)),
            private_mode=True,
            on_error=lambda e, _c: errors.append(e),
        )
        ev = await c.goals.send("account_opened", reference="APP-1", value="10")
        assert ev["counted"] is True
        with pytest.raises(PrivateModeFieldRejectedError):
            await c.goals.send("account_opened", reference="APP-1", metadata={"a": 1})
        recorder.handler = lambda _r: httpx.Response(200, json={"object": "list", "data": []})
        c.goal("order_paid", reference="R-1")
        c.goal("order_paid", reference="R-2", metadata={"x": 1})
        assert await c.flush(5)
        assert recorder.bodies()[-1] == {"events": [{"goal": "order_paid", "reference": "R-1"}]}
        assert isinstance(errors[0], PrivateModeFieldRejectedError)
        assert await c.close(1)

    run(main())


def test_async_goal_outside_loop_never_raises(recorder: Recorder) -> None:
    errors: List[str] = []
    c = AsyncClikgate(
        KEY,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(recorder)),
        shutdown_hooks=False,
        on_error=lambda e, _c: errors.append(e.code),
    )
    c.goal("order_paid", reference="R-1")
    assert errors == ["no_running_loop"]


def test_async_links_list(recorder: Recorder) -> None:
    pages = iter(
        [
            {"object": "list", "data": [{"id": "lnk_1"}], "has_more": True, "next_cursor": "lnk_1"},
            {"object": "list", "data": [{"id": "lnk_2"}], "has_more": False, "next_cursor": None},
        ]
    )
    recorder.handler = lambda _r: httpx.Response(200, json=next(pages))

    async def main() -> List[str]:
        c = AsyncClikgate(KEY, http_client=httpx.AsyncClient(transport=httpx.MockTransport(recorder)), shutdown_hooks=False)
        ids = [link["id"] async for link in c.links.list(limit=1)]
        await c.close(1)
        return ids

    assert run(main()) == ["lnk_1", "lnk_2"]
    assert recorder.requests[1].url.params["starting_after"] == "lnk_1"
