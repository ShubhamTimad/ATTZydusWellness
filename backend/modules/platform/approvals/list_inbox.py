"""Shared helpers for list tabs: Pending action / Done / All."""

from __future__ import annotations

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from modules.platform.approvals.model import ApprovalRequest, ApprovalStep, ApprovalTask
from modules.platform.roles.model import Role
from modules.rbac_association import user_role


def pending_approval_request_ids_for_viewer(db: Session, viewer_user_id: int):
    """Pending approval/rework request ids assigned to this viewer (user or role)."""
    uid = int(viewer_user_id)
    role_ids = select(user_role.c.role_id).where(user_role.c.user_id == uid)
    approval_ids = select(ApprovalTask.request_id).where(
        ApprovalTask.request_id.is_not(None),
        ApprovalTask.task_type == "approval",
        ApprovalTask.status == "pending",
        or_(
            ApprovalTask.assigned_user_id == uid,
            and_(
                ApprovalTask.assigned_user_id.is_(None),
                ApprovalTask.assigned_role_id.in_(role_ids),
            ),
        ),
    )
    rework_ids = select(ApprovalTask.request_id).where(
        ApprovalTask.request_id.is_not(None),
        ApprovalTask.task_type == "rework",
        ApprovalTask.status.in_(("open", "pending")),
        or_(
            ApprovalTask.assigned_user_id == uid,
            ApprovalTask.assigned_to_user_id == uid,
        ),
    )
    return approval_ids.union(rework_ids)


def pending_step_kinds_for_viewer(db: Session, viewer_user_id: int | None) -> dict[int, str]:
    if viewer_user_id is None:
        return {}
    uid = int(viewer_user_id)
    role_ids = select(user_role.c.role_id).where(user_role.c.user_id == uid)
    rows = db.execute(
        select(ApprovalTask.request_id, ApprovalStep.step_kind)
        .join(ApprovalStep, ApprovalStep.id == ApprovalTask.step_id)
        .where(
            ApprovalTask.request_id.is_not(None),
            ApprovalTask.task_type == "approval",
            ApprovalTask.status == "pending",
            or_(
                ApprovalTask.assigned_user_id == uid,
                and_(
                    ApprovalTask.assigned_user_id.is_(None),
                    ApprovalTask.assigned_role_id.in_(role_ids),
                ),
            ),
        )
    ).all()
    out: dict[int, str] = {}
    for request_id, kind in rows:
        if request_id is None:
            continue
        out[int(request_id)] = str(kind or "approve").lower()
    return out


def pending_role_names_for_requests(db: Session, request_ids: list[int]) -> dict[int, str]:
    """Pending approval-step role name keyed by approval request id."""
    ids = sorted({int(x) for x in request_ids if x is not None})
    if not ids:
        return {}
    rows = db.execute(
        select(ApprovalTask.request_id, Role.name)
        .join(ApprovalStep, ApprovalStep.id == ApprovalTask.step_id)
        .join(Role, Role.id == ApprovalStep.approver_role_id)
        .where(
            ApprovalTask.request_id.in_(ids),
            ApprovalTask.task_type == "approval",
            ApprovalTask.status == "pending",
        )
        .order_by(ApprovalTask.id.asc())
    ).all()
    out: dict[int, str] = {}
    for request_id, name in rows:
        if request_id is None or not name:
            continue
        out.setdefault(int(request_id), str(name))
    missing = [i for i in ids if i not in out]
    if not missing:
        return out
    fallback = db.execute(
        select(ApprovalRequest.id, Role.name)
        .join(
            ApprovalStep,
            and_(
                ApprovalStep.workflow_id == ApprovalRequest.workflow_id,
                ApprovalStep.step_order == ApprovalRequest.current_step,
            ),
        )
        .join(Role, Role.id == ApprovalStep.approver_role_id)
        .where(
            ApprovalRequest.id.in_(missing),
            ApprovalRequest.status == "pending",
        )
    ).all()
    for request_id, name in fallback:
        if request_id is None or not name:
            continue
        out[int(request_id)] = str(name)
    return out
