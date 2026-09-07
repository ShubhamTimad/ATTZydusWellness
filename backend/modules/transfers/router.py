from __future__ import annotations

from datetime import date
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
    SaveReceiveLocationsRequest,
    SubmitTransferOrderRequest,
    TransferAssigneeListResponse,
    TransferDestinationCostCenter,
    TransferListFilterOptionsResponse,
    TransferOrderDetail,
    TransferOrderListResponse,
    UpdateTransferOrderRequest,
)
from modules.transfers.constants import ACTION_SUBMIT
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
                "transfer.submit",
                "transfer.approve",
                "transfer.receive",
                "transfer.manage",
            )
        ),
    ],
    level: str | None = Query(
        None,
        description="hod | cost_center | central_finance — when set, users in that role",
    ),
    role_id: int | None = Query(
        None,
        ge=1,
        description="Workflow step role id — preferred over level (rename-safe)",
    ),
    for_submit: bool = Query(
        False,
        description="When true (or level/role_id omitted), return first-step role of transfer.submit workflow",
    ),
    for_next: bool = Query(
        False,
        description="With order_id: users of the step after the order's current one (next assignee)",
    ),
    order_id: int | None = Query(
        None,
        ge=1,
        description="When set, apply the picker step's org_scope against this order's cost centers",
    ),
) -> TransferAssigneeListResponse:
    try:
        if role_id is not None or for_next:
            return svc.list_assignees_by_role_id(role_id=role_id, order_id=order_id)
        if for_submit or level is None:
            return svc.list_assignees_for_action(
                action_code=ACTION_SUBMIT, order_id=order_id
            )
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


@router.get("/column-filter-options", response_model=TransferListFilterOptionsResponse)
def list_column_filter_options(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TransferOrderService, Depends(get_transfer_service)],
    _: Annotated[object, Depends(require_permission("transfer.view"))],
    plant_id: int | None = Query(None, ge=1),
) -> TransferListFilterOptionsResponse:
    """Distinct plant / cost-center / status values present on transfer orders."""
    return svc.list_column_filter_options(
        viewer_user_id=int(current.subject),
        plant_id=plant_id,
    )


@router.get("", response_model=TransferOrderListResponse)
def list_orders(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TransferOrderService, Depends(get_transfer_service)],
    _: Annotated[object, Depends(require_permission("transfer.view"))],
    tab: str = Query("needs_action"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    search: str | None = Query(None),
    order_number: str | None = Query(None),
    plant_id: int | None = Query(None),
    from_cost_center_id: int | None = Query(None),
    to_cost_center_id: int | None = Query(None),
    status: str | None = Query(None),
    asset_count: int | None = Query(None, ge=0),
    assigned_to: str | None = Query(None),
    created_on: date | None = Query(None),
    sort_by: str = Query("created_at"),
    sort_dir: str = Query("desc"),
) -> TransferOrderListResponse:
    return svc.list_orders(
        tab=tab,
        page=page,
        page_size=page_size,
        viewer_user_id=int(current.subject),
        search=search,
        order_number=order_number,
        plant_id=plant_id,
        from_cost_center_id=from_cost_center_id,
        to_cost_center_id=to_cost_center_id,
        status=status,
        asset_count=asset_count,
        assigned_to=assigned_to,
        created_on=created_on,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )


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
    _: Annotated[
        object,
        Depends(
            require_any_permission(
                "transfer.create",
                "transfer.receive",
                "transfer.manage",
            )
        ),
    ],
) -> TransferOrderDetail:
    try:
        return svc.update_order(order_id, body, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_order(
    order_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TransferOrderService, Depends(get_transfer_service)],
    _: Annotated[object, Depends(require_any_permission("transfer.create", "transfer.manage"))],
) -> None:
    try:
        svc.delete_draft_order(order_id, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.post("/{order_id}/archive", response_model=TransferOrderDetail)
def archive_order(
    order_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TransferOrderService, Depends(get_transfer_service)],
    _: Annotated[object, Depends(require_any_permission("transfer.create", "transfer.manage"))],
) -> TransferOrderDetail:
    try:
        return svc.archive_order(order_id, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.post("/{order_id}/unarchive", response_model=TransferOrderDetail)
def unarchive_order(
    order_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TransferOrderService, Depends(get_transfer_service)],
    _: Annotated[object, Depends(require_any_permission("transfer.create", "transfer.manage"))],
) -> TransferOrderDetail:
    try:
        return svc.unarchive_order(order_id, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.post("/{order_id}/submit", response_model=TransferOrderDetail)
def submit_order(
    order_id: int,
    body: SubmitTransferOrderRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TransferOrderService, Depends(get_transfer_service)],
    _: Annotated[
        object,
        Depends(
            require_any_permission(
                "transfer.create",
                "transfer.submit",
                "transfer.receive",
                "transfer.manage",
            )
        ),
    ],
) -> TransferOrderDetail:
    try:
        return svc.submit_order(order_id, body, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.post("/{order_id}/resume", response_model=TransferOrderDetail)
def resume_rejected_order(
    order_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TransferOrderService, Depends(get_transfer_service)],
    _: Annotated[
        object,
        Depends(
            require_any_permission(
                "transfer.create",
                "transfer.submit",
                "transfer.manage",
            )
        ),
    ],
) -> TransferOrderDetail:
    """Rejected → draft so the creator can edit and submit again from the start."""
    try:
        return svc.resume_rejected_order(order_id, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.post("/{order_id}/restart-transfer", response_model=TransferOrderDetail)
def restart_transfer(
    order_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TransferOrderService, Depends(get_transfer_service)],
    _: Annotated[
        object,
        Depends(
            require_any_permission(
                "transfer.create",
                "transfer.receive",
                "transfer.manage",
            )
        ),
    ],
) -> TransferOrderDetail:
    """After CF reject → receiver: reopen same order for a full re-transfer (approve flow)."""
    try:
        return svc.restart_transfer_for_resubmit(order_id, actor_user_id=int(current.subject))
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


@router.post("/{order_id}/receive-locations", response_model=TransferOrderDetail)
def save_receive_locations(
    order_id: int,
    body: SaveReceiveLocationsRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TransferOrderService, Depends(get_transfer_service)],
    _: Annotated[object, Depends(require_any_permission("transfer.receive", "transfer.manage"))],
) -> TransferOrderDetail:
    try:
        return svc.save_receive_locations(order_id, body, actor_user_id=int(current.subject))
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
