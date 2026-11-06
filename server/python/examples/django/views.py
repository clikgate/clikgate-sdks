"""Django example (views and settings in one file to keep it short): capture → save → send goal → verify webhook.

settings.py::

    MIDDLEWARE = [..., "clikgate.django.ClikgateMiddleware"]
    CLIKGATE = {"api_key": os.environ["CLIKGATE_API_KEY"]}

urls.py::

    path("cg/keep", views.keep_click_id),  # the web script's data-server-endpoint="/cg/keep" (same host)
    path("applications", views.create_application),
    path("applications/<str:app_id>/approve", views.approve),
    path("webhooks/clikgate", views.clikgate_webhook),
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict

from django.http import HttpRequest, HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from clikgate import SignatureVerificationError, webhooks
from clikgate.django import get_client, keep_view

applications: Dict[str, Dict[str, Any]] = {}  # a model in real life

# 1b. Keep the click ID longer (Safari): the server sets the cookie for 30 days (CSRF-exempt: it checks the origin)
keep_click_id = keep_view(days=30)


@require_POST
def create_application(request: HttpRequest) -> JsonResponse:
    app_id = f"APP-{len(applications) + 55231}"
    # 1 + 2. the middleware captured the click ID; save it with your own record
    applications[app_id] = {"id": app_id, "click_id": request.clikgate_click_id}
    return JsonResponse({"id": app_id}, status=201)


@require_POST
def approve(request: HttpRequest, app_id: str) -> JsonResponse:
    application = applications[app_id]
    # 3. later, from any view or job: send the goal (background, never raises)
    get_client().goal("account_opened", click_id=application["click_id"], reference=app_id, value="2000000", currency="NGN")
    return JsonResponse({"approved": True})


@csrf_exempt
@require_POST
def clikgate_webhook(request: HttpRequest) -> HttpResponse:
    # 4. verify over request.body (the raw bytes)
    try:
        event = webhooks.verify(request.body, request.headers.get("Clikgate-Signature"), os.environ.get("CLIKGATE_WEBHOOK_SECRET", ""))
    except SignatureVerificationError as err:
        return HttpResponse(err.code, status=400)
    if event.get("type") == "goal.completed":
        print("goal completed", json.dumps(event["data"]["object"]))  # dedupe on event["id"]
    return HttpResponse(status=200)
