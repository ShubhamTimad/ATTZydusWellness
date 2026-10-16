from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_any_permission, require_permission
from modules.errors import ConflictError
from db.session import get_db

from modules.platform.settings.brand_logo import InvalidBrandLogoError
from modules.platform.settings.login_background import InvalidLoginBackgroundError
from modules.platform.settings.schema import (
    AuthPolicyPublic,
    DocumentFormatPublic,
    EmailDeliveryPublic,
    EmailDeliveryTestRequest,
    FinancialYearSettingsPublic,
    LoginBackgroundMetaPublic,
    PasswordPolicyPublic,
    ScanningProcessSettingsPublic,
    ScanningProcessUpdateRequest,
    SessionIdleSettingsPublic,
    SsoSettingsPublic,
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
    _: SettingsRead,
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


@router.get("/sso", response_model=SsoSettingsPublic)
def get_sso_settings(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: AuthPolicyRead,
) -> SsoSettingsPublic:
    return svc.get_sso_settings()


@router.put("/sso", response_model=SsoSettingsPublic)
def put_sso_settings(
    payload: SsoSettingsPublic,
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: AuthPolicyWrite,
) -> SsoSettingsPublic:
    try:
        return svc.put_sso_settings(payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


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


@router.get("/login-background/meta", response_model=LoginBackgroundMetaPublic)
def get_login_background_meta(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: SettingsRead,
) -> LoginBackgroundMetaPublic:
    return svc.get_login_background_meta()


@router.get("/login-background")
def get_login_background_admin(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: SettingsRead,
) -> Response:
    blob = svc.get_login_background()
    if blob is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No login background configured.")
    data, content_type = blob
    return Response(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": "private, no-store"},
    )


@router.put("/login-background", response_model=LoginBackgroundMetaPublic)
async def put_login_background(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: SettingsWrite,
    file: UploadFile = File(...),
) -> LoginBackgroundMetaPublic:
    data = await file.read()
    try:
        return svc.put_login_background(data)
    except InvalidLoginBackgroundError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/brand-logo/meta", response_model=LoginBackgroundMetaPublic)
def get_brand_logo_meta(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: SettingsRead,
) -> LoginBackgroundMetaPublic:
    return svc.get_brand_logo_meta()


@router.get("/brand-logo")
def get_brand_logo_admin(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: SettingsRead,
) -> Response:
    blob = svc.get_brand_logo()
    if blob is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No logo configured.")
    data, content_type = blob
    return Response(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": "private, no-store"},
    )


@router.put("/brand-logo", response_model=LoginBackgroundMetaPublic)
async def put_brand_logo(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: SettingsWrite,
    file: UploadFile = File(...),
) -> LoginBackgroundMetaPublic:
    data = await file.read()
    try:
        return svc.put_brand_logo(data)
    except InvalidBrandLogoError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.delete("/brand-logo", status_code=status.HTTP_204_NO_CONTENT)
def delete_brand_logo(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: SettingsWrite,
) -> None:
    svc.delete_brand_logo()


@router.delete("/login-background", status_code=status.HTTP_204_NO_CONTENT)
def delete_login_background(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: SettingsWrite,
) -> None:
    svc.delete_login_background()


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


@router.get("/scanning-process", response_model=ScanningProcessSettingsPublic)
def get_scanning_process(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: SettingsRead,
) -> ScanningProcessSettingsPublic:
    return svc.get_scanning_process()


@router.put("/scanning-process", response_model=ScanningProcessSettingsPublic)
def put_scanning_process(
    payload: ScanningProcessUpdateRequest,
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: SettingsWrite,
) -> ScanningProcessSettingsPublic:
    try:
        return svc.put_scanning_process(payload)
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


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
