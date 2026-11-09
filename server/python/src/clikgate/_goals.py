"""Goal events (SPEC section 9): validation, the private-mode guard, ``goals.*`` and the background sender."""

from __future__ import annotations

import asyncio
import contextlib
import os
import queue
import re
import threading
from collections import deque
from datetime import datetime
from functools import partial
from typing import Any, Awaitable, Callable, Deque, Dict, List, Mapping, Optional, Sequence, TypedDict, Union, cast

from ._ads_hashing import check_hashed_fields
from ._click_ids import BROWSER_ENGINES, KEPT_BY, PLATFORMS
from ._core import AsyncCore, Core, ErrorContext, GuardState, _CoreBase
from ._enums import GoalKind, GoalStatus, Provider
from ._errors import ClikgateError, InvalidRequestError, as_clikgate_error, error_from_batch_item, local_error
from ._guard import guard_payload
from ._http import ApiRequest, RequestOptions, format_date, is_retryable
from ._money import MoneyInput, format_value
from ._types import GoalBatchResult, GoalEvent

__all__ = ["AsyncGoals", "GoalBatchEvent", "Goals", "check_provider", "with_enums"]

_GOAL_KEY = re.compile(r"[a-z][a-z0-9_]{1,39}")
_MAX_FAILED_ROUNDS = 3
_KNOWN = (
    "goal",
    "reference",
    "click_id",
    "code",
    "value",
    "currency",
    "is_first",
    "occurred_at",
    "metadata",
    "consent",
    "extra",
    "provider",
    "label",
    "kept_by",
    "browser_engine",
    "platform",
    "hashed_email",
    "hashed_phone_e164",
    "hashed_phone_digits",
)
_PROVIDER = re.compile(r"[a-z][a-z0-9_]{1,29}")


class GoalBatchEvent(TypedDict, total=False):
    """One event of ``goals.send_batch``: the goal key (``goal``) plus the same options as ``goals.send``."""

    goal: str
    reference: str
    click_id: Optional[str]
    code: Optional[str]
    value: Optional[MoneyInput]
    currency: Optional[str]
    is_first: Optional[bool]
    occurred_at: Union[datetime, str, None]
    metadata: Optional[Mapping[str, Any]]
    consent: Optional[Mapping[str, Any]]
    extra: Optional[Mapping[str, Any]]
    provider: Union[Provider, str, None]
    label: Optional[str]
    kept_by: Optional[str]
    browser_engine: Optional[str]
    platform: Optional[str]
    hashed_email: Optional[str]
    hashed_phone_e164: Optional[str]
    hashed_phone_digits: Optional[str]


Wire = Dict[str, Any]


def check_provider(provider: Any) -> str:
    """A ``Provider`` or a provider-key string (a gateway newer than this release); else ``invalid_provider``."""
    value = provider.value if isinstance(provider, Provider) else provider
    if not isinstance(value, str) or not _PROVIDER.fullmatch(value):
        raise local_error("invalid_provider", 'provider must be a provider key such as "paystack" or "stripe" (lower case).', "provider")
    return value


def _event_enums(event: Any) -> None:
    if not isinstance(event, dict):
        return
    status = event.get("status")
    if isinstance(status, str) and not isinstance(status, GoalStatus):
        with contextlib.suppress(ValueError):
            event["status"] = GoalStatus(status)
    kind = event.get("goal_kind")
    if isinstance(kind, str) and not isinstance(kind, GoalKind):
        with contextlib.suppress(ValueError):
            event["goal_kind"] = GoalKind(kind)


def with_enums(data: Any) -> Any:
    """``status`` → ``GoalStatus`` and ``goal_kind`` → ``GoalKind`` when known (str members, so the JSON and
    ``== "counted"`` still work); a value this release doesn't know stays a plain ``str``. Works on a goal event
    and on a batch result."""
    if isinstance(data, dict):
        if isinstance(data.get("data"), list):
            for item in data["data"]:
                if isinstance(item, dict):
                    _event_enums(item.get("goal_event"))
        else:
            _event_enums(data)
    return data


def _check_enum(field: str, value: Any, allowed: Sequence[str]) -> None:
    """``kept_by`` / ``browser_engine`` / ``platform`` (change 16): one of the documented values, else ``invalid_argument``."""
    if value is None:
        return
    if not isinstance(value, str) or value not in allowed:
        raise local_error("invalid_argument", f"{field} must be one of {', '.join(allowed)}.", field)


