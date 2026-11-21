"""Receives Clikgate webhooks. No sign-in here: the signature check is what protects the route."""

from typing import Any, Mapping, Optional

from clikgate import SignatureVerificationError, webhooks
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
    if not s.processed_events.mark_new(event["id"]):
        return Response(status_code=200)  # a repeat delivery: answer 200 and do nothing
    if str(event["type"]).startswith("referral."):
        handle_referral_event(event, s.rewards)
    return Response(status_code=200)  # answer quickly; Clikgate waits up to 10 seconds
# #endregion


# #region referral-event
def handle_referral_event(event: Mapping[str, Any], rewards: RewardStore) -> None:
    """Pays referral rewards. The event's ``data.object`` is the referral: its ``id``, and the ``referrer`` and
    ``referee`` with their ``customer_user_id`` (your own user IDs)."""
    # Clikgate SDK 2.1.0: replace with referral = event.as_referral(), and compare types with EventType.REFERRAL_QUALIFIED
    referral = (event.get("data") or {}).get("object") or {}
    referral_id = _text(referral, "id")
    referrer_user_id = _text(referral.get("referrer"), "customer_user_id")
    referee_user_id = _text(referral.get("referee"), "customer_user_id")
    if not referral_id or not referrer_user_id:
        return  # not a referral we can pay

    if event["type"] == "referral.qualified":
        # Final: pay once. In production, enqueue a job here and answer the webhook straight away.
        rewards.pay_once(referral_id, referrer_user_id, referee_user_id)
    elif event["type"] == "referral.disqualified":
        rewards.mark_disqualified(referral_id, referrer_user_id, referee_user_id)  # pay nothing
# #endregion


def _text(node: Any, key: str) -> Optional[str]:
    value = node.get(key) if isinstance(node, Mapping) else None
    return value if isinstance(value, str) else None
