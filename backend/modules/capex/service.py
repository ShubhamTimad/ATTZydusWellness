from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from modules.capex.constants import (
    ACTION_SUBMIT,
    ACTION_SUBMIT_WITH_ENGINEERING,
    EDITABLE_STATUSES,
    ENTITY_TYPE,
    ENTITY_TYPE_WITH_ENGINEERING,
    ROLE_CENTRAL_FINANCE,
    ROLE_ENGINEERING,
    ROLE_HOD,
    STATUS_APPROVED,
    STATUS_DRAFT,
    STATUS_IN_REWORK,
    STATUS_PENDING_APPROVAL,
    STATUS_REJECTED,
    SUBMITTABLE_STATUSES,
)
from modules.capex.audit import log_capex_event
from modules.capex.model import CapitalizationForm, CapitalizationFormAudit
from modules.capex.schema import (
    CapexApprovalPanel,
    CapexAssigneeListResponse,
    CapexAssigneeOption,
    CapexAuditChange,
    CapexAuditEventPublic,
    CapexFormCreateRequest,
    CapexFormDetail,
    CapexFormListItem,
    CapexFormListResponse,
    CapexFormUpdateRequest,
    CapexWorkflowRunPublic,
)
from modules.errors import ConflictError, NotFoundError
from modules.platform.approvals.assignment_service import get_workflow_for_action
from modules.platform.approvals.model import ApprovalRequest, ApprovalTask, ApprovalWorkflow
from modules.platform.approvals.service import ApprovalEngineService, ApprovalError
from modules.platform.roles.model import Role
from modules.platform.users.model import User
from modules.rbac_association import user_role
from modules.platform.tasks.schema import TaskApprovalStepLinePublic
from modules.platform.tasks.service import (
    _build_workflow_steps_for_request,
    _split_approval_task_runs,
    build_workflow_preview_steps,
)

CAPEX_PRIOR_RUNS_KEY = "_capex_prior_runs"

ASSIGNEE_LEVEL_ROLES: dict[str, str] = {
    "hod": ROLE_HOD,
    "engineering": ROLE_ENGINEERING,
    "central_finance": ROLE_CENTRAL_FINANCE,
}
ROLE_TO_ASSIGNEE_LEVEL: dict[str, str] = {v: k for k, v in ASSIGNEE_LEVEL_ROLES.items()}

def action_and_entity_for_form(*, requires_engineering: bool) -> tuple[str, str]:
    if requires_engineering:
        return ACTION_SUBMIT_WITH_ENGINEERING, ENTITY_TYPE_WITH_ENGINEERING
    return ACTION_SUBMIT, ENTITY_TYPE


def _users_in_role(db: Session, role_id: int) -> list[User]:
    return list(
        db.scalars(
            select(User)
            .select_from(user_role)
            .join(User, User.id == user_role.c.user_id)
            .where(user_role.c.role_id == int(role_id), User.is_active.is_(True))
            .order_by(User.full_name.asc(), User.id.asc())
        ).all()
    )


def _first_step_role(db: Session, workflow: ApprovalWorkflow) -> Role:
    if not workflow.steps:
        raise ConflictError("Active CapEx workflow has no steps configured.")
    first = sorted(workflow.steps, key=lambda s: int(s.step_order))[0]
    role = db.get(Role, int(first.approver_role_id))
    if role is None:
        raise ConflictError("Workflow approver role is missing.")
    return role


_FIELD_LABELS: dict[str, str] = {
    "asset_name": "Asset name",
    "equipment_tag_no": "Equipment tag no.",
    "asset_specifications": "Asset specifications",
    "party_name": "Party name",
    "department": "Department",
    "installation_location": "Installation location",
    "department_head": "Department head",
    "functioning_comment": "Functioning comment",
    "installation_date": "Installation date",
    "auc_code": "AUC code",
    "useful_life": "Useful life",
    "requires_engineering": "Engineering review required",
}

_AUDIT_LABELS: dict[str, str] = {
    "created": "Form created",
    "updated": "Form updated",
    "submitted": "Submitted for approval",
    "resubmitted": "Resubmitted for approval",
    "reassigned": "Approver reassigned",
    "step_approved": "Step approved",
    "approved": "Fully approved",
    "rejected": "Rejected",
    "linked_to_asset": "Linked to asset",
    "unlinked_from_asset": "Unlinked from asset",
}


def _fmt_val(value: Any) -> str:
    if value is None:
        return "—"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return str(value)


