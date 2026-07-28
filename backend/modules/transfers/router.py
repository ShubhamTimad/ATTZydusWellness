from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_any_permission, require_permission
from db.session import get_db
from modules.errors import ConflictError, NotFoundError
from modules.transfers.schema import (
    Cc2AssignTransferRequest,
    CfApproveTransferRequest,
    CfRejectTransferRequest,
    CreateTransferOrderRequest,
    SubmitTransferOrderRequest,
    TransferAssigneeListResponse,
    TransferDestinationCostCenter,
    TransferOrderDetail,
    TransferOrderListResponse,
    UpdateTransferOrderRequest,
)
from modules.transfers.service import TransferOrderService

router = APIRouter(prefix="/transfer-orders", tags=["admin", "transfer-orders"])


def get_transfer_service(db: Session = Depends(get_db)) -> TransferOrderService:
    return TransferOrderService(db)


def _http(exc: Exception) -> HTTPException:
    if isinstance(exc, NotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, ConflictError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    raise exc


@router.get("/assignees", response_model=TransferAssigneeListResponse)
def list_assignees(
    svc: Annotated[TransferOrderService, Depends(get_transfer_service)],
    _: Annotated[
        object,
        Depends(
            require_any_permission(
                "transfer.create",
                "transfer.approve",
                "transfer.receive",
                "transfer.manage",
            )
        ),
    ],
    level: str = Query("central_finance", description="cost_center or central_finance"),
) -> TransferAssigneeListResponse:
    try:
        return svc.list_assignees(level=level)
    except Exception as e:
        raise _http(e) from e


@router.get("/cost-center-users", response_model=TransferAssigneeListResponse)
def list_cost_center_users(
    svc: Annotated[TransferOrderService, Depends(get_transfer_service)],
    _: Annotated[
        object,
        Depends(
            require_any_permission(
                "transfer.create",
                "transfer.approve",
                "transfer.manage",
            )
        ),
    ],
    cost_center_id: int = Query(..., ge=1),
) -> TransferAssigneeListResponse:
    try:
        return svc.list_cost_center_users(cost_center_id=cost_center_id)
    except Exception as e:
        raise _http(e) from e


@router.get("/destination-cost-centers", response_model=list[TransferDestinationCostCenter])
def list_destination_cost_centers(
    svc: Annotated[TransferOrderService, Depends(get_transfer_service)],
    _: Annotated[
        object,
        Depends(
            require_any_permission(
                "transfer.create",
                "transfer.approve",
                "transfer.manage",
            )
        ),
    ],
    plant_id: int = Query(..., ge=1),
) -> list[TransferDestinationCostCenter]:
    try:
        return svc.list_destination_cost_centers(plant_id=plant_id)
    except Exception as e:
        raise _http(e) from e


@router.get("", response_model=TransferOrderListResponse)
def list_orders(
    svc: Annotated[TransferOrderService, Depends(get_transfer_service)],
    _: Annotated[object, Depends(require_permission("transfer.view"))],
    tab: str = Query("active"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
) -> TransferOrderListResponse:
    return svc.list_orders(tab=tab, page=page, page_size=page_size)


@router.post("", response_model=TransferOrderDetail, status_code=status.HTTP_201_CREATED)
def create_order(
    body: CreateTransferOrderRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TransferOrderService, Depends(get_transfer_service)],
    _: Annotated[object, Depends(require_permission("transfer.create"))],
) -> TransferOrderDetail:
    try:
        return svc.create_order(body, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.get("/{order_id}", response_model=TransferOrderDetail)
def get_order(
    order_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TransferOrderService, Depends(get_transfer_service)],
    _: Annotated[object, Depends(require_permission("transfer.view"))],
) -> TransferOrderDetail:
    try:
        return svc.get_order(order_id, viewer_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.patch("/{order_id}", response_model=TransferOrderDetail)
def update_order(
    order_id: int,
    body: UpdateTransferOrderRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TransferOrderService, Depends(get_transfer_service)],
    _: Annotated[object, Depends(require_any_permission("transfer.create", "transfer.manage"))],
) -> TransferOrderDetail:
    try:
        return svc.update_order(order_id, body, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.post("/{order_id}/submit", response_model=TransferOrderDetail)
def submit_order(
    order_id: int,
    body: SubmitTransferOrderRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TransferOrderService, Depends(get_transfer_service)],
    _: Annotated[object, Depends(require_permission("transfer.create"))],
) -> TransferOrderDetail:
    try:
        return svc.submit_order(order_id, body, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.post("/{order_id}/cf/approve", response_model=TransferOrderDetail)
def cf_approve(
    order_id: int,
    body: CfApproveTransferRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TransferOrderService, Depends(get_transfer_service)],
    _: Annotated[object, Depends(require_any_permission("transfer.approve", "transfer.manage"))],
) -> TransferOrderDetail:
    try:
        return svc.cf_approve(order_id, body, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.post("/{order_id}/cf/reject", response_model=TransferOrderDetail)
def cf_reject(
    order_id: int,
    body: CfRejectTransferRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TransferOrderService, Depends(get_transfer_service)],
    _: Annotated[object, Depends(require_any_permission("transfer.approve", "transfer.manage"))],
) -> TransferOrderDetail:
    try:
        return svc.cf_reject(order_id, body, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.post("/{order_id}/cc2/assign", response_model=TransferOrderDetail)
def cc2_assign(
    order_id: int,
    body: Cc2AssignTransferRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TransferOrderService, Depends(get_transfer_service)],
    _: Annotated[object, Depends(require_any_permission("transfer.receive", "transfer.manage"))],
) -> TransferOrderDetail:
    try:
        return svc.cc2_assign_to_cf(order_id, body, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.post("/{order_id}/cf/confirm", response_model=TransferOrderDetail)
def cf_confirm(
    order_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TransferOrderService, Depends(get_transfer_service)],
    _: Annotated[object, Depends(require_any_permission("transfer.confirm", "transfer.manage"))],
) -> TransferOrderDetail:
    try:
        return svc.cf_confirm(order_id, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.post("/{order_id}/cf/close", response_model=TransferOrderDetail)
def cf_close(
    order_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TransferOrderService, Depends(get_transfer_service)],
    _: Annotated[object, Depends(require_any_permission("transfer.confirm", "transfer.manage"))],
) -> TransferOrderDetail:
    try:
        return svc.cf_close(order_id, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e