def check_key(key: Any) -> str:
    if not isinstance(key, str) or not _GOAL_KEY.fullmatch(key):
        raise local_error(
            "invalid_goal_key", 'Goal keys are snake_case, 2-40 characters, starting with a letter (e.g. "account_opened").', "goal"
        )
    return key


def check_reference(reference: Any) -> str:
    if not isinstance(reference, str) or not 1 <= len(reference) <= 128:
        raise local_error("invalid_reference", "reference is required: your own unique ID for this event, 1-128 characters.", "reference")
    return reference


def build_goal_wire(
    key: Any,
    reference: Any,
    click_id: Optional[str] = None,
    code: Optional[str] = None,
    value: Optional[MoneyInput] = None,
    currency: Optional[str] = None,
    is_first: Optional[bool] = None,
    occurred_at: Union[datetime, str, None] = None,
    metadata: Optional[Mapping[str, Any]] = None,
    consent: Optional[Mapping[str, Any]] = None,
    extra: Optional[Mapping[str, Any]] = None,
    provider: Union[Provider, str, None] = None,
    label: Optional[str] = None,
    *,
    kept_by: Optional[str] = None,
    browser_engine: Optional[str] = None,
    platform: Optional[str] = None,
    hashed_email: Optional[str] = None,
    hashed_phone_e164: Optional[str] = None,
    hashed_phone_digits: Optional[str] = None,
) -> Wire:
    """Validate goal options and build the wire object (SPEC 9.1 step 1)."""
    goal = check_key(key)
    ref = check_reference(reference)
    if click_id is not None and code is not None:
        raise local_error("click_id_and_code", "Send either click_id or code, not both.", "code")
    _check_enum("kept_by", kept_by, KEPT_BY)
    _check_enum("browser_engine", browser_engine, BROWSER_ENGINES)
    _check_enum("platform", platform, PLATFORMS)
    provider_value = None if provider is None else check_provider(provider)
    wire: Wire = {
        "goal": goal,
        "reference": ref,
        "click_id": click_id,
        "code": code,
        "value": None if value is None else format_value(value),
        "currency": currency,
        "is_first": is_first,
        "label": label,
        "provider": provider_value,
        "kept_by": kept_by,
        "browser_engine": browser_engine,
        "platform": platform,
        "hashed_email": hashed_email,
        "hashed_phone_e164": hashed_phone_e164,
        "hashed_phone_digits": hashed_phone_digits,
        "occurred_at": None if occurred_at is None else format_date(occurred_at),
        "metadata": metadata,
        "consent": consent,
        **(extra or {}),
    }
    check_hashed_fields(wire)
    return {k: v for k, v in wire.items() if v is not None}


def batch_event_wire(event: Mapping[str, Any]) -> Wire:
    if not isinstance(event, Mapping):
        raise local_error("invalid_argument", "Each batch event must be a dict with goal and reference.", "events")
    known = {k: event.get(k) for k in _KNOWN if k != "goal"}
    unknown = {k: v for k, v in event.items() if k not in _KNOWN}
    if unknown:
        known["extra"] = {**unknown, **(known.get("extra") or {})}
    return build_goal_wire(event.get("goal"), **known)


def goal_warnings(core: _CoreBase, state: GuardState, wire: Wire) -> None:
    """Config-based warnings (SPEC 12.3); warn-only."""
    if state.config is None or core.private_mode != "auto":
        return
    goal = next((g for g in state.config.get("goals") or [] if g.get("key") == wire["goal"]), None)
    if goal is None:
        core.warn(
            "unknown_goal",
            f'The goal "{wire["goal"]}" isn\'t defined for your organisation (it will be sent; the API decides).',
            wire["goal"],
        )
        return
    if goal.get("value_mode") == "none" and "value" in wire:
        core.warn("value_not_allowed", f'The goal "{wire["goal"]}" takes no value.', wire["goal"])
    if goal.get("value_mode") == "required" and "value" not in wire:
        core.warn("value_required", f'The goal "{wire["goal"]}" needs a value.', wire["goal"])


def check_before_send(core: _CoreBase, state: GuardState, wire: Wire) -> None:
    """Steps 2 and 3 of SPEC 9.1 for one wire event. Raises PrivateModeFieldRejectedError."""
    goal_warnings(core, state, wire)
    if state.guard:
        guard_payload("goal", wire)


