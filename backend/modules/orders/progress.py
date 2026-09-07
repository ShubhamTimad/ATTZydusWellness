"""Build lifecycle progress stepper + enriched audit for physical orders."""

from __future__ import annotations

from datetime import datetime, timezone
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
    "order_created": "Order Created",
    "assignment_changed": "Executor Assigned",
    "reassigned": "Order Reassigned",
    "submitted_for_approval": "Submitted for Creation Approval",
    "approved": "Creation Approved",
    "rejected": "Order Rejected",
    "started": "Physical Verification",
    "asset_verified": "Asset Physically Verified (RFID Scan)",
    "closure_submitted": "Submitted for Approval",
    "closure_approved": "Closure Approved",
    "completed": "Completed",
    "closed": "Order Closed",
    "returned_for_execution": "Returned to Executor after Closure Rejection",
    "execution_items_rejected": "Assets Rejected",
    "closure_items_rejected": "Assets Rejected",
    "closure_items_approved": "Assets Approved",
    "archived": "Order Archived",
    "unarchived": "Order Unarchived",
    "item_remark_updated": "Remark added",
}

# ponytail: blur-save then Verify is two API calls; treat as one audit row if within this window.
_SIMULTANEOUS_REMARK_SCAN_SECONDS = 120


def _audit_detail(action: str, old_value: dict | None, new_value: dict | None) -> str | None:
    new_value = new_value or {}
    old_value = old_value or {}
    if action == "order_created":
        return None
    if action == "assignment_changed":
        assignee = new_value.get("assigned_to")
        if assignee is not None:
            name = new_value.get("assigned_to_name")
            if name:
                return f"Assigned to: {name}"
            return f"Assigned to: user #{assignee}"
    if action == "reassigned":
        old_name = old_value.get("assigned_to_name")
        new_name = new_value.get("assigned_to_name")
        if old_name and new_name:
            return f"{old_name} → {new_name}"
        if new_name:
            return f"Assigned to: {new_name}"
        assignee = new_value.get("assigned_to")
        return f"Assigned to: user #{assignee}" if assignee else None
    if action == "asset_verified":
        code = new_value.get("asset_code")
        rfid = new_value.get("rfid_code")
        parts = [p for p in (code, rfid) if p]
        return " · ".join(parts) if parts else None
    if action == "rejected":
        # Internal finish reasons are noisy; prefer the reviewer's reject reason.
        boilerplate = {
            "approved remaining assets; rejected assets returned to executor.",
            "closure review completed with rejected assets.",
            "rejected",
        }
        reason = (new_value.get("reason") or new_value.get("comment") or "").strip()
        if reason and reason.lower() not in boilerplate:
            return f"Rejected Reason: {reason}"
        return None
    if action == "submitted_for_approval":
        rid = new_value.get("approval_request_id")
        next_name = new_value.get("next_assignee_name") or new_value.get("assigned_to_name")
        parts = []
        if next_name:
            parts.append(f"Assigned to: {next_name}")
        if rid:
            parts.append(f"Approval request #{rid}")
        return " — ".join(parts) if parts else None
    if action == "closure_submitted":
        next_name = (
            new_value.get("next_assignee_name")
            or new_value.get("assignee_user_name")
            or new_value.get("assigned_to_name")
        )
        parts = []
        if next_name:
            parts.append(f"Assigned to: {next_name}")
        elif new_value.get("assignee_user_id") is not None:
            parts.append(f"Assigned to: user #{new_value.get('assignee_user_id')}")
        if new_value.get("resubmitted"):
            pass
        return " — ".join(parts) if parts else None
    if action == "execution_items_rejected":
        codes = new_value.get("asset_codes") or []
        reason = new_value.get("reason")
        parts = []
        if codes:
            parts.append(", ".join(str(c) for c in codes))
        if reason:
            parts.append(f"Rejected Reason: {reason}")
        return " — ".join(parts) if parts else None
    if action == "closure_items_rejected":
        codes = new_value.get("asset_codes") or []
        reason = new_value.get("reason")
        parts = []
        if codes:
            parts.append(", ".join(str(c) for c in codes))
        if reason:
            parts.append(f"Rejected Reason: {reason}")
        return " — ".join(parts) if parts else None
    if action == "returned_for_execution":
        reason = new_value.get("reason")
        codes = new_value.get("rejected_asset_codes") or []
        parts = []
        if codes:
            parts.append(", ".join(str(c) for c in codes))
        if reason:
            parts.append(f"Rejected Reason: {reason}")
        return " — ".join(parts) if parts else "Assets rejected by reviewer"
    if action == "closure_items_approved":
        codes = new_value.get("asset_codes") or []
        if codes:
            return ", ".join(str(c) for c in codes)
        return None
    if action == "item_remark_updated":
        remark = str(new_value.get("remarks") or "").strip()
        return remark or None
    return None


