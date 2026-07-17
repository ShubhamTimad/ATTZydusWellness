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
    AssetCustodianUserPublic,
    AssetCreateRequest,
    AssetDetailPublic,
    AssetExportFieldsResponse,
    AssetFieldConfigListResponse,
    AssetFieldConfigPublic,
    AssetExportFieldPublic,
    AssetListResponse,
    AssetListColumnsPreference,
    AssetImagePublic,
    AssetUpdateRequest,
    FinancialYearListResponse,
    ImportCancelBatchResponse,
    ImportConfirmChunkRequest,
    ImportConfirmChunkResponse,
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
    InvalidAssetImageError,
    MAX_ASSET_IMAGE_BYTES,
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


@router.get("/custodian-users", response_model=list[AssetCustodianUserPublic])
def list_custodian_users(
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[
        object,
        Depends(require_any_permission("asset.view", "asset.create", "asset.update")),
    ],
) -> list[AssetCustodianUserPublic]:
    return [
        AssetCustodianUserPublic.model_validate(user)
        for user in svc.list_custodian_users()
    ]


@router.get("/list-columns", response_model=AssetListColumnsPreference)
def get_asset_list_columns(
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
    _: Annotated[object, Depends(require_permission("asset.view"))],
) -> AssetListColumnsPreference:
    return AssetListColumnsPreference(
        columns=svc.get_asset_list_columns(int(current.subject))
    )


@router.put("/list-columns", response_model=AssetListColumnsPreference)
def update_asset_list_columns(
    payload: AssetListColumnsPreference,
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
    _: Annotated[object, Depends(require_permission("asset.view"))],
) -> AssetListColumnsPreference:
    try:
        columns = svc.update_asset_list_columns(int(current.subject), payload.columns)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return AssetListColumnsPreference(columns=columns)


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
    physical_order_status: str | None = Query(
        None,
        description="Filter by displayed physical order status, or none for assets with no order.",
    ),
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
    asset_code: str | None = Query(None, description="Column filter: asset number contains"),
    combined_asset_number: str | None = Query(None, description="Column filter: combined asset number contains"),
    asset_name: str | None = Query(None, description="Column filter: asset name contains"),
    rfid_code: str | None = Query(None, description="Column filter: RFID code contains"),
    category: str | None = Query(None, description="Column filter: category code/name contains"),
    cost_center: str | None = Query(None, description="Column filter: cost center code/name contains"),
    functional_location: str | None = Query(None, description="Column filter: functional location code/name contains"),
) -> AssetListResponse:
    return svc.list_assets(
        page=page,
        page_size=page_size,
        search=search,
        plant_id=plant_id,
        category_id=category_id,
        lifecycle_status=lifecycle_status,
        approval_status=approval_status,
        physical_order_status=physical_order_status,
        rfid_status=rfid_status,
        fy_verification=fy_verification,
        fy_start_year=fy_start_year,
        fy_scan_from=fy_scan_from,
        fy_scan_to=fy_scan_to,
        sort_by=sort_by,
        sort_dir=sort_dir,
        column_filters={
            "asset_code": asset_code or "",
            "combined_asset_number": combined_asset_number or "",
            "asset_name": asset_name or "",
            "rfid_code": rfid_code or "",
            "category": category or "",
            "cost_center": cost_center or "",
            "functional_location": functional_location or "",
        },
    )


@router.get("/field-config", response_model=AssetFieldConfigListResponse)
def list_field_config(
    _: Annotated[object, Depends(require_permission("asset.view"))],
    db: Annotated[Session, Depends(get_db)],
) -> AssetFieldConfigListResponse:
    from modules.assets.field_config import AssetFieldConfigService

    svc = AssetFieldConfigService(db)
    return AssetFieldConfigListResponse(
        fields=[
            AssetFieldConfigPublic(
                field_key=row.field_key,
                display_label=row.display_label,
                is_visible=row.is_visible,
                is_required=row.is_required,
            )
            for row in svc.list_all()
        ]
    )


