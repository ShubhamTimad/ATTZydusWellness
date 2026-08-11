from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_any_permission, require_permission
from db.session import get_db

from modules.platform.settings.schema import (
    AuthPolicyPublic,
    DocumentFormatPublic,
    EmailDeliveryPublic,
    EmailDeliveryTestRequest,
    FinancialYearSettingsPublic,
    PasswordPolicyPublic,
    SessionIdleSettingsPublic,
)
from modules.platform.settings.service import SettingsService

router = APIRouter(prefix="/settings", tags=["admin", "settings"])

# Settings module grants (settings.view / settings.update) cover the Settings page,
# including auth-policy tabs that historically used a separate auth_policy.* feature.
SettingsRead = Annotated[object, Depends(require_any_permission("settings.view", "settings.update"))]
SettingsWrite = Annotated[object, Depends(require_permission("settings.update"))]
AuthPolicyRead = Annotated[
    object,
    Depends(require_any_permission("auth_policy.view", "settings.view", "settings.update")),
]
AuthPolicyWrite = Annotated[
    object,
    Depends(require_any_permission("auth_policy.update", "settings.update")),
]


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
    _: SettingsWrite,
) -> PasswordPolicyPublic:
    return svc.put_password_policy(payload)


@router.get("/auth-policy", response_model=AuthPolicyPublic)
def get_auth_policy(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: AuthPolicyRead,
) -> AuthPolicyPublic:
    return svc.get_auth_policy()


@router.put("/auth-policy", response_model=AuthPolicyPublic)
def put_auth_policy(
    payload: AuthPolicyPublic,
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: AuthPolicyWrite,
) -> AuthPolicyPublic:
    return svc.put_auth_policy(payload)


@router.get("/email-delivery", response_model=EmailDeliveryPublic)
def get_email_delivery(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: SettingsRead,
) -> EmailDeliveryPublic:
    return svc.get_email_delivery()


@router.put("/email-delivery", response_model=EmailDeliveryPublic)
def put_email_delivery(
    payload: EmailDeliveryPublic,
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: SettingsWrite,
) -> EmailDeliveryPublic:
    return svc.put_email_delivery(payload)


@router.post("/email-delivery/test")
async def test_email_delivery(
    payload: EmailDeliveryTestRequest,
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: SettingsWrite,
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
    _: SettingsRead,
) -> SessionIdleSettingsPublic:
    return svc.get_session_idle()


@router.put("/session-idle", response_model=SessionIdleSettingsPublic)
def put_session_idle(
    payload: SessionIdleSettingsPublic,
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: SettingsWrite,
) -> SessionIdleSettingsPublic:
    return svc.put_session_idle(payload)


@router.get("/financial-year", response_model=FinancialYearSettingsPublic)
def get_financial_year(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: SettingsRead,
) -> FinancialYearSettingsPublic:
    return svc.get_financial_year()


@router.put("/financial-year", response_model=FinancialYearSettingsPublic)
def put_financial_year(
    payload: FinancialYearSettingsPublic,
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: SettingsWrite,
) -> FinancialYearSettingsPublic:
    return svc.put_financial_year(payload)


@router.get("/document-format", response_model=DocumentFormatPublic)
def get_document_format(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: SettingsRead,
) -> DocumentFormatPublic:
    return svc.get_document_format()


@router.put("/document-format", response_model=DocumentFormatPublic)
def put_document_format(
    payload: DocumentFormatPublic,
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: SettingsWrite,
) -> DocumentFormatPublic:
    return svc.put_document_format(payload)


@router.post("/document-format/preview")
def preview_document_format(
    payload: DocumentFormatPublic,
    _: SettingsRead,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    fmt: Annotated[str, Query(pattern="^(pdf|xlsx)$")] = "pdf",
) -> Response:
    from modules.platform.settings.document_format import previewing
    from modules.reports.export import ReportDocument, actor_display_name, build_pdf, build_xlsx, content_type_for_format

    try:
        user_id = int(current.subject)
    except (TypeError, ValueError):
        user_id = None
    sample = ReportDocument(
        title="Sample report",
        subtitle="Preview of current (unsaved) format",
        headers=["Asset name", "Plant", "Status"],
        rows=[["Filling line 1", "Goa", "Active"], ["HVAC unit", "Goa", "Active"]],
        summary=(("Records", "2"),),
        show_signatures=True,
        signature_blocks=(
            ("Signature of User", "A. Sharma", "11.08.2026"),
            ("Signature of Plant Head", "", ""),
            ("Signature of Finance", "", ""),
        ),
        generated_by=actor_display_name(db, user_id),
    )
    with previewing(payload):
        content = build_xlsx(sample) if fmt == "xlsx" else build_pdf(sample)
    filename = "document-format-preview.xlsx" if fmt == "xlsx" else "document-format-preview.pdf"
    disposition = "attachment" if fmt == "xlsx" else "inline"
    return Response(
        content=content,
        media_type=content_type_for_format(fmt),
        headers={"Content-Disposition": f'{disposition}; filename="{filename}"'},
    )
