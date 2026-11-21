"""A local stand-in for the Clikgate API, so the test never calls the real one. It answers the calls this backend makes
with the API's response shapes, and records every request for the test to check."""

import json
import re
import threading
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class RecordedRequest:
    method: str
    path: str
    authorization: Optional[str]
    body: Dict[str, Any]


class FakeClikgate:
    def __init__(self) -> None:
        self.requests: List[RecordedRequest] = []
        self._referrers_by_customer: Dict[str, Dict[str, Any]] = {}
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                fake._handle(self)

            def do_POST(self) -> None:
                fake._handle(self)

            def log_message(self, *args: Any) -> None:  # keep the test output quiet
                pass

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self._server.serve_forever, daemon=True).start()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self._server.server_address[1]}"

    def stop(self) -> None:
        self._server.shutdown()

    def requests_to(self, path: str) -> List[RecordedRequest]:
        return [r for r in self.requests if r.path == path]

    def _handle(self, handler: BaseHTTPRequestHandler) -> None:
        length = int(handler.headers.get("Content-Length") or 0)
        body = json.loads(handler.rfile.read(length) or b"{}")
        path = handler.path.split("?")[0]
        self.requests.append(RecordedRequest(handler.command, path, handler.headers.get("Authorization"), body))
        status, answer = self._answer(path, body)
        data = json.dumps(answer).encode()
        handler.send_response(status)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Content-Length", str(len(data)))
        handler.end_headers()
        handler.wfile.write(data)

    def _answer(self, path: str, body: Dict[str, Any]) -> Tuple[int, Any]:
        if path == "/v1/server-sdk/config":
            return 200, {"mode": "test", "private_mode": False, "goals": [{"key": "account_opened"}, {"key": "order_paid"}]}
        if path == "/v1/people/identify":
            return 200, {"object": "person_identified", "person_id": "per_fake"}
        if path == "/v1/goals/events":
            return 201, {"object": "goal_event", "id": "cnv_fake", "status": "counted"}
        if path == "/v1/goals/events/batch":
            events = body.get("events") or []
            data = [{"index": i, "ok": True, "status": 201, "goal_event": {"object": "goal_event", "status": "counted"}} for i in range(len(events))]
            return 200, {"object": "list", "data": data}
        if path == "/v1/payments/confirmations":
            return 201, {**body, "object": "payment_confirmation", "id": "pcf_fake", "match_status": "matched", "duplicate": False}
        if re.fullmatch(r"/v1/referral-programs/[^/]+/referrers", path):
            return self._referrer(path.split("/")[3], str(body.get("customer_user_id")))
        return 404, {"error": {"code": "not_found", "message": "Not in the fake."}}

    def _referrer(self, program_id: str, customer_user_id: str) -> Tuple[int, Any]:
        """Same customer, same referrer and code: 201 the first time, 200 after that, like the API."""
        created = customer_user_id not in self._referrers_by_customer
        if created:
            n = len(self._referrers_by_customer) + 1
            self._referrers_by_customer[customer_user_id] = referrer_object(n, program_id, customer_user_id)
        return (201 if created else 200), self._referrers_by_customer[customer_user_id]


def referrer_object(n: int, program_id: str, customer_user_id: str) -> Dict[str, Any]:
    """A referrer as the API returns it (``POST /v1/referral-programs/{id}/referrers``)."""
    code = f"TANGO{n}"
    return {
        "id": f"rfr_01JCK8Z9V7Q4M2N6P8R0S2T4R{n}",
        "object": "referrer",
        "program_id": program_id,
        "customer_user_id": customer_user_id,
        "display_name": None,
        "code": code,
        "external_code": None,
        "link_id": "lnk_01JCK8Z9V7Q4M2N6P8R0S2T4AA",
        "url": f"https://go.example.com/r/{code}",
        "short_url": f"https://go.example.com/{code.lower()}",
        "status": "active",
        "blocked_reason": None,
        "blocked_at": None,
        "stats": {"clicks": 0, "installs": 0, "signups": 0, "in_progress": 0, "qualified": 0, "disqualified": 0,
                  "rejected": 0, "referee_uninstall_rate_7d": None},
        "attributes": {},
        "leaderboard_opt_out": False,
        "quality_score": None,
        "quality_band": None,
        "last_activity_at": None,
        "created_at": "2026-11-02T09:30:00Z",
        "updated_at": "2026-11-02T09:30:00Z",
        "livemode": False,
    }


def referral_event(event_id: str, event_type: str, referral_id: str, program_id: str, referrer_user_id: str) -> Dict[str, Any]:
    """A ``referral.qualified`` or ``referral.disqualified`` webhook event as Clikgate sends it: the envelope, and the
    referral in ``data.object``."""
    qualified = event_type == "referral.qualified"
    steps: List[Dict[str, Any]] = [
        {"index": 0, "identify": True, "completed_at": "2026-11-02T10:00:00Z", "source_id": "identify:user_friend"},
    ]
    if qualified:
        steps.append({"index": 1, "goal": "order_paid", "completed_at": "2026-11-03T09:59:00Z",
                      "source_id": "goal:cnv_01JCK8Z9V7Q4M2N6P8R0S2T4GE"})
    referral: Dict[str, Any] = {
        "id": referral_id,
        "object": "referral",
        "program_id": program_id,
        "referrer_id": "rfr_01JCK8Z9V7Q4M2N6P8R0S2T4RR",
        "status": "qualified" if qualified else "disqualified",
        "source": "link",
        "match_type": "deterministic",
        "current_step": len(steps),
        "steps_completed": steps,
        "step_deadline_at": None,
        "hold_until": None,
        "qualified_at": "2026-11-03T10:00:00Z" if qualified else None,
        "disqualified_at": None if qualified else "2026-11-03T10:00:00Z",
        "rejected_at": None,
        "reason": None if qualified else "step_timeout",
        "reason_detail": None,
        "reason_message": None,
        "fraud_flags": [],
        "referee_uninstalled_after_qualification": False,
        "program": {"id": program_id, "name": "Invite friends"},
        "referrer": {"id": "rfr_01JCK8Z9V7Q4M2N6P8R0S2T4RR", "customer_user_id": referrer_user_id, "code": "TANGO1"},
        "referee": {"install_id": "ins_01JCK8Z9V7Q4M2N6P8R0S2T4IN",
                    "installation_id": "6a1f0c2e-0000-4000-8000-000000000002", "customer_user_id": "user_friend"},
        "link": {"id": "lnk_01JCK8Z9V7Q4M2N6P8R0S2T4AA"},
        "click_id": "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6",
        "created_at": "2026-11-02T09:45:00Z",
        "updated_at": "2026-11-03T10:00:00Z",
        "livemode": False,
    }
    if qualified:
        referral["reward_snapshot"] = {"referrer": {"amount_minor": 100000, "currency": "NGN"}, "note": "Paid by the app"}
    return {
        "id": event_id,
        "object": "event",
        "type": event_type,
        "api_version": "2026-10-01",
        "created_at": "2026-11-03T10:00:00Z",
        "organization_id": "org_01JCK8Z9V7Q4M2N6P8R0S2T4OR",
        "livemode": False,
        "data": {"previous_attributes": None, "object": referral},
    }
