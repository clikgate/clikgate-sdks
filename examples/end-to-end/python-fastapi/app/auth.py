"""Sign-up, sign-in and "current user": the three responses that tell the app who is signed in."""

from typing import Any, Dict, Optional

from clikgate import Installation
from clikgate.fastapi import installation
from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .services import Services, services
from .users import AppUser

router = APIRouter()


class Credentials(BaseModel):
    email: str
    password: str


def signed_in_user(authorization: Optional[str] = Header(None), s: Services = Depends(services)) -> AppUser:
    """Resolves "Authorization: Bearer <access token>" to the signed-in user. Stands in for your real authentication.
    Everything Clikgate needs about the user comes from here, never from the request body."""
    token = authorization[len("Bearer "):] if authorization and authorization.startswith("Bearer ") else ""
    user = s.users.find_by_session(token)
    if user is None:
        raise HTTPException(status_code=401, detail="not_signed_in")
    return user


def _session(s: Services, user: AppUser) -> Dict[str, Any]:
    # Every response that says who is signed in carries the token (None without an identity secret).
    return {
        "user": user.to_json(),
        "accessToken": s.users.start_session(user),
        "clikgateIdentityToken": s.identity.identity_token(user),
    }


@router.post("/auth/sign-up", status_code=201)
async def sign_up(body: Credentials, inst: Optional[Installation] = Depends(installation), s: Services = Depends(services)):
    user = s.users.create(body.email, body.password)
    if user is None:
        return JSONResponse({"error": "email_taken"}, status_code=409)
    await s.identity.identify_installation(user, inst)
    # #region server-goal
    # A goal only your server knows about. goal() never raises: it is queued and sent in the background, and the
    # reference (your own ID for the event) makes a resend count once.
    s.clikgate.goal("account_opened", reference=user.id)
    # #endregion
    return _session(s, user)


@router.post("/auth/sign-in")
async def sign_in(body: Credentials, inst: Optional[Installation] = Depends(installation), s: Services = Depends(services)):
    user = s.users.sign_in(body.email, body.password)
    if user is None:
        return JSONResponse({"error": "invalid_credentials"}, status_code=401)
    await s.identity.identify_installation(user, inst)  # only after your own sign-in check succeeded
    return _session(s, user)


@router.get("/me")
async def me(
    user: AppUser = Depends(signed_in_user),
    inst: Optional[Installation] = Depends(installation),
    s: Services = Depends(services),
):
    """The app calls this at every open, so it gets a fresh token and Path B runs again within Clikgate's 7 days."""
    await s.identity.identify_installation(user, inst)
    return {"user": user.to_json(), "clikgateIdentityToken": s.identity.identity_token(user)}
