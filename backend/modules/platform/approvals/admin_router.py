from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_permission, require_superuser
from db.session import get_db
from modules.platform.approvals.model import ApprovalStep
from modules.platform.approvals.schema import (
    ApprovalStepCreate,
    ApprovalStepUpdate,
    ApprovalWorkflowCreate,
    ApprovalWorkflowDetail,
    ApprovalWorkflowUpdate,
)
from modules.platform.approvals.service import ApprovalError, ApprovalWorkflowService
from modules.errors import ConflictError, NotFoundError

router = APIRouter(
    prefix="/approval-workflows",
    tags=["admin", "approval-workflows"],
    dependencies=[Depends(require_superuser()), Depends(require_permission("approval.manage"))],
)


def get_workflow_service(db: Session = Depends(get_db)) -> ApprovalWorkflowService:
    return ApprovalWorkflowService(db)


@router.post("", response_model=ApprovalWorkflowDetail, status_code=status.HTTP_201_CREATED)
def create_workflow(
    payload: ApprovalWorkflowCreate,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[ApprovalWorkflowService, Depends(get_workflow_service)],
) -> ApprovalWorkflowDetail:
    try:
        return svc.create_workflow(
            name=payload.name,
            entity_type=payload.entity_type,
            created_by=int(current.subject),
            is_active=payload.is_active,
        )
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("", response_model=list[ApprovalWorkflowDetail])
def list_workflows(
    svc: Annotated[ApprovalWorkflowService, Depends(get_workflow_service)],
) -> list[ApprovalWorkflowDetail]:
    return svc.list_workflows()


@router.get("/{workflow_id}", response_model=ApprovalWorkflowDetail)
def get_workflow(
    workflow_id: int,
    svc: Annotated[ApprovalWorkflowService, Depends(get_workflow_service)],
) -> ApprovalWorkflowDetail:
    try:
        return svc.get_workflow(workflow_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch("/{workflow_id}", response_model=ApprovalWorkflowDetail)
def update_workflow(
    workflow_id: int,
    payload: ApprovalWorkflowUpdate,
    svc: Annotated[ApprovalWorkflowService, Depends(get_workflow_service)],
) -> ApprovalWorkflowDetail:
    if payload.name is None and payload.entity_type is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to update.")
    try:
        return svc.update_workflow(
            workflow_id,
            name=payload.name,
            entity_type=payload.entity_type,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/{workflow_id}/steps", response_model=dict, status_code=status.HTTP_201_CREATED)
def add_step(
    workflow_id: int,
    payload: ApprovalStepCreate,
    svc: Annotated[ApprovalWorkflowService, Depends(get_workflow_service)],
) -> dict:
    try:
        step = svc.add_step(
            workflow_id=workflow_id,
            step_order=payload.step_order,
            approver_role_id=payload.approver_role_id,
            required_approvals=payload.required_approvals,
        )
        return {"id": step.id}
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.patch("/{workflow_id}/steps/{step_id}", response_model=dict)
def update_step(
    workflow_id: int,
    step_id: int,
    payload: ApprovalStepUpdate,
    svc: Annotated[ApprovalWorkflowService, Depends(get_workflow_service)],
) -> dict:
    if payload.approver_role_id is None and payload.required_approvals is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to update.")
    try:
        step = svc.update_step(
            step_id,
            approver_role_id=payload.approver_role_id,
            required_approvals=payload.required_approvals,
        )
        if int(step.workflow_id) != workflow_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Step not found.")
        return {"id": step.id}
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.delete("/{workflow_id}/steps/{step_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_step(
    workflow_id: int,
    step_id: int,
    svc: Annotated[ApprovalWorkflowService, Depends(get_workflow_service)],
) -> Response:
    step = svc._db.get(ApprovalStep, step_id)
    if step is None or int(step.workflow_id) != workflow_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Step not found.")
    try:
        svc.delete_step(step_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{workflow_id}/deactivate", response_model=ApprovalWorkflowDetail)
def deactivate_workflow(
    workflow_id: int,
    svc: Annotated[ApprovalWorkflowService, Depends(get_workflow_service)],
) -> ApprovalWorkflowDetail:
    try:
        return svc.deactivate_workflow(workflow_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch("/{workflow_id}/activate", response_model=ApprovalWorkflowDetail)
def activate_workflow(
    workflow_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[ApprovalWorkflowService, Depends(get_workflow_service)],
) -> ApprovalWorkflowDetail:
    try:
        return svc.activate_workflow(workflow_id, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ApprovalError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
