"""The Python conformance runner (server/conformance/README.md, "Runner protocol").

Starts the shared mock server, runs every case for language "python" and lets the mock judge each one.

    python tests/conformance/runner.py [--async] [--filter <substring>] [--verbose]

``--async`` runs the same cases against ``AsyncClikgate``.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "src"))

from clikgate import AsyncClikgate, Clikgate, ClikgateError, Clock, ErrorContext, Provider, format_value, hash_for_ads  # noqa: E402

MOCK = HERE.parents[2] / "conformance" / "mock-server" / "server.mjs"
CLEAR = ("CLIKGATE_API_KEY", "CLIKGATE_BASE_URL", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy")


def start_mock() -> Tuple[subprocess.Popen[str], str]:
    node = shutil.which("node")
    if node is None:
        sys.exit("conformance: Node 18+ must be on the PATH to start the mock server")
    child = subprocess.Popen([node, str(MOCK), "--port", "0"], stdout=subprocess.PIPE, text=True)
    assert child.stdout is not None
    for line in child.stdout:
        m = re.match(r"^CLIKGATE_MOCK_READY (.*)$", line.strip())
        if m:
            return child, f"http://127.0.0.1:{json.loads(m.group(1))['port']}"
    sys.exit("conformance: the mock server exited before it was ready")


def control(base: str, path: str, body: Any = None) -> Any:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        f"{base}/__control{path}", data=data, method="GET" if body is None else "POST", headers={"content-type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read())


def decode(v: Any) -> Any:
    """Decode the typed argument encodings of the case format."""
    if isinstance(v, list):
        return [decode(x) for x in v]
    if isinstance(v, dict):
        if len(v) == 1:
            ((k, x),) = v.items()
            if k == "$decimal":
                return Decimal(str(x))
            if k == "$float":
                return float(x)
            if k == "$bigint":
                return int(str(x))
            if k == "$datetime":
                return datetime.fromisoformat(str(x).replace("Z", "+00:00"))
            if k == "$bytes_base64":
                return base64.b64decode(str(x))
        return {kk: decode(vv) for kk, vv in v.items()}
    return v


def serialise_error(err: BaseException) -> Dict[str, Any]:
    if isinstance(err, ClikgateError):
        return {
            "class": type(err).__name__,
            "code": err.code,
            "http_status": err.http_status,
            "param": err.param,
            "request_id": err.request_id,
            "type": err.type,
            "retry_after": getattr(err, "retry_after", None),
            "field": getattr(err, "field", None),
            "index": getattr(err, "index", None),
            "allowed": getattr(err, "allowed", None),
            "doc_url": getattr(err, "doc_url", None),
            "required_plan": getattr(err, "required_plan", None),
            "limit": getattr(err, "limit", None),
            "message": err.message,
        }
    return {"class": type(err).__name__, "code": None, "message": str(err)}


class FakeClock(Clock):
    def __init__(self, now_ms: int) -> None:
        self.ms = now_ms
        self.sleeps: List[int] = []

    def now(self) -> float:
        return self.ms / 1000

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(round(seconds * 1000))

    async def async_sleep(self, seconds: float) -> None:
        self.sleeps.append(round(seconds * 1000))


class Capture(logging.Handler):
    def __init__(self) -> None:
        super().__init__(logging.DEBUG)
        self.warnings: List[str] = []
        self.logs: List[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        code = getattr(record, "clikgate_code", None)
        if record.levelno == logging.WARNING and isinstance(code, str):
            self.warnings.append(code)
        self.logs.append(f"{record.getMessage()} {code or ''}")


@dataclass
class Run:
    clock: FakeClock
    capture: Capture
    on_error: List[Dict[str, Any]] = field(default_factory=list)


def make_options(c: Dict[str, Any], run: Run, index: int) -> Dict[str, Any]:
    cl = c["client"]
    logger = logging.getLogger(f"clikgate.conformance.{index}")
    logger.handlers = [run.capture]
    logger.propagate = False
    logger.setLevel(logging.DEBUG)
    draws = {"i": 0}
    rand = c.get("random") or [0.5]

    def random() -> float:
        r = rand[draws["i"] % len(rand)]
        draws["i"] += 1
        return float(r)

    def on_error(error: ClikgateError, ctx: ErrorContext) -> None:
        run.on_error.append({**serialise_error(error), "events": ctx.events, "dropped": ctx.dropped, "operation": ctx.operation})

    return {
        "api_key": cl["api_key"],
        "base_url": cl["base_url"],
        "timeout": cl["timeout_ms"] / 1000,
        "max_retries": cl["max_retries"],
        "send_mode": cl["send_mode"],
        "private_mode": cl["private_mode"],
        "click_id_param": cl["click_id_param"],
        "batch_size": cl["batch_size"],
        "flush_interval": cl["flush_interval_ms"] / 1000,
        "max_queue_size": cl["max_queue_size"],
        "shutdown_hooks": False,
        "logger": logger,
        "on_error": on_error,
        "clock": run.clock,
        "random": random,
    }


GOAL_KEYS = (
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


def as_provider(v: Any) -> Any:
    """A known provider string becomes the ``Provider`` member (the enum path); others stay strings."""
    try:
        return Provider(v) if isinstance(v, str) else v
    except ValueError:
        return v


def goal_kwargs(a: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: a.get(k) for k in GOAL_KEYS}
    out["provider"] = as_provider(out["provider"])
    return out


def req_opts(a: Dict[str, Any]) -> Any:
    return {"idempotency_key": a["idempotency_key"]} if a.get("idempotency_key") else None


def canonical(result: Any) -> Any:
    return json.loads(json.dumps(result, default=str))


def local_step(client: Any, call: str, a: Dict[str, Any], run: Run) -> Tuple[bool, Any]:
    """Steps that are the same for both clients (no I/O). Returns (handled, result)."""
    if call == "client.mode":
        return True, {"value": client.mode}
    if call == "advance_clock":
        run.clock.ms += a["ms"]
        return True, None
    if call == "webhooks.verify":
        return True, client.webhooks.verify(a["raw_body"], a.get("header"), a["secret"], tolerance=a["tolerance"], now=a["now"])
    if call == "webhooks.verify_any":
        return True, client.webhooks.verify_any(a["raw_body"], a.get("header"), a["secrets"], tolerance=a["tolerance"], now=a["now"])
    if call == "click_ids.is_valid":
        return True, {"value": client.click_ids.is_valid(a.get("id"))}
    if call == "click_ids.from_request":
        r = a["request"]
        return True, {"value": client.click_ids.from_request({"url": r["url"], "headers": r.get("headers") or {}})}
    if call == "click_ids.cookie_header":
        return True, {"value": client.click_ids.cookie_header(a["id"], **cookie_kwargs(a))}
    if call == "click_ids.persist":
        res: List[Tuple[str, str]] = [("Set-Cookie", v) for v in a.get("existing_set_cookie") or []]
        client.click_ids.persist(res, a["id"], **cookie_kwargs(a))
        return True, {"set_cookie": [v for k, v in res if k.lower() == "set-cookie"]}
    if call == "click_ids.context":
        r = a["request"]
        return True, dict(client.click_ids.context({"url": r["url"], "headers": r.get("headers") or {}}))
    if call == "click_ids.keep":
        r = a["request"]
        route = client.click_ids.keep_route(**{k: a[k] for k in ("days", "secure", "domain") if a.get(k) is not None})
        kept = route.handle_keep(r["method"], r.get("headers") or {}, (r.get("body") or "").encode("utf-8"))
        headers = kept.headers

        def first(name: str) -> Any:
            return next((v for k, v in headers if k.lower() == name), None)

        out: Dict[str, Any] = {
            "status": kept.status,
            "cache_control": first("cache-control"),
            "set_cookie": [v for k, v in headers if k.lower() == "set-cookie"],
            "body": kept.body.decode("utf-8"),
            "location": first("location"),
        }
        if first("allow") is not None:
            out["allow"] = first("allow")
        return True, out
    if call == "click_ids.from_payment_metadata":
        return True, {"value": client.click_ids.from_payment_metadata(a.get("payload"))}
    if call == "money.format":
        return True, {"value": format_value(a["value"])}
    if call == "hash_for_ads":
        return True, dict(hash_for_ads(email=a.get("email"), phone=a.get("phone")))
    if call == "payments.build":
        build = getattr(client.payments, f"build_from_{a['gateway']}")
        return True, {"value": build(a.get("response"), goal=a.get("goal"), click_id=a.get("click_id"))}
    if call == "goal":
        client.goal(a.get("key"), **goal_kwargs(a))
        return True, None
    return False, None


_CONFIRM_KEYS = (
    "provider",
    "reference",
    "status",
    "amount",
    "amount_minor",
    "currency",
    "occurred_at",
    "aliases",
    "click_id",
    "goal",
    "test",
    "extra",
)


def confirm_kwargs(a: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: a.get(k) for k in _CONFIRM_KEYS}
    out["provider"] = as_provider(out["provider"])
    return out


def cookie_kwargs(a: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k in ("days", "secure", "domain"):
        if a.get(k) is not None:
            out[k] = a[k]
    return out


def sync_step(client: Clikgate, call: str, a: Dict[str, Any]) -> Any:
    ro = req_opts(a)
    if call == "goals.send":
        return client.goals.send(a.get("key"), request_options=ro, **goal_kwargs(a))  # type: ignore[arg-type]
    if call == "goals.send_batch":
        return client.goals.send_batch(a["events"])
    if call == "goals.reverse":
        return client.goals.reverse(a.get("key"), a.get("reference"), value=a.get("value"), reason=a.get("reason"))  # type: ignore[arg-type]
    if call == "flush":
        return {"value": client.flush(a.get("timeout_ms", 10_000) / 1000)}
    if call == "close":
        return {"value": client.close(a.get("timeout_ms", 10_000) / 1000)}
    if call == "config.get":
        return client.config()
    if call == "conversions.create":
        return client.conversions.create(request_options=ro, **(a.get("params") or {}))
    if call == "identify_user":
        return client.identify_user(
            request_options=ro, **{k: a.get(k) for k in ("click_id", "app_id", "installation_id", "customer_id", "label")}
        )
    if call == "payments.confirm":
        return client.payments.confirm(request_options=ro, **confirm_kwargs(a))
    if call == "payments.from":
        return getattr(client.payments, f"from_{a['gateway']}")(a.get("response"), goal=a.get("goal"), click_id=a.get("click_id"))
    if call == "conversions.reverse":
        return client.conversions.reverse(a.get("id"), **(a.get("params") or {}))  # type: ignore[arg-type]
    if call == "links.create":
        return client.links.create(request_options=ro, **(a.get("params") or {}))
    if call == "links.get":
        return client.links.get(a.get("id"))  # type: ignore[arg-type]
    if call == "links.update":
        return client.links.update(a.get("id"), request_options=ro, **(a.get("params") or {}))  # type: ignore[arg-type]
    if call == "links.list":
        items = []
        limit = a.get("max_items")
        for link in client.links.list(**(a.get("params") or {})):
            items.append(link)
            if limit is not None and len(items) >= limit:
                break
        return {"items": items}
    if call == "links.list_page":
        return client.links.list_page(**(a.get("params") or {}))
    if call == "links.qr":
        q = {k: v for k, v in a.items() if k != "id"}
        qr = client.links.qr(a["id"], **q)
        return {"content_type": qr.content_type, "bytes_length": len(qr.data)}
    if call == "clicks.get":
        return client.clicks.get(a.get("id"))  # type: ignore[arg-type]
    raise RuntimeError(f"runner: unknown call {call}")


async def async_step(client: AsyncClikgate, call: str, a: Dict[str, Any]) -> Any:
    ro = req_opts(a)
    if call == "goals.send":
        return await client.goals.send(a.get("key"), request_options=ro, **goal_kwargs(a))  # type: ignore[arg-type]
    if call == "goals.send_batch":
        return await client.goals.send_batch(a["events"])
    if call == "goals.reverse":
        return await client.goals.reverse(a.get("key"), a.get("reference"), value=a.get("value"), reason=a.get("reason"))  # type: ignore[arg-type]
    if call == "flush":
        return {"value": await client.flush(a.get("timeout_ms", 10_000) / 1000)}
    if call == "close":
        return {"value": await client.close(a.get("timeout_ms", 10_000) / 1000)}
    if call == "config.get":
        return await client.config()
    if call == "conversions.create":
        return await client.conversions.create(request_options=ro, **(a.get("params") or {}))
    if call == "identify_user":
        return await client.identify_user(
            request_options=ro, **{k: a.get(k) for k in ("click_id", "app_id", "installation_id", "customer_id", "label")}
        )
    if call == "payments.confirm":
        return await client.payments.confirm(request_options=ro, **confirm_kwargs(a))
    if call == "payments.from":
        return await getattr(client.payments, f"from_{a['gateway']}")(a.get("response"), goal=a.get("goal"), click_id=a.get("click_id"))
    if call == "conversions.reverse":
        return await client.conversions.reverse(a.get("id"), **(a.get("params") or {}))  # type: ignore[arg-type]
    if call == "links.create":
        return await client.links.create(request_options=ro, **(a.get("params") or {}))
    if call == "links.get":
        return await client.links.get(a.get("id"))  # type: ignore[arg-type]
    if call == "links.update":
        return await client.links.update(a.get("id"), request_options=ro, **(a.get("params") or {}))  # type: ignore[arg-type]
    if call == "links.list":
        items = []
        limit = a.get("max_items")
        async for link in client.links.list(**(a.get("params") or {})):
            items.append(link)
            if limit is not None and len(items) >= limit:
                break
        return {"items": items}
    if call == "links.list_page":
        return await client.links.list_page(**(a.get("params") or {}))
    if call == "links.qr":
        q = {k: v for k, v in a.items() if k != "id"}
        qr = await client.links.qr(a["id"], **q)
        return {"content_type": qr.content_type, "bytes_length": len(qr.data)}
    if call == "clicks.get":
        return await client.clicks.get(a.get("id"))  # type: ignore[arg-type]
    raise RuntimeError(f"runner: unknown call {call}")


def outcome(run: Run, steps: List[Dict[str, Any]], construct_error: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    return {
        "language": "python",
        "construct_error": construct_error,
        "steps": steps,
        "sleeps_ms": run.clock.sleeps,
        "warnings": run.capture.warnings,
        "logs": run.capture.logs,
        "on_error": run.on_error,
    }


def run_sync(base: str, c: Dict[str, Any], index: int) -> Dict[str, Any]:
    run = Run(FakeClock(c["now_ms"]), Capture())
    try:
        client = Clikgate(**make_options(c, run, index))
    except Exception as err:
        return control(base, "/finish", {"case_id": c["id"], **outcome(run, [], serialise_error(err))})  # type: ignore[no-any-return]
    steps: List[Dict[str, Any]] = []
    for step in c["steps"]:
        a = decode(step["args"])
        try:
            handled, result = local_step(client, step["call"], a, run)
            if not handled:
                result = sync_step(client, step["call"], a)
            steps.append({"result": canonical(result)})
        except Exception as err:
            steps.append({"error": serialise_error(err)})
    verdict = control(base, "/finish", {"case_id": c["id"], **outcome(run, steps)})
    client.close(1.0)
    return verdict  # type: ignore[no-any-return]


async def run_async(base: str, c: Dict[str, Any], index: int) -> Dict[str, Any]:
    run = Run(FakeClock(c["now_ms"]), Capture())
    try:
        client = AsyncClikgate(**make_options(c, run, index))
    except Exception as err:
        return control(base, "/finish", {"case_id": c["id"], **outcome(run, [], serialise_error(err))})  # type: ignore[no-any-return]
    steps: List[Dict[str, Any]] = []
    for step in c["steps"]:
        a = decode(step["args"])
        try:
            handled, result = local_step(client, step["call"], a, run)
            if not handled:
                result = await async_step(client, step["call"], a)
            steps.append({"result": canonical(result)})
        except Exception as err:
            steps.append({"error": serialise_error(err)})
    verdict = await asyncio.get_running_loop().run_in_executor(
        None, lambda: control(base, "/finish", {"case_id": c["id"], **outcome(run, steps)})
    )
    await client.close(1.0)
    return verdict  # type: ignore[no-any-return]


def main() -> int:
    argv = sys.argv[1:]
    use_async = "--async" in argv
    verbose = "--verbose" in argv
    flt = argv[argv.index("--filter") + 1] if "--filter" in argv else None
    for k in CLEAR:
        os.environ.pop(k, None)
    child, base = start_mock()
    passed = failed = 0
    try:
        cases = control(base, "/cases?language=python")["cases"]
        for i, c in enumerate(cases):
            if flt and flt not in c["id"]:
                continue
            started = control(base, "/start", {"case_id": c["id"]})
            verdict = asyncio.run(run_async(base, started, i)) if use_async else run_sync(base, started, i)
            if verdict["ok"]:
                passed += 1
                if verbose:
                    print(f"ok   {c['id']}")
            else:
                failed += 1
                print(f"FAIL {c['id']}: {c['description']}\n  - " + "\n  - ".join(verdict["failures"]))
    finally:
        child.kill()
        child.wait()
    label = "python, AsyncClikgate" if use_async else "python"
    print(f"\nconformance ({label}): {passed} passed, {failed} failed, {passed + failed} total")
    return 1 if failed or passed == 0 else 0


if __name__ == "__main__":
    sys.exit(main())
