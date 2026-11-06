"""State shared by the resources of one client: logging, ``on_error``, redaction and the guard state."""

from __future__ import annotations

import contextlib
import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Literal, Optional, Set, Union

from ._config import AsyncConfigCache, ConfigCache, LoggerLike
from ._errors import ClikgateError
from ._guard import REDACTED
from ._http import AsyncRequester, Requester
from ._types import ServerSdkConfig

__all__ = ["ErrorContext", "OnError"]

PrivateMode = Union[Literal["auto"], bool]


@dataclass(frozen=True)
class ErrorContext:
    """What ``on_error`` receives next to the error (SPEC 9.5). Never values, metadata or consent."""

    #: ``goal``, ``goals.batch`` or ``config``.
    operation: str
    #: The affected events as ``{"goal", "reference"}``; references are ``[redacted]`` while private mode is on.
    events: List[Dict[str, str]] = field(default_factory=list)
    #: True when the events won't be retried.
    dropped: bool = True


#: Called for failures that can't be raised (background sends and every ``goal()`` call).
OnError = Callable[[ClikgateError, ErrorContext], None]


@dataclass
class GuardState:
    guard: bool
    config: Optional[ServerSdkConfig]


class _CoreBase:
    def __init__(self, logger: LoggerLike, private_mode: PrivateMode, on_error: Optional[OnError]) -> None:
        self.logger = logger
        self.private_mode = private_mode
        self.on_error = on_error
        self._warned: Set[str] = set()
        self._lock = threading.Lock()

    def peek_config(self) -> Optional[ServerSdkConfig]:
        raise NotImplementedError

    def warn(self, code: str, message: str, once_key: Optional[str] = None) -> None:
        """Warn with a stable code. With ``once_key``, at most once per client for that key."""
        if once_key is not None:
            k = f"{code}:{once_key}"
            with self._lock:
                if k in self._warned:
                    return
                self._warned.add(k)
        self.logger.warning(message, extra={"clikgate_code": code})

    def may_be_private(self) -> bool:
        """Whether the guard is (or may be) on right now, without fetching: used for redaction."""
        if self.private_mode is True:
            return True
        if self.private_mode is False:
            return False
        cfg = self.peek_config()
        return cfg is None or bool(cfg.get("private_mode"))

    def state_from(self, config: Optional[ServerSdkConfig]) -> GuardState:
        return GuardState(guard=config is None or bool(config.get("private_mode")), config=config)

    def shown_reference(self, reference: Any) -> str:
        if self.may_be_private():
            return REDACTED
        return reference if isinstance(reference, str) else ("" if reference is None else str(reference))

    def report(self, error: ClikgateError, context: ErrorContext) -> None:
        """Log at error level and call ``on_error``. Never raises."""
        try:
            who = ", ".join(f"{e['goal']}:{e['reference']}" for e in context.events)
            rid = f", request {error.request_id}" if error.request_id else ""
            self.logger.error(
                f"Clikgate {context.operation} failed ({type(error).__name__} {error.code}{rid}) for {who or 'no events'}"
                f"{'; dropped' if context.dropped else ''}.",
                extra={"clikgate_code": error.code},
            )
        except Exception:  # a broken logger must not break the caller
            pass
        if self.on_error is None:
            return
        try:
            self.on_error(error, context)
        except Exception as err:
            with contextlib.suppress(Exception):
                self.logger.error(f"on_error raised: {type(err).__name__}: {err}")


class Core(_CoreBase):
    def __init__(
        self, requester: Requester, config: ConfigCache, logger: LoggerLike, private_mode: PrivateMode, on_error: Optional[OnError]
    ) -> None:
        super().__init__(logger, private_mode, on_error)
        self.requester = requester
        self.config = config

    def peek_config(self) -> Optional[ServerSdkConfig]:
        return self.config.peek()

    def guard_state(self) -> GuardState:
        if self.private_mode is True:
            return GuardState(True, None)
        if self.private_mode is False:
            return GuardState(False, None)
        return self.state_from(self.config.get())


class AsyncCore(_CoreBase):
    def __init__(
        self,
        requester: AsyncRequester,
        config: AsyncConfigCache,
        logger: LoggerLike,
        private_mode: PrivateMode,
        on_error: Optional[OnError],
    ) -> None:
        super().__init__(logger, private_mode, on_error)
        self.requester = requester
        self.config = config

    def peek_config(self) -> Optional[ServerSdkConfig]:
        return self.config.peek()

    async def guard_state(self) -> GuardState:
        if self.private_mode is True:
            return GuardState(True, None)
        if self.private_mode is False:
            return GuardState(False, None)
        return self.state_from(await self.config.get())
