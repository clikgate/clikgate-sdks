"""Flask example: capture → save → send goal → verify webhook.

pip install "clikgate[flask]"
CLIKGATE_API_KEY=cg_test_… CLIKGATE_WEBHOOK_SECRET=whsec_… flask --app flask_app run
"""

from __future__ import annotations

import os
from typing import Any, Dict, Tuple

from flask import Flask, abort, g, request

from clikgate import SignatureVerificationError, webhooks
from clikgate.flask import Clikgate, keep_view

app = Flask(__name__)
clikgate = Clikgate(app)  # 1. capture: g.clikgate_click_id, and ?cgid=… kept in the first-party cookie
# 1b. Keep the click ID longer (Safari): the web script's data-server-endpoint="/cg/keep" posts here (same host)
app.add_url_rule("/cg/keep", "clikgate_keep", keep_view(days=30), methods=["POST"])

applications: Dict[str, Dict[str, Any]] = {}


@app.post("/applications")
def create_application() -> Tuple[Dict[str, str], int]:
    app_id = f"APP-{len(applications) + 55231}"
    # 2. save the click ID with your own record
    applications[app_id] = {"id": app_id, "email": (request.get_json(silent=True) or {}).get("email", ""), "click_id": g.clikgate_click_id}
    return {"id": app_id}, 201


@app.post("/applications/<app_id>/approve")
def approve(app_id: str) -> Dict[str, bool]:
    application = applications.get(app_id) or abort(404)
    # 3. send the goal (background, never raises)
    clikgate.client.goal("account_opened", click_id=application["click_id"], reference=app_id, value="2000000", currency="NGN")
    return {"approved": True}


@app.post("/webhooks/clikgate")
def clikgate_webhook() -> Tuple[str, int]:
    # 4. verify over the raw bytes
    try:
        event = webhooks.verify(
            request.get_data(), request.headers.get("Clikgate-Signature"), os.environ.get("CLIKGATE_WEBHOOK_SECRET", "")
        )
    except SignatureVerificationError as err:
        return err.code, 400
    if event.get("type") == "goal.completed":
        print("goal completed", event["data"]["object"])  # dedupe on event["id"]
    return "", 200
