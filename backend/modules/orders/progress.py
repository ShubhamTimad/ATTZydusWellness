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
from modules.orders.model import PhysicalOrderItem
from modules.orders.schema import (
    OrderLifecycleApproverSlot,
    OrderLifecycleStepPublic,
    OrderWorkflowDefinition,
    OrderWorkflowStepDefinition,
    PhysicalOrderAuditPublic,
    PhysicalOrderAuditVerifiedAsset,
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
    "closure_submitted": "Order completed",
    "closure_approved": "Approved",
    "completed": "Order completed",
    "closed": "Order closed",
    "returned_for_execution": "Returned to executor after closure rejection",
    "execution_items_rejected": "Line items rejected during execution",
    "closure_items_rejected": "Line items rejected at closure review",
    "archived": "Order archived",
}


def _audit_detail(action: str, old_value: dict | None, new_value: dict | None) -> str | None:
    new_value = new_value or {}
    old_value = old_value or {}
    if action == "order_created":
        name = new_value.get("assigned_to_name")
        if name:
            return str(name)
        assignee = new_value.get("assigned_to")
        return f"User #{assignee}" if assignee else None
    if action == "assignment_changed":
        assignee = new_value.get("assigned_to")
        if assignee is not None:
            suffix = ""
            if new_value.get("auto_assigned"):
                suffix = " (after creation approval)"
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
        return None
    if action == "returned_for_execution":
        reason = new_value.get("reason")
        codes = new_value.get("rejected_asset_codes") or []
        parts = []
        if codes:
            parts.append(", ".join(str(c) for c in codes))
        if reason:
            parts.append(str(reason))
        return " — ".join(parts) if parts else "Line items rejected by reviewer"
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


def _verified_assets_from_items(
    items: list[PhysicalOrderItem],
    *,
    user_name_fn,
) -> list[PhysicalOrderAuditVerifiedAsset]:
    out: list[PhysicalOrderAuditVerifiedAsset] = []
    for item in items:
        if item.scan_time is None:
            continue
        asset = item.asset
        out.append(
            PhysicalOrderAuditVerifiedAsset(
                asset_code=str(asset.asset_code) if asset is not None else str(item.asset_id),
                asset_name=str(asset.asset_name) if asset is not None else None,
                rfid_code=str(asset.rfid_code) if asset is not None and asset.rfid_code else None,
                verified_at=item.scan_time,
                verified_by_name=user_name_fn(item.verified_by) if item.verified_by else None,
            )
        )
    out.sort(key=lambda row: (row.verified_at is None, row.verified_at))
    return out


def enrich_audit_rows(
    rows: list[PhysicalOrderAudit],
    *,
    user_name_fn,
    db: Session | None = None,
    order_id: int | None = None,
    order_items: list[PhysicalOrderItem] | None = None,
    assigned_to_name: str | None = None,
) -> list[PhysicalOrderAuditPublic]:
    out: list[PhysicalOrderAuditPublic] = []
    synthetic_id = -1
    has_real_creation_approval = any(
        str(r.action) == "approved" and not (r.new_value or {}).get("auto_approved") for r in rows
    )
    has_real_closure_approval = any(str(r.action) == "closure_approved" for r in rows)
    has_closure_submitted = any(str(r.action) == "closure_submitted" for r in rows)

    verified_assets = (
        _verified_assets_from_items(order_items, user_name_fn=user_name_fn) if order_items else []
    )

    for r in rows:
        action = str(r.action)
        if action == "asset_verified":
            continue
        if action == "completed" and (has_real_closure_approval or has_closure_submitted):
            continue
        if action == "approved" and (r.new_value or {}).get("auto_approved"):
            continue
        if action == "assignment_changed":
            continue
        new_value = dict(r.new_value or {})
        if action == "order_created" and not new_value.get("assigned_to_name") and assigned_to_name:
            new_value["assigned_to_name"] = assigned_to_name
        out.append(
            PhysicalOrderAuditPublic(
                id=int(r.id),
                action=action,
                label=_AUDIT_LABELS.get(action, action.replace("_", " ").title()),
                detail=_audit_detail(action, r.old_value, new_value),
                actor_name=user_name_fn(r.actor_user_id),
                old_value=r.old_value,
                new_value=new_value,
                created_at=r.created_at,
                verified_assets=verified_assets if action == "started" else [],
            )
        )

    if db is not None and order_id is not None:
        for entity_type, phase_label in (
            (ENTITY_TYPE_CREATION, "Creation approval"),
            (ENTITY_TYPE_CLOSURE, "Closure approval"),
        ):
            if entity_type == ENTITY_TYPE_CREATION and has_real_creation_approval:
                continue
            if entity_type == ENTITY_TYPE_CLOSURE and has_real_closure_approval:
                continue
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


