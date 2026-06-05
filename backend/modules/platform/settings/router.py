from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from core.permissions import require_permission
from db.session import get_db
from modules.platform.settings.schema import (
    AuthPolicyPublic,
    EmailDeliveryPublic,
    EmailDeliveryTestRequest,
    FinancialYearSettingsPublic,
    PasswordPolicyPublic,
    SessionIdleSettingsPublic,
)
from modules.platform.settings.service import SettingsService

router = APIRouter(prefix="/settings", tags=["admin", "settings"])


def get_settings_service(db: Session = Depends(get_db)) -> SettingsService:
    return SettingsService(db)


@router.get("/password-policy", response_model=PasswordPolicyPublic)
def get_password_policy(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
) -> PasswordPolicyPublic:
    return svc.get_password_policy()


@router.put("/password-policy", response_model=PasswordPolicyPublic)
def put_password_policy(
    payload: PasswordPolicyPublic,
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: Annotated[object, Depends(require_permission("settings.update"))],
) -> PasswordPolicyPublic:
    return svc.put_password_policy(payload)


@router.get("/auth-policy", response_model=AuthPolicyPublic)
def get_auth_policy(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: Annotated[object, Depends(require_permission("auth_policy.view"))],
) -> AuthPolicyPublic:
    return svc.get_auth_policy()


@router.put("/auth-policy", response_model=AuthPolicyPublic)
def put_auth_policy(
    payload: AuthPolicyPublic,
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: Annotated[object, Depends(require_permission("auth_policy.update"))],
) -> AuthPolicyPublic:
    return svc.put_auth_policy(payload)


@router.get("/email-delivery", response_model=EmailDeliveryPublic)
def get_email_delivery(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: Annotated[object, Depends(require_permission("settings.update"))],
) -> EmailDeliveryPublic:
    return svc.get_email_delivery()


@router.put("/email-delivery", response_model=EmailDeliveryPublic)
def put_email_delivery(
    payload: EmailDeliveryPublic,
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: Annotated[object, Depends(require_permission("settings.update"))],
) -> EmailDeliveryPublic:
    return svc.put_email_delivery(payload)


@router.post("/email-delivery/test")
async def test_email_delivery(
    payload: EmailDeliveryTestRequest,
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: Annotated[object, Depends(require_permission("settings.update"))],
) -> dict[str, str]:
    try:
        await run_in_threadpool(
            svc.send_test_email,
            to_email=payload.to_email,
            config=payload.config,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"status": "sent", "to_email": payload.to_email.strip().lower()}


@router.get("/session-idle", response_model=SessionIdleSettingsPublic)
def get_session_idle(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: Annotated[object, Depends(require_permission("settings.update"))],
) -> SessionIdleSettingsPublic:
    return svc.get_session_idle()


@router.put("/session-idle", response_model=SessionIdleSettingsPublic)
def put_session_idle(
    payload: SessionIdleSettingsPublic,
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: Annotated[object, Depends(require_permission("settings.update"))],
) -> SessionIdleSettingsPublic:
    return svc.put_session_idle(payload)


@router.get("/financial-year", response_model=FinancialYearSettingsPublic)
def get_financial_year(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: Annotated[object, Depends(require_permission("settings.update"))],
) -> FinancialYearSettingsPublic:
    return svc.get_financial_year()


@router.put("/financial-year", response_model=FinancialYearSettingsPublic)
def put_financial_year(
    payload: FinancialYearSettingsPublic,
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: Annotated[object, Depends(require_permission("settings.update"))],
) -> FinancialYearSettingsPublic:
    return svc.put_financial_year(payload)