def _workflow_next_assignee_line(
    db: Session,
    req: ApprovalRequest,
    act: ApprovalAction,
    *,
    user_name_fn,
) -> str | None:
    """Who the approval engine handed the next step to after this action."""
    if str(act.action).lower() not in ("approve", "approved"):
        return None
    step_order = int(act.task.step.step_order) if act.task and act.task.step else None
    tasks = list(req.tasks or [])
    next_tasks: list[ApprovalTask] = []
    if step_order is not None:
        next_tasks = [
            t
            for t in tasks
            if t.step is not None and int(t.step.step_order) == step_order + 1
        ]
    if not next_tasks and step_order is not None:
        next_tasks = [
            t
            for t in tasks
            if t.step is not None and int(t.step.step_order) > step_order
        ]
    if not next_tasks:
        # ApprovalTask has no created_at — use later ids / still-pending handoffs.
        current_id = int(act.task_id) if act.task_id is not None else None
        next_tasks = [
            t
            for t in tasks
            if (current_id is None or int(t.id) != current_id)
            and str(getattr(t, "status", "") or "") == "pending"
        ]
    names: list[str] = []
    roles: list[str] = []
    for t in next_tasks:
        if t.assigned_user_id is not None:
            name = user_name_fn(int(t.assigned_user_id))
            if name:
                names.append(str(name))
        elif t.assigned_role_id is not None:
            role = db.get(Role, int(t.assigned_role_id))
            if role is not None and role.name:
                roles.append(str(role.name))
        elif t.step is not None:
            role = db.get(Role, int(t.step.approver_role_id))
            if role is not None and role.name:
                roles.append(str(role.name))
    if names:
        uniq = list(dict.fromkeys(names))
        return f"Assigned to: {', '.join(uniq)}"
    if roles:
        uniq = list(dict.fromkeys(roles))
        return f"Assigned role: {', '.join(uniq)}"
    return None


def _first_request_assignee_line(
    db: Session,
    req: ApprovalRequest,
    *,
    user_name_fn,
) -> str | None:
    """Assignee (or role) for the first pending/created task on a request."""
    tasks = sorted(
        (t for t in (req.tasks or []) if t.step is not None),
        key=lambda t: (int(t.step.step_order), int(t.id)),
    )
    if not tasks:
        return None
    first = tasks[0]
    if first.assigned_user_id is not None:
        name = user_name_fn(int(first.assigned_user_id))
        return f"Assigned to: {name}" if name else f"Assigned to: user #{first.assigned_user_id}"
    role_id = first.assigned_role_id or (first.step.approver_role_id if first.step else None)
    if role_id is not None:
        role = db.get(Role, int(role_id))
        if role is not None and role.name:
            return f"Assigned role: {role.name}"
    return None


