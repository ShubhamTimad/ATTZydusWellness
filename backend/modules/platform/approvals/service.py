from __future__ import annotations

from datetime import datetime, timedelta, timezone
import secrets
from typing import Any

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.orm import Session, selectinload

from modules.platform.approvals.model import (
    ApprovalAction,
    ApprovalRequest,
    ApprovalStep,
    ApprovalTask,
    ApprovalWorkflow,
    TaskAuditLog,
    TaskComment,
)
from modules.disposals.constants import DISPOSAL_ENTITY_TYPES
from modules.errors import ConflictError, NotFoundError
from modules.transfers.constants import TRANSFER_ENTITY_TYPES
from modules.rbac_association import user_role
from modules.platform.roles.model import Role
from modules.platform.users.model import User
import os

from modules.platform.emails.service import EmailNotificationService
from modules.platform.mfa.policy_hooks import maybe_send_mfa_setup_for_user
from modules.platform.mfa.notify import create_mfa_setup_link
from modules.platform.auth_policy.service import get_global_policy


class ApprovalError(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _step_kind(step: ApprovalStep | None) -> str:
    if step is None:
        return "approve"
    return str(getattr(step, "step_kind", None) or "approve").strip().lower() or "approve"


def _sorted_steps(workflow: ApprovalWorkflow) -> list[ApprovalStep]:
    return sorted(workflow.steps or [], key=lambda s: int(s.step_order))


def assignment_step_for_workflow(workflow: ApprovalWorkflow) -> ApprovalStep | None:
    """First ``assign`` step, else first step (executor pool for physical orders)."""
    steps = _sorted_steps(workflow)
    if not steps:
        return None
    for step in steps:
        if _step_kind(step) == "assign":
            return step
    return steps[0]


def first_approval_step(workflow: ApprovalWorkflow) -> ApprovalStep:
    """First step that is not assignment-only (approval starts here after complete)."""
    steps = _sorted_steps(workflow)
    if not steps:
        raise ConflictError("Active workflow has no steps configured.")
    for step in steps:
        if _step_kind(step) != "assign":
            return step
    raise ConflictError(
        "Physical order workflow has only assignment steps. "
        "Add an Approve step for the role that approves and closes the order."
    )


class ApprovalWorkflowService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def list_workflows(self) -> list[ApprovalWorkflow]:
        stmt = select(ApprovalWorkflow).options(selectinload(ApprovalWorkflow.steps)).order_by(
            ApprovalWorkflow.created_at.desc()
        )
        return list(self._db.scalars(stmt).unique().all())

    def get_workflow(self, workflow_id: int) -> ApprovalWorkflow:
        wf = self._db.scalar(
            select(ApprovalWorkflow)
            .where(ApprovalWorkflow.id == workflow_id)
            .options(selectinload(ApprovalWorkflow.steps))
        )
        if wf is None:
            raise NotFoundError("ApprovalWorkflow", workflow_id)
        return wf

    def create_workflow(
        self,
        *,
        name: str,
        entity_type: str,
        created_by: int | None,
        is_active: bool = False,
    ) -> ApprovalWorkflow:
        if is_active:
            existing = self._db.scalar(
                select(ApprovalWorkflow.id).where(
                    ApprovalWorkflow.entity_type == entity_type,
                    ApprovalWorkflow.is_active.is_(True),
                )
            )
            if existing is not None:
                raise ConflictError("Only one active workflow is allowed per entity_type.")
        wf = ApprovalWorkflow(
            name=name.strip(),
            entity_type=entity_type.strip(),
            is_active=bool(is_active),
            created_by=created_by,
        )
        self._db.add(wf)
        self._db.commit()
        return self.get_workflow(wf.id)

    def add_step(
        self,
        *,
        workflow_id: int,
        step_order: int,
        approver_role_id: int,
        required_approvals: int,
        step_kind: str = "approve",
    ) -> ApprovalStep:
        wf = self.get_workflow(workflow_id)
        if wf.is_active:
            raise ConflictError("Deactivate the workflow before adding or changing levels.")
        role = self._db.get(Role, approver_role_id)
        if role is None:
            raise NotFoundError("Role", approver_role_id)
        if step_order < 1:
            raise ConflictError("step_order must be >= 1.")
        if required_approvals < 1:
            raise ConflictError("required_approvals must be >= 1.")
        kind = (step_kind or "approve").strip().lower()
        if kind not in ("approve", "receive", "confirm", "close", "assign"):
            raise ConflictError(
                "step_kind must be one of: approve, receive, confirm, close, assign."
            )
        existing_orders = [s.step_order for s in wf.steps]
        if step_order in existing_orders:
            raise ConflictError("That level number already exists.")
        step = ApprovalStep(
            workflow_id=workflow_id,
            step_order=step_order,
            approver_role_id=approver_role_id,
            required_approvals=required_approvals,
            step_kind=kind,
        )
        self._db.add(step)
        self._db.commit()
        return step

    def update_workflow(
        self,
        workflow_id: int,
        *,
        name: str | None = None,
        entity_type: str | None = None,
    ) -> ApprovalWorkflow:
        wf = self.get_workflow(workflow_id)
        if wf.is_active and entity_type is not None:
            raise ConflictError("Deactivate the workflow before changing entity type.")
        if name is not None:
            wf.name = name.strip()
        if entity_type is not None:
            wf.entity_type = entity_type.strip()
        self._db.commit()
        return self.get_workflow(workflow_id)

    def update_step(
        self,
        step_id: int,
        *,
        approver_role_id: int | None = None,
        required_approvals: int | None = None,
        step_kind: str | None = None,
    ) -> ApprovalStep:
        step = self._db.get(ApprovalStep, step_id)
        if step is None:
            raise NotFoundError("ApprovalStep", step_id)
        wf = self.get_workflow(int(step.workflow_id))
        if wf.is_active:
            raise ConflictError("Deactivate the workflow before editing levels.")
        if approver_role_id is not None:
            role = self._db.get(Role, approver_role_id)
            if role is None:
                raise NotFoundError("Role", approver_role_id)
            step.approver_role_id = approver_role_id
        if required_approvals is not None:
            if required_approvals < 1:
                raise ConflictError("required_approvals must be >= 1.")
            step.required_approvals = required_approvals
        if step_kind is not None:
            kind = step_kind.strip().lower()
            if kind not in ("approve", "receive", "confirm", "close", "assign"):
                raise ConflictError(
                    "step_kind must be one of: approve, receive, confirm, close, assign."
                )
            step.step_kind = kind
        self._db.commit()
        self._db.refresh(step)
        return step

    def delete_step(self, step_id: int) -> None:
        step = self._db.get(ApprovalStep, step_id)
        if step is None:
            raise NotFoundError("ApprovalStep", step_id)
        wf = self.get_workflow(int(step.workflow_id))
        if wf.is_active:
            raise ConflictError("Deactivate the workflow before deleting levels.")
        self._db.delete(step)
        self._db.commit()

    def deactivate_workflow(self, workflow_id: int) -> ApprovalWorkflow:
        wf = self.get_workflow(workflow_id)
        wf.is_active = False
        self._db.commit()
        return self.get_workflow(workflow_id)

    def delete_workflow(self, workflow_id: int) -> None:
        """Delete a draft/inactive workflow. Blocked if still active or used by requests."""
        from modules.platform.approvals.model import ApprovalRequest

        wf = self.get_workflow(workflow_id)
        if wf.is_active:
            raise ConflictError("Deactivate the workflow before deleting it.")
        used = self._db.scalar(
            select(ApprovalRequest.id).where(ApprovalRequest.workflow_id == int(workflow_id)).limit(1)
        )
        if used is not None:
            raise ConflictError(
                "This workflow has approval history and cannot be deleted. Keep it as a draft."
            )
        # Clear mappings in-session (FK is NOT NULL; ORM must not SET NULL).
        wf.workflow_mappings.clear()
        self._db.delete(wf)
        self._db.commit()

    def activate_workflow(self, workflow_id: int, *, actor_user_id: int | None) -> ApprovalWorkflow:
        wf = self.get_workflow(workflow_id)
        if wf.is_active:
            return wf
        if not wf.steps:
            raise ConflictError("Cannot activate a workflow with no steps.")
        self._db.execute(
            ApprovalWorkflow.__table__.update()
            .where(
                ApprovalWorkflow.entity_type == wf.entity_type,
                ApprovalWorkflow.id != wf.id,
            )
            .values(is_active=False)
        )
        wf.is_active = True
        self._db.commit()
        return self.get_workflow(wf.id)

    def get_active_workflow_for_entity(self, entity_type: str) -> ApprovalWorkflow | None:
        return self._db.scalar(
            select(ApprovalWorkflow)
            .where(
                ApprovalWorkflow.entity_type == entity_type,
                ApprovalWorkflow.is_active.is_(True),
            )
            .options(selectinload(ApprovalWorkflow.steps))
        )


class PasswordSetupTokenService:
    """
    Backward compatibility token generator.

    The email engine now owns notifications; this helper remains for older scripts/tests.
    """

    @staticmethod
    def generate_token() -> str:
        return secrets.token_urlsafe(32)

    @staticmethod
    def expires_at(*, minutes: int = 60 * 24) -> datetime:
        return _now_utc() + timedelta(minutes=minutes)


class ApprovalEngineService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def create_request_for_entity(
        self,
        *,
        workflow: ApprovalWorkflow,
        entity_type: str,
        entity_id: int,
        payload: dict,
        created_by: int | None,
        assigned_user_id: int | None = None,
    ) -> ApprovalRequest:
        if not workflow.steps:
            raise ConflictError("Active workflow has no steps configured.")
        first = first_approval_step(workflow)
        req = ApprovalRequest(
            workflow_id=workflow.id,
            entity_type=entity_type,
            entity_id=entity_id,
            status="pending",
            current_step=first.step_order,
            payload=payload,
            created_by=created_by,
        )
        self._db.add(req)
        self._db.flush()
        self._create_tasks_for_step(req, first, assigned_user_id=assigned_user_id)
        return req

    def _users_for_role(self, role_id: int) -> list[User]:
        stmt = (
            select(User)
            .select_from(user_role)
            .join(User, User.id == user_role.c.user_id)
            .where(user_role.c.role_id == role_id, User.is_active.is_(True))
            .order_by(User.id.asc())
        )
        return list(self._db.scalars(stmt).all())

    def _role_ids_for_user(self, user_id: int) -> set[int]:
        stmt = select(user_role.c.role_id).where(user_role.c.user_id == user_id)
        return {int(rid) for rid in self._db.execute(stmt).scalars().all()}

    def _create_tasks_for_step(
        self,
        req: ApprovalRequest,
        step: ApprovalStep,
        *,
        assigned_user_id: int | None = None,
    ) -> None:
        # Role task (default) or explicit user handoff when assigned_user_id is set.
        role = self._db.get(Role, step.approver_role_id)
        if role is None:
            raise NotFoundError("Role", step.approver_role_id)
        role_users = self._users_for_role(step.approver_role_id)
        if not role_users:
            raise ConflictError("No active approvers found for the configured approver role.")

        assignee_user_id: int | None = None
        assignee_role_id: int | None = int(step.approver_role_id)
        if assigned_user_id is not None:
            uid = int(assigned_user_id)
            if not any(int(u.id) == uid for u in role_users):
                raise ConflictError(
                    f"Selected user is not an active member of role {role.name!r}."
                )
            assignee_user_id = uid
            assignee_role_id = None

        from modules.assets.lifecycle import approval_task_title

        payload = dict(req.payload) if isinstance(req.payload, dict) else {}
        task = ApprovalTask(
            request_id=req.id,
            step_id=step.id,
            assigned_user_id=assignee_user_id,
            assigned_role_id=assignee_role_id,
            task_type="approval",
            title=approval_task_title(str(req.entity_type), payload),
            priority="medium",
            status="pending",
            acted_at=None,
            entity_type=req.entity_type,
            entity_id=req.entity_id,
            created_by=req.created_by,
            form_data=dict(req.payload) if req.payload is not None else None,
        )
        self._db.add(task)
        self._db.flush()
        self._db.add(
            TaskAuditLog(
                task_id=int(task.id),
                action="created",
                actor_user_id=req.created_by,
                new_value={
                    "request_id": req.id,
                    "entity_type": req.entity_type,
                    "entity_id": req.entity_id,
                    "assigned_user_id": assignee_user_id,
                },
            )
        )
        self._notify_approvers_for_task(task=task, req=req)

    def _notify_approvers_for_task(self, *, task: ApprovalTask, req: ApprovalRequest) -> None:
        entity_name = self._entity_name_for_request(req)
        recipients: list[User] = []
        if task.assigned_user_id is not None:
            u = self._db.get(User, int(task.assigned_user_id))
            if u is not None and u.is_active:
                recipients = [u]
        elif task.assigned_role_id is not None:
            recipients = self._users_for_role(int(task.assigned_role_id))
        for user in recipients:
            if not user.email:
                continue
            try:
                EmailNotificationService(self._db).trigger_event(
                    event_code="TASK_ASSIGNED",
                    payload={
                        "user_name": user.full_name,
                        "email": user.email,
                        "task_name": task.title or "Approval task",
                        "entity_name": entity_name,
                        "task_link": self._task_link(int(task.id)),
                    },
                )
            except Exception:
                pass

    def list_my_tasks(self, *, user_id: int) -> list[ApprovalTask]:
        role_ids = self._role_ids_for_user(user_id)
        stmt = select(ApprovalTask).where(
            or_(
                ApprovalTask.assigned_user_id == user_id,
                and_(ApprovalTask.assigned_role_id.is_not(None), ApprovalTask.assigned_role_id.in_(role_ids)),
            )
        ).order_by(ApprovalTask.id.desc())
        return list(self._db.scalars(stmt).all())

    def get_request(self, request_id: int) -> ApprovalRequest:
        req = self._db.scalar(
            select(ApprovalRequest)
            .where(ApprovalRequest.id == request_id)
            .options(selectinload(ApprovalRequest.tasks))
        )
        if req is None:
            raise NotFoundError("ApprovalRequest", request_id)
        return req

    def get_task(self, task_id: int) -> ApprovalTask:
        task = self._db.scalar(
            select(ApprovalTask)
            .where(ApprovalTask.id == task_id)
            .options(selectinload(ApprovalTask.step), selectinload(ApprovalTask.request))
        )
        if task is None:
            raise NotFoundError("ApprovalTask", task_id)
        return task

    def resubmit_rejected_request(
        self,
        *,
        request_id: int,
        actor_user_id: int,
        assigned_user_id: int | None = None,
    ) -> tuple[ApprovalRequest, int]:
        """
        After a reject, the submitter may edit the underlying entity and send the same approval
        request back through the workflow. Old tasks for this request are removed; step 1 restarts
        with a fresh approver task (same request id, new task id).
        """
        req = self._db.scalar(
            select(ApprovalRequest)
            .where(ApprovalRequest.id == request_id)
            .options(selectinload(ApprovalRequest.workflow).selectinload(ApprovalWorkflow.steps))
        )
        if req is None:
            raise NotFoundError("ApprovalRequest", request_id)
        if str(req.status) not in ("rejected", "in_rework"):
            raise ApprovalError("Only a rejected request can be resubmitted for approval.")

        actor = self._db.get(User, actor_user_id)
        if actor is None:
            raise NotFoundError("User", actor_user_id)
        # Assets: any user with submit permission may resubmit after edits (router enforces asset.create).
        # Transfers: original submitter, destination custodian (after CF return), or superuser.
        # Other entity types: only the original submitter (or superuser).
        if str(req.entity_type) not in ("asset_creation", "asset_import"):
            if req.created_by != actor_user_id and not bool(actor.is_superuser):
                allowed = False
                if str(req.entity_type) in TRANSFER_ENTITY_TYPES:
                    from modules.transfers.model import AssetTransferOrder
                    from modules.transfers.service import _is_destination_actor

                    xfer = self._db.get(AssetTransferOrder, int(req.entity_id))
                    allowed = xfer is not None and _is_destination_actor(xfer, actor_user_id)
                if not allowed:
                    raise ApprovalError(
                        "Only the person who submitted this request can resubmit it."
                    )

        entity_type = str(req.entity_type)
        if entity_type == "user_creation":
            user = self._db.scalar(
                select(User)
                .where(User.id == int(req.entity_id))
                .options(selectinload(User.roles), selectinload(User.org_units))
            )
            if user is None:
                raise NotFoundError("User", int(req.entity_id))

            prev_temp_password: str | None = None
            if isinstance(req.payload, dict):
                raw_prev = req.payload.get("temp_password")
                if isinstance(raw_prev, str) and raw_prev.strip():
                    prev_temp_password = raw_prev

            req.payload = self._build_user_creation_payload(user)
            if prev_temp_password and isinstance(req.payload, dict) and not req.payload.get("temp_password"):
                req.payload["temp_password"] = prev_temp_password
        elif entity_type in ("asset_creation", "asset_import"):
            from modules.assets.lifecycle import refresh_asset_request_payload, set_asset_pending_approval
            from modules.assets.model import AssetMaster

            asset = self._db.get(AssetMaster, int(req.entity_id))
            if asset is None:
                raise NotFoundError("AssetMaster", int(req.entity_id))
            action_code = "asset.import" if entity_type == "asset_import" else "asset.create"
            extra: dict[str, Any] = {}
            if entity_type == "asset_import" and isinstance(req.payload, dict):
                batch_id = req.payload.get("batch_id")
                if batch_id is not None:
                    extra["batch_id"] = batch_id
            req.payload = refresh_asset_request_payload(asset, action_code=action_code)
            if extra:
                req.payload.update(extra)
            set_asset_pending_approval(asset)
        elif entity_type in ("physical_order_creation", "physical_order_closure"):
            from modules.orders.constants import (
                ORDER_STATUS_COMPLETED,
                ORDER_STATUS_PENDING_APPROVAL,
            )
            from modules.orders.model import PhysicalOrder
            from modules.orders.service import PhysicalOrderService

            order = self._db.get(PhysicalOrder, int(req.entity_id))
            if order is None:
                raise NotFoundError("PhysicalOrder", int(req.entity_id))
            svc = PhysicalOrderService(self._db)
            req.payload = svc._order_payload(
                svc._load_order(int(order.id)),
                action_code="order.create"
                if entity_type == "physical_order_creation"
                else "order.complete",
            )
            if entity_type == "physical_order_creation":
                order.status = ORDER_STATUS_PENDING_APPROVAL
            else:
                order.status = ORDER_STATUS_COMPLETED
        elif entity_type in ("capitalization_request", "capitalization_request_engineering"):
            from modules.capex.constants import STATUS_PENDING_APPROVAL
            from modules.capex.model import CapitalizationForm
            from modules.capex.service import CapexFormService, action_and_entity_for_form, CAPEX_PRIOR_RUNS_KEY

            form = self._db.get(CapitalizationForm, int(req.entity_id))
            if form is None:
                raise NotFoundError("CapitalizationForm", int(req.entity_id))
            svc = CapexFormService(self._db)
            action_code, _ = action_and_entity_for_form(
                requires_engineering=bool(form.requires_engineering)
            )
            prior = None
            if isinstance(req.payload, dict):
                prior = req.payload.get(CAPEX_PRIOR_RUNS_KEY)
            req.payload = svc._form_payload(form, action_code=action_code)
            if prior:
                req.payload[CAPEX_PRIOR_RUNS_KEY] = prior
            form.status = STATUS_PENDING_APPROVAL
            form.rejection_comment = None
        elif entity_type in DISPOSAL_ENTITY_TYPES:
            from modules.disposals.constants import (
                STATUS_PENDING_APPROVAL as DISPOSAL_PENDING_APPROVAL,
            )
            from modules.disposals.model import AssetDisposalOrder
            from modules.disposals.service import DisposalOrderService, action_and_entity_for_order

            order = self._db.get(AssetDisposalOrder, int(req.entity_id))
            if order is None:
                raise NotFoundError("AssetDisposalOrder", int(req.entity_id))
            svc = DisposalOrderService(self._db)
            action_code, _entity = action_and_entity_for_order(
                requires_engineering=bool(order.requires_engineering)
            )
            req.payload = svc._order_payload(
                svc._load_order(int(order.id)), action_code=action_code
            )
            order.status = DISPOSAL_PENDING_APPROVAL
            order.rejection_comment = None
        elif entity_type in TRANSFER_ENTITY_TYPES:
            from modules.transfers.constants import (
                STATUS_PENDING_APPROVAL as TRANSFER_PENDING_APPROVAL,
            )
            from modules.transfers.model import AssetTransferOrder
            from modules.transfers.service import TransferOrderService, action_and_entity_for_order

            order = self._db.get(AssetTransferOrder, int(req.entity_id))
            if order is None:
                raise NotFoundError("AssetTransferOrder", int(req.entity_id))
            svc = TransferOrderService(self._db)
            action_code, _entity = action_and_entity_for_order()
            req.payload = svc._order_payload(
                svc._load_order(int(order.id)), action_code=action_code
            )
            order.status = TRANSFER_PENDING_APPROVAL
            order.rejection_reason = None
        else:
            raise ApprovalError(
                "Resubmit is only implemented for user creation, asset, physical order, "
                "capitalization, disposal, and transfer requests."
            )

        now = _now_utc()
        # Close any existing open rework tasks (and log resubmitted on them).
        open_rework = self._db.scalars(
            select(ApprovalTask).where(
                ApprovalTask.request_id == req.id,
                ApprovalTask.task_type == "rework",
                ApprovalTask.status.in_(("open", "pending")),
            )
        ).all()
        for t in open_rework:
            self._db.add(
                TaskAuditLog(
                    task_id=int(t.id),
                    action="resubmitted",
                    actor_user_id=actor_user_id,
                    new_value={"request_id": int(req.id)},
                )
            )
            t.status = "closed"
            t.closed_at = now

        # Close any leftover pending approval tasks from previous runs.
        pending_approvals = self._db.scalars(
            select(ApprovalTask).where(
                ApprovalTask.request_id == req.id,
                ApprovalTask.task_type == "approval",
                ApprovalTask.status == "pending",
            )
        ).all()
        for t in pending_approvals:
            t.status = "closed"
            t.closed_at = now

        self._db.flush()

        wf = req.workflow
        if wf is None or not wf.steps:
            raise ApprovalError("Workflow is missing for this request.")
        first = first_approval_step(wf)
        req.status = "pending"
        req.current_step = int(first.step_order)
        req.last_resubmitted_at = now
        self._create_tasks_for_step(req, first, assigned_user_id=assigned_user_id)
        self._db.flush()
        new_task = self._db.scalar(
            select(ApprovalTask)
            .where(ApprovalTask.request_id == req.id)
            .order_by(ApprovalTask.id.desc())
            .limit(1)
        )
        if new_task is None:
            raise ApprovalError("Could not create a new approval task after resubmit.")
        self._db.add(
            TaskAuditLog(
                task_id=int(new_task.id),
                action="resubmitted",
                actor_user_id=actor_user_id,
                new_value={"request_id": int(req.id)},
            )
        )
        # Notify creator + peers (same role) that the request was resubmitted.
        try:
            self._notify_creator_and_peers(
                creator_user_id=int(req.created_by) if req.created_by is not None else actor_user_id,
                event_code="TASK_RESUBMITTED",
                payload={
                    "entity_name": self._entity_name_for_request(req),
                    "task_link": self._task_link(int(new_task.id)),
                },
            )
        except Exception:
            # Email notifications must not block resubmission.
            pass
        self._db.commit()
        reloaded = self.get_request(int(req.id))
        return reloaded, int(new_task.id)

    @staticmethod
    def _task_link(task_id: int) -> str:
        base = (os.environ.get("FRONTEND_APP_URL") or os.environ.get("FRONTEND_ORIGIN") or "http://localhost:5173").rstrip("/")
        return f"{base}/dashboard/tasks/{int(task_id)}"

    @staticmethod
    def _entity_name_for_request(req: ApprovalRequest) -> str:
        from modules.assets.lifecycle import entity_display_name

        payload = req.payload if isinstance(req.payload, dict) else {}
        return entity_display_name(str(req.entity_type), payload, int(req.entity_id))

    def _notify_creator_and_peers(self, *, creator_user_id: int, event_code: str, payload: dict[str, Any]) -> None:
        """
        Send the same email to:
        - creator (mandatory)
        - all active users that share at least one RBAC role with creator
        """
        creator = self._db.get(User, int(creator_user_id))
        if creator is None:
            return

        # Find creator role ids.
        role_ids = {
            int(rid)
            for rid in self._db.execute(
                select(user_role.c.role_id).where(user_role.c.user_id == int(creator_user_id))
            ).scalars().all()
        }
        user_ids: set[int] = {int(creator_user_id)}
        if role_ids:
            peer_ids = self._db.execute(
                select(user_role.c.user_id).where(user_role.c.role_id.in_(role_ids))
            ).scalars().all()
            user_ids |= {int(uid) for uid in peer_ids if uid is not None}

        # Load active users with email.
        rows = self._db.scalars(
            select(User).where(User.id.in_(user_ids), User.is_active.is_(True))
        ).all()
        for u in rows:
            if not u.email:
                continue
            EmailNotificationService(self._db).trigger_event(
                event_code=event_code,
                payload={
                    "user_name": u.full_name,
                    "email": u.email,
                    **payload,
                },
            )

    @staticmethod
    def _build_user_creation_payload(user: User) -> dict[str, Any]:
        role = user.roles[0] if user.roles else None
        org = user.org_units[0] if user.org_units else None
        return {
            "action_code": "users.create",
            "full_name": user.full_name,
            "phone": user.phone,
            "email": user.email,
            "role_id": int(role.id) if role is not None else None,
            "org_unit_id": int(org.id) if org is not None else None,
        }

    def act_on_task(
        self,
        *,
        task_id: int,
        actor_user_id: int,
        action: str,
        comment: str | None,
        next_assigned_user_id: int | None = None,
        to_functional_location: str | None = None,
        to_actual_location: str | None = None,
        to_cost_center_id: int | None = None,
    ) -> ApprovalRequest:
        task = self.get_task(task_id)
        role_ids = self._role_ids_for_user(actor_user_id)
        is_user_task = task.assigned_user_id is not None
        is_role_task = task.assigned_role_id is not None
        if is_user_task:
            if task.assigned_user_id != actor_user_id:
                raise ApprovalError("This task is not assigned to you.")
            if task.status != "pending":
                raise ApprovalError("This task has already been acted on.")
        elif is_role_task:
            if int(task.assigned_role_id) not in role_ids:
                raise ApprovalError("This task is not assigned to your role.")
            # For role/group tasks we allow multiple actors until the step threshold is met,
            # but we prevent duplicate actions from the same user.
            existing = self._db.scalar(
                select(ApprovalAction.id).where(
                    ApprovalAction.task_id == task.id,
                    ApprovalAction.user_id == actor_user_id,
                )
            )
            if existing is not None:
                raise ApprovalError("You have already acted on this task.")
            if task.status != "pending":
                raise ApprovalError("This task has already been completed.")
        else:
            raise ApprovalError("Task assignment is invalid (no assignee).")
        req = self.get_request(task.request_id)
        if req.status != "pending":
            raise ApprovalError("This approval request is no longer pending.")

        act = action.strip().lower()
        if act not in ("approve", "reject"):
            raise ConflictError("action must be one of: approve, reject.")
        if act == "reject" and not (comment or "").strip():
            raise ConflictError("Reason is required when rejecting.")

        # Persist the action record first; then update task/request status depending on task type.
        self._db.add(
            ApprovalAction(
                task_id=task.id,
                user_id=actor_user_id,
                action=act,
                comment=comment,
            )
        )
        # Unified task audit/comments (additive; does not affect approval engine logic).
        self._db.add(
            TaskAuditLog(
                task_id=int(task.id),
                action="rejected" if act == "reject" else "approved",
                actor_user_id=actor_user_id,
                new_value={"action": act},
            )
        )
        if comment:
            self._db.add(TaskComment(task_id=int(task.id), user_id=actor_user_id, comment=comment))
            self._db.add(
                TaskAuditLog(
                    task_id=int(task.id),
                    action="commented",
                    actor_user_id=actor_user_id,
                    new_value={"comment": comment},
                )
            )
        self._db.flush()

        if act == "reject":
            # Transfer: reject on approve (→ creator) or confirm (→ receiver redo receive).
            # CapEx close stays non-rejectable. Disposal close reject returns to receiver.
            transfer_step_kind = (
                _step_kind(task.step) if str(req.entity_type) in TRANSFER_ENTITY_TYPES else None
            )
            if transfer_step_kind is not None and transfer_step_kind not in ("approve", "confirm"):
                raise ApprovalError(
                    "Reject is only available on approval or confirm steps for transfers."
                )
            capex_step_kind = (
                _step_kind(task.step)
                if str(req.entity_type)
                in ("capitalization_request", "capitalization_request_engineering")
                else None
            )
            if capex_step_kind == "close":
                raise ApprovalError("Reject is not available on the Close step.")
            now = _now_utc()
            task.status = "rejected"
            task.acted_at = now
            disposal_return_to: str | None = None
            transfer_return_to: str | None = None

            if str(req.entity_type) in ("asset_creation", "asset_import"):
                from modules.assets.service import reject_asset_after_approval

                reject_asset_after_approval(
                    self._db,
                    asset_id=int(req.entity_id),
                    approver_user_id=actor_user_id,
                    comment=comment,
                )
            elif str(req.entity_type) in ("physical_order_creation", "physical_order_closure"):
                from modules.orders.service import reject_order_approval

                reject_order_approval(
                    self._db,
                    order_id=int(req.entity_id),
                    entity_type=str(req.entity_type),
                    approver_user_id=actor_user_id,
                    comment=comment,
                )
            elif str(req.entity_type) in ("capitalization_request", "capitalization_request_engineering"):
                from modules.capex.service import reject_capex_approval

                step_role = None
                if task.step is not None:
                    role = self._db.get(Role, int(task.step.approver_role_id))
                    step_role = role.name if role is not None else None
                reject_capex_approval(
                    self._db,
                    form_id=int(req.entity_id),
                    approver_user_id=actor_user_id,
                    comment=comment,
                    step_role_name=step_role,
                )
            elif str(req.entity_type) in DISPOSAL_ENTITY_TYPES:
                from modules.disposals.service import reject_disposal_approval

                step_role = None
                if task.step is not None:
                    role = self._db.get(Role, int(task.step.approver_role_id))
                    step_role = role.name if role is not None else None
                disposal_return_to = reject_disposal_approval(
                    self._db,
                    order_id=int(req.entity_id),
                    approver_user_id=actor_user_id,
                    comment=comment,
                    step_role_name=step_role,
                )
            if str(req.entity_type) in TRANSFER_ENTITY_TYPES:
                from modules.transfers.service import reject_transfer_approval

                step_role = None
                if task.step is not None:
                    role = self._db.get(Role, int(task.step.approver_role_id))
                    step_role = role.name if role is not None else None
                transfer_return_to = reject_transfer_approval(
                    self._db,
                    order_id=int(req.entity_id),
                    approver_user_id=actor_user_id,
                    comment=comment,
                    step_role_name=step_role,
                )

            # Close all still-pending approval tasks for this request (avoid multiple active items).
            pending = self._db.scalars(
                select(ApprovalTask).where(
                    ApprovalTask.request_id == req.id,
                    ApprovalTask.status == "pending",
                    ApprovalTask.id != task.id,
                )
            ).all()
            for t in pending:
                t.status = "closed"
                t.closed_at = now

            # Physical / disposal-to-creator / transfer-to-creator: terminal rejected (resume to draft).
            # Do not open a creator rework task / leave the approval request in_rework.
            if str(req.entity_type) in (
                "physical_order_creation",
                "physical_order_closure",
            ) or transfer_return_to == "creator" or disposal_return_to == "creator":
                req.status = "rejected"
                self._db.commit()
                return self.get_request(req.id)

            # Post-receive transfer/disposal reject: reopen receive for the receiver.
            if transfer_return_to == "receiver" or disposal_return_to == "receiver":
                from modules.disposals.model import AssetDisposalOrder
                from modules.transfers.model import AssetTransferOrder

                wf = self._db.scalar(
                    select(ApprovalWorkflow)
                    .where(ApprovalWorkflow.id == int(req.workflow_id))
                    .options(selectinload(ApprovalWorkflow.steps))
                )
                if wf is None:
                    raise ApprovalError("Approval workflow not found.")
                receive_step = next(
                    (s for s in _sorted_steps(wf) if _step_kind(s) == "receive"),
                    None,
                )
                if receive_step is None:
                    # Approve-only disposal workflows use REST receive; order is already
                    # pending_receipt with the receiver assigned.
                    if disposal_return_to != "receiver":
                        raise ApprovalError("Workflow has no receive step to reopen.")
                    req.status = "pending"
                    self._db.commit()
                    return self.get_request(req.id)
                receiver_id: int | None = None
                if transfer_return_to == "receiver":
                    order = self._db.get(AssetTransferOrder, int(req.entity_id))
                    receiver_id = (
                        int(order.to_asset_custodian_id)
                        if order is not None and order.to_asset_custodian_id is not None
                        else None
                    )
                    if receiver_id is None:
                        raise ApprovalError(
                            "Destination custodian is missing; cannot return this transfer to the receiver."
                        )
                else:
                    order = self._db.get(AssetDisposalOrder, int(req.entity_id))
                    receiver_id = (
                        int(order.receiver_user_id)
                        if order is not None and order.receiver_user_id is not None
                        else None
                    )
                    if receiver_id is None:
                        raise ApprovalError(
                            "Receiver is missing; cannot return this disposal for re-receive."
                        )
                req.status = "pending"
                req.current_step = int(receive_step.step_order)
                self._create_tasks_for_step(req, receive_step, assigned_user_id=receiver_id)
                self._db.commit()
                return self.get_request(req.id)

            # Move request into rework state (do not keep it "pending").
            req.status = "in_rework"

            # Ensure only one open rework task exists.
            existing_rework = self._db.scalar(
                select(ApprovalTask.id).where(
                    ApprovalTask.request_id == req.id,
                    ApprovalTask.task_type == "rework",
                    ApprovalTask.status.in_(("open", "pending")),
                )
            )
            if existing_rework is None and req.created_by is not None:
                from modules.assets.lifecycle import approval_task_title

                payload = dict(req.payload) if isinstance(req.payload, dict) else {}
                rework_title = (
                    f"Rework: {approval_task_title(str(req.entity_type), payload)}"
                    if str(req.entity_type)
                    in (
                        "asset_creation",
                        "asset_import",
                        "physical_order_creation",
                        "physical_order_closure",
                        "capitalization_request",
                        "capitalization_request_engineering",
                        *DISPOSAL_ENTITY_TYPES,
                        *TRANSFER_ENTITY_TYPES,
                    )
                    else "Rework required"
                )
                rework_task = ApprovalTask(
                    task_type="rework",
                    title=rework_title,
                    description=comment,
                    priority="medium",
                    entity_type=req.entity_type,
                    entity_id=req.entity_id,
                    created_by=req.created_by,
                    assigned_to_user_id=req.created_by,
                    assigned_user_id=req.created_by,
                    assigned_role_id=None,
                    status="open",
                    request_id=req.id,
                    step_id=None,
                )
                self._db.add(rework_task)
                self._db.flush()
                self._db.add(
                    TaskAuditLog(
                        task_id=int(rework_task.id),
                        action="created",
                        actor_user_id=req.created_by,
                        new_value={
                            "request_id": req.id,
                            "entity_type": req.entity_type,
                            "entity_id": req.entity_id,
                            "task_type": "rework",
                        },
                    )
                )
                self._db.add(
                    TaskAuditLog(
                        task_id=int(rework_task.id),
                        action="rework_started",
                        actor_user_id=actor_user_id,
                        new_value={"request_id": int(req.id)},
                    )
                )
                # Email creator + same-role peers.
                try:
                    self._notify_creator_and_peers(
                        creator_user_id=int(req.created_by),
                        event_code="TASK_REWORK_REQUIRED",
                        payload={
                            "entity_name": self._entity_name_for_request(req),
                            "rejection_reason": comment or "Rejected",
                            "task_link": self._task_link(int(rework_task.id)),
                        },
                    )
                except Exception:
                    pass

            self._db.commit()
            return self.get_request(req.id)

        # Approved: check whether the step has enough approvals.
        step = task.step
        assert step is not None
        if is_user_task:
            task.status = "approved"
            task.acted_at = _now_utc()
            # Session may have autoflush=False; count must see this status update.
            self._db.flush()
            approved_count = int(
                self._db.scalar(
                    select(func.count())
                    .select_from(ApprovalTask)
                    .where(
                        ApprovalTask.request_id == req.id,
                        ApprovalTask.step_id == step.id,
                        ApprovalTask.status == "approved",
                    )
                )
                or 0
            )
        else:
            # Role/group task: approvals are counted by distinct approval_actions on this task.
            self._db.flush()
            approved_count = int(
                self._db.scalar(
                    select(func.count(func.distinct(ApprovalAction.user_id)))
                    .select_from(ApprovalAction)
                    .where(
                        ApprovalAction.task_id == task.id,
                        ApprovalAction.action == "approve",
                    )
                )
                or 0
            )
            if approved_count >= int(step.required_approvals):
                task.status = "approved"
                task.acted_at = _now_utc()
        if approved_count < int(step.required_approvals):
            self._db.commit()
            return self.get_request(req.id)

        wf = self._db.scalar(
            select(ApprovalWorkflow)
            .where(ApprovalWorkflow.id == req.workflow_id)
            .options(selectinload(ApprovalWorkflow.steps))
        )
        if wf is None:
            raise ApprovalError("Workflow not found for request.")

        steps_sorted = sorted(wf.steps, key=lambda s: s.step_order)
        idx = next((i for i, s in enumerate(steps_sorted) if s.id == step.id), None)
        if idx is None:
            raise ApprovalError("Step not found in workflow.")

        is_disposal = str(req.entity_type) in DISPOSAL_ENTITY_TYPES
        is_transfer = str(req.entity_type) in TRANSFER_ENTITY_TYPES
        kind = _step_kind(step)

        if is_transfer:
            return self._advance_transfer_after_step(
                req,
                step=step,
                steps_sorted=steps_sorted,
                idx=idx,
                actor_user_id=actor_user_id,
                comment=comment,
                next_assigned_user_id=next_assigned_user_id,
                to_functional_location=to_functional_location,
                to_actual_location=to_actual_location,
                to_cost_center_id=to_cost_center_id,
                kind=kind,
            )

        has_disposal_ops = is_disposal and any(
            _step_kind(s) in ("receive", "confirm", "close") for s in steps_sorted
        )
        if has_disposal_ops:
            return self._advance_disposal_after_step(
                req,
                step=step,
                steps_sorted=steps_sorted,
                idx=idx,
                actor_user_id=actor_user_id,
                comment=comment,
                next_assigned_user_id=next_assigned_user_id,
                to_functional_location=to_functional_location,
                to_actual_location=to_actual_location,
                to_cost_center_id=to_cost_center_id,
                kind=kind,
            )

        next_approval = next(
            (s for s in steps_sorted[idx + 1 :] if _step_kind(s) != "assign"),
            None,
        )
        if next_approval is None:
            # Final approval. Disposal orders hand off to the receiver, so the
            # final approver (Store Person) must also name the receiving user.
            if is_disposal and next_assigned_user_id is None:
                raise ApprovalError(
                    "Select the receiver before giving final approval."
                )
            req.status = "approved"
            self._finalize_request(
                req,
                comment=comment,
                step=step,
                next_assigned_user_id=next_assigned_user_id,
            )
            self._db.commit()
            return self.get_request(req.id)

        # Move to next step.
        next_step = next_approval
        req.current_step = next_step.step_order
        is_capex = str(req.entity_type) in (
            "capitalization_request",
            "capitalization_request_engineering",
        )
        needs_named_next_approver = is_disposal or is_capex
        if needs_named_next_approver:
            cur_role = self._db.get(Role, int(step.approver_role_id))
            nxt_role = self._db.get(Role, int(next_step.approver_role_id))
            # CapEx: same role on next step → actor continues (no picker).
            if (
                is_capex
                and next_assigned_user_id is None
                and cur_role is not None
                and nxt_role is not None
                and int(cur_role.id) == int(nxt_role.id)
            ):
                next_assigned_user_id = actor_user_id
            if next_assigned_user_id is None:
                raise ApprovalError(
                    "Select the next approver before approving this step."
                )
            self._create_tasks_for_step(
                req, next_step, assigned_user_id=int(next_assigned_user_id)
            )
            if is_disposal:
                from modules.disposals.service import log_disposal_step_approved

                log_disposal_step_approved(
                    self._db,
                    order_id=int(req.entity_id),
                    actor_user_id=actor_user_id,
                    step_role_name=cur_role.name if cur_role is not None else None,
                    next_assignee_user_id=int(next_assigned_user_id),
                    next_role_name=nxt_role.name if nxt_role is not None else None,
                    comment=comment,
                )
            else:
                from modules.capex.service import log_capex_step_approved

                log_capex_step_approved(
                    self._db,
                    form_id=int(req.entity_id),
                    actor_user_id=actor_user_id,
                    step_role_name=cur_role.name if cur_role is not None else None,
                    next_assignee_user_id=int(next_assigned_user_id),
                    next_role_name=nxt_role.name if nxt_role is not None else None,
                    comment=comment,
                )
        else:
            self._create_tasks_for_step(req, next_step)
        self._db.commit()
        return self.get_request(req.id)

    def _advance_transfer_after_step(
        self,
        req: ApprovalRequest,
        *,
        step: ApprovalStep,
        steps_sorted: list[ApprovalStep],
        idx: int,
        actor_user_id: int,
        comment: str | None,
        next_assigned_user_id: int | None,
        to_functional_location: str | None,
        to_actual_location: str | None,
        to_cost_center_id: int | None,
        kind: str,
    ) -> ApprovalRequest:
        """Transfer workflow: approve/receive/confirm/close all run through the engine."""
        from modules.transfers.service import (
            apply_transfer_close,
            apply_transfer_confirm,
            apply_transfer_enter_receive,
            apply_transfer_receive,
            log_transfer_step_approved,
        )

        cur_role = self._db.get(Role, int(step.approver_role_id))
        step_role_name = cur_role.name if cur_role is not None else None
        is_last = idx == len(steps_sorted) - 1

        if is_last:
            # Last step closes the order (close kind preferred; any last step treated as close).
            apply_transfer_close(
                self._db,
                order_id=int(req.entity_id),
                actor_user_id=actor_user_id,
                step_role_name=step_role_name,
                comment=comment,
            )
            req.status = "approved"
            self._db.commit()
            return self.get_request(req.id)

        next_step = steps_sorted[idx + 1]
        next_kind = _step_kind(next_step)
        nxt_role = self._db.get(Role, int(next_step.approver_role_id))
        next_role_name = nxt_role.name if nxt_role is not None else None

        # Same role on close: actor continues — no next-user picker.
        if (
            next_assigned_user_id is None
            and next_kind == "close"
            and cur_role is not None
            and nxt_role is not None
            and int(cur_role.id) == int(nxt_role.id)
        ):
            next_assigned_user_id = actor_user_id

        if next_assigned_user_id is None:
            raise ApprovalError("Select the next assignee before completing this step.")

        self._create_tasks_for_step(
            req, next_step, assigned_user_id=int(next_assigned_user_id)
        )
        req.current_step = next_step.step_order

        if kind == "receive":
            apply_transfer_receive(
                self._db,
                order_id=int(req.entity_id),
                actor_user_id=actor_user_id,
                functional_location=to_functional_location,
                actual_location=to_actual_location,
                next_assignee_user_id=int(next_assigned_user_id),
                step_role_name=step_role_name,
                comment=comment,
                cost_center_id=to_cost_center_id,
            )
        elif kind == "confirm":
            apply_transfer_confirm(
                self._db,
                order_id=int(req.entity_id),
                actor_user_id=actor_user_id,
                next_assignee_user_id=int(next_assigned_user_id),
                step_role_name=step_role_name,
                comment=comment,
            )
        else:
            # Completing an approve (or unknown) step.
            log_transfer_step_approved(
                self._db,
                order_id=int(req.entity_id),
                actor_user_id=actor_user_id,
                step_role_name=step_role_name,
                next_assignee_user_id=int(next_assigned_user_id),
                next_role_name=next_role_name,
                comment=comment,
            )
            if next_kind == "receive":
                apply_transfer_enter_receive(
                    self._db,
                    order_id=int(req.entity_id),
                    actor_user_id=actor_user_id,
                    next_assignee_user_id=int(next_assigned_user_id),
                    step_role_name=step_role_name,
                    comment=comment,
                )

        self._db.commit()
        return self.get_request(req.id)

    def _advance_disposal_after_step(
        self,
        req: ApprovalRequest,
        *,
        step: ApprovalStep,
        steps_sorted: list[ApprovalStep],
        idx: int,
        actor_user_id: int,
        comment: str | None,
        next_assigned_user_id: int | None,
        to_functional_location: str | None,
        to_actual_location: str | None,
        to_cost_center_id: int | None,
        kind: str,
    ) -> ApprovalRequest:
        """Disposal workflow with receive/confirm/close kinds (mirrors transfer)."""
        from modules.disposals.service import (
            apply_disposal_close,
            apply_disposal_enter_receive,
            apply_disposal_receive,
            log_disposal_step_approved,
        )

        cur_role = self._db.get(Role, int(step.approver_role_id))
        step_role_name = cur_role.name if cur_role is not None else None
        is_last = idx == len(steps_sorted) - 1

        if is_last:
            apply_disposal_close(
                self._db,
                order_id=int(req.entity_id),
                actor_user_id=actor_user_id,
                step_role_name=step_role_name,
                comment=comment,
            )
            req.status = "approved"
            self._db.commit()
            return self.get_request(req.id)

        next_step = steps_sorted[idx + 1]
        next_kind = _step_kind(next_step)
        nxt_role = self._db.get(Role, int(next_step.approver_role_id))
        next_role_name = nxt_role.name if nxt_role is not None else None

        # Same role on close: actor continues — no next-user picker.
        if (
            next_assigned_user_id is None
            and next_kind == "close"
            and cur_role is not None
            and nxt_role is not None
            and int(cur_role.id) == int(nxt_role.id)
        ):
            next_assigned_user_id = actor_user_id

        if next_assigned_user_id is None:
            raise ApprovalError("Select the next assignee before completing this step.")

        self._create_tasks_for_step(
            req, next_step, assigned_user_id=int(next_assigned_user_id)
        )
        req.current_step = next_step.step_order

        if kind == "receive":
            apply_disposal_receive(
                self._db,
                order_id=int(req.entity_id),
                actor_user_id=actor_user_id,
                cost_center_id=to_cost_center_id,
                functional_location=to_functional_location,
                actual_location=to_actual_location,
                next_assignee_user_id=int(next_assigned_user_id),
                step_role_name=step_role_name,
                comment=comment,
            )
        else:
            log_disposal_step_approved(
                self._db,
                order_id=int(req.entity_id),
                actor_user_id=actor_user_id,
                step_role_name=step_role_name,
                next_assignee_user_id=int(next_assigned_user_id),
                next_role_name=next_role_name,
                comment=comment,
            )
            if next_kind == "receive":
                apply_disposal_enter_receive(
                    self._db,
                    order_id=int(req.entity_id),
                    actor_user_id=actor_user_id,
                    next_assignee_user_id=int(next_assigned_user_id),
                    step_role_name=step_role_name,
                    comment=comment,
                )

        self._db.commit()
        return self.get_request(req.id)

    def _last_approve_user_id(self, req: ApprovalRequest) -> int | None:
        row = self._db.execute(
            select(ApprovalAction.user_id)
            .join(ApprovalTask, ApprovalTask.id == ApprovalAction.task_id)
            .where(
                ApprovalTask.request_id == req.id,
                ApprovalAction.action == "approve",
            )
            .order_by(ApprovalAction.created_at.desc())
            .limit(1)
        ).first()
        return int(row[0]) if row else None

    def _finalize_request(
        self,
        req: ApprovalRequest,
        *,
        comment: str | None = None,
        step: ApprovalStep | None = None,
        next_assigned_user_id: int | None = None,
    ) -> None:
        if req.entity_type in ("asset_creation", "asset_import"):
            from modules.assets.service import activate_asset_after_approval

            approver_id = self._last_approve_user_id(req)
            activate_asset_after_approval(
                self._db,
                asset_id=int(req.entity_id),
                approver_user_id=approver_id,
                comment=comment,
            )
            self._db.commit()
            return
        if req.entity_type == "physical_order_creation":
            from modules.orders.service import finalize_creation_approval

            approver_id = self._last_approve_user_id(req)
            finalize_creation_approval(
                self._db,
                order_id=int(req.entity_id),
                approver_user_id=approver_id,
            )
            return
        if req.entity_type == "physical_order_closure":
            from modules.orders.service import finalize_closure_approval

            approver_id = self._last_approve_user_id(req)
            finalize_closure_approval(
                self._db,
                order_id=int(req.entity_id),
                approver_user_id=approver_id,
            )
            return
        if req.entity_type in ("capitalization_request", "capitalization_request_engineering"):
            from modules.capex.service import finalize_capex_approval

            approver_id = self._last_approve_user_id(req)
            step_role = None
            if step is not None:
                role = self._db.get(Role, int(step.approver_role_id))
                step_role = role.name if role is not None else None
            finalize_capex_approval(
                self._db,
                form_id=int(req.entity_id),
                approver_user_id=approver_id,
                step_role_name=step_role,
                comment=comment,
            )
            return
        if req.entity_type in DISPOSAL_ENTITY_TYPES:
            from modules.disposals.service import finalize_disposal_approval

            approver_id = self._last_approve_user_id(req)
            step_role = None
            if step is not None:
                role = self._db.get(Role, int(step.approver_role_id))
                step_role = role.name if role is not None else None
            finalize_disposal_approval(
                self._db,
                order_id=int(req.entity_id),
                approver_user_id=approver_id,
                step_role_name=step_role,
                comment=comment,
                scrapyard_user_id=next_assigned_user_id,
            )
            return
        if req.entity_type in TRANSFER_ENTITY_TYPES:
            from modules.transfers.service import finalize_transfer_approval

            approver_id = self._last_approve_user_id(req)
            step_role = None
            if step is not None:
                role = self._db.get(Role, int(step.approver_role_id))
                step_role = role.name if role is not None else None
            finalize_transfer_approval(
                self._db,
                order_id=int(req.entity_id),
                approver_user_id=approver_id,
                step_role_name=step_role,
                comment=comment,
            )
            return
        if req.entity_type == "user_creation":
            user = self._db.get(User, req.entity_id)
            if user is None:
                raise ApprovalError("Target user not found for approval request.")
            user.is_active = True
            # Trigger configurable email notification (template-driven).
            if user.email:
                payload: dict[str, Any] = {
                    "user_name": user.full_name,
                    "username": user.username,
                    "email": user.email,
                    "company_name": "Ultra Workspace",
                    # Always include keys used by templates; values may be blank.
                    "temp_password": "",
                    "setup_link": "",
                }
                # If the user was created with an auto-generated password, it is stored in the approval payload.
                try:
                    if isinstance(req.payload, dict) and req.payload.get("temp_password"):
                        payload["temp_password"] = str(req.payload.get("temp_password") or "")
                except Exception:
                    pass

                # If MFA is enabled by policy (and not completed), include setup link in the same email.
                try:
                    pol = get_global_policy(self._db)
                    if bool(pol.mfa_enabled):
                        # Reload for mfa_record if needed.
                        u2 = self._db.scalar(
                            select(User)
                            .where(User.id == int(user.id))
                            .options(selectinload(User.mfa_record))
                        )
                        if u2 is not None and (u2.mfa_record is None or not bool(u2.mfa_record.setup_completed)):
                            link = create_mfa_setup_link(self._db, user=u2)
                            if link:
                                payload["setup_link"] = link
                except Exception:
                    pass

                EmailNotificationService(self._db).trigger_event(
                    event_code="USER_CREATED",
                    payload=payload,
                )
            # Avoid sending a second MFA email when the setup link was already included above.
            if not (isinstance(payload, dict) and payload.get("setup_link")):
                maybe_send_mfa_setup_for_user(self._db, user)

