import json
import logging
from typing import Annotated
from urllib.parse import parse_qs

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, Response
from pydantic import ValidationError
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.login_rate_limit import (
    check_bucket,
    check_login_allowed,
    clear_login_failures,
    record_login_failure,
)
from core.password_policy import PasswordExpiredError
from db.session import get_db
from modules.platform.auth.login_result import (
    CaptchaInvalidError,
    ForgotPasswordAccountInactiveError,
    ForgotPasswordDeliveryError,
    ForgotPasswordUserNotFoundError,
    LoginOutcomeMfaOtp,
    LoginOutcomeMfaSetup,
    LoginOutcomeTokens,
    MobileAccessDeniedError,
    PasswordLoginDisabledError,
)
from modules.platform.auth.schema import LoginRequest, RefreshRequest, TokenPair, UserMe
from modules.platform.auth.service import (
    ACCOUNT_LOCKED_MESSAGE,
    AuthService,
    AccountLockedError,
    InvalidCredentialsError,
    InvalidRefreshTokenError,
)
from modules.platform.auth.schema import (
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    ResetPasswordRequest,
    ResetPasswordResponse,
)
from modules.errors import NotFoundError
from modules.platform.settings.service import SettingsService
from modules.platform.settings.schema import (
    AuthPolicyPublic,
    AppVersionPublic,
    LoginBackgroundMetaPublic,
    SessionIdleSettingsPublic,
)
from modules.platform.settings.session_idle import (
    get_session_idle_timeout_minutes,
    idle_policy_for_auth_method,
)
from modules.platform.settings.app_version import get_app_version
from modules.platform.auth.model import UserSession
from modules.platform.users.service import UserService
from core.security import decode_access_token
from jose import JWTError
from datetime import datetime, timezone
from sqlalchemy import select, update

router = APIRouter(tags=["auth"])
logger = logging.getLogger(__name__)


def get_auth_service(db: Session = Depends(get_db)) -> AuthService:
    return AuthService(db)


@router.get("/auth/policy", response_model=AuthPolicyPublic)
def public_auth_policy(db: Session = Depends(get_db)) -> AuthPolicyPublic:
    """
    Public, unauthenticated policy snapshot for login UI (do not leak user/company data).
    """
    return SettingsService(db).get_auth_policy()


@router.get("/auth/session-policy", response_model=SessionIdleSettingsPublic)
def public_session_policy(
    request: Request,
    db: Session = Depends(get_db),
) -> SessionIdleSettingsPublic:
    """
    Idle policy for the current session.

    With a Bearer token, SSO sessions honor Session idle → Apply to SSO (off by default).
    Without a token, returns the global password idle policy.
    """
    auth = request.headers.get("authorization") or request.headers.get("Authorization") or ""
    if auth.lower().startswith("bearer "):
        token = auth.split(None, 1)[1].strip()
        try:
            claims = decode_access_token(token)
            auth_method: str | None = None
            amr = claims.get("amr")
            if isinstance(amr, str) and amr.strip():
                auth_method = amr.strip().lower()
            jti = claims.get("jti")
            if auth_method is None and isinstance(jti, str) and jti:
                now = datetime.now(timezone.utc)
                row = db.scalar(
                    select(UserSession).where(
                        UserSession.refresh_jti == jti,
                        UserSession.revoked_at.is_(None),
                        UserSession.expires_at > now,
                    )
                )
                if row is not None:
                    auth_method = getattr(row, "auth_method", None)
            if auth_method is not None:
                enabled, minutes = idle_policy_for_auth_method(auth_method)
                return SessionIdleSettingsPublic(
                    idle_enabled=enabled,
                    idle_timeout_minutes=minutes if enabled else 0,
                )
        except JWTError:
            pass
    return SessionIdleSettingsPublic(
        idle_enabled=True,
        idle_timeout_minutes=get_session_idle_timeout_minutes(),
    )

@router.get("/auth/session-touch")
def session_touch(_user: CurrentUser = Depends(get_current_user)) -> dict[str, bool]:
    """Authenticated no-op so idle middleware can bump last_activity_at."""
    return {"ok": True}


