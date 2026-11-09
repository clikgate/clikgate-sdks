"""'Allow unknown goal names' off: 422 unknown_goal / goal_archived are final, and debug logging names the goal only."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, List, Tuple

import httpx
import pytest

from clikgate import AsyncClikgate, Clikgate, ClikgateError, ErrorContext, InvalidRequestError

from .conftest import KEY, Recorder

LINE = "Goal `level_complete` isn't set up in Clikgate"
ENVELOPE = {
    "error": {"type": "invalid_request", "code": "unknown_goal", "message": "This goal isn't set up in Clikgate.", "param": "goal"},
    "status": "refused",
    "reason": "unknown_goal",
    "counted": False,
    "goal_kind": None,
}
REFUSAL = {"status": "refused", "reason": "unknown_goal", "counted": False, "goal_kind": None}
ITEM = {
    "index": 1,
    "ok": False,
    "status": 422,
    "goal_event": None,
    "error": {"type": "invalid_request", "code": "unknown_goal", "message": "x", "param": "goal"},
}
OK0 = {"index": 0, "ok": True, "status": 201, "goal_event": {"object": "goal_event", "status": "counted", "reason": None}, "error": None}


class Lines(logging.Handler):
    def __init__(self) -> None:
        super().__init__(logging.DEBUG)
        self.lines: List[Tuple[int, str]] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.lines.append((record.levelno, record.getMessage()))

    def debug(self) -> List[str]:
        return [m for lvl, m in self.lines if lvl == logging.DEBUG]


def logger(level: int) -> Tuple[logging.Logger, Lines]:
    log = logging.getLogger(f"clikgate.test.strict.{level}.{id(object())}")
    log.propagate = False
    log.setLevel(level)
    h = Lines()
    log.addHandler(h)
    return log, h


def client(rec: Recorder, **kw: Any) -> Clikgate:
    kw.setdefault("send_mode", "sync")
    return Clikgate(KEY, http_client=httpx.Client(transport=httpx.MockTransport(rec)), shutdown_hooks=False, private_mode=False, **kw)


def answers(*bodies: Tuple[int, Any]) -> Recorder:
    queue = list(bodies)
    return Recorder(
        lambda _r: httpx.Response(queue[0][0], json=queue.pop(0)[1]) if len(queue) > 1 else httpx.Response(queue[0][0], json=queue[0][1])
    )


def test_send_unknown_goal_is_final_and_logged_at_debug() -> None:
    rec = answers((422, ENVELOPE))
    log, h = logger(logging.DEBUG)
    c = client(rec, logger=log, max_retries=3)
    with pytest.raises(InvalidRequestError) as exc:
        c.goals.send("level_complete", reference="APP-77120", value="2500", label="Ada")
    assert (exc.value.code, exc.value.http_status) == ("unknown_goal", 422)
    assert len(rec.requests) == 1
    assert h.debug() == [LINE]
    assert all("APP-77120" not in m and "2500" not in m and "Ada" not in m for _l, m in h.lines)


def test_refusal_body_maps_to_its_reason() -> None:
    rec = answers((422, REFUSAL), (422, {"status": "refused", "reason": "goal_archived"}))
    log, h = logger(logging.DEBUG)
    c = client(rec, logger=log, max_retries=3)
    with pytest.raises(InvalidRequestError) as unknown:
        c.goals.send("level_complete", reference="APP-1")
    assert unknown.value.code == "unknown_goal"
    assert unknown.value.raw == REFUSAL
    with pytest.raises(InvalidRequestError) as archived:
        c.goals.send("old_signup", reference="APP-2")
    assert (archived.value.code, archived.value.http_status) == ("goal_archived", 422)
    assert len(rec.requests) == 2
    assert h.debug() == [LINE]


def test_no_line_without_debug_logging() -> None:
    log, h = logger(logging.WARNING)
    c = client(answers((422, ENVELOPE)), logger=log)
    with pytest.raises(InvalidRequestError):
        c.goals.send("level_complete", reference="APP-1")
    assert h.lines == []


def test_the_name_is_never_remembered() -> None:
    rec = answers((422, ENVELOPE), (201, {"object": "goal_event", "status": "counted"}))
    c = client(rec)
    with pytest.raises(InvalidRequestError):
        c.goals.send("level_complete", reference="APP-1")
    assert c.goals.send("level_complete", reference="APP-2")["status"] == "counted"
    assert len(rec.requests) == 2


def test_batch_and_background_items() -> None:
    rec = answers((200, {"object": "list", "data": [OK0, ITEM]}))
    log, h = logger(logging.DEBUG)
    result = client(rec, logger=log).goals.send_batch(
        [{"goal": "order_paid", "reference": "R-0"}, {"goal": "level_complete", "reference": "APP-77120"}]
    )
    assert result["data"][1]["ok"] is False
    errors: List[Tuple[str, bool]] = []

    def on_error(e: ClikgateError, ctx: ErrorContext) -> None:
        errors.append((e.code, ctx.dropped))

    bg = client(rec, logger=log, send_mode="background", on_error=on_error)
    bg.goal("order_paid", reference="R-0")
    bg.goal("level_complete", reference="APP-77120", value="2500")
    assert bg.flush(2) is True
    assert bg.flush(2) is True
    bg.close(1)
    assert len(rec.requests) == 2
    assert errors == [("unknown_goal", True)]
    assert h.debug() == [LINE, LINE]


def test_async_send_unknown_goal() -> None:
    log, h = logger(logging.DEBUG)
    seen: List[httpx.Request] = []

    def handler(r: httpx.Request) -> httpx.Response:
        seen.append(r)
        return httpx.Response(422, json=REFUSAL)

    async def main() -> None:
        c = AsyncClikgate(
            KEY,
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
            shutdown_hooks=False,
            private_mode=False,
            send_mode="sync",
            logger=log,
            max_retries=3,
        )
        with pytest.raises(InvalidRequestError) as exc:
            await c.goals.send("level_complete", reference="APP-1")
        assert exc.value.code == "unknown_goal"
        await c.close(1)

    asyncio.run(main())
    assert len(seen) == 1
    assert h.debug() == [LINE]