@router.get("/export/fields", response_model=AssetExportFieldsResponse)
def list_export_fields(
    _: Annotated[object, Depends(require_permission("asset.view"))],
    db: Annotated[Session, Depends(get_db)],
) -> AssetExportFieldsResponse:
    from modules.assets.field_config import AssetFieldConfigService
    from modules.assets.field_definitions import ASSET_EXPORT_FIELDS

    svc = AssetFieldConfigService(db)
    labels = svc.label_map()
    return AssetExportFieldsResponse(
        fields=[
            AssetExportFieldPublic(key=key, label=labels.get(key, key))
            for key in ASSET_EXPORT_FIELDS
            if svc.is_visible(key, default=True)
        ]
    )


@router.get("/export")
def export_assets(
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_permission("asset.view"))],
    fields: list[str] = Query(..., min_length=1),
    plant_id: int | None = Query(None),
    category_id: int | None = Query(None),
    cost_center: str | None = Query(None),
    functional_location: str | None = Query(None),
    actual_location: str | None = Query(None),
    fy_verification: str | None = Query(None),
    fy_start_year: int | None = Query(None, ge=2000, le=2100),
    fy_scan_from: date | None = Query(None),
    fy_scan_to: date | None = Query(None),
    asset_ids: list[int] | None = Query(None),
    sort_by: str = Query("asset_code"),
    sort_dir: str = Query("asc"),
) -> Response:
    try:
        content, filename, media_type = svc.export_assets(
            fields=fields,
            plant_id=plant_id,
            category_id=category_id,
            cost_center=cost_center,
            functional_location=functional_location,
            actual_location=actual_location,
            fy_verification=fy_verification,
            fy_start_year=fy_start_year,
            fy_scan_from=fy_scan_from,
            fy_scan_to=fy_scan_to,
            asset_ids=asset_ids,
            sort_by=sort_by,
            sort_dir=sort_dir,
        )
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
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


@router.get("/{asset_id}/image")
def get_asset_image(
    asset_id: int,
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_permission("asset.view"))],
) -> Response:
    try:
        content, content_type, _filename = svc.get_asset_image(asset_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(
        content=content,
        media_type=content_type,
        headers={"Cache-Control": "private, no-store"},
    )


@router.put("/{asset_id}/image", response_model=AssetImagePublic)
async def upload_asset_image(
    asset_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[
        object,
        Depends(require_any_permission("asset.update", "asset.manage", "asset.create")),
    ],
    file: UploadFile = File(...),
) -> AssetImagePublic:
    try:
        content = await file.read(MAX_ASSET_IMAGE_BYTES + 1)
        return svc.set_asset_image(
            asset_id,
            data=content,
            filename=file.filename,
            actor_user_id=int(current.subject),
        )
    except InvalidAssetImageError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    finally:
        await file.close()


@router.delete("/{asset_id}/image", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset_image(
    asset_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_any_permission("asset.update", "asset.manage"))],
) -> None:
    try:
        svc.delete_asset_image(asset_id, actor_user_id=int(current.subject))
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
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Combined Asset No already exists.",
        ) from None
    except DuplicateRfidError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="RFID code already exists.") from None
    except InvalidTagColorError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_tag_color", "message": exc.message},
        ) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


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
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Combined Asset No already exists.",
        ) from None
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


@router.get("/import/template")
def download_import_template(
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_permission("asset.import"))],
) -> Response:
    content, filename, media_type = svc.build_import_template()
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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


@router.post("/import/confirm-chunk", response_model=ImportConfirmChunkResponse)
def import_confirm_chunk(
    body: ImportConfirmChunkRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_permission("asset.import"))],
) -> ImportConfirmChunkResponse:
    try:
        return svc.confirm_import_chunk(body, actor_user_id=int(current.subject))
    except ImportValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.preview.model_dump(mode="json"),
        ) from exc
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/import/cancel-batch/{batch_id}", response_model=ImportCancelBatchResponse)
def cancel_import_batch(
    batch_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[AssetMasterService, Depends(get_asset_service)],
    _: Annotated[object, Depends(require_permission("asset.import"))],
) -> ImportCancelBatchResponse:
    try:
        return svc.cancel_import_batch(batch_id, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

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