def with_index(index: int, fn: Callable[[], Any]) -> Any:
    try:
        return fn()
    except InvalidRequestError as err:
        err.index = index
        raise


def reverse_wire(key: Any, reference: Any, value: Optional[MoneyInput], reason: Optional[str]) -> Wire:
    wire: Wire = {"goal": check_key(key), "reference": check_reference(reference)}
    if value is not None:
        wire["value"] = format_value(value)
    if reason is not None:
        wire["reason"] = reason
    return wire


def batch_wires(core: _CoreBase, events: Sequence[Mapping[str, Any]]) -> List[Wire]:
    if not isinstance(events, (list, tuple)) or len(events) == 0:
        raise local_error("batch_empty", "Send at least one event.", "events")
    if len(events) > 500:
        raise local_error("batch_too_large", "A batch takes at most 500 events.", "events")
    return [with_index(i, partial(batch_event_wire, e)) for i, e in enumerate(events)]


def send_request(wire: Wire, options: Optional[RequestOptions]) -> ApiRequest:
    # SPEC 7: a random Idempotency-Key per call (the transport's default), reused across that call's
    # retries. The API dedupes (goal, reference) itself.
    return ApiRequest("POST", "/v1/goals/events", body=wire).with_options(options)


class _Queued:
    __slots__ = ("rounds", "wire")

    def __init__(self, wire: Wire) -> None:
        self.wire = wire
        self.rounds = 0


class _QueueLogic:
    """The background queue's bookkeeping (SPEC 9.3), shared by the thread and asyncio senders."""

    def __init__(self, core: _CoreBase, batch_size: int, max_queue_size: int) -> None:
        self.core = core
        self.batch_size = batch_size
        self.max_queue_size = max_queue_size
        self.items: Deque[_Queued] = deque()
        self.lock = threading.Lock()

    def shown(self, wire: Wire) -> Dict[str, str]:
        return {"goal": str(wire.get("goal")), "reference": self.core.shown_reference(wire.get("reference"))}

    def push(self, wire: Wire) -> int:
        dropped: Optional[_Queued] = None
        with self.lock:
            if len(self.items) >= self.max_queue_size:
                dropped = self.items.popleft()
            self.items.append(_Queued(wire))
            size = len(self.items)
        if dropped is not None:
            self.core.warn(
                "queue_full_dropped", f"The Clikgate queue is full ({self.max_queue_size} events); the oldest event was dropped."
            )
            self.core.report(
                local_error("queue_full", "The background queue was full; this event was dropped."),
                ErrorContext("goal", [self.shown(dropped.wire)], True),
            )
        return size

    def take(self, n: int) -> List[_Queued]:
        with self.lock:
            return [self.items.popleft() for _ in range(min(n, len(self.items)))]

    def requeue(self, batch: List[_Queued]) -> None:
        with self.lock:
            self.items.extendleft(reversed(batch))

    def __len__(self) -> int:
        return len(self.items)

    def prepare(self, state: GuardState, batch: List[_Queued]) -> List[_Queued]:
        sendable = []
        for q in batch:
            try:
                check_before_send(self.core, state, q.wire)
                sendable.append(q)
            except Exception as err:
                self.core.report(as_clikgate_error(err), ErrorContext("goal", [self.shown(q.wire)], True))
        return sendable

    def on_success(self, data: Any, sendable: List[_Queued]) -> None:
        items = data.get("data") if isinstance(data, dict) else None
        for item in items or []:
            if not isinstance(item, dict) or item.get("ok"):
                continue
            index = item.get("index")
            if not isinstance(index, int) or not 0 <= index < len(sendable):
                continue
            q = sendable[index]
            error = error_from_batch_item(int(item.get("status") or 0), item.get("error"))
            self.core.report(error, ErrorContext("goal", [self.shown(q.wire)], True))
        self.core.note_refused_items([q.wire for q in sendable], data)

    def on_failure(self, error: ClikgateError, sendable: List[_Queued]) -> List[_Queued]:
        if is_retryable(error):
            keep: List[_Queued] = []
            drop: List[_Queued] = []
            for q in sendable:
                q.rounds += 1
                (drop if q.rounds >= _MAX_FAILED_ROUNDS else keep).append(q)
            if drop:
                self.core.report(error, ErrorContext("goals.batch", [self.shown(q.wire) for q in drop], True))
            return keep
        for q in sendable:
            self.core.note_refused_goal(q.wire.get("goal"), error.code)
        self.core.report(error, ErrorContext("goals.batch", [self.shown(q.wire) for q in sendable], True))
        return []


