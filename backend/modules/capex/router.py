from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_permission
from db.session import get_db
from modules.capex.schema import (
    CapexAssigneeListResponse,
    CapexAuditEventPublic,
    CapexFormCreateRequest,
    CapexFormDetail,
    CapexFormListResponse,
    CapexFormUpdateRequest,
    CapexReassignRequest,
    CapexSubmitRequest,
)
from modules.capex.service import CapexFormService, action_and_entity_for_form
from modules.errors import ConflictError, NotFoundError

router = APIRouter(prefix="/capitalization-forms", tags=["admin", "capitalization-forms"])


def get_capex_service(db: Session = Depends(get_db)) -> CapexFormService:
    return CapexFormService(db)


@router.get("", response_model=CapexFormListResponse)
def list_forms(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[CapexFormService, Depends(get_capex_service)],
    _: Annotated[object, Depends(require_permission("capitalization.view"))],
    tab: str = Query("needs_action"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    available_for_asset: bool = Query(False),
    for_asset_id: int | None = Query(None, ge=1),
    search: str | None = Query(None),
    form_number: str | None = Query(None),
    asset_name: str | None = Query(None),
    department: str | None = Query(None),
    status: str | None = Query(None),
    created_by: str | None = Query(None),
    sort_by: str = Query("form_number"),
    sort_dir: str = Query("desc"),
) -> CapexFormListResponse:
    return svc.list_forms(
        tab=tab,
        page=page,
        page_size=page_size,
        available_for_asset=available_for_asset,
        for_asset_id=for_asset_id,
        search=search,
        form_number=form_number,
        asset_name=asset_name,
        department=department,
        status=status,
        created_by=created_by,
        viewer_user_id=int(current.subject),
        sort_by=sort_by,
        sort_dir=sort_dir,
    )


@router.get("/assignees", response_model=CapexAssigneeListResponse)
def list_assignees(
    svc: Annotated[CapexFormService, Depends(get_capex_service)],
    _: Annotated[object, Depends(require_permission("capitalization.view"))],
    role_id: int | None = Query(
        None,
        ge=1,
        description="Preferred: workflow step role id (stable across role renames).",
    ),
    level: str | None = Query(
        None,
        description="Legacy: hod | engineering | central_finance (name-mapped pools)",
    ),
    requires_engineering: bool | None = Query(
        None,
        description="When set, return users in the mapped CapEx workflow's first-step role.",
    ),
    cost_center_id: int | None = Query(
        None,
        ge=1,
        description="Narrow the pool to users covering this cost center (the form's cost center).",
    ),
) -> CapexAssigneeListResponse:
    try:
        if role_id is not None:
            return svc.list_assignees_by_role_id(role_id=role_id, cost_center_id=cost_center_id)
        if requires_engineering is not None:
            action_code, _ = action_and_entity_for_form(
                requires_engineering=bool(requires_engineering)
            )
            return svc.list_assignees_for_action(
                action_code=action_code, cost_center_id=cost_center_id
            )
        return svc.list_assignees(level=level or "hod", cost_center_id=cost_center_id)
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e


@router.post("", response_model=CapexFormDetail, status_code=status.HTTP_201_CREATED)
def create_form(
    body: CapexFormCreateRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[CapexFormService, Depends(get_capex_service)],
    _: Annotated[object, Depends(require_permission("capitalization.create"))],
) -> CapexFormDetail:
    try:
        return svc.create_form(body, actor_user_id=int(current.subject))
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.get("/{form_id}", response_model=CapexFormDetail)
def get_form(
    form_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[CapexFormService, Depends(get_capex_service)],
    _: Annotated[object, Depends(require_permission("capitalization.view"))],
) -> CapexFormDetail:
    try:
        return svc.get_form(form_id, viewer_user_id=int(current.subject))
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e


@router.get("/{form_id}/audit", response_model=list[CapexAuditEventPublic])
def list_form_audit(
    form_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[CapexFormService, Depends(get_capex_service)],
    _: Annotated[object, Depends(require_permission("capitalization.view"))],
) -> list[CapexAuditEventPublic]:
    try:
        return svc.list_audit(form_id, viewer_user_id=int(current.subject))
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e


@router.patch("/{form_id}", response_model=CapexFormDetail)
def update_form(
    form_id: int,
    body: CapexFormUpdateRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[CapexFormService, Depends(get_capex_service)],
    _: Annotated[object, Depends(require_permission("capitalization.update"))],
) -> CapexFormDetail:
    try:
        return svc.update_form(form_id, body, actor_user_id=int(current.subject))
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.delete("/{form_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_form(
    form_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[CapexFormService, Depends(get_capex_service)],
    _: Annotated[object, Depends(require_permission("capitalization.update"))],
) -> None:
    try:
        svc.delete_draft_form(form_id, actor_user_id=int(current.subject))
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.post("/{form_id}/archive", response_model=CapexFormDetail)
def archive_form(
    form_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[CapexFormService, Depends(get_capex_service)],
    _: Annotated[object, Depends(require_permission("capitalization.update"))],
) -> CapexFormDetail:
    try:
        return svc.archive_form(form_id, actor_user_id=int(current.subject))
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.post("/{form_id}/unarchive", response_model=CapexFormDetail)
def unarchive_form(
    form_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[CapexFormService, Depends(get_capex_service)],
    _: Annotated[object, Depends(require_permission("capitalization.update"))],
) -> CapexFormDetail:
    try:
        return svc.unarchive_form(form_id, actor_user_id=int(current.subject))
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.post("/{form_id}/submit", response_model=CapexFormDetail)
def submit_form(
    form_id: int,
    body: CapexSubmitRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[CapexFormService, Depends(get_capex_service)],
    _: Annotated[object, Depends(require_permission("capitalization.submit"))],
) -> CapexFormDetail:
    try:
        return svc.submit_form(
            form_id,
            actor_user_id=int(current.subject),
            assignee_user_id=int(body.assignee_user_id),
            requires_engineering=body.requires_engineering,
        )
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.post("/{form_id}/reassign", response_model=CapexFormDetail)
def reassign_approver(
    form_id: int,
    body: CapexReassignRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[CapexFormService, Depends(get_capex_service)],
    _: Annotated[object, Depends(require_permission("capitalization.reassign"))],
) -> CapexFormDetail:
    try:
        return svc.reassign_approver(
            form_id,
            actor_user_id=int(current.subject),
            assignee_user_id=int(body.assignee_user_id),
        )
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