@router.get("/auth/app-version", response_model=AppVersionPublic)
def public_app_version() -> AppVersionPublic:
    """Display version for the login screen (from Settings)."""
    return AppVersionPublic(version=get_app_version())


@router.get("/auth/login-background/meta", response_model=LoginBackgroundMetaPublic)
def public_login_background_meta() -> JSONResponse:
    """Tiny cache-busting token for the login background. Do not HTTP-cache this."""
    from modules.platform.settings.login_background import get_login_background_served

    served = get_login_background_served()
    if served is None:
        body = LoginBackgroundMetaPublic(configured=False, content_type=None, version=None)
    else:
        _data, content_type, version = served
        body = LoginBackgroundMetaPublic(configured=True, content_type=content_type, version=version)
    return JSONResponse(
        content=body.model_dump(),
        headers={"Cache-Control": "no-store"},
    )


@router.get("/auth/brand-logo/meta", response_model=LoginBackgroundMetaPublic)
def public_brand_logo_meta() -> JSONResponse:
    """Tiny cache-busting token for the application logo. Do not HTTP-cache this."""
    from modules.platform.settings.brand_logo import get_brand_logo_served

    served = get_brand_logo_served()
    if served is None:
        body = LoginBackgroundMetaPublic(configured=False, content_type=None, version=None)
    else:
        _data, content_type, version = served
        body = LoginBackgroundMetaPublic(configured=True, content_type=content_type, version=version)
    return JSONResponse(
        content=body.model_dump(),
        headers={"Cache-Control": "no-store"},
    )


@router.get("/auth/brand-logo")
def public_brand_logo(request: Request, v: str | None = None) -> Response:
    """Custom application logo when configured in Settings; 404 when unset."""
    from modules.platform.settings.brand_logo import get_brand_logo_served

    served = get_brand_logo_served()
    if served is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No logo configured.")
    data, content_type, version = served
    etag = f'"{version}"'
    cache = "public, max-age=31536000, immutable" if v else "public, max-age=60"
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers={"ETag": etag, "Cache-Control": cache})
    return Response(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": cache, "ETag": etag},
    )


@router.get("/auth/login-background")
def public_login_background(request: Request, v: str | None = None) -> Response:
    """Custom login background image when configured in Settings; 404 when unset."""
    from modules.platform.settings.login_background import get_login_background_served

    served = get_login_background_served()
    if served is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No login background configured.")
    data, content_type, version = served
    etag = f'"{version}"'
    # Versioned URLs are immutable so the browser can keep the file for a year.
    cache = "public, max-age=31536000, immutable" if v else "public, max-age=60"
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers={"ETag": etag, "Cache-Control": cache})
    return Response(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": cache, "ETag": etag},
    )


async def get_login_payload(request: Request) -> LoginRequest:
    """
    Accept JSON (default) or form bodies (e.g. OAuth2-style ``username`` + ``password``).

    Plain ``LoginRequest`` injection only parses JSON; form clients otherwise get 422.
    """
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    payload_dict: dict[str, str]
    if content_type == "application/x-www-form-urlencoded":
        raw = await request.body()
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Form body must be UTF-8",
            ) from exc
        pairs = parse_qs(text, keep_blank_values=False, strict_parsing=False)
        payload_dict = {str(k): v[-1] for k, v in pairs.items() if v}
    elif content_type == "multipart/form-data":
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Use application/json or application/x-www-form-urlencoded for /login",
        )
    else:
        try:
            body = await request.json()
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid JSON body",
            ) from exc
        if not isinstance(body, dict):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="JSON body must be an object",
            )
        payload_dict = {}
        for key, value in body.items():
            if value is None:
                continue
            if isinstance(value, (dict, list)):
                continue
            payload_dict[str(key)] = value if isinstance(value, str) else str(value)
    try:
        return LoginRequest.model_validate(payload_dict)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.errors(),
        ) from exc