_STOP = object()


class SyncSender:
    """One daemon worker thread runs jobs in order: background batches and sync-mode sends.

    At most one batch is in flight per client, so requests leave in queue order. The thread never keeps
    the process alive, and it is restarted after ``os.fork()``.
    """

    def __init__(self, core: Core, batch_size: int, max_queue_size: int, flush_interval: float) -> None:
        self.core = core
        self.logic = _QueueLogic(core, batch_size, max_queue_size)
        self.flush_interval = flush_interval
        self.jobs: queue.Queue[Any] = queue.Queue()
        self.pending = 0
        self.size_pending = False
        self.thread: Optional[threading.Thread] = None
        self.pid = os.getpid()
        self.lock = threading.Lock()

    @property
    def busy(self) -> bool:
        return len(self.logic) > 0 or self.pending > 0

    # -- worker -----------------------------------------------------------------------------------
    def _ensure_thread(self) -> bool:
        with self.lock:
            if self.pid != os.getpid():  # forked: the parent's thread doesn't exist here
                self.pid = os.getpid()
                self.thread = None
                self.jobs = queue.Queue()
                self.pending = 0
                self.size_pending = False
            if self.thread is not None and self.thread.is_alive():
                return True
            try:
                t = threading.Thread(target=self._run, name="clikgate-sender", daemon=True)
                t.start()
            except RuntimeError:  # interpreter shutting down
                return False
            self.thread = t
            return True

    def _run(self) -> None:
        while True:
            timeout = self.flush_interval if len(self.logic) else None
            try:
                job = self.jobs.get(timeout=timeout)
            except queue.Empty:
                if len(self.logic):
                    self._safe(self._drain_once)
                continue
            if job is _STOP:
                self._done()
                return
            self._safe(job)
            self._done()

    def _done(self) -> None:
        with self.lock:
            self.pending = max(0, self.pending - 1)

    @staticmethod
    def _safe(fn: Callable[[], Any]) -> None:
        with contextlib.suppress(Exception):
            fn()

    def post(self, job: Callable[[], Any]) -> None:
        with self.lock:
            self.pending += 1
        if threading.current_thread() is self.thread or not self._ensure_thread():
            self._safe(job)
            self._done()
            return
        self.jobs.put(job)

    # -- background queue -------------------------------------------------------------------------
    def enqueue(self, wire: Wire) -> None:
        size = self.logic.push(wire)
        if size >= self.logic.batch_size and not self.size_pending:
            self.size_pending = True
            self.post(self._size_job)
        elif size == 1:
            self.post(lambda: None)  # wake the worker so its interval timer runs

    def _size_job(self) -> None:
        self.size_pending = False
        while len(self.logic) >= self.logic.batch_size:
            requeue = self._send_batch(self.logic.take(self.logic.batch_size))
            self.logic.requeue(requeue)
            if requeue:
                break

    def _drain_once(self) -> None:
        remaining = len(self.logic)
        requeue: List[_Queued] = []
        while remaining > 0 and len(self.logic):
            batch = self.logic.take(min(self.logic.batch_size, remaining))
            remaining -= len(batch)
            requeue.extend(self._send_batch(batch))
        self.logic.requeue(requeue)

    def _send_batch(self, batch: List[_Queued]) -> List[_Queued]:
        try:
            state = self.core.guard_state()
        except Exception:
            state = GuardState(True, None)
        sendable = self.logic.prepare(state, batch)
        if not sendable:
            return []
        try:
            _s, data, _h = self.core.requester.request(
                ApiRequest("POST", "/v1/goals/events/batch", body={"events": [q.wire for q in sendable]})
            )
        except Exception as err:
            return self.logic.on_failure(as_clikgate_error(err), sendable)
        self.logic.on_success(data, sendable)
        return []

    def flush(self, timeout: float) -> bool:
        done = threading.Event()

        def job() -> None:
            try:
                self._drain_once()
            finally:
                done.set()

        self.post(job)
        return done.wait(timeout)

    def stop(self) -> None:
        if self.thread is not None and self.thread.is_alive():
            with self.lock:
                self.pending += 1
            self.jobs.put(_STOP)


