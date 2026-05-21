from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
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
    ImportConfirmRequest,
    ImportConfirmResponse,
    ImportPreviewResponse,
    ImportValidateRequest,
)
from modules.assets.service import (
    AssetMasterService,
    DuplicateAssetCodeError,
    DuplicateRfidError,
    ImportValidationError,
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
        sort_by=sort_by,
        sort_dir=sort_dir,
    )


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
