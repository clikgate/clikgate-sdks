"""Receives Clikgate webhooks. No sign-in here: the signature check is what protects the route."""

from clikgate import EventType, SignatureVerificationError, WebhookEvent, webhooks
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse

from .rewards import RewardStore
from .services import Services, services

router = APIRouter()


# #region webhook
@router.post("/webhooks/clikgate")
async def receive_webhook(request: Request, s: Services = Depends(services)) -> Response:
    raw_body = await request.body()  # the raw bytes: the signature covers exactly what Clikgate sent
    try:
        event = webhooks.verify(raw_body, request.headers.get("Clikgate-Signature"), s.settings.webhook_secret)
    except SignatureVerificationError as err:
        return JSONResponse({"error": err.code}, status_code=400)
    if not s.processed_events.mark_new(event.id):
        return Response(status_code=200)  # a repeat delivery: answer 200 and do nothing
    if event.type.startswith("referral."):
        handle_referral_event(event, s.rewards)
    return Response(status_code=200)  # answer quickly; Clikgate waits up to 10 seconds
# #endregion


# #region referral-event
def handle_referral_event(event: WebhookEvent, rewards: RewardStore) -> None:
    """Pays referral rewards. ``event.as_referral()`` gives the referral: its ``id``, and the ``referrer`` and
    ``referee`` with ``customer_id`` (your own user IDs; the referee's is ``None`` until the app identified them)."""
    referral = event.as_referral()  # None for an event that isn't referral.*
    if referral is None:
        return
    referrer_user_id = referral["referrer"]["customer_id"]
    referee_user_id = referral["referee"]["customer_id"]

    if event.type == EventType.REFERRAL_QUALIFIED:
        # Final: pay once. In production, enqueue a job here and answer the webhook straight away.
        rewards.pay_once(referral["id"], referrer_user_id, referee_user_id)
    elif event.type == EventType.REFERRAL_DISQUALIFIED:
        rewards.mark_disqualified(referral["id"], referrer_user_id, referee_user_id)  # pay nothing
# #endregion
