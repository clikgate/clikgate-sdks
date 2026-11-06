"""``GET /v1/server-sdk/config`` (SPEC 12.1): single attempt, 10-minute cache, fail closed, 60 s negative cache."""

from __future__ import annotations

import asyncio
import logging
import re
import threading
from typing import Any, Optional, Union, cast

from ._errors import ClikgateError
from ._http import ApiRequest, AsyncRequester, Requester
from ._types import ServerSdkConfig
from ._version import VERSION

CONFIG_TTL_MS = 10 * 60 * 1000
CONFIG_RETRY_MS = 60 * 1000
_TIMEOUT_CAP_S = 5.0
LoggerLike = Union[logging.Logger, logging.LoggerAdapter]  # type: ignore[type-arg]


def semver_less(a: str, b: str) -> bool:
    """Compare two semver strings (pre-release suffixes ignored)."""

    def parse(v: str) -> list[int]:
        core = re.split(r"[-+]", v, maxsplit=1)[0]
        out = []
        for p in core.split(".")[:3]:
            m = re.match(r"[0-9]+", p)
            out.append(int(m.group(0)) if m else 0)
        return out + [0] * (3 - len(out))

    return parse(a) < parse(b)


class _ConfigBase:
    def __init__(self, logger: LoggerLike, timeout: float, now_ms: Any) -> None:
        self.value: Optional[ServerSdkConfig] = None
        self.fetched_at = 0
        self.failed_at: Optional[int] = None
        self.version_warned = False
        self.logger = logger
        self.timeout = min(timeout, _TIMEOUT_CAP_S)
        self.now_ms = now_ms

    def peek(self) -> Optional[ServerSdkConfig]:
        """The cached config without fetching (may be stale or ``None``)."""
        return self.value

    def cached(self) -> tuple[bool, Optional[ServerSdkConfig]]:
        now = self.now_ms()
        if self.value is not None and now - self.fetched_at < CONFIG_TTL_MS:
            return True, self.value
        if self.failed_at is not None and now - self.failed_at < CONFIG_RETRY_MS:
            return True, None
        return False, None

    def request(self) -> ApiRequest:
        return ApiRequest("GET", "/v1/server-sdk/config", max_retries=0, timeout=self.timeout)

    def accept(self, data: Any) -> ServerSdkConfig:
        if not isinstance(data, dict) or not isinstance(data.get("private_mode"), bool):
            raise ValueError("unexpected config body")
        config = cast(ServerSdkConfig, data)
        self.value = config
        self.fetched_at = self.now_ms()
        self.failed_at = None
        versions = data.get("minimum_sdk_versions")
        minimum = versions.get("python") if isinstance(versions, dict) else None
        if not self.version_warned and isinstance(minimum, str) and semver_less(VERSION, minimum):
            self.version_warned = True
            self.logger.warning(
                f"clikgate (Python) {VERSION} is below the minimum version {minimum} for your organisation. Please upgrade.",
                extra={"clikgate_code": "sdk_below_minimum_version"},
            )
        return config

    def fail(self, err: BaseException) -> None:
        self.value = None
        self.failed_at = self.now_ms()
        why = err.code if isinstance(err, ClikgateError) else "error"
        self.logger.warning(
            f"Could not load the server SDK config ({why}); the private-mode guard stays on until it loads.",
            extra={"clikgate_code": "config_unavailable"},
        )


class ConfigCache(_ConfigBase):
    """Thread-safe; concurrent callers share one in-flight request."""

    def __init__(self, requester: Requester, logger: LoggerLike, timeout: float) -> None:
        super().__init__(logger, timeout, requester.now_ms)
        self.requester = requester
        self.lock = threading.Lock()

    def get(self) -> Optional[ServerSdkConfig]:
        hit, value = self.cached()
        if hit:
            return value
        with self.lock:
            hit, value = self.cached()
            if hit:
                return value
            try:
                _status, data, _h = self.requester.request(self.request())
                return self.accept(data)
            except Exception as err:
                self.fail(err)
                return None


class AsyncConfigCache(_ConfigBase):
    def __init__(self, requester: AsyncRequester, logger: LoggerLike, timeout: float) -> None:
        super().__init__(logger, timeout, requester.now_ms)
        self.requester = requester
        self.inflight: Optional[asyncio.Future[Optional[ServerSdkConfig]]] = None

    async def _fetch(self) -> Optional[ServerSdkConfig]:
        try:
            _status, data, _h = await self.requester.request(self.request())
            return self.accept(data)
        except Exception as err:
            self.fail(err)
            return None

    async def get(self) -> Optional[ServerSdkConfig]:
        hit, value = self.cached()
        if hit:
            return value
        if self.inflight is None or self.inflight.get_loop() is not asyncio.get_running_loop():
            self.inflight = asyncio.ensure_future(self._fetch())
            fut = self.inflight
            fut.add_done_callback(lambda _f: setattr(self, "inflight", None) if self.inflight is fut else None)
        return await asyncio.shield(self.inflight)
