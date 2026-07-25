from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_any_permission, require_permission
from db.session import get_db
from modules.errors import ConflictError, NotFoundError
from modules.orders.schema import (
    CreatePhysicalOrderRequest,
    ExecutorListResponse,
    ItemIdsRequest,
    PhysicalOrderDetail,
    PhysicalOrderListResponse,
    RejectItemsRequest,
    RejectOrderRequest,
    ScanAssetRequest,
    ScanAssetResponse,
    SubmitPhysicalOrderRequest,
    UpdatePhysicalOrderRequest,
    ValidateAssetsRequest,
    ValidateAssetsResponse,
)
from modules.orders.service import PhysicalOrderService

router = APIRouter(prefix="/physical-orders", tags=["admin", "physical-orders"])


def get_order_service(db: Session = Depends(get_db)) -> PhysicalOrderService:
    return PhysicalOrderService(db)


@router.post("/validate-assets", response_model=ValidateAssetsResponse)
def validate_assets(
    body: ValidateAssetsRequest,
    svc: Annotated[PhysicalOrderService, Depends(get_order_service)],
    _: Annotated[object, Depends(require_permission("order.create"))],
) -> ValidateAssetsResponse:
    return svc.validate_assets(body.asset_ids)


@router.get("/executors", response_model=ExecutorListResponse)
def list_executors(
    svc: Annotated[PhysicalOrderService, Depends(get_order_service)],
    _: Annotated[
        object,
        Depends(require_any_permission("order.create", "order.manage", "order.reassign", "order.execute")),
    ],
    plant_id: int | None = Query(
        None,
        description="Limit to users in the workflow role who belong to this plant.",
    ),
) -> ExecutorListResponse:
    try:
        return svc.list_executors(plant_id=plant_id)
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.get("", response_model=PhysicalOrderListResponse)
def list_orders(
    svc: Annotated[PhysicalOrderService, Depends(get_order_service)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
    _: Annotated[object, Depends(require_permission("order.view"))],
    tab: str = Query("all"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
) -> PhysicalOrderListResponse:
    return svc.list_orders(tab=tab, page=page, page_size=page_size, viewer_id=int(current.subject))


@router.post("", response_model=PhysicalOrderDetail, status_code=status.HTTP_201_CREATED)
def create_order(
    body: CreatePhysicalOrderRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[PhysicalOrderService, Depends(get_order_service)],
    _: Annotated[object, Depends(require_permission("order.create"))],
) -> PhysicalOrderDetail:
    try:
        return svc.create_order(body, actor_user_id=int(current.subject))
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.get("/{order_id}", response_model=PhysicalOrderDetail)
def get_order(
    order_id: int,
    svc: Annotated[PhysicalOrderService, Depends(get_order_service)],
    _: Annotated[object, Depends(require_permission("order.view"))],
) -> PhysicalOrderDetail:
    try:
        return svc.get_order(order_id)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e


@router.patch("/{order_id}", response_model=PhysicalOrderDetail)
def update_order(
    order_id: int,
    body: UpdatePhysicalOrderRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[PhysicalOrderService, Depends(get_order_service)],
    _: Annotated[object, Depends(require_permission("order.update"))],
) -> PhysicalOrderDetail:
    try:
        return svc.update_order(
            order_id,
            actor_user_id=int(current.subject),
            assigned_to=body.assigned_to,
            remarks=body.remarks,
            asset_ids=body.asset_ids,
        )
    except (ConflictError, NotFoundError) as e:
        code = status.HTTP_409_CONFLICT if isinstance(e, ConflictError) else status.HTTP_404_NOT_FOUND
        raise HTTPException(status_code=code, detail=str(e)) from e


@router.post("/{order_id}/submit", response_model=PhysicalOrderDetail)
def submit_order(
    order_id: int,
    body: SubmitPhysicalOrderRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[PhysicalOrderService, Depends(get_order_service)],
    _: Annotated[object, Depends(require_permission("order.create"))],
) -> PhysicalOrderDetail:
    try:
        return svc.submit_order(
            order_id,
            actor_user_id=int(current.subject),
            assigned_to=int(body.assigned_to),
        )
    except (ConflictError, NotFoundError) as e:
        code = status.HTTP_409_CONFLICT if isinstance(e, ConflictError) else status.HTTP_404_NOT_FOUND
        raise HTTPException(status_code=code, detail=str(e)) from e


@router.post("/{order_id}/approval/approve-order", response_model=PhysicalOrderDetail)
def approve_creation_order(
    order_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[PhysicalOrderService, Depends(get_order_service)],
    _: Annotated[object, Depends(require_permission("order.approve"))],
) -> PhysicalOrderDetail:
    try:
        return svc.approve_creation_order(order_id, actor_user_id=int(current.subject))
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.post("/{order_id}/approval/approve-all", response_model=PhysicalOrderDetail)
def approve_all_items(
    order_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[PhysicalOrderService, Depends(get_order_service)],
    _: Annotated[object, Depends(require_any_permission("order.approve", "order.create"))],
) -> PhysicalOrderDetail:
    try:
        return svc.approve_all_items(order_id, actor_user_id=int(current.subject))
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.post("/{order_id}/approval/approve-items", response_model=PhysicalOrderDetail)
def approve_items(
    order_id: int,
    body: ItemIdsRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[PhysicalOrderService, Depends(get_order_service)],
    _: Annotated[object, Depends(require_any_permission("order.approve", "order.create"))],
) -> PhysicalOrderDetail:
    try:
        return svc.approve_items(order_id, body.item_ids, actor_user_id=int(current.subject))
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.post("/{order_id}/approval/reject-items", response_model=PhysicalOrderDetail)
def reject_items(
    order_id: int,
    body: RejectItemsRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[PhysicalOrderService, Depends(get_order_service)],
    _: Annotated[object, Depends(require_any_permission("order.approve", "order.create"))],
) -> PhysicalOrderDetail:
    try:
        return svc.reject_items(
            order_id,
            body.item_ids,
            rejection_reason=body.rejection_reason,
            actor_user_id=int(current.subject),
        )
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.post("/{order_id}/approval/reject-order", response_model=PhysicalOrderDetail)
def reject_order(
    order_id: int,
    body: RejectOrderRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[PhysicalOrderService, Depends(get_order_service)],
    _: Annotated[object, Depends(require_permission("order.approve"))],
) -> PhysicalOrderDetail:
    try:
        return svc.reject_order(order_id, reason=body.reason, actor_user_id=int(current.subject))
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.post("/{order_id}/execution/reject-items", response_model=PhysicalOrderDetail)
def reject_execution_items(
    order_id: int,
    body: RejectItemsRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[PhysicalOrderService, Depends(get_order_service)],
    _: Annotated[object, Depends(require_permission("order.execute"))],
) -> PhysicalOrderDetail:
    try:
        return svc.reject_execution_items(
            order_id,
            body.item_ids,
            rejection_reason=body.rejection_reason,
            actor_user_id=int(current.subject),
        )
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.post("/{order_id}/reassign", response_model=PhysicalOrderDetail)
def reassign_order(
    order_id: int,
    body: UpdatePhysicalOrderRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[PhysicalOrderService, Depends(get_order_service)],
    _: Annotated[
        object,
        Depends(require_any_permission("order.reassign", "order.create", "order.update", "order.manage")),
    ],
) -> PhysicalOrderDetail:
    if body.assigned_to is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="assigned_to is required.",
        )
    try:
        return svc.reassign_order(
            order_id,
            assigned_to=body.assigned_to,
            actor_user_id=int(current.subject),
        )
    except (ConflictError, NotFoundError) as e:
        code = status.HTTP_409_CONFLICT if isinstance(e, ConflictError) else status.HTTP_404_NOT_FOUND
        raise HTTPException(status_code=code, detail=str(e)) from e


@router.post("/{order_id}/close", response_model=PhysicalOrderDetail)
def close_order(
    order_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[PhysicalOrderService, Depends(get_order_service)],
    _: Annotated[object, Depends(require_any_permission("order.approve", "order.update", "order.create"))],
) -> PhysicalOrderDetail:
    try:
        return svc.close_order(order_id, actor_user_id=int(current.subject))
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.post("/{order_id}/start", response_model=PhysicalOrderDetail)
def start_order(
    order_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[PhysicalOrderService, Depends(get_order_service)],
    _: Annotated[object, Depends(require_permission("order.execute"))],
) -> PhysicalOrderDetail:
    try:
        return svc.start_order(order_id, actor_user_id=int(current.subject))
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.post("/{order_id}/scan", response_model=ScanAssetResponse)
def scan_asset(
    order_id: int,
    body: ScanAssetRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[PhysicalOrderService, Depends(get_order_service)],
    _: Annotated[object, Depends(require_permission("order.execute"))],
) -> ScanAssetResponse:
    try:
        return svc.scan_asset(
            order_id,
            scan_value=body.scan_value,
            item_id=body.item_id,
            actor_user_id=int(current.subject),
        )
    except (ConflictError, NotFoundError) as e:
        code = status.HTTP_409_CONFLICT if isinstance(e, ConflictError) else status.HTTP_404_NOT_FOUND
        raise HTTPException(status_code=code, detail=str(e)) from e


@router.post("/{order_id}/submit-closure", response_model=PhysicalOrderDetail)
def submit_closure(
    order_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[PhysicalOrderService, Depends(get_order_service)],
    _: Annotated[object, Depends(require_permission("order.execute"))],
) -> PhysicalOrderDetail:
    try:
        return svc.submit_closure(order_id, actor_user_id=int(current.subject))
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.post("/{order_id}/closure/approve-order", response_model=PhysicalOrderDetail)
def approve_closure_order(
    order_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[PhysicalOrderService, Depends(get_order_service)],
    _: Annotated[object, Depends(require_any_permission("order.approve", "order.create"))],
) -> PhysicalOrderDetail:
    try:
        return svc.approve_closure_order(order_id, actor_user_id=int(current.subject))
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
