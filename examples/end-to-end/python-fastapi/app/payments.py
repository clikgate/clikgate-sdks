"""The app reports the payment as a Payment goal (provider and reference). Your server confirms it here, after its own
check with the gateway, so Clikgate counts the confirmed amount, never an amount sent from the app."""

from typing import Any, Dict

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .auth import signed_in_user
from .services import Services, services
from .users import AppUser

router = APIRouter()


class PaymentRequest(BaseModel):
    reference: str


async def verify_with_paystack(reference: str) -> Dict[str, Any]:
    """Your server's own check with Paystack. Stubbed in the sample: it answers like a successful
    ``GET https://api.paystack.co/transaction/verify/{reference}`` for ₦7,500, so the sample runs without a Paystack
    account. In your app, make that request with your Paystack secret key and return the parsed JSON body."""
    return {
        "status": True,
        "message": "Verification successful",
        "data": {
            "status": "success",
            "reference": reference,
            "amount": 750000,  # kobo: Paystack's minor unit
            "currency": "NGN",
            "paid_at": "2026-11-20T10:15:00.000Z",
            "metadata": {},
        },
    }


@router.post("/payments/paystack/confirm")
async def confirm_payment(body: PaymentRequest, _: AppUser = Depends(signed_in_user), s: Services = Depends(services)):
    # #region from-paystack
    verify = await verify_with_paystack(body.reference)  # your own check, with your Paystack key
    if verify["data"]["status"] != "success":
        return JSONResponse({"error": "payment_not_successful"}, status_code=402)
    # ...give the customer what they paid for, then pass Paystack's answer on. Only the reference, status, amount,
    # currency, time and cg_click_id are sent: never customer details.
    await s.clikgate.payments.from_paystack(verify, goal="order_paid")
    # #endregion
    return {"status": "paid", "reference": body.reference}
