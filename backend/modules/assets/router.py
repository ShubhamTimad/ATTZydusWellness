from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_any_permission, require_permission
from db.session import get_db
from modules.assets.schema import (
    AssetCategoryPublic,
    AssetCreateRequest,
    AssetDetailPublic,
    AssetListResponse,
    AssetUpdateRequest,
    FinancialYearListResponse,
    ImportConfirmRequest,
    ImportConfirmResponse,
    ImportPreviewResponse,
    ImportValidateRequest,
    SubmitForApprovalRequest,
    SubmitForApprovalResponse,
    AssetRfidAttachByCodeRequest,
    AssetRfidAttachPublic,
    AssetRfidAttachRequest,
    AssetRfidUpdateRequest,
)
from modules.assets.service import (
    AssetMasterService,
    DuplicateAssetCodeError,
    DuplicateRfidError,
    ImportValidationError,
    InvalidRfidError,
    InvalidTagColorError,
)
from modules.assets.schema import AssetAuditEventPublic
from modules.errors import ConflictError, NotFoundError

router = APIRouter(prefix="/assets", tags=["admin", "assets"])


def get_asset_service(db: Session = Depends(get_db)) -> AssetMasterService:
    return AssetMasterService(db)


@router.get("/categories", response_model=list[AssetCategoryPublic])
def list_categories(
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_permission("asset.view"))],
) -> list[AssetCategoryPublic]:
    return svc.list_categories()


@router.get("", response_model=AssetListResponse)
def list_assets(
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_permission("asset.view"))],
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    search: str | None = Query(None),
    plant_id: int | None = Query(None),
    category_id: int | None = Query(None),
    lifecycle_status: str | None = Query(None),
    approval_status: str | None = Query(None),
    rfid_status: str | None = Query(
        None,
        description="Filter by RFID tag: tagged | not_tagged",
    ),
    fy_verification: str | None = Query(
        None,
        description="Filter RFID-tagged active assets by financial year verification: verified | pending | all",
    ),
    fy_start_year: int | None = Query(
        None,
        ge=2000,
        le=2100,
        description="Calendar year the financial year starts in; omit for the running financial year.",
    ),
    fy_scan_from: date | None = Query(None, description="Include RFID scans on or after this date (within FY)."),
    fy_scan_to: date | None = Query(None, description="Include RFID scans on or before this date (within FY)."),
    sort_by: str = Query("created_at"),
    sort_dir: str = Query("desc"),
) -> AssetListResponse:
    return svc.list_assets(
        page=page,
        page_size=page_size,
        search=search,
        plant_id=plant_id,
        category_id=category_id,
        lifecycle_status=lifecycle_status,
        approval_status=approval_status,
        rfid_status=rfid_status,
        fy_verification=fy_verification,
        fy_start_year=fy_start_year,
        fy_scan_from=fy_scan_from,
        fy_scan_to=fy_scan_to,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )


@router.get("/fy-verification/export")
def export_fy_verification(
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_permission("asset.view"))],
    format: str = Query("xlsx", alias="format", pattern="^(?i)(xlsx|pdf)$"),
    fy_verification: str | None = Query("all"),
    fy_start_year: int | None = Query(None, ge=2000, le=2100),
    fy_scan_from: date | None = Query(None),
    fy_scan_to: date | None = Query(None),
    plant_id: int | None = Query(None),
    category_id: int | None = Query(None),
    search: str | None = Query(None),
) -> Response:
    content, filename, media_type = svc.export_fy_verification_report(
        fmt=format,
        fy_verification=fy_verification,
        fy_start_year=fy_start_year,
        fy_scan_from=fy_scan_from,
        fy_scan_to=fy_scan_to,
        plant_id=plant_id,
        category_id=category_id,
        search=search,
    )
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/financial-years", response_model=FinancialYearListResponse)
def list_financial_years(
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_permission("asset.view"))],
    years_back: int = Query(10, ge=1, le=30),
) -> FinancialYearListResponse:
    return svc.list_financial_years(years_back=years_back)


@router.post("/submit-for-approval", response_model=SubmitForApprovalResponse)
def submit_assets_for_approval(
    body: SubmitForApprovalRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_permission("asset.create"))],
) -> SubmitForApprovalResponse:
    try:
        return svc.submit_for_approval(body.asset_ids, actor_user_id=int(current.subject))
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/{asset_id}/submit-for-approval", response_model=SubmitForApprovalResponse)
def submit_asset_for_approval(
    asset_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_permission("asset.create"))],
) -> SubmitForApprovalResponse:
    try:
        return svc.submit_for_approval([asset_id], actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/{asset_id}", response_model=AssetDetailPublic)
def get_asset(
    asset_id: int,
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_permission("asset.view"))],
) -> AssetDetailPublic:
    try:
        return svc.get_asset(asset_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("", response_model=AssetDetailPublic, status_code=status.HTTP_201_CREATED)
def create_asset(
    payload: AssetCreateRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_permission("asset.create"))],
) -> AssetDetailPublic:
    try:
        return svc.create_asset(payload, actor_user_id=int(current.subject))
    except DuplicateAssetCodeError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Asset code already exists.") from None
    except DuplicateRfidError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="RFID code already exists.") from None
    except InvalidTagColorError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_tag_color", "message": exc.message},
        ) from exc


