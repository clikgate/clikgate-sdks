"""The app calls ``GET /me/referral`` when the user opens "Invite friends". The user comes from your own session, so
nobody can ask for someone else's code."""

from typing import Dict, Optional

from clikgate import AsyncClikgate
from fastapi import APIRouter, Depends

from .auth import signed_in_user
from .services import Services, services
from .users import AppUser

router = APIRouter()


# #region referral-code
async def get_or_create_referral_code(clikgate: AsyncClikgate, program_id: str, user_id: str) -> Dict[str, Optional[str]]:
    """Gets or creates a user's referrer code in your referral program. The same user always gets the same code,
    whether your backend or the app's Engage add-on asks first, so there is nothing to check before calling."""
    # Your own user ID, exactly as the app's identifyUser sends it. referrer["created"] is True the first time.
    referrer = await clikgate.referrals.get_or_create_referrer(program_id, customer_id=user_id)
    return {"code": referrer["code"], "link": referrer["short_url"]}
# #endregion


@router.get("/me/referral")
async def my_referral(user: AppUser = Depends(signed_in_user), s: Services = Depends(services)):
    return await get_or_create_referral_code(s.clikgate, s.settings.referral_program_id, user.id)  # {"code": "...", "link": "https://..."}