def _step_order(*, show_creation_approval: bool, has_closure_workflow: bool) -> tuple[str, ...]:
    """Business lifecycle keys in display order.

    Happy path: Draft → Assigned → In Progress → Completed → Approved → Closed.
    Creation-approval step is only shown for legacy pending_approval orders.
    """
    keys: list[str] = ["order_created"]
    if show_creation_approval:
        keys.append("approved")
    keys.extend(["assigned", "in_progress", "completed"])
    if has_closure_workflow:
        keys.append("closure_approved")
    keys.append("closed")
    return tuple(keys)


def _active_step_key(
    order_status: str,
    *,
    show_creation_approval: bool,
    has_closure_workflow: bool,
    work_completed: bool = False,
) -> str | None:
    """Which timeline segment is current for each order status.

    Finished milestones are behind the highlight; the ring sits on the next
    action (or the in-flight stage). Closed is terminal (all completed).
    """
    if order_status == ORDER_STATUS_DRAFT:
        return "order_created"
    if order_status == ORDER_STATUS_PENDING_APPROVAL:
        return "approved" if show_creation_approval else "order_created"
    if order_status == ORDER_STATUS_APPROVED:
        # Closure approved → next action is Close.
        if has_closure_workflow and work_completed:
            return "closed"
        return "approved" if show_creation_approval else "assigned"
    if order_status == ORDER_STATUS_ASSIGNED:
        return "assigned"
    if order_status == ORDER_STATUS_IN_PROGRESS:
        return "in_progress"
    if order_status in (ORDER_STATUS_PENDING_CLOSURE, ORDER_STATUS_COMPLETED):
        # Work finished → highlight approval (or Close when no closure workflow).
        if has_closure_workflow:
            return "closure_approved"
        return "closed"
    if order_status == ORDER_STATUS_CLOSED:
        return "closed"
    if order_status == ORDER_STATUS_REJECTED:
        return "rejected"
    return None