@router.post(
    "/login",
    response_model=None,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "application/json": {
                    "schema": LoginRequest.model_json_schema()
                }
            },
        }
    },
)
def login(
    request: Request,
    payload: Annotated[LoginRequest, Depends(get_login_payload)],
    svc: Annotated[AuthService, Depends(get_auth_service)],
) -> TokenPair | JSONResponse:
    client_ip = check_login_allowed(request)
    try:
        out = svc.login_outcome(payload)
    except PasswordExpiredError:
        clear_login_failures(client_ip)
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"error": "password_expired"},
        )
    except PasswordLoginDisabledError:
        clear_login_failures(client_ip)
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"error": "password_login_disabled"},
        )
    except MobileAccessDeniedError:
        clear_login_failures(client_ip)
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={
                "error": "mobile_access_denied",
                "detail": "Your account is not authorized to use the mobile application.",
            },
        )
    except CaptchaInvalidError:
        clear_login_failures(client_ip)
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"error": "captcha_invalid"},
        )
    except AccountLockedError:
        clear_login_failures(client_ip)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ACCOUNT_LOCKED_MESSAGE,
        ) from None
    except InvalidCredentialsError:
        record_login_failure(client_ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        ) from None
    clear_login_failures(client_ip)
    if isinstance(out, LoginOutcomeTokens):
        return out.tokens
    if isinstance(out, LoginOutcomeMfaSetup):
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "mfa_required": True,
                "setup_required": True,
                "setup_token": out.setup_token,
                "expires_in": out.expires_in_seconds,
            },
        )
    if isinstance(out, LoginOutcomeMfaOtp):
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "mfa_required": True,
                "setup_required": False,
                "challenge_token": out.challenge_token,
                "expires_in": out.expires_in_seconds,
            },
        )
    return JSONResponse(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, content={"error": "login_state"})


_FORGOT_PASSWORD_MESSAGE = (
    "If an account exists for that email, a password reset link has been sent."
)


@router.post("/logout")
def logout(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, bool]:
    jti = current.claims.get("jti")
    if isinstance(jti, str) and jti:
        now = datetime.now(timezone.utc)
        db.execute(
            update(UserSession)
            .where(UserSession.refresh_jti == jti, UserSession.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        db.commit()
    return {"ok": True}


@router.post("/refresh", response_model=TokenPair)
def refresh_tokens(
    payload: RefreshRequest,
    svc: Annotated[AuthService, Depends(get_auth_service)],
) -> TokenPair:
    try:
        return svc.refresh(payload.refresh_token)
    except InvalidRefreshTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        ) from None


@router.get("/me", response_model=UserMe)
def me(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[AuthService, Depends(get_auth_service)],
) -> UserMe:
    try:
        return svc.get_me_public(int(current.subject))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token subject",
        ) from exc
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc


@router.get("/me/photo")
def my_photo(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    """Own profile photo for the navbar/profile avatar (no ``users.view`` needed)."""
    try:
        content, content_type = UserService(db).get_photo(int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(content=content, media_type=content_type, headers={"Cache-Control": "private, no-store"})


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
def forgot_password(
    request: Request,
    payload: ForgotPasswordRequest,
    svc: Annotated[AuthService, Depends(get_auth_service)],
) -> ForgotPasswordResponse:
    check_bucket(request, "forgot-password", max_hits=5, window_sec=3600)
    try:
        svc.forgot_password(email=str(payload.email))
    except ForgotPasswordUserNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account found with this email address.",
        ) from None
    except ForgotPasswordAccountInactiveError:
        pass
    except ForgotPasswordDeliveryError:
        logger.error("forgot_password_delivery_failed")
    return ForgotPasswordResponse(ok=True, message=_FORGOT_PASSWORD_MESSAGE)


@router.post("/reset-password", response_model=ResetPasswordResponse)
def reset_password(
    request: Request,
    payload: ResetPasswordRequest,
    svc: Annotated[AuthService, Depends(get_auth_service)],
) -> ResetPasswordResponse:
    check_bucket(request, "reset-password", max_hits=10, window_sec=3600)
    try:
        svc.reset_password(token=payload.token, new_password=payload.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reset failed") from exc
    return ResetPasswordResponse(ok=True)
