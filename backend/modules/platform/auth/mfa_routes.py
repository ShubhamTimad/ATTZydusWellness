from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from modules.platform.auth.login_result import MobileAccessDeniedError
from sqlalchemy.orm import Session

from db.session import get_db
from modules.platform.auth.schema import TokenPair
from modules.platform.auth.service import AuthService
from modules.platform.mfa.service import MfaService
from modules.platform.users.model import User

router = APIRouter(prefix="/auth", tags=["auth", "mfa"])


def get_auth_service(db: Session = Depends(get_db)) -> AuthService:
    return AuthService(db)


class MfaVerifyRequest(BaseModel):
    challenge_token: str = Field(min_length=10, max_length=512)
    otp: str = Field(min_length=6, max_length=12)
    client_type: str = Field(
        default="web",
        description="Must match the client_type sent to POST /login (use ``mobile`` for the APK).",
    )

    @field_validator("client_type", mode="before")
    @classmethod
    def _normalize_client_type(cls, value: object) -> str:
        if value is None or (isinstance(value, str) and not value.strip()):
            return "web"
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in ("web", "mobile"):
                return normalized
        raise ValueError("client_type must be 'web' or 'mobile'")


class MfaSetupInitBody(BaseModel):
    setup_token: str = Field(min_length=10, max_length=512)


class MfaSetupVerifyBody(BaseModel):
    setup_token: str = Field(min_length=10, max_length=512)
    otp: str = Field(min_length=6, max_length=12)


@router.post("/mfa/verify", response_model=TokenPair)
def verify_mfa_otp(
    payload: MfaVerifyRequest,
    svc: Annotated[AuthService, Depends(get_auth_service)],
    db: Annotated[Session, Depends(get_db)],
) -> TokenPair:
    mfa = MfaService(db)
    ch = mfa.verify_login_challenge(payload.challenge_token)
    if ch is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired challenge")
    user = db.get(User, int(ch.user_id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user")
    if not mfa.verify_totp_for_user(int(user.id), payload.otp):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OTP")
    try:
        svc.assert_client_access(user, payload.client_type)
    except MobileAccessDeniedError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "mobile_access_denied",
                "detail": "Your account is not authorized to use the mobile application.",
            },
        ) from None
    mfa.mark_challenge_used(ch)
    return svc.issue_token_pair(user)


@router.post("/mfa/setup/init")
def mfa_setup_init(
    body: MfaSetupInitBody,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    mfa = MfaService(db)
    row = mfa.find_valid_setup_token(body.setup_token)
    if row is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired setup token")
    user = db.get(User, int(row.user_id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user")
    res = mfa.init_enrollment(int(user.id))
    return {"otpauth_url": res.otpauth_url, "account_name": res.account_name}


@router.post("/mfa/setup/verify")
def mfa_setup_verify(
    body: MfaSetupVerifyBody,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    mfa = MfaService(db)
    row = mfa.find_valid_setup_token(body.setup_token)
    if row is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired setup token")
    user = db.get(User, int(row.user_id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user")
    if not mfa.complete_enrollment(int(user.id), body.otp):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OTP or enrollment state")
    mfa.mark_setup_token_used(row)
    if user.email:
        from modules.platform.emails.service import enqueue_trigger_events

        enqueue_trigger_events(
            [("MFA_ENABLED", {"user_name": user.full_name, "email": user.email})]
        )
    return {"ok": True}