def _step_phase(
    *,
    order_status: str,
    step_key: str,
    step_order: tuple[str, ...],
    active_key: str | None,
) -> str:
    """Return pending | active | completed | rejected for a business lifecycle step."""
    if order_status == ORDER_STATUS_REJECTED:
        if step_key == "order_created":
            return "completed"
        if step_key == "rejected":
            return "rejected"
        return "pending"

    if active_key is None or step_key not in step_order:
        return "pending"

    step_idx = step_order.index(step_key)
    active_idx = step_order.index(active_key)

    # Terminal success: every reached step (including Closed) is done — no "current" ring.
    if order_status == ORDER_STATUS_CLOSED:
        return "completed" if step_idx <= active_idx else "pending"

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
    creation_wf = _workflow_definition(db, action_code=ACTION_CREATE, phase="assignment")
    closure_wf = _workflow_definition(db, action_code=ACTION_COMPLETE, phase="closure")
    status = str(order.status)
    # Creation-approval UI only for legacy in-flight pending_approval orders.
    show_creation_approval = status == ORDER_STATUS_PENDING_APPROVAL
    has_closure_workflow = closure_wf is not None
    step_order = _step_order(
        show_creation_approval=show_creation_approval,
        has_closure_workflow=has_closure_workflow,
    )

    verified = sum(1 for i in order.items if i.scan_time is not None)
    total = len(order.items)
    active_key = _active_step_key(
        status,
        show_creation_approval=show_creation_approval,
        has_closure_workflow=has_closure_workflow,
        work_completed=order.completed_at is not None,
    )

    def phase(step_key: str) -> str:
        return _step_phase(
            order_status=status,
            step_key=step_key,
            step_order=step_order,
            active_key=active_key,
        )

    work_completed_at = (
        order.completed_at
        or _find_audit_time(audit_rows, "closure_submitted")
        or _find_audit_time(audit_rows, "completed")
    )

    steps: list[OrderLifecycleStepPublic] = [
        OrderLifecycleStepPublic(
            key="order_created",
            label="Draft" if status == ORDER_STATUS_DRAFT else "Order Created",
            status=phase("order_created"),
            actor_name=user_name_fn(order.created_by),
            occurred_at=order.created_at,
            detail=f"Order {order.order_number}",
        ),
    ]

    if show_creation_approval:
        steps.append(
            OrderLifecycleStepPublic(
                key="approved",
                label="Pending Approval" if status == ORDER_STATUS_PENDING_APPROVAL else "Approved",
                status=phase("approved"),
                actor_name=_find_audit_actor(audit_rows, "approved", user_name_fn),
                occurred_at=_find_audit_time(audit_rows, "approved"),
                detail=(
                    "Awaiting creation approval"
                    if status == ORDER_STATUS_PENDING_APPROVAL
                    else None
                ),
            )
        )

    steps.extend(
        [
            OrderLifecycleStepPublic(
                key="assigned",
                label="Assigned",
                status=phase("assigned"),
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
                status=phase("in_progress"),
                actor_name=user_name_fn(order.started_by),
                occurred_at=order.started_at,
                detail=(
                    f"{verified} of {total} assets scanned"
                    if status == ORDER_STATUS_IN_PROGRESS and total
                    else None
                ),
            ),
            OrderLifecycleStepPublic(
                key="completed",
                label="Completed",
                status=phase("completed"),
                actor_name=(
                    _find_audit_actor(audit_rows, "closure_submitted", user_name_fn)
                    or _find_audit_actor(audit_rows, "completed", user_name_fn)
                ),
                occurred_at=work_completed_at,
                detail=None,
            ),
        ]
    )

    if has_closure_workflow:
        steps.append(
            OrderLifecycleStepPublic(
                key="closure_approved",
                label="Approved",
                status=phase("closure_approved"),
                actor_name=_find_audit_actor(audit_rows, "closure_approved", user_name_fn),
                occurred_at=_find_audit_time(audit_rows, "closure_approved"),
                detail=(
                    "Awaiting approval"
                    if status == ORDER_STATUS_COMPLETED
                    else None
                ),
            )
        )

    steps.append(
        OrderLifecycleStepPublic(
            key="closed",
            label="Closed",
            status=phase("closed"),
            actor_name=_find_audit_actor(audit_rows, "closed", user_name_fn),
            occurred_at=order.closed_at,
            detail=(
                "Ready to close"
                if status in (ORDER_STATUS_APPROVED, ORDER_STATUS_COMPLETED)
                and active_key == "closed"
                else None
            ),
        )
    )

    if status == ORDER_STATUS_REJECTED:
        steps.append(
            OrderLifecycleStepPublic(
                key="rejected",
                label="Rejected",
                status="rejected",
                actor_name=_find_audit_actor(audit_rows, "rejected", user_name_fn),
                occurred_at=_find_audit_time(audit_rows, "rejected"),
                detail="Order rejected",
            )
        )

    current_key = active_key
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