class AsyncSender:
    """The asyncio version: one worker task per event loop runs jobs in order."""

    def __init__(self, core: AsyncCore, batch_size: int, max_queue_size: int, flush_interval: float) -> None:
        self.core = core
        self.logic = _QueueLogic(core, batch_size, max_queue_size)
        self.flush_interval = flush_interval
        self.jobs: Optional[asyncio.Queue[Any]] = None
        self.task: Optional[asyncio.Task[None]] = None
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.pending = 0
        self.size_pending = False

    @property
    def busy(self) -> bool:
        return len(self.logic) > 0 or self.pending > 0

    def _ensure_task(self) -> asyncio.Queue[Any]:
        loop = asyncio.get_running_loop()  # raises RuntimeError outside a loop
        if self.loop is not loop or self.task is None or self.task.done() or self.jobs is None:
            self.loop = loop
            self.jobs = asyncio.Queue()
            self.pending = 0
            self.task = loop.create_task(self._run(self.jobs))
        return self.jobs

    async def _run(self, jobs: asyncio.Queue[Any]) -> None:
        while True:
            try:
                if len(self.logic):
                    job = await asyncio.wait_for(jobs.get(), self.flush_interval)
                else:
                    job = await jobs.get()
            except asyncio.TimeoutError:
                if len(self.logic):
                    await self._safe(self._drain_once)
                continue
            if job is _STOP:
                self.pending = max(0, self.pending - 1)
                return
            await self._safe(job)
            self.pending = max(0, self.pending - 1)

    @staticmethod
    async def _safe(fn: Callable[[], Awaitable[Any]]) -> None:
        with contextlib.suppress(Exception):
            await fn()

    def post(self, job: Callable[[], Awaitable[Any]]) -> None:
        jobs = self._ensure_task()
        self.pending += 1
        jobs.put_nowait(job)

    def enqueue(self, wire: Wire) -> None:
        self._ensure_task()
        size = self.logic.push(wire)
        if size >= self.logic.batch_size and not self.size_pending:
            self.size_pending = True
            self.post(self._size_job)
        elif size == 1:
            self.post(self._noop)

    @staticmethod
    async def _noop() -> None:
        return None

    async def _size_job(self) -> None:
        self.size_pending = False
        while len(self.logic) >= self.logic.batch_size:
            requeue = await self._send_batch(self.logic.take(self.logic.batch_size))
            self.logic.requeue(requeue)
            if requeue:
                break

    async def _drain_once(self) -> None:
        remaining = len(self.logic)
        requeue: List[_Queued] = []
        while remaining > 0 and len(self.logic):
            batch = self.logic.take(min(self.logic.batch_size, remaining))
            remaining -= len(batch)
            requeue.extend(await self._send_batch(batch))
        self.logic.requeue(requeue)

    async def _send_batch(self, batch: List[_Queued]) -> List[_Queued]:
        try:
            state = await self.core.guard_state()
        except Exception:
            state = GuardState(True, None)
        sendable = self.logic.prepare(state, batch)
        if not sendable:
            return []
        try:
            _s, data, _h = await self.core.requester.request(
                ApiRequest("POST", "/v1/goals/events/batch", body={"events": [q.wire for q in sendable]})
            )
        except Exception as err:
            return self.logic.on_failure(as_clikgate_error(err), sendable)
        self.logic.on_success(data, sendable)
        return []

    async def flush(self, timeout: float) -> bool:
        done = asyncio.Event()

        async def job() -> None:
            try:
                await self._drain_once()
            finally:
                done.set()

        try:
            self.post(job)
        except RuntimeError:
            return not self.busy
        try:
            await asyncio.wait_for(done.wait(), timeout)
        except asyncio.TimeoutError:
            return False
        return True

    def stop(self) -> None:
        if self.task is not None and not self.task.done() and self.jobs is not None:
            self.pending += 1
            self.jobs.put_nowait(_STOP)


