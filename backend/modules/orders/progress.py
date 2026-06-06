"""Build lifecycle progress stepper + enriched audit for physical orders."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from modules.orders.constants import (
    ACTION_COMPLETE,
    ACTION_CREATE,
    ENTITY_TYPE_CLOSURE,
    ENTITY_TYPE_CREATION,
    ORDER_STATUS_APPROVED,
    ORDER_STATUS_ASSIGNED,
    ORDER_STATUS_CLOSED,
    ORDER_STATUS_COMPLETED,
    ORDER_STATUS_DRAFT,
    ORDER_STATUS_IN_PROGRESS,
    ORDER_STATUS_PENDING_APPROVAL,
    ORDER_STATUS_PENDING_CLOSURE,
    ORDER_STATUS_REJECTED,
)
from modules.orders.model import PhysicalOrder, PhysicalOrderAudit
from modules.orders.schema import (
    OrderLifecycleApproverSlot,
    OrderLifecycleStepPublic,
    OrderWorkflowDefinition,
    OrderWorkflowStepDefinition,
    PhysicalOrderAuditPublic,
    PhysicalOrderProgressPublic,
)
from modules.platform.approvals.assignment_service import get_workflow_for_action
from modules.platform.approvals.model import ApprovalAction, ApprovalRequest, ApprovalTask, ApprovalWorkflow
from modules.platform.roles.model import Role
from modules.platform.tasks.service import _build_workflow_steps_for_request
from modules.platform.tasks.schema import TaskApprovalStepLinePublic

_AUDIT_LABELS: dict[str, str] = {
    "order_created": "Order created",
    "assignment_changed": "Executor assigned",
    "reassigned": "Order reassigned",
    "submitted_for_approval": "Submitted for creation approval",
    "approved": "Creation approved",
    "rejected": "Order rejected",
    "started": "Physical verification started",
    "asset_verified": "Asset physically verified (RFID scan)",
    "closure_submitted": "Work completed — submitted for closure approval",
    "closure_approved": "Closure approved",
    "completed": "Order completed",
    "closed": "Order closed",
    "returned_for_execution": "Returned to executor after closure rejection",
    "execution_items_rejected": "Line items rejected during execution",
    "closure_items_rejected": "Line items rejected at closure review",
}


def _audit_detail(action: str, old_value: dict | None, new_value: dict | None) -> str | None:
    new_value = new_value or {}
    old_value = old_value or {}
    if action == "assignment_changed":
        assignee = new_value.get("assigned_to")
        if assignee is not None:
            suffix = ""
            if new_value.get("auto_assigned"):
                suffix = " (automatic after approval)"
            elif new_value.get("intended_only"):
                suffix = " (intended executor)"
            name = new_value.get("assigned_to_name")
            if name:
                return f"Assigned to {name}{suffix}"
            return f"Assigned to user #{assignee}{suffix}"
    if action == "reassigned":
        old_name = old_value.get("assigned_to_name")
        new_name = new_value.get("assigned_to_name")
        if old_name and new_name:
            return f"{old_name} → {new_name}"
        if new_name:
            return f"Reassigned to {new_name}"
        assignee = new_value.get("assigned_to")
        return f"Reassigned to user #{assignee}" if assignee else None
    if action == "asset_verified":
        code = new_value.get("asset_code")
        rfid = new_value.get("rfid_code")
        parts = [p for p in (code, rfid) if p]
        return " · ".join(parts) if parts else None
    if action == "rejected":
        reason = new_value.get("reason") or new_value.get("comment") or new_value.get("phase")
        return str(reason) if reason else None
    if action == "submitted_for_approval":
        rid = new_value.get("approval_request_id")
        return f"Approval request #{rid}" if rid else None
    if action == "closure_submitted":
        rid = new_value.get("approval_request_id")
        return f"Closure approval request #{rid}" if rid else None
    if action == "returned_for_execution":
        return str(new_value.get("reason") or "Line items rejected by reviewer")
    if action == "execution_items_rejected":
        codes = new_value.get("asset_codes") or []
        reason = new_value.get("reason")
        parts = []
        if codes:
            parts.append(", ".join(str(c) for c in codes))
        if reason:
            parts.append(str(reason))
        return " — ".join(parts) if parts else None
    if action == "closure_items_rejected":
        codes = new_value.get("asset_codes") or []
        reason = new_value.get("reason")
        parts = []
        if codes:
            parts.append(", ".join(str(c) for c in codes))
        if reason:
            parts.append(str(reason))
        return " — ".join(parts) if parts else None
    return None


def enrich_audit_rows(
    rows: list[PhysicalOrderAudit],
    *,
    user_name_fn,
    db: Session | None = None,
    order_id: int | None = None,
) -> list[PhysicalOrderAuditPublic]:
    out: list[PhysicalOrderAuditPublic] = []
    synthetic_id = -1
    for r in rows:
        action = str(r.action)
        out.append(
            PhysicalOrderAuditPublic(
                id=int(r.id),
                action=action,
                label=_AUDIT_LABELS.get(action, action.replace("_", " ").title()),
                detail=_audit_detail(action, r.old_value, r.new_value),
                actor_name=user_name_fn(r.actor_user_id),
                old_value=r.old_value,
                new_value=r.new_value,
                created_at=r.created_at,
            )
        )

    if db is not None and order_id is not None:
        for entity_type, phase_label in (
            (ENTITY_TYPE_CREATION, "Creation approval"),
            (ENTITY_TYPE_CLOSURE, "Closure approval"),
        ):
            req = _latest_approval_request(db, order_id=order_id, entity_type=entity_type)
            if req is None:
                continue
            actions = db.scalars(
                select(ApprovalAction)
                .join(ApprovalTask, ApprovalTask.id == ApprovalAction.task_id)
                .where(ApprovalTask.request_id == req.id)
                .options(selectinload(ApprovalAction.task).selectinload(ApprovalTask.step))
                .order_by(ApprovalAction.created_at.asc())
            ).all()
            for act in actions:
                synthetic_id -= 1
                step_order = int(act.task.step.step_order) if act.task and act.task.step else None
                act_name = str(act.action).lower()
                label = (
                    f"{phase_label} level {step_order} approved"
                    if act_name in ("approve", "approved")
                    else f"{phase_label} level {step_order} rejected"
                )
                out.append(
                    PhysicalOrderAuditPublic(
                        id=synthetic_id,
                        action=f"workflow_{act_name}",
                        label=label,
                        detail=act.comment,
                        actor_name=user_name_fn(int(act.user_id)),
                        old_value=None,
                        new_value={
                            "request_id": int(req.id),
                            "step_order": step_order,
                            "action": act_name,
                        },
                        created_at=act.created_at,
                    )
                )

    out.sort(key=lambda e: e.created_at)
    return out


def _workflow_definition(db: Session, *, action_code: str, phase: str) -> OrderWorkflowDefinition | None:
    wf = get_workflow_for_action(db, action_code)
    if wf is None or not wf.steps:
        return None
    steps: list[OrderWorkflowStepDefinition] = []
    for step in sorted(wf.steps, key=lambda s: int(s.step_order)):
        role = db.get(Role, int(step.approver_role_id))
        steps.append(
            OrderWorkflowStepDefinition(
                step_order=int(step.step_order),
                role_name=role.name if role is not None else "Approvers",
                required_approvals=int(step.required_approvals),
            )
        )
    return OrderWorkflowDefinition(
        phase=phase,
        workflow_name=str(wf.name),
        action_code=action_code,
        steps=steps,
    )


def _latest_approval_request(db: Session, *, order_id: int, entity_type: str) -> ApprovalRequest | None:
    return db.scalar(
        select(ApprovalRequest)
        .where(
            ApprovalRequest.entity_id == order_id,
            ApprovalRequest.entity_type == entity_type,
        )
        .order_by(ApprovalRequest.id.desc())
        .options(
            selectinload(ApprovalRequest.workflow).selectinload(ApprovalWorkflow.steps),
            selectinload(ApprovalRequest.tasks).selectinload(ApprovalTask.step),
            selectinload(ApprovalRequest.tasks).selectinload(ApprovalTask.actions),
        )
    )


def _find_audit_time(audit_rows: list[PhysicalOrderAudit], action: str) -> datetime | None:
    for row in reversed(audit_rows):
        if row.action == action:
            return row.created_at
    return None


def _find_audit_actor(audit_rows: list[PhysicalOrderAudit], action: str, user_name_fn) -> str | None:
    for row in reversed(audit_rows):
        if row.action == action:
            return user_name_fn(row.actor_user_id)
    return None


_STEP_ORDER = (
    "order_created",
    "approved",
    "assigned",
    "in_progress",
    "completed",
    "closed",
)

# Which timeline segment is current for each order status (matches status badge).
_ACTIVE_STEP_FOR_STATUS: dict[str, str] = {
    ORDER_STATUS_DRAFT: "order_created",
    ORDER_STATUS_PENDING_APPROVAL: "approved",
    ORDER_STATUS_APPROVED: "approved",
    ORDER_STATUS_ASSIGNED: "assigned",
    ORDER_STATUS_IN_PROGRESS: "in_progress",
    ORDER_STATUS_PENDING_CLOSURE: "completed",
    ORDER_STATUS_COMPLETED: "completed",
    ORDER_STATUS_CLOSED: "closed",
}


def _step_phase(
    *,
    order_status: str,
    step_key: str,
    creation_req: ApprovalRequest | None,
) -> str:
    """Return pending | active | completed | rejected for a business lifecycle step."""
    if order_status == ORDER_STATUS_REJECTED:
        if step_key == "order_created":
            return "completed"
        if step_key == "rejected":
            return "rejected"
        return "pending"

    active_key = _ACTIVE_STEP_FOR_STATUS.get(order_status)
    if active_key is None or step_key not in _STEP_ORDER:
        return "pending"

    step_idx = _STEP_ORDER.index(step_key)
    active_idx = _STEP_ORDER.index(active_key)

    if step_idx < active_idx:
        return "completed"
    if step_idx == active_idx:
        return "active"
    return "pending"


def build_order_progress(
    db: Session,
    order: PhysicalOrder,
    *,
    audit_rows: list[PhysicalOrderAudit],
    user_name_fn,
) -> PhysicalOrderProgressPublic:
    creation_wf = _workflow_definition(db, action_code=ACTION_CREATE, phase="creation")
    closure_wf = _workflow_definition(db, action_code=ACTION_COMPLETE, phase="closure")
    creation_req = _latest_approval_request(db, order_id=int(order.id), entity_type=ENTITY_TYPE_CREATION)

    status = str(order.status)
    verified = sum(1 for i in order.items if i.scan_time is not None)
    total = len(order.items)

    steps: list[OrderLifecycleStepPublic] = [
        OrderLifecycleStepPublic(
            key="order_created",
            label="Draft" if status == ORDER_STATUS_DRAFT else "Order Created",
            status=_step_phase(order_status=status, step_key="order_created", creation_req=creation_req),
            actor_name=user_name_fn(order.created_by),
            occurred_at=order.created_at,
            detail=f"Order {order.order_number}",
        ),
        OrderLifecycleStepPublic(
            key="approved",
            label="Pending Approval" if status == ORDER_STATUS_PENDING_APPROVAL else "Approved",
            status=_step_phase(order_status=status, step_key="approved", creation_req=creation_req),
            actor_name=_find_audit_actor(audit_rows, "approved", user_name_fn),
            occurred_at=_find_audit_time(audit_rows, "approved"),
            detail=(
                "Awaiting creation approval"
                if status == ORDER_STATUS_PENDING_APPROVAL
                else None
            ),
        ),
        OrderLifecycleStepPublic(
            key="assigned",
            label="Assigned",
            status=_step_phase(order_status=status, step_key="assigned", creation_req=creation_req),
            actor_name=user_name_fn(order.assigned_by) if order.assigned_at else None,
            occurred_at=order.assigned_at,
            detail=(
                f"Executor: {user_name_fn(order.assigned_to)}"
                if order.assigned_to and order.assigned_at
                else (
                    f"Pending: {user_name_fn(order.assigned_to)}"
                    if order.assigned_to
                    else None
                )
            ),
        ),
        OrderLifecycleStepPublic(
            key="in_progress",
            label="In Progress",
            status=_step_phase(order_status=status, step_key="in_progress", creation_req=creation_req),
            actor_name=user_name_fn(order.started_by),
            occurred_at=order.started_at,
            detail=(
                f"{verified} of {total} assets scanned"
                if status in (ORDER_STATUS_IN_PROGRESS, ORDER_STATUS_PENDING_CLOSURE) and total
                else None
            ),
        ),
        OrderLifecycleStepPublic(
            key="completed",
            label=(
                "Pending Closure"
                if status == ORDER_STATUS_PENDING_CLOSURE
                else "Completed"
            ),
            status=_step_phase(order_status=status, step_key="completed", creation_req=creation_req),
            actor_name=_find_audit_actor(audit_rows, "completed", user_name_fn),
            occurred_at=order.completed_at,
            detail=(
                "Awaiting closure approval"
                if status == ORDER_STATUS_PENDING_CLOSURE
                else None
            ),
        ),
        OrderLifecycleStepPublic(
            key="closed",
            label="Closed",
            status=_step_phase(order_status=status, step_key="closed", creation_req=creation_req),
            actor_name=_find_audit_actor(audit_rows, "closed", user_name_fn),
            occurred_at=order.closed_at,
        ),
    ]

    if status == ORDER_STATUS_REJECTED:
        steps.append(
            OrderLifecycleStepPublic(
                key="rejected",
                label="Rejected",
                status="rejected",
                actor_name=_find_audit_actor(audit_rows, "rejected", user_name_fn),
                occurred_at=_find_audit_time(audit_rows, "rejected"),
                detail="Creation approval rejected",
            )
        )

    current_key: str | None = _ACTIVE_STEP_FOR_STATUS.get(status)
    if status == ORDER_STATUS_REJECTED:
        current_key = "rejected"
    if current_key is None and steps:
        current_key = steps[0].key

    return PhysicalOrderProgressPublic(
        steps=steps,
        current_step_key=current_key,
        creation_workflow=creation_wf,
        closure_workflow=closure_wf,
    )
