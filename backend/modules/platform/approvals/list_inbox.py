"""Shared helpers for list tabs: Pending action / Done / All."""

from __future__ import annotations

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from modules.platform.approvals.model import ApprovalRequest, ApprovalStep, ApprovalTask
from modules.platform.approvals.step_roles import role_pool_task_clause
from modules.platform.roles.model import Role
from modules.rbac_association import user_role


def pending_approval_request_ids_for_viewer(db: Session, viewer_user_id: int):
    """Pending approval/rework request ids assigned to this viewer (user or role)."""
    uid = int(viewer_user_id)
    role_ids = {
        int(rid)
        for rid in db.execute(select(user_role.c.role_id).where(user_role.c.user_id == uid)).scalars().all()
    }
    approval_ids = select(ApprovalTask.request_id).where(
        ApprovalTask.request_id.is_not(None),
        ApprovalTask.task_type == "approval",
        ApprovalTask.status == "pending",
        or_(
            ApprovalTask.assigned_user_id == uid,
            role_pool_task_clause(role_ids),
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
    role_ids = {
        int(rid)
        for rid in db.execute(select(user_role.c.role_id).where(user_role.c.user_id == uid)).scalars().all()
    }
    rows = db.execute(
        select(ApprovalTask.request_id, ApprovalStep.step_kind)
        .join(ApprovalStep, ApprovalStep.id == ApprovalTask.step_id)
        .where(
            ApprovalTask.request_id.is_not(None),
            ApprovalTask.task_type == "approval",
            ApprovalTask.status == "pending",
            or_(
                ApprovalTask.assigned_user_id == uid,
                role_pool_task_clause(role_ids),
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
    """Pending approval-step role names keyed by approval request id."""
    from modules.rbac_association import approval_step_roles

    ids = sorted({int(x) for x in request_ids if x is not None})
    if not ids:
        return {}
    rows = db.execute(
        select(ApprovalTask.request_id, ApprovalTask.step_id, Role.name)
        .join(ApprovalStep, ApprovalStep.id == ApprovalTask.step_id)
        .join(Role, Role.id == ApprovalStep.approver_role_id)
        .where(
            ApprovalTask.request_id.in_(ids),
            ApprovalTask.task_type == "approval",
            ApprovalTask.status == "pending",
        )
        .order_by(ApprovalTask.id.asc())
    ).all()
    req_step: dict[int, int] = {}
    names_by_step: dict[int, list[str]] = {}
    for request_id, step_id, name in rows:
        if request_id is None or step_id is None or not name:
            continue
        req_step.setdefault(int(request_id), int(step_id))
        bucket = names_by_step.setdefault(int(step_id), [])
        if str(name) not in bucket:
            bucket.append(str(name))
    step_ids = list(names_by_step)
    if step_ids:
        extras = db.execute(
            select(approval_step_roles.c.step_id, Role.name)
            .join(Role, Role.id == approval_step_roles.c.role_id)
            .where(approval_step_roles.c.step_id.in_(step_ids))
            .order_by(approval_step_roles.c.role_id.asc())
        ).all()
        for step_id, name in extras:
            if step_id is None or not name:
                continue
            bucket = names_by_step.setdefault(int(step_id), [])
            if str(name) not in bucket:
                bucket.append(str(name))
    out = {
        rid: ", ".join(names_by_step.get(sid) or [])
        for rid, sid in req_step.items()
        if names_by_step.get(sid)
    }
    missing = [i for i in ids if i not in out]
    if not missing:
        return out
    fallback = db.execute(
        select(ApprovalRequest.id, ApprovalStep.id, Role.name)
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
    fb_step: dict[int, int] = {}
    for request_id, step_id, name in fallback:
        if request_id is None or step_id is None or not name:
            continue
        fb_step[int(request_id)] = int(step_id)
        bucket = names_by_step.setdefault(int(step_id), [])
        if str(name) not in bucket:
            bucket.append(str(name))
    fb_step_ids = [sid for sid in fb_step.values() if sid not in step_ids]
    if fb_step_ids:
        extras = db.execute(
            select(approval_step_roles.c.step_id, Role.name)
            .join(Role, Role.id == approval_step_roles.c.role_id)
            .where(approval_step_roles.c.step_id.in_(fb_step_ids))
        ).all()
        for step_id, name in extras:
            if step_id is None or not name:
                continue
            bucket = names_by_step.setdefault(int(step_id), [])
            if str(name) not in bucket:
                bucket.append(str(name))
    for rid, sid in fb_step.items():
        label = ", ".join(names_by_step.get(sid) or [])
        if label:
            out[rid] = label
    return out
