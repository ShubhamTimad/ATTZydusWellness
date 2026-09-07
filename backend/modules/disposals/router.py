from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_any_permission, require_permission
from db.session import get_db
from modules.disposals.schema import (
    CloseDisposalRequest,
    CreateDisposalOrderRequest,
    DisposalAssigneeListResponse,
    DisposalListFilterOptionsResponse,
    DisposalOrderAuditPublic,
    DisposalOrderDetail,
    DisposalOrderListResponse,
    ReassignDisposalRequest,
    ReceiveDisposalRequest,
    SubmitDisposalOrderRequest,
    UpdateDisposalOrderRequest,
)
from modules.disposals.service import DisposalOrderService, action_and_entity_for_order
from modules.errors import ConflictError, NotFoundError

router = APIRouter(prefix="/disposal-orders", tags=["admin", "disposal-orders"])


def get_disposal_service(db: Session = Depends(get_db)) -> DisposalOrderService:
    return DisposalOrderService(db)


def _http(exc: Exception) -> HTTPException:
    if isinstance(exc, NotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, ConflictError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    raise exc


@router.get("/column-filter-options", response_model=DisposalListFilterOptionsResponse)
def list_column_filter_options(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[DisposalOrderService, Depends(get_disposal_service)],
    _: Annotated[object, Depends(require_permission("disposal.view"))],
    plant_id: int | None = Query(None, ge=1),
) -> DisposalListFilterOptionsResponse:
    """Distinct plant / cost-center / status values present on disposal orders."""
    return svc.list_column_filter_options(
        viewer_user_id=int(current.subject),
        plant_id=plant_id,
    )


@router.get("", response_model=DisposalOrderListResponse)
def list_orders(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[DisposalOrderService, Depends(get_disposal_service)],
    _: Annotated[object, Depends(require_permission("disposal.view"))],
    tab: str = Query("needs_action"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    search: str | None = Query(None),
    order_number: str | None = Query(None),
    plant_id: int | None = Query(None),
    from_cost_center_id: int | None = Query(None),
    status: str | None = Query(None),
    asset_count: int | None = Query(None, ge=0),
    assigned_to: str | None = Query(None),
    created_on: date | None = Query(None),
    sort_by: str = Query("created_at"),
    sort_dir: str = Query("desc"),
) -> DisposalOrderListResponse:
    return svc.list_orders(
        tab=tab,
        page=page,
        page_size=page_size,
        viewer_user_id=int(current.subject),
        search=search,
        order_number=order_number,
        plant_id=plant_id,
        from_cost_center_id=from_cost_center_id,
        status=status,
        asset_count=asset_count,
        assigned_to=assigned_to,
        created_on=created_on,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )


@router.get("/assignees", response_model=DisposalAssigneeListResponse)
def list_assignees(
    svc: Annotated[DisposalOrderService, Depends(get_disposal_service)],
    _: Annotated[object, Depends(require_permission("disposal.view"))],
    level: str | None = Query(
        None,
        description="hod | engineering | central_finance | cfm | md | cost_center | scrapyard",
    ),
    role_id: int | None = Query(
        None,
        ge=1,
        description="Workflow step role id — preferred over level (rename-safe)",
    ),
    requires_engineering: bool | None = Query(
        None,
        description="When set, return users in the mapped disposal workflow's first-step role.",
    ),
    order_id: int | None = Query(
        None,
        ge=1,
        description="When set, apply the picker step's org_scope against this order's cost centers",
    ),
    from_cost_center_id: int | None = Query(
        None,
        ge=1,
        description="Asset From cost center (create picker — before an order exists)",
    ),
    to_cost_center_id: int | None = Query(
        None,
        ge=1,
        description="Scrapyard cost center (create picker — before an order exists)",
    ),
    asset_id: list[int] | None = Query(
        None,
        description="Selected asset ids so the create picker can resolve the From cost center",
    ),
) -> DisposalAssigneeListResponse:
    try:
        if role_id is not None:
            return svc.list_assignees_by_role_id(
                role_id=role_id,
                order_id=order_id,
                source_cost_center_id=from_cost_center_id,
                destination_cost_center_id=to_cost_center_id,
            )
        if requires_engineering is not None:
            action_code, _entity = action_and_entity_for_order(
                requires_engineering=bool(requires_engineering)
            )
            return svc.list_assignees_for_action(
                action_code=action_code,
                order_id=order_id,
                source_cost_center_id=from_cost_center_id,
                destination_cost_center_id=to_cost_center_id,
                asset_ids=asset_id,
            )
        return svc.list_assignees(level=level or "hod")
    except Exception as e:
        raise _http(e) from e


@router.get("/cost-center-users", response_model=DisposalAssigneeListResponse)
def list_cost_center_users(
    svc: Annotated[DisposalOrderService, Depends(get_disposal_service)],
    _: Annotated[
        object,
        Depends(
            require_any_permission(
                "disposal.create",
                "disposal.view",
                "disposal.manage",
            )
        ),
    ],
    cost_center_id: int = Query(..., ge=1),
) -> DisposalAssigneeListResponse:
    try:
        return svc.list_cost_center_custodians(cost_center_id=cost_center_id)
    except Exception as e:
        raise _http(e) from e


@router.post("", response_model=DisposalOrderDetail, status_code=status.HTTP_201_CREATED)
def create_order(
    body: CreateDisposalOrderRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[DisposalOrderService, Depends(get_disposal_service)],
    _: Annotated[object, Depends(require_permission("disposal.create"))],
) -> DisposalOrderDetail:
    try:
        return svc.create_order(body, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.get("/{order_id}", response_model=DisposalOrderDetail)
def get_order(
    order_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[DisposalOrderService, Depends(get_disposal_service)],
    _: Annotated[object, Depends(require_permission("disposal.view"))],
) -> DisposalOrderDetail:
    try:
        return svc.get_order(order_id, viewer_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.get("/{order_id}/audit", response_model=list[DisposalOrderAuditPublic])
def list_order_audit(
    order_id: int,
    svc: Annotated[DisposalOrderService, Depends(get_disposal_service)],
    _: Annotated[object, Depends(require_permission("disposal.view"))],
) -> list[DisposalOrderAuditPublic]:
    try:
        return svc.list_audit(order_id)
    except Exception as e:
        raise _http(e) from e


@router.patch("/{order_id}", response_model=DisposalOrderDetail)
def update_order(
    order_id: int,
    body: UpdateDisposalOrderRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[DisposalOrderService, Depends(get_disposal_service)],
    _: Annotated[object, Depends(require_permission("disposal.update"))],
) -> DisposalOrderDetail:
    try:
        return svc.update_order(order_id, body, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.post("/{order_id}/archive", response_model=DisposalOrderDetail)
def archive_order(
    order_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[DisposalOrderService, Depends(get_disposal_service)],
    _: Annotated[object, Depends(require_permission("disposal.update"))],
) -> DisposalOrderDetail:
    try:
        return svc.archive_draft_order(order_id, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.post("/{order_id}/unarchive", response_model=DisposalOrderDetail)
def unarchive_order(
    order_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[DisposalOrderService, Depends(get_disposal_service)],
    _: Annotated[object, Depends(require_permission("disposal.update"))],
) -> DisposalOrderDetail:
    try:
        return svc.unarchive_order(order_id, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_order(
    order_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[DisposalOrderService, Depends(get_disposal_service)],
    _: Annotated[object, Depends(require_permission("disposal.update"))],
) -> None:
    try:
        svc.delete_draft_order(order_id, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.post("/{order_id}/submit", response_model=DisposalOrderDetail)
def submit_order(
    order_id: int,
    body: SubmitDisposalOrderRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[DisposalOrderService, Depends(get_disposal_service)],
    _: Annotated[object, Depends(require_permission("disposal.submit"))],
) -> DisposalOrderDetail:
    try:
        return svc.submit_order(order_id, body, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.post("/{order_id}/resume", response_model=DisposalOrderDetail)
def resume_rejected_order(
    order_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[DisposalOrderService, Depends(get_disposal_service)],
    _: Annotated[object, Depends(require_permission("disposal.submit"))],
) -> DisposalOrderDetail:
    try:
        return svc.resume_rejected_order(order_id, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.post("/{order_id}/reassign", response_model=DisposalOrderDetail)
def reassign_approver(
    order_id: int,
    body: ReassignDisposalRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[DisposalOrderService, Depends(get_disposal_service)],
    _: Annotated[object, Depends(require_permission("disposal.reassign"))],
) -> DisposalOrderDetail:
    try:
        return svc.reassign_approver(
            order_id,
            actor_user_id=int(current.subject),
            assignee_user_id=int(body.assignee_user_id),
        )
    except Exception as e:
        raise _http(e) from e


@router.post("/{order_id}/receive", response_model=DisposalOrderDetail)
def receive_order(
    order_id: int,
    body: ReceiveDisposalRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[DisposalOrderService, Depends(get_disposal_service)],
    _: Annotated[object, Depends(require_permission("disposal.receive"))],
) -> DisposalOrderDetail:
    try:
        return svc.receive_order(order_id, body, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e


@router.post("/{order_id}/close", response_model=DisposalOrderDetail)
def close_order(
    order_id: int,
    body: CloseDisposalRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[DisposalOrderService, Depends(get_disposal_service)],
    _: Annotated[object, Depends(require_permission("disposal.close"))],
) -> DisposalOrderDetail:
    try:
        return svc.close_order(order_id, body, actor_user_id=int(current.subject))
    except Exception as e:
        raise _http(e) from e