@router.patch("/{asset_id}", response_model=AssetDetailPublic)
def update_asset(
    asset_id: int,
    payload: AssetUpdateRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_any_permission("asset.update", "asset.manage"))],
) -> AssetDetailPublic:
    try:
        return svc.update_asset(asset_id, payload, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except DuplicateAssetCodeError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Asset code already exists.") from None
    except InvalidTagColorError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_tag_color", "message": exc.message},
        ) from exc


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(
    asset_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_any_permission("asset.delete", "asset.manage"))],
) -> None:
    try:
        svc.soft_delete(asset_id, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/{asset_id}/audit", response_model=list[AssetAuditEventPublic])
def asset_audit(
    asset_id: int,
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_permission("asset.view"))],
) -> list[AssetAuditEventPublic]:
    try:
        return svc.list_audit(asset_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/import/preview", response_model=ImportPreviewResponse)
async def import_preview(
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_permission("asset.import"))],
    file: UploadFile = File(...),
) -> ImportPreviewResponse:
    content = await file.read()
    try:
        return svc.preview_import(filename=file.filename, content=content)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/import/validate", response_model=ImportPreviewResponse)
def import_validate(
    body: ImportValidateRequest,
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_permission("asset.import"))],
) -> ImportPreviewResponse:
    return svc.validate_import_rows(filename=body.filename, raw_rows=body.rows)


@router.post("/import/confirm", response_model=ImportConfirmResponse)
def import_confirm(
    body: ImportConfirmRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_permission("asset.import"))],
) -> ImportConfirmResponse:
    try:
        return svc.confirm_import(body, actor_user_id=int(current.subject))
    except ImportValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.preview.model_dump(mode="json"),
        ) from exc

def _rfid_error_response(exc: DuplicateRfidError | InvalidRfidError) -> HTTPException:
    if isinstance(exc, DuplicateRfidError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "duplicate_rfid",
                "message": exc.message,
                "rfid_code": exc.rfid_code,
                "existing_asset_id": exc.existing_asset_id,
                "existing_asset_code": exc.existing_asset_code,
            },
        )
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"code": "invalid_rfid", "message": exc.message},
    )


def _tag_color_error_response(exc: InvalidTagColorError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"code": "invalid_tag_color", "message": exc.message},
    )


@router.post("/rfid/attach-by-code", response_model=AssetRfidAttachPublic)
def attach_asset_rfid_by_code(
    payload: AssetRfidAttachByCodeRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_any_permission("asset.update", "asset.manage"))],
) -> AssetRfidAttachPublic:
    """Attach or update RFID when the operator knows asset code + tag (no row selection)."""
    try:
        return svc.attach_rfid_by_asset_code(
            asset_code=payload.asset_code,
            rfid_code=payload.rfid_code,
            tag_color_id=payload.tag_color_id,
            actor_user_id=int(current.subject),
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except InvalidTagColorError as exc:
        raise _tag_color_error_response(exc) from exc
    except (DuplicateRfidError, InvalidRfidError) as exc:
        raise _rfid_error_response(exc) from exc


@router.post("/{asset_id}/rfid/attach", response_model=AssetRfidAttachPublic)
def attach_asset_rfid(
    asset_id: int,
    payload: AssetRfidAttachRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_any_permission("asset.update", "asset.manage"))],
) -> AssetRfidAttachPublic:
    """Dedicated endpoint: attach or update RFID on a single asset (unique per asset)."""
    try:
        return svc.attach_rfid(
            asset_id=asset_id,
            rfid_code=payload.rfid_code,
            tag_color_id=payload.tag_color_id,
            actor_user_id=int(current.subject),
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except InvalidTagColorError as exc:
        raise _tag_color_error_response(exc) from exc
    except (DuplicateRfidError, InvalidRfidError) as exc:
        raise _rfid_error_response(exc) from exc


@router.patch("/{asset_id}/rfid", response_model=AssetDetailPublic)
def update_asset_rfid(
    asset_id: int,
    payload: AssetRfidUpdateRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_any_permission("asset.update", "asset.manage"))],
) -> AssetDetailPublic:
    try:
        return svc.update_rfid(
            asset_id=asset_id,
            rfid_code=payload.rfid_code,
            actor_user_id=int(current.subject),
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (DuplicateRfidError, InvalidRfidError) as exc:
        raise _rfid_error_response(exc) from exc

