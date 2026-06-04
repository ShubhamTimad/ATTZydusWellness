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
    "submitted_for_approval": "Submitted for creation approval",
    "approved": "Creation approved — order activated",
    "rejected": "Order rejected",
    "started": "Physical verification started",
    "asset_verified": "Asset physically verified (RFID scan)",
    "closure_submitted": "Submitted for closure approval",
    "closure_approved": "Closure approved",
    "completed": "Order completed",
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
            return f"Assigned to user #{assignee}"
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


def _phase_to_lifecycle_status(phase: str) -> str:
    if phase == "completed":
        return "completed"
    if phase == "current":
        return "active"
    if phase == "rejected":
        return "rejected"
    return "pending"


def _slots_from_approval_step(step: TaskApprovalStepLinePublic) -> list[OrderLifecycleApproverSlot]:
    approvals = [a for a in step.actions if str(a.action).lower() in ("approve", "approved")]
    rejections = [a for a in step.actions if str(a.action).lower() in ("reject", "rejected")]
    slots: list[OrderLifecycleApproverSlot] = []
    required = max(int(step.required_approvals), 1)
    for i in range(required):
        if i < len(approvals):
            a = approvals[i]
            slots.append(
                OrderLifecycleApproverSlot(
                    slot=i + 1,
                    status="completed",
                    actor_name=a.actor_display_name,
                    acted_at=a.created_at,
                    comment=a.comment,
                )
            )
        elif rejections and step.phase == "rejected" and i == len(approvals):
            r = rejections[0]
            slots.append(
                OrderLifecycleApproverSlot(
                    slot=i + 1,
                    status="rejected",
                    actor_name=r.actor_display_name,
                    acted_at=r.created_at,
                    comment=r.comment,
                )
            )
        else:
            slots.append(OrderLifecycleApproverSlot(slot=i + 1, status="pending"))
    return slots