class Goals:
    """Goal events: the outcomes your business cares about (``account_opened``, ``loan_disbursed``, ``order_paid``).

    ``goals.send`` waits for the API and raises on failure; ``clikgate.goal()`` is the fire-and-forget version.
    """

    def __init__(self, core: Core) -> None:
        self._core = core

    def send(
        self,
        key: str,
        *,
        reference: str,
        click_id: Optional[str] = None,
        code: Optional[str] = None,
        value: Optional[MoneyInput] = None,
        currency: Optional[str] = None,
        is_first: Optional[bool] = None,
        occurred_at: Union[datetime, str, None] = None,
        metadata: Optional[Mapping[str, Any]] = None,
        consent: Optional[Mapping[str, Any]] = None,
        extra: Optional[Mapping[str, Any]] = None,
        provider: Union[Provider, str, None] = None,
        request_options: Optional[RequestOptions] = None,
        label: Optional[str] = None,
        kept_by: Optional[str] = None,
        browser_engine: Optional[str] = None,
        platform: Optional[str] = None,
        hashed_email: Optional[str] = None,
        hashed_phone_e164: Optional[str] = None,
        hashed_phone_digits: Optional[str] = None,
    ) -> GoalEvent:
        """Send one goal event and wait for the result.

        Retries are safe: each call sends a random ``Idempotency-Key``, reused across its retries, and the API
        ignores a second event with the same goal and reference, so a resend never counts twice.

        ``hashed_email``, ``hashed_phone_e164`` and ``hashed_phone_digits``: your own SHA-256 hashes for ad network
        matching (:func:`clikgate.hash_for_ads`); anything but 64 lowercase hex is a local ``invalid_hashed_identifier``.

        Raises:
            InvalidRequestError: local validation or a 4xx; PrivateModeFieldRejectedError in private mode.
            TypeError: ``value`` is a float.

        Example::

            event = clikgate.goals.send(
                "account_opened",
                click_id=application.click_id,   # kept since the visitor landed
                reference="APP-55231",
                value=Decimal("2000000"),         # ₦2,000,000 in normal units
                currency="NGN",
            )
            if event["status"] == GoalStatus.COUNTED:      # counted, waiting (a Payment goal) or refused
                print("attributed to", (event.get("attributed_to") or {}).get("link_id"))
        """
        wire = build_goal_wire(
            key,
            reference,
            click_id,
            code,
            value,
            currency,
            is_first,
            occurred_at,
            metadata,
            consent,
            extra,
            provider,
            label,
            kept_by=kept_by,
            browser_engine=browser_engine,
            platform=platform,
            hashed_email=hashed_email,
            hashed_phone_e164=hashed_phone_e164,
            hashed_phone_digits=hashed_phone_digits,
        )
        return self._send_wire(wire, request_options)

    def _send_wire(self, wire: Wire, options: Optional[RequestOptions] = None) -> GoalEvent:
        check_before_send(self._core, self._core.guard_state(), wire)
        try:
            _s, data, _h = self._core.requester.request(send_request(wire, options))
        except ClikgateError as err:
            self._core.note_refused_goal(wire.get("goal"), err.code)
            raise
        self._core.note_refused_goal(wire.get("goal"), data.get("reason") if isinstance(data, dict) else None)
        return cast(GoalEvent, with_enums(data))

    def send_batch(self, events: Sequence[GoalBatchEvent], *, request_options: Optional[RequestOptions] = None) -> GoalBatchResult:
        """Send up to 500 goal events in one request. Per-event failures are returned, not raised.

        Raises:
            InvalidRequestError: when an event fails local validation (with ``index``), or the batch is empty or too large.

        Example::

            result = clikgate.goals.send_batch([
                {"goal": "order_paid", "reference": "ORD-1001", "click_id": click_id, "value": "1500.50", "currency": "NGN"},
                {"goal": "order_paid", "reference": "ORD-1002", "value": "99.90"},
            ])
            for item in result["data"]:
                if not item["ok"]:
                    print(item["index"], (item.get("error") or {}).get("code"))
        """
        wires = batch_wires(self._core, cast(Sequence[Mapping[str, Any]], events))
        state = self._core.guard_state()
        for i, w in enumerate(wires):
            with_index(i, partial(check_before_send, self._core, state, w))
        _s, data, _h = self._core.requester.request(
            ApiRequest("POST", "/v1/goals/events/batch", body={"events": wires}).with_options(request_options)
        )
        self._core.note_refused_items(wires, data)
        return cast(GoalBatchResult, with_enums(data))

    def reverse(
        self,
        key: str,
        reference: str,
        *,
        value: Optional[MoneyInput] = None,
        reason: Optional[str] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> GoalEvent:
        """Reverse a goal event, fully (no value) or partly (a refund, a cancelled loan, a chargeback).

        Example::

            clikgate.goals.reverse("loan_disbursed", "LN-2201")                  # full
            clikgate.goals.reverse("order_paid", "ORD-1001", value="500")        # partial
        """
        wire = reverse_wire(key, reference, value, reason)
        if self._core.guard_state().guard:
            guard_payload("reversal", wire)
        _s, data, _h = self._core.requester.request(ApiRequest("POST", "/v1/goals/events/reverse", body=wire).with_options(request_options))
        return cast(GoalEvent, data)


class AsyncGoals:
    """Goal events (async). See :class:`Goals`."""

    def __init__(self, core: AsyncCore) -> None:
        self._core = core

    async def send(
        self,
        key: str,
        *,
        reference: str,
        click_id: Optional[str] = None,
        code: Optional[str] = None,
        value: Optional[MoneyInput] = None,
        currency: Optional[str] = None,
        is_first: Optional[bool] = None,
        occurred_at: Union[datetime, str, None] = None,
        metadata: Optional[Mapping[str, Any]] = None,
        consent: Optional[Mapping[str, Any]] = None,
        extra: Optional[Mapping[str, Any]] = None,
        provider: Union[Provider, str, None] = None,
        request_options: Optional[RequestOptions] = None,
        label: Optional[str] = None,
        kept_by: Optional[str] = None,
        browser_engine: Optional[str] = None,
        platform: Optional[str] = None,
        hashed_email: Optional[str] = None,
        hashed_phone_e164: Optional[str] = None,
        hashed_phone_digits: Optional[str] = None,
    ) -> GoalEvent:
        """Send one goal event and wait for the result.

        Example::

            event = await clikgate.goals.send("account_opened", click_id=click_id, reference="APP-55231", value=Decimal("2000000"))
        """
        wire = build_goal_wire(
            key,
            reference,
            click_id,
            code,
            value,
            currency,
            is_first,
            occurred_at,
            metadata,
            consent,
            extra,
            provider,
            label,
            kept_by=kept_by,
            browser_engine=browser_engine,
            platform=platform,
            hashed_email=hashed_email,
            hashed_phone_e164=hashed_phone_e164,
            hashed_phone_digits=hashed_phone_digits,
        )
        return await self._send_wire(wire, request_options)

    async def _send_wire(self, wire: Wire, options: Optional[RequestOptions] = None) -> GoalEvent:
        check_before_send(self._core, await self._core.guard_state(), wire)
        try:
            _s, data, _h = await self._core.requester.request(send_request(wire, options))
        except ClikgateError as err:
            self._core.note_refused_goal(wire.get("goal"), err.code)
            raise
        self._core.note_refused_goal(wire.get("goal"), data.get("reason") if isinstance(data, dict) else None)
        return cast(GoalEvent, with_enums(data))

    async def send_batch(self, events: Sequence[GoalBatchEvent], *, request_options: Optional[RequestOptions] = None) -> GoalBatchResult:
        """Send up to 500 goal events in one request. Per-event failures are returned, not raised.

        Example::

            result = await clikgate.goals.send_batch([{"goal": "order_paid", "reference": "ORD-1001", "value": "1500.50"}])
        """
        wires = batch_wires(self._core, cast(Sequence[Mapping[str, Any]], events))
        state = await self._core.guard_state()
        for i, w in enumerate(wires):
            with_index(i, partial(check_before_send, self._core, state, w))
        _s, data, _h = await self._core.requester.request(
            ApiRequest("POST", "/v1/goals/events/batch", body={"events": wires}).with_options(request_options)
        )
        self._core.note_refused_items(wires, data)
        return cast(GoalBatchResult, with_enums(data))

    async def reverse(
        self,
        key: str,
        reference: str,
        *,
        value: Optional[MoneyInput] = None,
        reason: Optional[str] = None,
        request_options: Optional[RequestOptions] = None,
    ) -> GoalEvent:
        """Reverse a goal event, fully or partly.

        Example::

            await clikgate.goals.reverse("order_paid", "ORD-1001", value="500")
        """
        wire = reverse_wire(key, reference, value, reason)
        if (await self._core.guard_state()).guard:
            guard_payload("reversal", wire)
        _s, data, _h = await self._core.requester.request(
            ApiRequest("POST", "/v1/goals/events/reverse", body=wire).with_options(request_options)
        )
        return cast(GoalEvent, data)
