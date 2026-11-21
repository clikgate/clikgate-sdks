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
        self._codes_by_customer: Dict[str, str] = {}
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
            return self._referrer(str(body.get("customer_user_id")))
        return 404, {"error": {"code": "not_found", "message": "Not in the fake."}}

    def _referrer(self, customer_user_id: str) -> Tuple[int, Any]:
        """Same customer, same code: 201 the first time, 200 after that, like the API."""
        created = customer_user_id not in self._codes_by_customer
        code = self._codes_by_customer.setdefault(customer_user_id, f"TANGO-{len(self._codes_by_customer) + 1}")
        answer = {"object": "referrer", "code": code, "customer_user_id": customer_user_id, "short_url": f"https://go.example.com/r/{code}"}
        return (201 if created else 200), answer