def _append_approval_steps(
    steps: list[OrderLifecycleStepPublic],
    *,
    prefix: str,
    phase_label: str,
    wf_def: OrderWorkflowDefinition | None,
    req: ApprovalRequest | None,
    db: Session,
) -> None:
    wf_lines: list[TaskApprovalStepLinePublic] = []
    if req is not None:
        wf_lines = _build_workflow_steps_for_request(db, req)

    if wf_def and wf_def.steps:
        for def_step in wf_def.steps:
            key = f"{prefix}_approval_{def_step.step_order}"
            line = next((x for x in wf_lines if int(x.step_order) == int(def_step.step_order)), None)
            if line is not None:
                status = _phase_to_lifecycle_status(str(line.phase))
                last_approve = next(
                    (
                        a
                        for a in reversed(line.actions)
                        if str(a.action).lower() in ("approve", "approved")
                    ),
                    None,
                )
                steps.append(
                    OrderLifecycleStepPublic(
                        key=key,
                        label=f"{phase_label} · Level {def_step.step_order}",
                        status=status,
                        role_name=def_step.role_name,
                        actor_name=last_approve.actor_display_name if last_approve else None,
                        occurred_at=last_approve.created_at if last_approve else None,
                        detail=line.status_label,
                        approver_slots=_slots_from_approval_step(line),
                    )
                )
            else:
                steps.append(
                    OrderLifecycleStepPublic(
                        key=key,
                        label=f"{phase_label} · Level {def_step.step_order}",
                        status="pending",
                        role_name=def_step.role_name,
                        detail=f"Awaiting {def_step.required_approvals} approval(s) from {def_step.role_name}",
                        approver_slots=[
                            OrderLifecycleApproverSlot(slot=i + 1, status="pending")
                            for i in range(max(def_step.required_approvals, 1))
                        ],
                    )
                )
        return

    # No workflow configured — single implicit approval step.
    key = f"{prefix}_approval"
    if req is None:
        steps.append(
            OrderLifecycleStepPublic(
                key=key,
                label=phase_label,
                status="pending",
                detail="No approval workflow configured",
            )
        )
        return
    status = "completed" if str(req.status).lower() == "approved" else (
        "rejected" if str(req.status).lower() in ("rejected", "in_rework") else "active"
    )
    steps.append(
        OrderLifecycleStepPublic(
            key=key,
            label=phase_label,
            status=status,
            detail=f"Approval request #{req.id} · {req.status}",
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
    closure_req = _latest_approval_request(db, order_id=int(order.id), entity_type=ENTITY_TYPE_CLOSURE)

    steps: list[OrderLifecycleStepPublic] = []
    status = str(order.status)

    # 1. Created
    steps.append(
        OrderLifecycleStepPublic(
            key="created",
            label="Created",
            status="completed",
            actor_name=user_name_fn(order.created_by),
            occurred_at=order.created_at,
            detail=f"Order {order.order_number}",
        )
    )

    # 2. Assigned
    assign_status = "completed" if order.assigned_to else ("active" if status == ORDER_STATUS_DRAFT else "pending")
    steps.append(
        OrderLifecycleStepPublic(
            key="assigned",
            label="Assigned",
            status=assign_status,
            actor_name=user_name_fn(order.assigned_by) if order.assigned_by else None,
            occurred_at=order.assigned_at,
            detail=order.assigned_to and user_name_fn(order.assigned_to)
            and f"Executor: {user_name_fn(order.assigned_to)}"
            or None,
        )
    )

    # 3. Creation approval (from workflow)
    _append_approval_steps(
        steps,
        prefix="creation",
        phase_label="Creation approval",
        wf_def=creation_wf,
        req=creation_req if status != ORDER_STATUS_DRAFT else None,
        db=db,
    )

    # 4. Activated
    activated_at = _find_audit_time(audit_rows, "approved")
    activated_status = "pending"
    if status in (ORDER_STATUS_REJECTED,) and creation_req and str(creation_req.status).lower() in (
        "rejected",
        "in_rework",
    ):
        activated_status = "pending"
    elif status in (
        ORDER_STATUS_APPROVED,
        ORDER_STATUS_IN_PROGRESS,
        ORDER_STATUS_PENDING_CLOSURE,
        ORDER_STATUS_COMPLETED,
    ):
        activated_status = "completed"
    elif status == ORDER_STATUS_PENDING_APPROVAL:
        activated_status = "pending"
    elif status == ORDER_STATUS_REJECTED:
        activated_status = "pending"

    steps.append(
        OrderLifecycleStepPublic(
            key="activated",
            label="Activated",
            status=activated_status,
            actor_name=_find_audit_actor(audit_rows, "approved", user_name_fn),
            occurred_at=activated_at,
            detail="Ready for physical verification" if activated_status == "completed" else None,
        )
    )

    # 5. Started
    started_status = "pending"
    if order.started_at:
        started_status = "completed"
    elif status == ORDER_STATUS_APPROVED:
        started_status = "active"
    elif status == ORDER_STATUS_IN_PROGRESS:
        started_status = "completed"

    steps.append(
        OrderLifecycleStepPublic(
            key="started",
            label="Started",
            status=started_status,
            actor_name=user_name_fn(order.started_by),
            occurred_at=order.started_at,
            detail="Executor began physical verification" if order.started_at else None,
        )
    )

    # 6. Physical verification
    total = len(order.items)
    verified = sum(1 for i in order.items if i.scan_time is not None)
    verify_status = "pending"
    if status == ORDER_STATUS_COMPLETED:
        verify_status = "completed"
    elif status in (ORDER_STATUS_PENDING_CLOSURE,):
        verify_status = "completed"
    elif status == ORDER_STATUS_IN_PROGRESS:
        verify_status = "active" if verified < total else "completed"
    elif verified > 0 and verified >= total:
        verify_status = "completed"

    steps.append(
        OrderLifecycleStepPublic(
            key="verification",
            label="Verification",
            status=verify_status,
            detail=f"{verified} of {total} assets scanned" if total else None,
            occurred_at=_find_audit_time(audit_rows, "closure_submitted")
            if verify_status == "completed" and verified >= total
            else None,
        )
    )

    # 7. Closure submitted
    closure_submitted_at = _find_audit_time(audit_rows, "closure_submitted")
    closure_submitted_status = "pending"
    if closure_submitted_at or status in (ORDER_STATUS_PENDING_CLOSURE, ORDER_STATUS_COMPLETED):
        closure_submitted_status = "completed"
    elif status == ORDER_STATUS_IN_PROGRESS and verified >= total and total > 0:
        closure_submitted_status = "active"

    steps.append(
        OrderLifecycleStepPublic(
            key="closure_submitted",
            label="Closure submitted",
            status=closure_submitted_status,
            actor_name=_find_audit_actor(audit_rows, "closure_submitted", user_name_fn),
            occurred_at=closure_submitted_at,
        )
    )

    # 8. Closure approval (from workflow)
    _append_approval_steps(
        steps,
        prefix="closure",
        phase_label="Closure approval",
        wf_def=closure_wf,
        req=closure_req if closure_submitted_status != "pending" else None,
        db=db,
    )

    # 9. Completed
    completed_status = "completed" if status == ORDER_STATUS_COMPLETED else "pending"
    if status == ORDER_STATUS_PENDING_CLOSURE:
        completed_status = "pending"
    steps.append(
        OrderLifecycleStepPublic(
            key="completed",
            label="Completed",
            status=completed_status,
            actor_name=_find_audit_actor(audit_rows, "completed", user_name_fn),
            occurred_at=order.completed_at,
        )
    )

    # Mark global rejection on order when rejected (override active approval step)
    if status == ORDER_STATUS_REJECTED:
        for step in steps:
            if step.status == "active":
                step.status = "rejected"
        if creation_req and str(creation_req.status).lower() in ("rejected", "in_rework"):
            for step in steps:
                if step.key.startswith("creation_approval") and step.status == "active":
                    step.status = "rejected"

    current_key: str | None = None
    for step in steps:
        if step.status == "active":
            current_key = step.key
            break
        if step.status == "rejected":
            current_key = step.key
            break
    if current_key is None:
        for step in reversed(steps):
            if step.status == "completed":
                current_key = step.key
                break
        if current_key is None and steps:
            current_key = steps[0].key

    return PhysicalOrderProgressPublic(
        steps=steps,
        current_step_key=current_key,
        creation_workflow=creation_wf,
        closure_workflow=closure_wf,
    )
