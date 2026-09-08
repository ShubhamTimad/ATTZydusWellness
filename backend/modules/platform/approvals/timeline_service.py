"""Unified read-only approval timeline for an entity (e.g. user)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from modules.platform.approvals.inbox_service import _viewer_can_access_request, safe_payload_preview
from modules.platform.approvals.model import ApprovalAction, ApprovalRequest, ApprovalStep, ApprovalTask, TaskAuditLog
from modules.platform.approvals.service import ApprovalError
from modules.platform.rbac_audit.model import RbacAuditLog
from modules.platform.roles.model import Role
from modules.platform.users.model import User


def resolve_db_entity(
    db: Session, *, path_entity_type: str, entity_id: int
) -> tuple[str, int] | None:
    """
    Map URL segment to persisted ``approval_requests`` (entity_type, entity_id).

    Supported:
    - ``user`` → ``user_creation`` + ``entity_id`` (user primary key)
    - Or any ``entity_type`` that matches an existing approval request for that entity id
      (case-insensitive; stored casing is returned).
    """
    raw = (path_entity_type or "").strip()
    low = raw.lower()
    if low == "user":
        return ("user_creation", entity_id)
    if low == "user_creation":
        return ("user_creation", entity_id)
    if low == "asset":
        row = db.execute(
            select(ApprovalRequest.entity_type, ApprovalRequest.entity_id)
            .where(
                ApprovalRequest.entity_id == entity_id,
                ApprovalRequest.entity_type.in_(("asset_creation", "asset_import")),
            )
            .order_by(ApprovalRequest.id.desc())
            .limit(1)
        ).first()
        if row is not None:
            return (str(row[0]), int(row[1]))
        return ("asset_creation", entity_id)
    if low in ("asset_creation", "asset_import"):
        return (low, entity_id)
    if low in ("physical_order", "physical_order_creation", "physical_order_closure", "order"):
        row = db.execute(
            select(ApprovalRequest.entity_type, ApprovalRequest.entity_id)
            .where(
                ApprovalRequest.entity_id == entity_id,
                ApprovalRequest.entity_type.in_(
                    ("physical_order_creation", "physical_order_closure")
                ),
            )
            .order_by(ApprovalRequest.id.desc())
            .limit(1)
        ).first()
        if row is not None:
            return (str(row[0]), int(row[1]))
        return ("physical_order_creation", entity_id)
    row = db.execute(
        select(ApprovalRequest.entity_type, ApprovalRequest.entity_id)
        .where(
            ApprovalRequest.entity_id == entity_id,
            func.lower(ApprovalRequest.entity_type) == low,
        )
        .limit(1)
    ).first()
    if row is not None:
        return (str(row[0]), int(row[1]))
    return None


class ApprovalTimelineService:
    def __init__(self, db: Session) -> None:
        self._db = db

    @staticmethod
    def _actor_name(db: Session, user_id: int | None) -> str | None:
        if user_id is None:
            return None
        actor = db.get(User, int(user_id))
        if actor is None:
            return f"User #{user_id}"
        return actor.full_name or actor.username or actor.email or f"User #{user_id}"

    @staticmethod
    def _diff_changes(
        before: dict[str, Any],
        after: dict[str, Any],
    ) -> dict[str, Any]:
        changes: dict[str, Any] = {}
        for key in sorted(set(before.keys()) | set(after.keys())):
            if before.get(key) == after.get(key):
                continue
            if key == "role_names" and before.get("role_ids") == after.get("role_ids"):
                continue
            changes[key] = {"from": before.get(key), "to": after.get(key)}
        return changes

    def _rbac_log_event(self, lg: RbacAuditLog) -> dict[str, Any] | None:
        actor_name = self._actor_name(self._db, lg.actor_user_id)
        before = lg.old_value if isinstance(lg.old_value, dict) else {}
        after = lg.new_value if isinstance(lg.new_value, dict) else {}
        action = str(lg.action)

        if action == "activate":
            return {
                "type": "activated",
                "user": actor_name,
                "timestamp": lg.created_at,
                "details": None,
            }
        if action == "deactivate":
            return {
                "type": "deactivated",
                "user": actor_name,
                "timestamp": lg.created_at,
                "details": None,
            }
        if action == "account_locked":
            return {
                "type": "account_locked",
                "user": "System",
                "timestamp": lg.created_at,
                "details": None,
            }
        if action == "account_unlocked":
            return {
                "type": "account_unlocked",
                "user": actor_name or "System",
                "timestamp": lg.created_at,
                "details": None,
            }
        if action != "update":
            return None

        changes = self._diff_changes(before, after)
        if not changes:
            return None

        if set(changes.keys()) == {"is_active"}:
            if changes["is_active"].get("from") is False and changes["is_active"].get("to") is True:
                return {
                    "type": "activated",
                    "user": actor_name,
                    "timestamp": lg.created_at,
                    "details": None,
                }
            if changes["is_active"].get("from") is True and changes["is_active"].get("to") is False:
                return {
                    "type": "deactivated",
                    "user": actor_name,
                    "timestamp": lg.created_at,
                    "details": None,
                }

        return {
            "type": "entity_updated",
            "user": actor_name,
            "timestamp": lg.created_at,
            "details": {"changes": changes, "before": before, "after": after},
        }

    def _pending_approver_label(self, req: ApprovalRequest) -> str | None:
        step_row = self._db.scalar(
            select(ApprovalStep).where(
                ApprovalStep.workflow_id == req.workflow_id,
                ApprovalStep.step_order == req.current_step,
            )
        )
        if step_row is None:
            return None
        role = self._db.get(Role, int(step_row.approver_role_id))
        return role.name if role is not None else "Approvers"

    def _user_creation_timeline(
        self,
        *,
        entity_id: int,
        req: ApprovalRequest | None,
        viewer_id: int,
    ) -> list[dict[str, Any]]:
        """Single consolidated create event; later approval/update events only."""
        target_user = self._db.get(User, entity_id)
        can_view_approval = (
            req is None
            or _viewer_can_access_request(self._db, request_id=req.id, viewer_id=viewer_id)
        )

        events: list[dict[str, Any]] = []
        rbac_logs = self._db.scalars(
            select(RbacAuditLog)
            .where(RbacAuditLog.target_type == "user", RbacAuditLog.target_id == entity_id)
            .order_by(RbacAuditLog.created_at.asc())
        ).all()

        create_log = next((lg for lg in rbac_logs if lg.action == "create"), None)
        if create_log is not None:
            actor = (
                self._db.get(User, int(create_log.actor_user_id))
                if create_log.actor_user_id is not None
                else None
            )
            actor_name = actor.full_name or actor.email or f"User #{create_log.actor_user_id}" if actor else None
            details: dict[str, Any] = (
                dict(create_log.new_value) if isinstance(create_log.new_value, dict) else {}
            )
            if (
                req is not None
                and can_view_approval
                and target_user is not None
                and not bool(target_user.is_active)
                and str(req.status) == "pending"
            ):
                awaiting = self._pending_approver_label(req)
                if awaiting:
                    details["approval_status"] = "pending"
                    details["awaiting_role"] = awaiting
            events.append(
                {
                    "type": "created",
                    "user": actor_name,
                    "timestamp": create_log.created_at,
                    "details": details or None,
                }
            )
        elif req is not None:
            creator = self._db.get(User, int(req.created_by)) if req.created_by is not None else None
            creator_name = creator.full_name or creator.email or f"User #{creator.id}" if creator else None
            payload = req.payload if isinstance(req.payload, dict) else {}
            details = {
                "approval_status": str(req.status),
                "preview": safe_payload_preview(payload),
            }
            if str(req.status) == "pending":
                awaiting = self._pending_approver_label(req)
                if awaiting:
                    details["awaiting_role"] = awaiting
            events.append(
                {
                    "type": "created",
                    "user": creator_name,
                    "timestamp": req.created_at,
                    "details": details,
                }
            )

        create_ts = events[0]["timestamp"] if events else None

        for lg in rbac_logs:
            if lg.action in ("create", "assign"):
                continue
            ev = self._rbac_log_event(lg)
            if ev is not None:
                events.append(ev)

        # Locks written before the audit row existed still belong on the user trail.
        if (
            target_user is not None
            and target_user.locked_at is not None
            and not any(ev.get("type") == "account_locked" for ev in events)
        ):
            events.append(
                {
                    "type": "account_locked",
                    "user": "System",
                    "timestamp": target_user.locked_at,
                    "details": None,
                }
            )

        if req is not None and can_view_approval:
            actions = self._db.scalars(
                select(ApprovalAction)
                .join(ApprovalTask, ApprovalTask.id == ApprovalAction.task_id)
                .where(ApprovalTask.request_id == req.id)
                .options(selectinload(ApprovalAction.task).selectinload(ApprovalTask.step))
                .order_by(ApprovalAction.created_at.asc())
            ).all()
            for act in actions:
                task = act.task
                step_order = int(task.step.step_order) if task and task.step else None
                actor = self._db.get(User, int(act.user_id))
                actor_name = actor.full_name or actor.email or f"User #{act.user_id}" if actor else None
                events.append(
                    {
                        "type": "approval_step",
                        "step": step_order,
                        "action": act.action,
                        "user": actor_name,
                        "timestamp": act.created_at,
                        "details": {"task_id": task.id if task else None, "comment": act.comment},
                    }
                )

            rework_logs = self._db.scalars(
                select(TaskAuditLog)
                .join(ApprovalTask, ApprovalTask.id == TaskAuditLog.task_id)
                .where(
                    ApprovalTask.request_id == req.id,
                    ApprovalTask.task_type == "rework",
                    TaskAuditLog.action.in_(("created", "rework_started", "entity_updated", "resubmitted")),
                )
                .order_by(TaskAuditLog.created_at.asc())
            ).all()
            for lg in rework_logs:
                if lg.action == "created" and create_ts is not None and lg.created_at == create_ts:
                    continue
                actor = self._db.get(User, int(lg.actor_user_id)) if lg.actor_user_id is not None else None
                actor_name = actor.full_name or actor.email or f"User #{lg.actor_user_id}" if actor else None
                details: dict[str, Any] = {}
                if isinstance(lg.new_value, dict):
                    details.update(lg.new_value)
                if lg.action == "entity_updated":
                    before = lg.old_value if isinstance(lg.old_value, dict) else {}
                    after = lg.new_value if isinstance(lg.new_value, dict) else {}
                    changes: dict[str, Any] = {}
                    for k in sorted(set(before.keys()) | set(after.keys())):
                        if before.get(k) != after.get(k):
                            changes[k] = {"from": before.get(k), "to": after.get(k)}
                    details = {"changes": changes, "before": before, "after": after}
                events.append(
                    {
                        "type": str(lg.action),
                        "user": actor_name,
                        "timestamp": lg.created_at,
                        "details": details or None,
                    }
                )

        return events

    def _user_rbac_timeline_events(self, entity_id: int) -> list[dict[str, Any]]:
        logs = self._db.scalars(
            select(RbacAuditLog)
            .where(RbacAuditLog.target_type == "user", RbacAuditLog.target_id == entity_id)
            .order_by(RbacAuditLog.created_at.asc())
        ).all()
        events: list[dict[str, Any]] = []
        for lg in logs:
            actor = self._db.get(User, int(lg.actor_user_id)) if lg.actor_user_id is not None else None
            actor_name = actor.full_name or actor.email or f"User #{lg.actor_user_id}" if actor else None
            if lg.action == "create":
                events.append(
                    {
                        "type": "created",
                        "user": actor_name,
                        "timestamp": lg.created_at,
                        "details": lg.new_value if isinstance(lg.new_value, dict) else None,
                    }
                )
                continue
            if lg.action == "update":
                before = lg.old_value if isinstance(lg.old_value, dict) else {}
                after = lg.new_value if isinstance(lg.new_value, dict) else {}
                changes: dict[str, Any] = {}
                for k in sorted(set(before.keys()) | set(after.keys())):
                    if before.get(k) != after.get(k):
                        changes[k] = {"from": before.get(k), "to": after.get(k)}
                events.append(
                    {
                        "type": "entity_updated",
                        "user": actor_name,
                        "timestamp": lg.created_at,
                        "details": {"changes": changes, "before": before, "after": after} if changes else None,
                    }
                )
                continue
            if lg.action == "assign":
                events.append(
                    {
                        "type": "role_assigned",
                        "user": actor_name,
                        "timestamp": lg.created_at,
                        "details": lg.new_value if isinstance(lg.new_value, dict) else None,
                    }
                )
        return events

    def get_entity_timeline(
        self,
        *,
        path_entity_type: str,
        entity_id: int,
        viewer_id: int,
    ) -> list[dict[str, Any]]:
        resolved = resolve_db_entity(self._db, path_entity_type=path_entity_type, entity_id=entity_id)
        if resolved is None:
            raise ApprovalError("Unsupported entity type for timeline.")
        db_entity_type, db_entity_id = resolved

        req = self._db.scalar(
            select(ApprovalRequest)
            .where(
                ApprovalRequest.entity_type == db_entity_type,
                ApprovalRequest.entity_id == db_entity_id,
            )
            .order_by(ApprovalRequest.id.desc())
            .options(
                selectinload(ApprovalRequest.tasks).selectinload(ApprovalTask.step),
                selectinload(ApprovalRequest.tasks).selectinload(ApprovalTask.actions),
            )
        )
        if db_entity_type == "user_creation":
            return self._user_creation_timeline(entity_id=entity_id, req=req, viewer_id=viewer_id)

        if req is None:
            return []

        if not _viewer_can_access_request(self._db, request_id=req.id, viewer_id=viewer_id):
            raise ApprovalError("You cannot view this timeline.")

        events: list[dict[str, Any]] = []

        creator = self._db.get(User, int(req.created_by)) if req.created_by is not None else None
        creator_name = None
        if creator is not None:
            creator_name = creator.full_name or creator.email or f"User #{creator.id}"

        events.append(
            {
                "type": "created",
                "user": creator_name,
                "timestamp": req.created_at,
                "details": {
                    "request_id": req.id,
                    "status": req.status,
                    "preview": safe_payload_preview(req.payload if isinstance(req.payload, dict) else None),
                },
            }
        )

        actions = self._db.scalars(
            select(ApprovalAction)
            .join(ApprovalTask, ApprovalTask.id == ApprovalAction.task_id)
            .where(ApprovalTask.request_id == req.id)
            .options(
                selectinload(ApprovalAction.task).selectinload(ApprovalTask.step),
            )
            .order_by(ApprovalAction.created_at.asc())
        ).all()

        for act in actions:
            task = act.task
            step_order = int(task.step.step_order) if task and task.step else None
            actor = self._db.get(User, int(act.user_id))
            actor_name = actor.full_name or actor.email or f"User #{act.user_id}" if actor else None
            events.append(
                {
                    "type": "approval_step",
                    "step": step_order,
                    "action": act.action,
                    "user": actor_name,
                    "timestamp": act.created_at,
                    "details": {"task_id": task.id if task else None, "comment": act.comment},
                }
            )

        # Rework / resubmit audit trail (captures "what changed" and resubmission moments).
        rework_logs = self._db.scalars(
            select(TaskAuditLog)
            .join(ApprovalTask, ApprovalTask.id == TaskAuditLog.task_id)
            .where(
                ApprovalTask.request_id == req.id,
                ApprovalTask.task_type == "rework",
                TaskAuditLog.action.in_(("created", "rework_started", "entity_updated", "resubmitted")),
            )
            .order_by(TaskAuditLog.created_at.asc())
        ).all()

        for lg in rework_logs:
            actor = self._db.get(User, int(lg.actor_user_id)) if lg.actor_user_id is not None else None
            actor_name = actor.full_name or actor.email or f"User #{lg.actor_user_id}" if actor else None
            details: dict[str, Any] = {}
            if isinstance(lg.new_value, dict):
                details.update(lg.new_value)
            if lg.action == "entity_updated":
                before = lg.old_value if isinstance(lg.old_value, dict) else {}
                after = lg.new_value if isinstance(lg.new_value, dict) else {}
                changes: dict[str, Any] = {}
                for k in sorted(set(before.keys()) | set(after.keys())):
                    if before.get(k) != after.get(k):
                        changes[k] = {"from": before.get(k), "to": after.get(k)}
                details = {"changes": changes, "before": before, "after": after}
            events.append(
                {
                    "type": str(lg.action),
                    "user": actor_name,
                    "timestamp": lg.created_at,
                    "details": details or None,
                }
            )

        if req.status == "pending":
            step_row = self._db.scalar(
                select(ApprovalStep).where(
                    ApprovalStep.workflow_id == req.workflow_id,
                    ApprovalStep.step_order == req.current_step,
                )
            )
            assigned: list[str] = []
            if step_row is not None:
                role = self._db.get(Role, int(step_row.approver_role_id))
                role_name = role.name if role is not None else "Approvers"
                for t in req.tasks:
                    if t.step_id != step_row.id or t.status != "pending":
                        continue
                    if t.assigned_user_id is not None:
                        u = self._db.get(User, int(t.assigned_user_id))
                        assigned.append(u.full_name or u.email or f"User #{t.assigned_user_id}" if u else "?")
                    elif t.assigned_role_id is not None:
                        r = self._db.get(Role, int(t.assigned_role_id))
                        assigned.append(f"Role: {r.name}" if r else "Role")
                events.append(
                    {
                        "type": "approval_step",
                        "step": int(req.current_step),
                        "action": "pending",
                        "assigned_to": assigned,
                        "timestamp": None,
                        "details": {"role": role_name, "required_approvals": int(step_row.required_approvals)},
                    }
                )

        return events