def _user_display(db: Session, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    u = db.get(User, int(user_id))
    if u is None:
        return f"User #{user_id}"
    return u.full_name or u.email or f"User #{user_id}"


def _snapshot_fields(form: CapitalizationForm) -> dict[str, Any]:
    return {
        "asset_name": form.asset_name,
        "equipment_tag_no": form.equipment_tag_no,
        "asset_specifications": form.asset_specifications,
        "party_name": form.party_name,
        "department": form.department,
        "installation_location": form.installation_location,
        "department_head": form.department_head,
        "functioning_comment": form.functioning_comment,
        "installation_date": form.installation_date.isoformat() if form.installation_date else None,
        "auc_code": form.auc_code,
        "useful_life": form.useful_life,
        "requires_engineering": bool(form.requires_engineering),
    }


class CapexFormService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def _next_form_number(self) -> str:
        year = datetime.now(timezone.utc).year
        prefix = f"CAP-{year}-"
        last = self._db.scalar(
            select(CapitalizationForm.form_number)
            .where(CapitalizationForm.form_number.like(f"{prefix}%"))
            .order_by(CapitalizationForm.id.desc())
            .limit(1)
        )
        seq = 1
        if last:
            try:
                seq = int(str(last).split("-")[-1]) + 1
            except ValueError:
                seq = 1
        return f"{prefix}{seq:05d}"

    def _load(self, form_id: int) -> CapitalizationForm:
        row = self._db.scalar(
            select(CapitalizationForm)
            .where(CapitalizationForm.id == form_id)
            .options(
                selectinload(CapitalizationForm.creator),
                selectinload(CapitalizationForm.asset),
            )
        )
        if row is None:
            raise NotFoundError("CapitalizationForm", form_id)
        return row

    def _approval_panel(
        self, form: CapitalizationForm, *, viewer_user_id: int | None
    ) -> CapexApprovalPanel | None:
        if form.approval_request_id is None:
            # Show a preview of the workflow steps even before submission.
            action_code, _ = action_and_entity_for_form(
                requires_engineering=bool(form.requires_engineering)
            )
            wf = get_workflow_for_action(self._db, action_code)
            if wf is None or not wf.steps:
                return None
            preview_steps = build_workflow_preview_steps(self._db, wf)
            if not preview_steps:
                return None
            return CapexApprovalPanel(
                request_id=0,
                request_status="preview",
                workflow_steps=preview_steps,
            )
        req = self._db.scalar(
            select(ApprovalRequest)
            .where(ApprovalRequest.id == int(form.approval_request_id))
            .options(
                selectinload(ApprovalRequest.workflow).selectinload(ApprovalWorkflow.steps),
                selectinload(ApprovalRequest.tasks).options(
                    selectinload(ApprovalTask.step),
                    selectinload(ApprovalTask.actions),
                ),
            )
        )
        if req is None:
            return None

        workflow_runs = self._workflow_runs_for_request(req)
        steps = workflow_runs[-1].workflow_steps if workflow_runs else []

        my_pending: int | None = None
        pending_task: ApprovalTask | None = None
        for t in req.tasks or []:
            if str(t.task_type) != "approval":
                continue
            if str(t.status).lower() != "pending":
                continue
            pending_task = t
            if viewer_user_id is not None and t.assigned_user_id is not None:
                if int(t.assigned_user_id) == int(viewer_user_id):
                    my_pending = int(t.id)
            break

        current_assignee_id: int | None = None
        current_assignee_name: str | None = None
        current_role: str | None = None
        current_level: str | None = None
        current_role_id: int | None = None
        if pending_task is not None:
            if pending_task.assigned_user_id is not None:
                current_assignee_id = int(pending_task.assigned_user_id)
                current_assignee_name = _user_display(self._db, current_assignee_id)
            step = pending_task.step
            if step is not None:
                current_role_id = int(step.approver_role_id)
                role = self._db.get(Role, current_role_id)
                if role is not None:
                    current_role = role.name
                    current_level = ROLE_TO_ASSIGNEE_LEVEL.get(role.name)

        is_final = True
        needs_next = False
        next_role: str | None = None
        next_role_id: int | None = None
        next_level: str | None = None
        wf_steps = sorted(
            (req.workflow.steps or []) if req.workflow is not None else [],
            key=lambda s: int(s.step_order),
        )
        if str(req.status) == "pending" and steps:
            current = next((s for s in steps if s.phase == "current"), None)
            if current is not None:
                is_final = int(current.step_order) >= int(current.total_steps)
                if not is_final:
                    nxt_row = next(
                        (
                            s
                            for s in wf_steps
                            if int(s.step_order) == int(current.step_order) + 1
                        ),
                        None,
                    )
                    if nxt_row is not None:
                        needs_next = True
                        next_role_id = int(nxt_row.approver_role_id)
                        role = self._db.get(Role, next_role_id)
                        if role is not None:
                            next_role = role.name
                            next_level = ROLE_TO_ASSIGNEE_LEVEL.get(role.name)
        return CapexApprovalPanel(
            request_id=int(req.id),
            request_status=str(req.status),
            workflow_steps=steps,
            workflow_runs=workflow_runs,
            my_pending_task_id=my_pending,
            pending_task_id=int(pending_task.id) if pending_task is not None else None,
            current_assignee_user_id=current_assignee_id,
            current_assignee_name=current_assignee_name,
            current_step_role_name=current_role,
            current_assignee_level=current_level,
            current_assignee_role_id=current_role_id,
            is_final_step=is_final,
            needs_next_assignee=needs_next,
            next_step_role_name=next_role,
            next_assignee_role_id=next_role_id,
            next_assignee_level=next_level,
        )

    def _workflow_runs_for_request(self, req: ApprovalRequest) -> list[CapexWorkflowRunPublic]:
        """Prior snapshotted attempts (after 2↔3 workflow switch) + live task runs."""
        out: list[CapexWorkflowRunPublic] = []
        payload = dict(req.payload) if isinstance(req.payload, dict) else {}
        for raw in payload.get(CAPEX_PRIOR_RUNS_KEY) or []:
            if not isinstance(raw, dict):
                continue
            try:
                step_rows = [
                    TaskApprovalStepLinePublic.model_validate(s)
                    for s in (raw.get("workflow_steps") or [])
                ]
            except Exception:
                continue
            out.append(
                CapexWorkflowRunPublic(
                    attempt=len(out) + 1,
                    request_id=int(req.id),
                    request_status=str(raw.get("request_status") or "rejected"),
                    is_current=False,
                    workflow_steps=step_rows,
                )
            )

        wf_step_ids = {int(s.id) for s in (req.workflow.steps if req.workflow else [])}
        live_tasks = [
            t
            for t in (req.tasks or [])
            if t.step_id is not None and int(t.step_id) in wf_step_ids
        ]
        live_runs = _split_approval_task_runs(live_tasks)
        for idx, run_tasks in enumerate(live_runs):
            is_last = idx == len(live_runs) - 1
            has_reject = any(str(t.status).lower() == "rejected" for t in run_tasks)
            if is_last and str(req.status).lower() == "pending" and not has_reject:
                status_override = None
            elif has_reject:
                status_override = "rejected"
            elif is_last:
                status_override = str(req.status)
            else:
                status_override = "rejected"
            step_rows = _build_workflow_steps_for_request(
                self._db,
                req,
                tasks=run_tasks,
                status_override=status_override,
            )
            out.append(
                CapexWorkflowRunPublic(
                    attempt=len(out) + 1,
                    request_id=int(req.id),
                    request_status=status_override or str(req.status),
                    is_current=is_last,
                    workflow_steps=step_rows,
                )
            )
        if out and not any(r.is_current for r in out):
            out[-1].is_current = True
        return out

    def _snapshot_prior_runs_onto_payload(self, req: ApprovalRequest) -> list[dict[str, Any]]:
        """Freeze current live attempts before switching 2↔3 step workflows."""
        payload = dict(req.payload) if isinstance(req.payload, dict) else {}
        prior: list[dict[str, Any]] = list(payload.get(CAPEX_PRIOR_RUNS_KEY) or [])
        wf_step_ids = {int(s.id) for s in (req.workflow.steps if req.workflow else [])}
        live_tasks = [
            t
            for t in (req.tasks or [])
            if t.step_id is not None and int(t.step_id) in wf_step_ids
        ]
        for run_tasks in _split_approval_task_runs(live_tasks):
            has_reject = any(str(t.status).lower() == "rejected" for t in run_tasks)
            status_override = "rejected" if has_reject else str(req.status)
            steps = _build_workflow_steps_for_request(
                self._db,
                req,
                tasks=run_tasks,
                status_override=status_override,
            )
            prior.append(
                {
                    "request_status": status_override,
                    "entity_type": str(req.entity_type),
                    "workflow_steps": [s.model_dump(mode="json") for s in steps],
                }
            )
        return prior

    def _resubmit_with_workflow_switch(
        self,
        form: CapitalizationForm,
        req: ApprovalRequest,
        *,
        workflow: ApprovalWorkflow,
        entity_type: str,
        action_code: str,
        actor_user_id: int,
        assignee_user_id: int,
    ) -> None:
        """After reject, toggle engineering 2↔3: keep prior attempts, restart on new workflow."""
        engine = ApprovalEngineService(self._db)
        prior = self._snapshot_prior_runs_onto_payload(req)
        now = datetime.now(timezone.utc)

        for t in list(req.tasks or []):
            if str(t.status).lower() in ("pending", "open"):
                t.status = "closed"
                t.closed_at = now

        payload = self._form_payload(form, action_code=action_code)
        payload[CAPEX_PRIOR_RUNS_KEY] = prior
        req.payload = payload
        req.workflow_id = int(workflow.id)
        req.entity_type = entity_type
        steps_sorted = sorted(workflow.steps, key=lambda s: int(s.step_order))
        if not steps_sorted:
            raise ConflictError("Active CapEx workflow has no steps configured.")
        first = steps_sorted[0]
        req.status = "pending"
        req.current_step = int(first.step_order)
        req.last_resubmitted_at = now
        self._db.flush()
        self._db.expire(req, ["workflow", "tasks"])
        # Reload workflow steps for task creation
        wf = self._db.scalar(
            select(ApprovalWorkflow)
            .where(ApprovalWorkflow.id == int(workflow.id))
            .options(selectinload(ApprovalWorkflow.steps))
        )
        if wf is None or not wf.steps:
            raise ConflictError("Active CapEx workflow has no steps configured.")
        first = sorted(wf.steps, key=lambda s: int(s.step_order))[0]
        req.workflow = wf
        engine._create_tasks_for_step(req, first, assigned_user_id=int(assignee_user_id))
        form.status = STATUS_PENDING_APPROVAL
        form.rejection_comment = None
        log_capex_event(
            self._db,
            form_id=int(form.id),
            action="resubmitted",
            actor_user_id=actor_user_id,
            new_value={
                "assignee_user_id": int(assignee_user_id),
                "assignee_name": _user_display(self._db, assignee_user_id),
                "role_name": _first_step_role(self._db, workflow).name,
                "workflow_switched": True,
                "entity_type": entity_type,
            },
        )
        self._db.commit()

    def _to_detail(
        self, form: CapitalizationForm, *, viewer_user_id: int | None = None
    ) -> CapexFormDetail:
        creator = form.creator
        asset = form.asset
        return CapexFormDetail(
            id=int(form.id),
            form_number=form.form_number,
            status=form.status,
            asset_name=form.asset_name,
            equipment_tag_no=form.equipment_tag_no,
            asset_specifications=form.asset_specifications,
            party_name=form.party_name,
            department=form.department,
            installation_location=form.installation_location,
            department_head=form.department_head,
            functioning_comment=form.functioning_comment,
            installation_date=form.installation_date,
            auc_code=form.auc_code,
            useful_life=form.useful_life,
            requires_engineering=bool(form.requires_engineering),
            approval_request_id=form.approval_request_id,
            asset_id=form.asset_id,
            asset_code=asset.asset_code if asset is not None else None,
            rejection_comment=form.rejection_comment,
            created_by=form.created_by,
            created_by_name=creator.full_name if creator is not None else None,
            created_at=form.created_at,
            updated_at=form.updated_at,
            approval_panel=self._approval_panel(form, viewer_user_id=viewer_user_id),
        )

    def _form_payload(self, form: CapitalizationForm, *, action_code: str) -> dict[str, Any]:
        return {
            "action_code": action_code,
            "form_number": form.form_number,
            "asset_name": form.asset_name,
            "department": form.department,
            "requires_engineering": bool(form.requires_engineering),
            "auc_code": form.auc_code,
        }

    def list_forms(
        self,
        *,
        tab: str = "all",
        page: int = 1,
        page_size: int = 25,
        available_for_asset: bool = False,
        for_asset_id: int | None = None,
        search: str | None = None,
        form_number: str | None = None,
        asset_name: str | None = None,
        department: str | None = None,
        created_by: str | None = None,
    ) -> CapexFormListResponse:
        stmt = select(CapitalizationForm).options(selectinload(CapitalizationForm.creator))
        count_stmt = select(func.count()).select_from(CapitalizationForm)

        if available_for_asset:
            unused = CapitalizationForm.asset_id.is_(None)
            if for_asset_id is not None:
                unused = or_(unused, CapitalizationForm.asset_id == int(for_asset_id))
            stmt = stmt.where(CapitalizationForm.status == STATUS_APPROVED, unused)
            count_stmt = count_stmt.where(CapitalizationForm.status == STATUS_APPROVED, unused)
        elif tab and tab != "all":
            if tab == STATUS_IN_REWORK:
                rejected_statuses = (STATUS_IN_REWORK, STATUS_REJECTED)
                stmt = stmt.where(CapitalizationForm.status.in_(rejected_statuses))
                count_stmt = count_stmt.where(CapitalizationForm.status.in_(rejected_statuses))
            else:
                stmt = stmt.where(CapitalizationForm.status == tab)
                count_stmt = count_stmt.where(CapitalizationForm.status == tab)

        def _like(value: str) -> str:
            return f"%{value.strip()}%"

        if search and search.strip():
            q = _like(search)
            search_clause = or_(
                CapitalizationForm.form_number.ilike(q),
                CapitalizationForm.asset_name.ilike(q),
                CapitalizationForm.department.ilike(q),
                CapitalizationForm.creator.has(User.full_name.ilike(q)),
            )
            stmt = stmt.where(search_clause)
            count_stmt = count_stmt.where(search_clause)

        if form_number and form_number.strip():
            clause = CapitalizationForm.form_number.ilike(_like(form_number))
            stmt = stmt.where(clause)
            count_stmt = count_stmt.where(clause)
        if asset_name and asset_name.strip():
            clause = CapitalizationForm.asset_name.ilike(_like(asset_name))
            stmt = stmt.where(clause)
            count_stmt = count_stmt.where(clause)
        if department and department.strip():
            clause = CapitalizationForm.department.ilike(_like(department))
            stmt = stmt.where(clause)
            count_stmt = count_stmt.where(clause)
        if created_by and created_by.strip():
            clause = CapitalizationForm.creator.has(User.full_name.ilike(_like(created_by)))
            stmt = stmt.where(clause)
            count_stmt = count_stmt.where(clause)

        total = int(self._db.scalar(count_stmt) or 0)
        rows = list(
            self._db.scalars(
                stmt.order_by(CapitalizationForm.id.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            ).all()
        )
        items = [
            CapexFormListItem(
                id=int(r.id),
                form_number=r.form_number,
                asset_name=r.asset_name,
                department=r.department,
                status=r.status,
                requires_engineering=bool(r.requires_engineering),
                asset_id=r.asset_id,
                created_by_name=r.creator.full_name if r.creator is not None else None,
                created_at=r.created_at,
            )
            for r in rows
        ]
        return CapexFormListResponse(items=items, total=total, page=page, page_size=page_size)

    def get_form(self, form_id: int, *, viewer_user_id: int | None = None) -> CapexFormDetail:
        return self._to_detail(self._load(form_id), viewer_user_id=viewer_user_id)

    def list_assignees(self, *, level: str) -> CapexAssigneeListResponse:
        role_name = ASSIGNEE_LEVEL_ROLES.get(level.strip().lower())
        if role_name is None:
            raise ConflictError(
                "Invalid assignee level. Use hod, engineering, or central_finance."
            )
        role = self._db.scalar(select(Role).where(Role.name == role_name))
        if role is None:
            raise ConflictError(f"Role {role_name!r} is not configured.")
        users = _users_in_role(self._db, int(role.id))
        return CapexAssigneeListResponse(
            role_name=role_name,
            items=[
                CapexAssigneeOption(
                    id=int(u.id),
                    full_name=u.full_name,
                    email=u.email,
                )
                for u in users
            ],
        )

    def list_assignees_by_role_id(self, *, role_id: int) -> CapexAssigneeListResponse:
        """Users in a workflow step role — keyed by role id so renames do not break the picker."""
        role = self._db.get(Role, int(role_id))
        if role is None:
            raise NotFoundError("Role", role_id)
        users = _users_in_role(self._db, int(role.id))
        return CapexAssigneeListResponse(
            role_name=str(role.name),
            items=[
                CapexAssigneeOption(
                    id=int(u.id),
                    full_name=u.full_name,
                    email=u.email,
                )
                for u in users
            ],
        )

    def list_assignees_for_action(self, *, action_code: str) -> CapexAssigneeListResponse:
        """Users in the first step role of the workflow mapped to this CapEx action."""
        wf = get_workflow_for_action(self._db, action_code)
        if wf is None or not wf.steps:
            raise ConflictError(
                "No active CapEx approval workflow is configured. Contact an administrator."
            )
        role = _first_step_role(self._db, wf)
        users = _users_in_role(self._db, int(role.id))
        return CapexAssigneeListResponse(
            role_name=str(role.name),
            items=[
                CapexAssigneeOption(
                    id=int(u.id),
                    full_name=u.full_name,
                    email=u.email,
                )
                for u in users
            ],
        )

    def create_form(self, data: CapexFormCreateRequest, *, actor_user_id: int) -> CapexFormDetail:
        form = CapitalizationForm(
            form_number=self._next_form_number(),
            status=STATUS_DRAFT,
            asset_name=data.asset_name.strip(),
            equipment_tag_no=_strip_or_none(data.equipment_tag_no),
            asset_specifications=_strip_or_none(data.asset_specifications),
            party_name=_strip_or_none(data.party_name),
            department=_strip_or_none(data.department),
            installation_location=_strip_or_none(data.installation_location),
            department_head=_strip_or_none(data.department_head),
            functioning_comment=_strip_or_none(data.functioning_comment),
            installation_date=data.installation_date,
            auc_code=_strip_or_none(data.auc_code),
            useful_life=_strip_or_none(data.useful_life),
            requires_engineering=bool(data.requires_engineering),
            created_by=actor_user_id,
        )
        self._db.add(form)
        self._db.flush()
        log_capex_event(
            self._db,
            form_id=int(form.id),
            action="created",
            actor_user_id=actor_user_id,
            new_value={"form_number": form.form_number, "asset_name": form.asset_name},
        )
        if data.submit:
            if data.assignee_user_id is None:
                raise ConflictError("Select an approver before submitting.")
            self._submit(
                form,
                actor_user_id=actor_user_id,
                assignee_user_id=int(data.assignee_user_id),
            )
        else:
            self._db.commit()
        return self._to_detail(self._load(int(form.id)), viewer_user_id=actor_user_id)

    def update_form(
        self, form_id: int, data: CapexFormUpdateRequest, *, actor_user_id: int
    ) -> CapexFormDetail:
        form = self._load(form_id)
        if form.status not in EDITABLE_STATUSES:
            raise ConflictError("Form can only be edited while draft, rejected, or in rework.")
        before = _snapshot_fields(form)
        patch = data.model_dump(exclude_unset=True)
        for key, value in patch.items():
            if key in ("asset_name",) and isinstance(value, str):
                setattr(form, key, value.strip())
            elif key == "requires_engineering":
                form.requires_engineering = bool(value)
            elif key == "installation_date":
                form.installation_date = value
            elif isinstance(value, str) or value is None:
                setattr(form, key, _strip_or_none(value) if isinstance(value, str) else None)
            else:
                setattr(form, key, value)
        after = _snapshot_fields(form)
        changes = {
            k: {"from": before[k], "to": after[k]}
            for k in before
            if before[k] != after[k]
        }
        if changes:
            log_capex_event(
                self._db,
                form_id=int(form.id),
                action="updated",
                actor_user_id=actor_user_id,
                old_value={k: v["from"] for k, v in changes.items()},
                new_value={k: v["to"] for k, v in changes.items()},
            )
        self._db.commit()
        return self._to_detail(self._load(form_id), viewer_user_id=actor_user_id)

    def submit_form(
        self,
        form_id: int,
        *,
        actor_user_id: int,
        assignee_user_id: int,
        requires_engineering: bool | None = None,
    ) -> CapexFormDetail:
        form = self._load(form_id)
        if requires_engineering is not None and form.status in EDITABLE_STATUSES:
            form.requires_engineering = bool(requires_engineering)
            self._db.flush()
        self._submit(form, actor_user_id=actor_user_id, assignee_user_id=assignee_user_id)
        return self._to_detail(self._load(form_id), viewer_user_id=actor_user_id)

    def reassign_approver(
        self, form_id: int, *, actor_user_id: int, assignee_user_id: int
    ) -> CapexFormDetail:
        """Move the current pending CapEx approval task to a different user in the same role."""
        form = self._load(form_id)
        if form.status != STATUS_PENDING_APPROVAL:
            raise ConflictError("Approver can only be reassigned while the form is pending approval.")
        if form.approval_request_id is None:
            raise ConflictError("No active approval request to reassign.")

        req = self._db.scalar(
            select(ApprovalRequest)
            .where(ApprovalRequest.id == int(form.approval_request_id))
            .options(
                selectinload(ApprovalRequest.tasks).selectinload(ApprovalTask.step),
            )
        )
        if req is None or str(req.status) != "pending":
            raise ConflictError("Approval request is not pending.")

        pending = next(
            (
                t
                for t in (req.tasks or [])
                if str(t.task_type) == "approval" and str(t.status).lower() == "pending"
            ),
            None,
        )
        if pending is None or pending.step is None:
            raise ConflictError("No pending approval step to reassign.")

        if pending.assigned_user_id is not None and int(pending.assigned_user_id) == int(
            assignee_user_id
        ):
            raise ConflictError("Select a different approver.")

        engine = ApprovalEngineService(self._db)
        role_id = int(pending.step.approver_role_id)
        role = self._db.get(Role, role_id)
        role_name = role.name if role is not None else "Approvers"
        role_users = engine._users_for_role(role_id)
        if not any(int(u.id) == int(assignee_user_id) for u in role_users):
            raise ConflictError(f"Selected user is not an active member of role {role_name!r}.")

        old_id = int(pending.assigned_user_id) if pending.assigned_user_id is not None else None
        old_name = _user_display(self._db, old_id)
        new_name = _user_display(self._db, assignee_user_id)

        pending.assigned_user_id = int(assignee_user_id)
        pending.assigned_role_id = None
        self._db.flush()

        from modules.platform.approvals.model import TaskAuditLog

        self._db.add(
            TaskAuditLog(
                task_id=int(pending.id),
                action="assigned",
                actor_user_id=actor_user_id,
                old_value={"assigned_user_id": old_id, "assigned_user_name": old_name},
                new_value={
                    "assigned_user_id": int(assignee_user_id),
                    "assigned_user_name": new_name,
                },
            )
        )
        log_capex_event(
            self._db,
            form_id=int(form.id),
            action="reassigned",
            actor_user_id=actor_user_id,
            old_value={
                "assignee_user_id": old_id,
                "assignee_name": old_name,
                "role_name": role_name,
            },
            new_value={
                "assignee_user_id": int(assignee_user_id),
                "assignee_name": new_name,
                "role_name": role_name,
            },
        )
        try:
            engine._notify_approvers_for_task(task=pending, req=req)
        except Exception:
            pass
        self._db.commit()
        return self._to_detail(self._load(form_id), viewer_user_id=actor_user_id)

    def _submit(
        self,
        form: CapitalizationForm,
        *,
        actor_user_id: int,
        assignee_user_id: int,
    ) -> None:
        if form.status not in SUBMITTABLE_STATUSES:
            raise ConflictError("Form cannot be submitted in its current status.")
        if not (form.asset_name or "").strip():
            raise ConflictError("Asset name is required.")
        if assignee_user_id < 1:
            raise ConflictError("Select an approver before submitting.")

        action_code, entity_type = action_and_entity_for_form(
            requires_engineering=bool(form.requires_engineering)
        )
        wf = get_workflow_for_action(self._db, action_code)
        if wf is None:
            raise ConflictError(
                "No active CapEx approval workflow is configured. Contact an administrator."
            )

        first_role = _first_step_role(self._db, wf)
        role_users = _users_in_role(self._db, int(first_role.id))
        if not any(int(u.id) == int(assignee_user_id) for u in role_users):
            raise ConflictError(
                f"Selected user is not an active member of role {first_role.name!r}."
            )

        engine = ApprovalEngineService(self._db)
        try:
            assignee_name = _user_display(self._db, assignee_user_id)
            assign_meta = {
                "assignee_user_id": int(assignee_user_id),
                "assignee_name": assignee_name,
                "role_name": str(first_role.name),
            }
            if form.approval_request_id and form.status in (STATUS_REJECTED, STATUS_IN_REWORK):
                existing = self._db.scalar(
                    select(ApprovalRequest)
                    .where(ApprovalRequest.id == int(form.approval_request_id))
                    .options(
                        selectinload(ApprovalRequest.workflow).selectinload(ApprovalWorkflow.steps),
                        selectinload(ApprovalRequest.tasks).options(
                            selectinload(ApprovalTask.step),
                            selectinload(ApprovalTask.actions),
                        ),
                    )
                )
                if existing is not None and (
                    str(existing.entity_type) != entity_type
                    or int(existing.workflow_id) != int(wf.id)
                ):
                    self._resubmit_with_workflow_switch(
                        form,
                        existing,
                        workflow=wf,
                        entity_type=entity_type,
                        action_code=action_code,
                        actor_user_id=actor_user_id,
                        assignee_user_id=int(assignee_user_id),
                    )
                    return
                try:
                    engine.resubmit_rejected_request(
                        request_id=int(form.approval_request_id),
                        actor_user_id=actor_user_id,
                        assigned_user_id=int(assignee_user_id),
                    )
                    form.status = STATUS_PENDING_APPROVAL
                    form.rejection_comment = None
                    log_capex_event(
                        self._db,
                        form_id=int(form.id),
                        action="resubmitted",
                        actor_user_id=actor_user_id,
                        new_value=assign_meta,
                    )
                    self._db.commit()
                    return
                except ApprovalError:
                    pass

            # Preserve prior-run snapshots if recreating after a failed same-workflow resubmit.
            create_payload = self._form_payload(form, action_code=action_code)
            if form.approval_request_id:
                old = self._db.get(ApprovalRequest, int(form.approval_request_id))
                if old is not None and isinstance(old.payload, dict):
                    prior = old.payload.get(CAPEX_PRIOR_RUNS_KEY)
                    if prior:
                        create_payload[CAPEX_PRIOR_RUNS_KEY] = prior

            req = engine.create_request_for_entity(
                workflow=wf,
                entity_type=entity_type,
                entity_id=int(form.id),
                payload=create_payload,
                created_by=actor_user_id,
                assigned_user_id=int(assignee_user_id),
            )
            form.approval_request_id = int(req.id)
            form.status = STATUS_PENDING_APPROVAL
            form.rejection_comment = None
            log_capex_event(
                self._db,
                form_id=int(form.id),
                action="submitted",
                actor_user_id=actor_user_id,
                new_value=assign_meta,
            )
            self._db.commit()
        except ConflictError:
            self._db.rollback()
            raise
        except ApprovalError as exc:
            self._db.rollback()
            raise ConflictError(str(exc)) from exc

    def link_to_asset(
        self, form_id: int, *, asset_id: int, actor_user_id: int | None = None, asset_code: str | None = None
    ) -> CapitalizationForm:
        """Validate approved+unused and set asset_id. Caller owns commit."""
        form = self._db.get(CapitalizationForm, form_id)
        if form is None:
            raise NotFoundError("CapitalizationForm", form_id)
        if form.status != STATUS_APPROVED:
            raise ConflictError("Only an approved capitalization form can be linked to an asset.")
        if form.asset_id is not None and int(form.asset_id) != int(asset_id):
            raise ConflictError("This capitalization form is already linked to an asset.")
        if form.asset_id is not None and int(form.asset_id) == int(asset_id):
            return form

        existing = self._db.scalar(
            select(CapitalizationForm).where(
                CapitalizationForm.asset_id == asset_id,
                CapitalizationForm.id != form_id,
            )
        )
        if existing is not None:
            existing.asset_id = None
            log_capex_event(
                self._db,
                form_id=int(existing.id),
                action="unlinked_from_asset",
                actor_user_id=actor_user_id,
                new_value={"asset_id": None, "replaced_by_form_id": int(form_id)},
            )

        form.asset_id = asset_id
        log_capex_event(
            self._db,
            form_id=int(form.id),
            action="linked_to_asset",
            actor_user_id=actor_user_id,
            new_value={"asset_id": asset_id, "asset_code": asset_code},
        )
        return form

    def unlink_from_asset(
        self, *, asset_id: int, actor_user_id: int | None = None
    ) -> CapitalizationForm | None:
        """Clear CapEx link for an asset. Caller owns commit."""
        form = self._db.scalar(
            select(CapitalizationForm).where(CapitalizationForm.asset_id == int(asset_id))
        )
        if form is None:
            return None
        form.asset_id = None
        log_capex_event(
            self._db,
            form_id=int(form.id),
            action="unlinked_from_asset",
            actor_user_id=actor_user_id,
            new_value={"asset_id": None},
        )
        return form

    def list_audit(self, form_id: int) -> list[CapexAuditEventPublic]:
        form = self._db.get(CapitalizationForm, form_id)
        if form is None:
            raise NotFoundError("CapitalizationForm", form_id)
        rows = list(
            self._db.scalars(
                select(CapitalizationFormAudit)
                .where(CapitalizationFormAudit.form_id == form_id)
                .options(selectinload(CapitalizationFormAudit.actor))
                .order_by(CapitalizationFormAudit.id.desc())
            ).all()
        )
        out: list[CapexAuditEventPublic] = []
        for ev in rows:
            actor = ev.actor
            actor_name = (
                (actor.full_name if actor is not None else None)
                or (actor.email if actor is not None else None)
                or ("System" if ev.actor_user_id is None else f"User #{ev.actor_user_id}")
            )
            nv = dict(ev.new_value) if isinstance(ev.new_value, dict) else {}
            ov = dict(ev.old_value) if isinstance(ev.old_value, dict) else {}
            label = _AUDIT_LABELS.get(str(ev.action), str(ev.action).replace("_", " ").title())
            detail: str | None = None
            changes: list[CapexAuditChange] = []

            if ev.action == "updated":
                keys = sorted(set(ov) | set(nv))
                for k in keys:
                    changes.append(
                        CapexAuditChange(
                            field=_FIELD_LABELS.get(k, k.replace("_", " ").title()),
                            from_value=_fmt_val(ov.get(k)),
                            to_value=_fmt_val(nv.get(k)),
                        )
                    )
            elif ev.action in ("submitted", "resubmitted"):
                who = nv.get("assignee_name") or "—"
                role = nv.get("role_name") or "Approver"
                detail = f"Assigned to {who} · {role}"
            elif ev.action == "reassigned":
                old_who = ov.get("assignee_name") or "—"
                new_who = nv.get("assignee_name") or "—"
                role = nv.get("role_name") or ov.get("role_name") or "—"
                detail = f"{old_who} → {new_who} · {role}"
            elif ev.action == "step_approved":
                role = nv.get("step_role_name")
                if role:
                    label = f"Approved · {role}"
                nxt = nv.get("next_assignee_name")
                nxt_role = nv.get("next_role_name")
                parts = []
                if nxt:
                    parts.append(f"Next: {nxt}")
                if nxt_role:
                    parts.append(str(nxt_role))
                if nv.get("comment"):
                    parts.append(f"Note: {nv['comment']}")
                detail = " · ".join(parts) if parts else None
            elif ev.action == "rejected":
                if nv.get("comment"):
                    detail = f"Reason: {nv['comment']}"
                role = nv.get("step_role_name")
                if role:
                    label = f"Rejected · {role}"
            elif ev.action == "approved":
                role = nv.get("step_role_name")
                if role:
                    detail = f"Final step · {role}"
                if nv.get("comment"):
                    detail = (detail + " · " if detail else "") + f"Note: {nv['comment']}"
            elif ev.action == "linked_to_asset":
                code = nv.get("asset_code") or (f"#{nv['asset_id']}" if nv.get("asset_id") else None)
                if code:
                    detail = str(code)
            elif ev.action == "created":
                if nv.get("form_number"):
                    detail = str(nv["form_number"])

            out.append(
                CapexAuditEventPublic(
                    id=int(ev.id),
                    action=str(ev.action),
                    label=label,
                    detail=detail,
                    actor_name=actor_name,
                    changes=changes,
                    created_at=ev.created_at,
                )
            )
        return out


def _strip_or_none(value: str | None) -> str | None:
    if value is None:
        return None
    s = value.strip()
    return s or None


def finalize_capex_approval(
    db: Session,
    *,
    form_id: int,
    approver_user_id: int | None,
    step_role_name: str | None = None,
    comment: str | None = None,
) -> None:
    form = db.get(CapitalizationForm, form_id)
    if form is None:
        return
    form.status = STATUS_APPROVED
    form.rejection_comment = None
    log_capex_event(
        db,
        form_id=int(form.id),
        action="approved",
        actor_user_id=approver_user_id,
        new_value={
            "step_role_name": step_role_name,
            "comment": (comment or "").strip() or None,
        },
    )
    db.commit()


def reject_capex_approval(
    db: Session,
    *,
    form_id: int,
    approver_user_id: int | None,
    comment: str | None,
    step_role_name: str | None = None,
) -> None:
    form = db.get(CapitalizationForm, form_id)
    if form is None:
        return
    form.status = STATUS_IN_REWORK
    form.rejection_comment = (comment or "").strip() or None
    log_capex_event(
        db,
        form_id=int(form.id),
        action="rejected",
        actor_user_id=approver_user_id,
        new_value={
            "comment": form.rejection_comment,
            "step_role_name": step_role_name,
        },
    )
    db.commit()


def log_capex_step_approved(
    db: Session,
    *,
    form_id: int,
    actor_user_id: int | None,
    step_role_name: str | None,
    next_assignee_user_id: int | None,
    next_role_name: str | None,
    comment: str | None = None,
) -> None:
    log_capex_event(
        db,
        form_id=form_id,
        action="step_approved",
        actor_user_id=actor_user_id,
        new_value={
            "step_role_name": step_role_name,
            "next_assignee_user_id": next_assignee_user_id,
            "next_assignee_name": _user_display(db, next_assignee_user_id),
            "next_role_name": next_role_name,
            "comment": (comment or "").strip() or None,
        },
    )