def _aware_dt(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _within_seconds(left: datetime | None, right: datetime | None, seconds: int) -> bool:
    a = _aware_dt(left)
    b = _aware_dt(right)
    if a is None or b is None:
        return False
    return abs((a - b).total_seconds()) <= seconds


def _asset_display_name(
    new_value: dict | None,
    order_items: list[PhysicalOrderItem] | None,
) -> str:
    payload = new_value or {}
    name = str(payload.get("asset_name") or "").strip()
    if name:
        return name
    aid = payload.get("asset_id")
    if aid is not None and order_items:
        for item in order_items:
            if int(item.asset_id) != int(aid):
                continue
            asset = getattr(item, "asset", None)
            item_name = str(getattr(asset, "asset_name", None) or "").strip() if asset is not None else ""
            if item_name:
                return item_name
            break
    return str(payload.get("asset_code") or "").strip() or "asset"


def _item_remark_audit_label(
    old_value: dict | None,
    new_value: dict | None,
    order_items: list[PhysicalOrderItem] | None,
) -> str:
    name = _asset_display_name(new_value, order_items)
    old_remark = str((old_value or {}).get("remarks") or "").strip()
    new_remark = str((new_value or {}).get("remarks") or "").strip()
    if new_remark and not old_remark:
        verb = "added"
    elif new_remark:
        verb = "updated"
    else:
        verb = "removed"
    return f"Remark {verb} for {name}"


def _fold_simultaneous_item_remarks(
    rows: list[PhysicalOrderAudit],
    order_items: list[PhysicalOrderItem] | None,
) -> tuple[set[int], dict[int, str]]:
    """Hide remark-only rows that were saved in the same Verify click as an RFID scan."""
    fold_ids: set[int] = set()
    remarks_by_asset_id: dict[int, str] = {}
    if not order_items:
        return fold_ids, remarks_by_asset_id
    scan_time_by_asset_id = {
        int(item.asset_id): item.scan_time
        for item in order_items
        if item.scan_time is not None
    }
    if not scan_time_by_asset_id:
        return fold_ids, remarks_by_asset_id
    for row in rows:
        if str(row.action) != "item_remark_updated":
            continue
        payload = row.new_value or {}
        aid = payload.get("asset_id")
        if aid is None:
            continue
        asset_id = int(aid)
        if not _within_seconds(
            getattr(row, "created_at", None),
            scan_time_by_asset_id.get(asset_id),
            _SIMULTANEOUS_REMARK_SCAN_SECONDS,
        ):
            continue
        fold_ids.add(int(row.id))
        text = str(payload.get("remarks") or "").strip()
        if text:
            remarks_by_asset_id[asset_id] = text
    return fold_ids, remarks_by_asset_id


def _verified_assets_from_items(
    items: list[PhysicalOrderItem],
    *,
    user_name_fn,
    remarks_by_asset_id: dict[int, str] | None = None,
) -> list[PhysicalOrderAuditVerifiedAsset]:
    out: list[PhysicalOrderAuditVerifiedAsset] = []
    for item in items:
        if item.scan_time is None:
            continue
        asset = item.asset
        asset_id = int(item.asset_id)
        remark = (remarks_by_asset_id or {}).get(asset_id)
        out.append(
            PhysicalOrderAuditVerifiedAsset(
                asset_code=str(asset.asset_code) if asset is not None else str(item.asset_id),
                asset_name=str(asset.asset_name) if asset is not None else None,
                rfid_code=str(asset.rfid_code) if asset is not None and asset.rfid_code else None,
                verified_at=item.scan_time,
                verified_by_name=user_name_fn(item.verified_by) if item.verified_by else None,
                remark=remark,
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
    work_completed_at: datetime | None = None,
    work_completed_by: int | None = None,
) -> list[PhysicalOrderAuditPublic]:
    out: list[PhysicalOrderAuditPublic] = []
    synthetic_id = -1
    has_closure_submitted = any(str(r.action) == "closure_submitted" for r in rows)
    has_completed = any(str(r.action) == "completed" for r in rows)
    has_order_rejected = any(str(r.action) == "rejected" for r in rows)
    fold_remark_ids, folded_remarks = _fold_simultaneous_item_remarks(rows, order_items)

    verified_assets = (
        _verified_assets_from_items(
            order_items,
            user_name_fn=user_name_fn,
            remarks_by_asset_id=folded_remarks,
        )
        if order_items
        else []
    )

    workflow_rows: list[PhysicalOrderAuditPublic] = []
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
                detail_parts: list[str] = []
                next_line = _workflow_next_assignee_line(
                    db, req, act, user_name_fn=user_name_fn
                )
                if next_line:
                    detail_parts.append(next_line)
                if act.comment:
                    detail_parts.append(f"Comment: {act.comment}")
                workflow_rows.append(
                    PhysicalOrderAuditPublic(
                        id=synthetic_id,
                        action=f"workflow_{act_name}",
                        label=label,
                        detail=" — ".join(detail_parts) if detail_parts else None,
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

    has_workflow_creation_approve = any(
        e.action.startswith("workflow_")
        and (e.new_value or {}).get("action") in ("approve", "approved")
        and "Creation" in e.label
        for e in workflow_rows
    )
    has_workflow_closure_approve = any(
        e.action.startswith("workflow_")
        and (e.new_value or {}).get("action") in ("approve", "approved")
        and "Closure" in e.label
        for e in workflow_rows
    )

    # Line rejects are folded into matching "Order Rejected" rows (same cycle only).
    folded_reason_by_rejected_id: dict[int, str] = {}
    if has_order_rejected:
        pending_line_reason: str | None = None
        chronological = sorted(
            rows,
            key=lambda row: (
                getattr(row, "created_at", None) is None,
                getattr(row, "created_at", None),
                int(getattr(row, "id", 0) or 0),
            ),
        )
        for row in chronological:
            action_name = str(row.action)
            if action_name in ("closure_items_rejected", "execution_items_rejected"):
                reason = str((row.new_value or {}).get("reason") or "").strip()
                if reason:
                    pending_line_reason = reason
            elif action_name == "rejected" and pending_line_reason:
                folded_reason_by_rejected_id[int(row.id)] = pending_line_reason
                pending_line_reason = None

    boilerplate_reject_reasons = {
        "approved remaining assets; rejected assets returned to executor.",
        "closure review completed with rejected assets.",
        "rejected",
    }

    for r in rows:
        action = str(r.action)
        if action == "asset_verified":
            continue
        if action == "item_remark_updated" and int(r.id) in fold_remark_ids:
            continue
        # Line rejects are applied right before order-level reject; keep one "Order rejected".
        if action == "closure_items_rejected" and has_order_rejected:
            continue
        if action == "execution_items_rejected" and has_order_rejected:
            continue
        if action == "approved" and (r.new_value or {}).get("auto_approved"):
            continue
        # Prefer step-by-step workflow rows (they include next assignee).
        if action == "approved" and has_workflow_creation_approve:
            continue
        if action == "closure_approved" and has_workflow_closure_approve:
            continue
        new_value = dict(r.new_value or {})
        if action == "rejected":
            if not new_value.get("assigned_to_name") and assigned_to_name:
                new_value["assigned_to_name"] = assigned_to_name
            existing = str(new_value.get("reason") or new_value.get("comment") or "").strip()
            folded = folded_reason_by_rejected_id.get(int(r.id))
            if folded and (not existing or existing.lower() in boilerplate_reject_reasons):
                new_value["reason"] = folded
        if action == "submitted_for_approval" and db is not None and order_id is not None:
            if not new_value.get("next_assignee_name") and not new_value.get("assigned_to_name"):
                req = _latest_approval_request(
                    db, order_id=order_id, entity_type=ENTITY_TYPE_CREATION
                )
                if req is not None:
                    first_line = _first_request_assignee_line(
                        db, req, user_name_fn=user_name_fn
                    )
                    if first_line and first_line.startswith("Assigned to: "):
                        new_value["next_assignee_name"] = first_line.removeprefix("Assigned to: ")
                    elif first_line and first_line.startswith("Assigned role: "):
                        new_value["next_assignee_name"] = first_line.removeprefix("Assigned role: ")
                    elif first_line and first_line.startswith("Next: "):
                        new_value["next_assignee_name"] = first_line.removeprefix("Next: ")
                    elif first_line and first_line.startswith("Next role: "):
                        new_value["next_assignee_name"] = first_line.removeprefix("Next role: ")
        if action == "closure_submitted":
            if not (
                new_value.get("next_assignee_name")
                or new_value.get("assignee_user_name")
                or new_value.get("assigned_to_name")
            ):
                assignee_id = new_value.get("assignee_user_id")
                if assignee_id is not None:
                    name = user_name_fn(int(assignee_id))
                    if name:
                        new_value["assignee_user_name"] = name
                elif db is not None and order_id is not None:
                    req = _latest_approval_request(
                        db, order_id=order_id, entity_type=ENTITY_TYPE_CLOSURE
                    )
                    if req is not None:
                        first_line = _first_request_assignee_line(
                            db, req, user_name_fn=user_name_fn
                        )
                        if first_line and first_line.startswith("Assigned to: "):
                            new_value["next_assignee_name"] = first_line.removeprefix(
                                "Assigned to: "
                            )
                        elif first_line and first_line.startswith("Assigned role: "):
                            new_value["next_assignee_name"] = first_line.removeprefix(
                                "Assigned role: "
                            )
                        elif first_line and first_line.startswith("Next: "):
                            new_value["next_assignee_name"] = first_line.removeprefix("Next: ")
                        elif first_line and first_line.startswith("Next role: "):
                            new_value["next_assignee_name"] = first_line.removeprefix(
                                "Next role: "
                            )
        out.append(
            PhysicalOrderAuditPublic(
                id=int(r.id),
                action=action,
                label=(
                    _item_remark_audit_label(r.old_value, new_value, order_items)
                    if action == "item_remark_updated"
                    else _AUDIT_LABELS.get(action, action.replace("_", " ").title())
                ),
                detail=_audit_detail(action, r.old_value, new_value),
                actor_name=user_name_fn(r.actor_user_id),
                old_value=r.old_value,
                new_value=new_value,
                created_at=r.created_at,
                verified_assets=verified_assets if action == "started" else [],
            )
        )

    if has_closure_submitted and not has_completed and work_completed_at is not None:
        synthetic_id -= 1
        out.append(
            PhysicalOrderAuditPublic(
                id=synthetic_id,
                action="completed",
                label=_AUDIT_LABELS.get("completed", "Completed"),
                detail=None,
                actor_name=user_name_fn(work_completed_by) if work_completed_by else None,
                old_value=None,
                new_value=None,
                created_at=work_completed_at,
            )
        )

    out.extend(workflow_rows)
    out.sort(key=lambda e: (e.created_at, e.id))
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
                step_kind=str(getattr(step, "step_kind", None) or "approve"),
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


def _is_close_kind(step: OrderWorkflowStepDefinition) -> bool:
    return str(getattr(step, "step_kind", None) or "approve").strip().lower() == "close"


def _approval_progress_defs(
    closure_wf: OrderWorkflowDefinition | None,
) -> list[OrderWorkflowStepDefinition]:
    """Approve levels only. Assign is executor; Close is the existing Closed node."""
    if closure_wf is None or not closure_wf.steps:
        return []
    steps = sorted(closure_wf.steps, key=lambda s: int(s.step_order))
    if len(steps) > 1:
        steps = steps[1:]
    return [s for s in steps if not _is_close_kind(s)]


def _approval_progress_keys(closure_wf: OrderWorkflowDefinition | None) -> tuple[str, ...]:
    steps = _approval_progress_defs(closure_wf)
    if len(steps) <= 1:
        return ("closure_approved",) if closure_wf is not None else ()
    return tuple(f"closure_{s.step_order}" for s in steps)


def _step_order(
    *,
    show_creation_approval: bool,
    has_closure_workflow: bool,
    closure_step_keys: tuple[str, ...] = ("closure_approved",),
) -> tuple[str, ...]:
    """Business lifecycle keys in display order.

    Happy path: Draft → Assigned → In Progress → Completed → Approved → Closed.
    Creation-approval step is only shown for legacy pending_approval orders.
    """
    keys: list[str] = ["order_created"]
    if show_creation_approval:
        keys.append("approved")
    keys.extend(["assigned", "in_progress", "completed"])
    if has_closure_workflow:
        keys.extend(closure_step_keys)
    keys.append("closed")
    return tuple(keys)


def _active_step_key(
    order_status: str,
    *,
    show_creation_approval: bool,
    has_closure_workflow: bool,
    work_completed: bool = False,
    current_closure_key: str | None = None,
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
            return current_closure_key or "closure_approved"
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
    rejection_cutoff: str | None = None,
) -> str:
    """Return pending | active | completed | rejected for a business lifecycle step."""
    if order_status == ORDER_STATUS_REJECTED:
        if step_key == "rejected":
            return "rejected"
        cutoff = rejection_cutoff or "order_created"
        if step_key in step_order and cutoff in step_order:
            return (
                "completed"
                if step_order.index(step_key) <= step_order.index(cutoff)
                else "pending"
            )
        if step_key == "order_created":
            return "completed"
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


def _rejection_cutoff_key(
    order: PhysicalOrder,
    audit_rows: list[PhysicalOrderAudit],
    *,
    has_closure_workflow: bool,
) -> str:
    """Last happy-path step that actually happened before rejection."""
    if order.closed_at or _find_audit_time(audit_rows, "closed"):
        return "closed"
    if has_closure_workflow and _find_audit_time(audit_rows, "closure_approved"):
        return "closure_approved"
    if (
        order.completed_at
        or _find_audit_time(audit_rows, "closure_submitted")
        or _find_audit_time(audit_rows, "completed")
    ):
        return "completed"
    if order.started_at:
        return "in_progress"
    if order.assigned_at:
        return "assigned"
    for row in reversed(audit_rows):
        if str(row.action) != "rejected":
            continue
        nv = row.new_value or {}
        if nv.get("phase") == "creation" or nv.get("entity_type") == ENTITY_TYPE_CREATION:
            return "approved"
        break
    if any(str(r.action) == "submitted_for_approval" for r in audit_rows):
        return "approved"
    if any(str(r.action) == "approved" for r in audit_rows):
        return "approved"
    return "order_created"


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
    has_closure_workflow = closure_wf is not None
    rejection_cutoff: str | None = None
    if status == ORDER_STATUS_REJECTED:
        rejection_cutoff = _rejection_cutoff_key(
            order, audit_rows, has_closure_workflow=has_closure_workflow
        )
    # Creation-approval UI for in-flight pending_approval, or after a creation reject.
    show_creation_approval = status == ORDER_STATUS_PENDING_APPROVAL or rejection_cutoff == "approved"
    closure_step_keys = _approval_progress_keys(closure_wf)
    closure_req = (
        _latest_approval_request(db, order_id=int(order.id), entity_type=ENTITY_TYPE_CLOSURE)
        if has_closure_workflow
        else None
    )
    current_closure_key = None
    if closure_req is not None and str(closure_req.status) == "pending" and closure_step_keys:
        mapped = f"closure_{int(closure_req.current_step)}"
        current_closure_key = mapped if mapped in closure_step_keys else closure_step_keys[0]
    step_order = _step_order(
        show_creation_approval=show_creation_approval,
        has_closure_workflow=has_closure_workflow,
        closure_step_keys=closure_step_keys or ("closure_approved",),
    )

    verified = sum(1 for i in order.items if i.scan_time is not None)
    total = len(order.items)
    active_key = _active_step_key(
        status,
        show_creation_approval=show_creation_approval,
        has_closure_workflow=has_closure_workflow,
        work_completed=order.completed_at is not None,
        current_closure_key=current_closure_key,
    )

    def phase(step_key: str) -> str:
        return _step_phase(
            order_status=status,
            step_key=step_key,
            step_order=step_order,
            active_key=active_key,
            rejection_cutoff=rejection_cutoff,
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
            detail=None,
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
                    f"Executor: {user_name_fn(order.started_by or order.assigned_to)}"
                    if (order.started_by or order.assigned_to) and order.assigned_at
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
                # detail=(
                #     f"{verified} of {total} assets scanned"
                #     if status == ORDER_STATUS_IN_PROGRESS and total
                #     else None
                # ),
            ),
            OrderLifecycleStepPublic(
                key="completed",
                label="Completed",
                status=phase("completed"),
                actor_name=(
                    _find_audit_actor(audit_rows, "completed", user_name_fn)
                    or _find_audit_actor(audit_rows, "closure_submitted", user_name_fn)
                ),
                occurred_at=work_completed_at,
                detail=None,
            ),
        ]
    )

    if has_closure_workflow:
        awaiting_closure = status in (ORDER_STATUS_COMPLETED, ORDER_STATUS_PENDING_CLOSURE)
        approval_defs = _approval_progress_defs(closure_wf)
        if len(approval_defs) <= 1:
            steps.append(
                OrderLifecycleStepPublic(
                    key="closure_approved",
                    label="Pending approval" if awaiting_closure else "Approved",
                    status=phase("closure_approved"),
                    actor_name=_find_audit_actor(audit_rows, "closure_approved", user_name_fn),
                    occurred_at=_find_audit_time(audit_rows, "closure_approved"),
                    detail="Awaiting Approval" if awaiting_closure else None,
                )
            )
        else:
            for spec in approval_defs:
                key = f"closure_{spec.step_order}"
                st = phase(key)
                steps.append(
                    OrderLifecycleStepPublic(
                        key=key,
                        label=spec.role_name,
                        status=st,
                        role_name=spec.role_name,
                        actor_name=(
                            _find_audit_actor(audit_rows, "closure_approved", user_name_fn)
                            if st == "completed"
                            else None
                        ),
                        occurred_at=(
                            _find_audit_time(audit_rows, "closure_approved")
                            if st == "completed"
                            else None
                        ),
                        detail="Awaiting Approval" if st == "active" else None,
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
        # CapEx-style: stop at the last reached step, then Rejected — do not paint
        # Approved/Closed as done when rejection happened earlier.
        if rejection_cutoff:
            kept: list[OrderLifecycleStepPublic] = []
            for step in steps:
                kept.append(step)
                if step.key == rejection_cutoff:
                    break
            steps = kept
        steps.append(
            OrderLifecycleStepPublic(
                key="rejected",
                label="Rejected",
                status="Rejected",
                actor_name=_find_audit_actor(audit_rows, "rejected", user_name_fn),
                occurred_at=_find_audit_time(audit_rows, "rejected"),
                detail="Order Rejected",
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
