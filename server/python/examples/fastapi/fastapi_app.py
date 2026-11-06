"""FastAPI example: capture → save → send goal → verify webhook.

pip install "clikgate[fastapi]" uvicorn
CLIKGATE_API_KEY=cg_test_… CLIKGATE_WEBHOOK_SECRET=whsec_… uvicorn fastapi_app:app
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Dict, Optional

from fastapi import Depends, FastAPI, HTTPException, Request, Response

from clikgate import AsyncClikgate, SignatureVerificationError, webhooks
from clikgate.fastapi import ClikgateMiddleware, click_id, keep_endpoint

clikgate = AsyncClikgate()  # create one client and reuse it


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    yield
    await clikgate.close()  # send anything still queued


app = FastAPI(lifespan=lifespan)
# 1. Capture: keeps ?cgid=… in the first-party cookie
app.add_middleware(ClikgateMiddleware, client=clikgate)
# 1b. Keep the click ID longer (Safari): the web script's data-server-endpoint="/cg/keep" posts here and this
# server sets the cookie. Same host as the website; only same-origin POSTs with a valid click ID are accepted.
app.add_api_route("/cg/keep", keep_endpoint(client=clikgate, days=30), methods=["POST"])

applications: Dict[str, Dict[str, Any]] = {}  # your own storage (a database in real life)


# 2. Save the click ID with your own record
@app.post("/applications", status_code=201)
async def create_application(body: Dict[str, str], cid: Optional[str] = Depends(click_id)) -> Dict[str, str]:
    app_id = f"APP-{len(applications) + 55231}"
    applications[app_id] = {"id": app_id, "email": body.get("email", ""), "click_id": cid}
    return {"id": app_id}


# 3. Later, from any job: send the goal (never raises; retried safely)
@app.post("/applications/{app_id}/approve")
async def approve(app_id: str) -> Dict[str, bool]:
    application = applications.get(app_id)
    if application is None:
        raise HTTPException(404)
    clikgate.goal("account_opened", click_id=application["click_id"], reference=app_id, value="2000000", currency="NGN")
    return {"approved": True}


# 4. Verify Clikgate webhooks over the raw body
@app.post("/webhooks/clikgate")
async def clikgate_webhook(request: Request) -> Response:
    try:
        event = webhooks.verify(
            await request.body(), request.headers.get("Clikgate-Signature"), os.environ.get("CLIKGATE_WEBHOOK_SECRET", "")
        )
    except SignatureVerificationError as err:
        return Response(err.code, status_code=400)
    if event.get("type") == "goal.completed":
        print("goal completed", event["data"]["object"])  # dedupe on event["id"]
    return Response(status_code=200)
