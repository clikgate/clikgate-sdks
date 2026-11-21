"""The app calls ``GET /me/referral`` when the user opens "Invite friends". The user comes from your own session, so
nobody can ask for someone else's code."""

from typing import Dict

import httpx
from fastapi import APIRouter, Depends

from .auth import signed_in_user
from .config import Settings
from .services import Services, services
from .users import AppUser

router = APIRouter()


# #region referral-code
async def get_or_create_referral_code(settings: Settings, user_id: str) -> Dict[str, str]:
    """Gets or creates a user's referrer code in your referral program. The same user always gets the same code,
    whether your backend or the app's Engage add-on asks first, so there is nothing to check before calling."""
    # Clikgate SDK 2.1.0: replace with clikgate.referrals.get_or_create_referrer(...)
    # Until then: the same API call the SDK will make (201 when created, 200 when it already existed).
    async with httpx.AsyncClient(base_url=settings.base_url, timeout=10) as http:
        response = await http.post(
            f"/v1/referral-programs/{settings.referral_program_id}/referrers",
            headers={"Authorization": f"Bearer {settings.api_key}"},
            json={"customer_user_id": user_id},  # your own user ID, exactly as the app's identifyUser sends it
        )
    response.raise_for_status()
    referrer = response.json()
    return {"code": referrer["code"], "link": referrer["short_url"]}
# #endregion


@router.get("/me/referral")
async def my_referral(user: AppUser = Depends(signed_in_user), s: Services = Depends(services)):
    return await get_or_create_referral_code(s.settings, user.id)  # {"code": "...", "link": "https://..."}
