from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from modules.capex.constants import (
    ACTION_SUBMIT,
    ACTION_SUBMIT_WITH_ENGINEERING,
    EDITABLE_STATUSES,
    ENTITY_TYPE,
    ENTITY_TYPE_WITH_ENGINEERING,
    ROLE_CENTRAL_FINANCE,
    ROLE_COST_CENTER_USER,
    ROLE_ENGINEERING,
    ROLE_HOD,
    STATUS_APPROVED,
    STATUS_CANCELLED,
    STATUS_DRAFT,
    STATUS_IN_REWORK,
    STATUS_PENDING_APPROVAL,
    STATUS_REJECTED,
    SUBMITTABLE_STATUSES,
    capex_needs_next_assignee,
    status_codes_matching_search,
)
from modules.asset_masters.model import CostCenterMaster
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
from modules.list_sort import apply_sort_dir, archived_last_expr
from modules.platform.approvals.assignment_service import get_workflow_for_action
from modules.platform.approvals.list_inbox import pending_approval_request_ids_for_viewer
from modules.platform.approvals.model import ApprovalRequest, ApprovalTask, ApprovalWorkflow
from modules.platform.approvals.service import ApprovalEngineService, ApprovalError
from modules.platform.roles.model import Role
from modules.platform.users.model import User
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


def _capex_action_label(
    form: CapitalizationForm,
    viewer_user_id: int | None,
    pending_req_ids: set[int],
) -> str | None:
    if viewer_user_id is None:
        return None
    uid = int(viewer_user_id)
    if form.status in EDITABLE_STATUSES and form.created_by is not None and int(form.created_by) == uid:
        return "Submit" if form.status == STATUS_DRAFT else "Resubmit"
    if (
        form.approval_request_id is not None
        and form.status == STATUS_PENDING_APPROVAL
        and int(form.approval_request_id) in pending_req_ids
    ):
        return "Approve"
    return None


def action_and_entity_for_form(*, requires_engineering: bool) -> tuple[str, str]:
    if requires_engineering:
        return ACTION_SUBMIT_WITH_ENGINEERING, ENTITY_TYPE_WITH_ENGINEERING
    return ACTION_SUBMIT, ENTITY_TYPE


def _actor_may_discard_capex(form: CapitalizationForm, *, actor_user_id: int, db: Session) -> bool:
    creator_id = int(form.created_by) if form.created_by is not None else None
    if creator_id is not None and creator_id == int(actor_user_id):
        return True
    viewer = db.get(User, int(actor_user_id))
    return viewer is not None and bool(viewer.is_superuser)


def _users_in_role(db: Session, role_id: int, *, cost_center_id: int | None = None) -> list[User]:
    """Active members of the role, narrowed to a cost center when the form names one.

    Same rule as the order modules: a user with no cost centers covers their whole plant.
    """
    from modules.platform.approvals.org_scope import filter_users_by_cost_center, users_in_role

    return filter_users_by_cost_center(
        users_in_role(db, int(role_id)), cost_center_id=cost_center_id
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
    "cost_center_id": "Cost Center",
}

_AUDIT_LABELS: dict[str, str] = {
    "created": "Form Created",
    "updated": "Updated",
    "submitted": "Submitted for Approval",
    "resubmitted": "Resubmitted for approval",
    "reassigned": "Approver Reassigned",
    "step_approved": "Step Approved",
    "approved": "Approved",
    "rejected": "Rejected",
    "linked_to_asset": "Linked to Asset",
    "unlinked_from_asset": "Unlinked from Asset",
    "archived": "Form Archived",
    "unarchived": "Form Unarchived",
}


def _fmt_val(value: Any) -> str:
    if value is None:
        return "—"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return str(value)


def _cost_center_label(cc: CostCenterMaster | None, raw_id: Any) -> str:
    if cc is None:
        return "—" if raw_id is None else f"Cost center #{raw_id}"
    name = (cc.name or "").strip()
    return name or f"Cost center #{cc.id}"


def _audit_change_value(key: str, value: Any, cost_centers: dict[int, CostCenterMaster]) -> str:
    if key == "cost_center_id":
        if value is None:
            return "—"
        try:
            cc_id = int(value)
        except (TypeError, ValueError):
            return _fmt_val(value)
        return _cost_center_label(cost_centers.get(cc_id), cc_id)
    return _fmt_val(value)


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
        "cost_center_id": form.cost_center_id,
    }


def _capex_list_sort_expr(sort_by: str):
    key = (sort_by or "form_number").strip().lower()
    if key == "form_number":
        return CapitalizationForm.form_number
    if key == "asset_name":
        return CapitalizationForm.asset_name
    if key == "department":
        return CapitalizationForm.department
    if key == "status":
        return CapitalizationForm.status
    if key == "created_by_name":
        return (
            select(User.full_name)
            .where(User.id == CapitalizationForm.created_by)
            .correlate(CapitalizationForm)
            .limit(1)
            .scalar_subquery()
        )
    if key == "created_at":
        return CapitalizationForm.created_at
    if key == "id":
        return CapitalizationForm.id
    return CapitalizationForm.form_number


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
                selectinload(CapitalizationForm.cost_center),
            )
        )
        if row is None:
            raise NotFoundError("CapitalizationForm", form_id)
        return row

    def _validated_cost_center_id(self, cost_center_id: int | None) -> int | None:
        if cost_center_id is None:
            return None
        cc = self._db.get(CostCenterMaster, int(cost_center_id))
        if cc is None:
            raise NotFoundError("CostCenterMaster", cost_center_id)
        if not bool(cc.is_active):
            raise ConflictError(f"Cost center {cc.code!r} is inactive.")
        return int(cc.id)

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
        current_kind: str | None = None
        current_order: int | None = None
        if pending_task is not None:
            if pending_task.assigned_user_id is not None:
                current_assignee_id = int(pending_task.assigned_user_id)
                current_assignee_name = _user_display(self._db, current_assignee_id)
            step = pending_task.step
            if step is not None:
                current_role_id = int(step.approver_role_id)
                current_kind = str(getattr(step, "step_kind", None) or "approve").strip().lower() or "approve"
                current_order = int(step.step_order)
                from modules.platform.approvals.step_roles import role_names_label, step_role_ids

                current_role = role_names_label(self._db, step_role_ids(step))
                role = self._db.get(Role, current_role_id)
                if role is not None:
                    current_level = ROLE_TO_ASSIGNEE_LEVEL.get(role.name)

        is_final = True
        needs_next = False
        next_role: str | None = None
        next_role_id: int | None = None
        next_level: str | None = None
        next_kind: str | None = None
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
                        from modules.platform.approvals.step_roles import role_names_label, step_role_ids

                        next_role_id = int(nxt_row.approver_role_id)
                        next_kind = (
                            str(getattr(nxt_row, "step_kind", None) or "approve").strip().lower()
                            or "approve"
                        )
                        needs_next = capex_needs_next_assignee(
                            current_role_id=current_role_id,
                            next_role_id=next_role_id,
                        )
                        next_role = role_names_label(self._db, step_role_ids(nxt_row))
                        role = self._db.get(Role, next_role_id)
                        if role is not None:
                            next_level = ROLE_TO_ASSIGNEE_LEVEL.get(role.name)
                        if not needs_next:
                            next_role_id = None
                            next_role = None
                            next_level = None
                            next_kind = None
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
            current_step_kind=current_kind,
            current_step_order=current_order,
            current_assignee_role_id=current_role_id,
            is_final_step=is_final,
            needs_next_assignee=needs_next,
            next_step_role_name=next_role,
            next_assignee_role_id=next_role_id,
            next_assignee_level=next_level,
            next_step_kind=next_kind,
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
        viewer = self._db.get(User, int(viewer_user_id)) if viewer_user_id is not None else None
        is_super = viewer is not None and bool(viewer.is_superuser)
        is_creator = (
            form.created_by is not None
            and viewer_user_id is not None
            and int(form.created_by) == int(viewer_user_id)
        )
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
            cost_center_id=form.cost_center_id,
            cost_center_code=form.cost_center.code if form.cost_center is not None else None,
            cost_center_name=form.cost_center.name if form.cost_center is not None else None,
            approval_request_id=form.approval_request_id,
            asset_id=form.asset_id,
            asset_code=asset.asset_code if asset is not None else None,
            rejection_comment=form.rejection_comment,
            created_by=form.created_by,
            created_by_name=creator.full_name if creator is not None else None,
            created_at=form.created_at,
            updated_at=form.updated_at,
            approval_panel=self._approval_panel(form, viewer_user_id=viewer_user_id),
            can_delete=False,
            can_archive=(
                form.status in EDITABLE_STATUSES
                and (is_creator or is_super)
            ),
            can_unarchive=(
                form.status == STATUS_CANCELLED and (is_creator or is_super)
            ),
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
        tab: str = "needs_action",
        page: int = 1,
        page_size: int = 25,
        available_for_asset: bool = False,
        for_asset_id: int | None = None,
        search: str | None = None,
        form_number: str | None = None,
        asset_name: str | None = None,
        department: str | None = None,
        status: str | None = None,
        created_by: str | None = None,
        viewer_user_id: int | None = None,
    sort_by: str = "form_number",
        sort_dir: str = "desc",
    ) -> CapexFormListResponse:
        stmt = select(CapitalizationForm).options(selectinload(CapitalizationForm.creator))
        count_stmt = select(func.count()).select_from(CapitalizationForm)
        tab_key = (tab or "needs_action").strip().lower()

        if available_for_asset:
            unused = CapitalizationForm.asset_id.is_(None)
            if for_asset_id is not None:
                unused = or_(unused, CapitalizationForm.asset_id == int(for_asset_id))
            stmt = stmt.where(CapitalizationForm.status == STATUS_APPROVED, unused)
            count_stmt = count_stmt.where(CapitalizationForm.status == STATUS_APPROVED, unused)
        else:
            tab_where = self._list_forms_where(tab_key, viewer_user_id=viewer_user_id)
            if tab_where:
                stmt = stmt.where(*tab_where)
                count_stmt = count_stmt.where(*tab_where)

        def _like(value: str) -> str:
            return f"%{value.strip()}%"

        if search and search.strip():
            q = _like(search)
            search_parts = [
                CapitalizationForm.form_number.ilike(q),
                CapitalizationForm.asset_name.ilike(q),
                CapitalizationForm.department.ilike(q),
                CapitalizationForm.creator.has(
                    or_(User.full_name.ilike(q), User.username.ilike(q))
                ),
            ]
            status_codes = status_codes_matching_search(search)
            if status_codes:
                search_parts.append(CapitalizationForm.status.in_(status_codes))
            search_clause = or_(*search_parts)
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
        status_q = (status or "").strip().lower()
        if status_q:
            if status_q in (STATUS_REJECTED, STATUS_IN_REWORK):
                clause = CapitalizationForm.status.in_((STATUS_REJECTED, STATUS_IN_REWORK))
            else:
                clause = CapitalizationForm.status == status_q
            stmt = stmt.where(clause)
            count_stmt = count_stmt.where(clause)
        if created_by and created_by.strip():
            clause = CapitalizationForm.creator.has(User.full_name.ilike(_like(created_by)))
            stmt = stmt.where(clause)
            count_stmt = count_stmt.where(clause)

        total = int(self._db.scalar(count_stmt) or 0)
        order_col = _capex_list_sort_expr(sort_by)
        stmt = apply_sort_dir(
            stmt,
            order_col,
            sort_dir=sort_dir,
            tiebreaker=CapitalizationForm.id,
            pin_last=archived_last_expr(CapitalizationForm.status, status_filter=status),
        )
        rows = list(
            self._db.scalars(
                stmt.offset((page - 1) * page_size).limit(page_size)
            ).all()
        )
        pending_ids: set[int] = set()
        if viewer_user_id is not None and not available_for_asset:
            pending_ids = {
                int(x)
                for x in self._db.scalars(
                    pending_approval_request_ids_for_viewer(self._db, int(viewer_user_id))
                ).all()
                if x is not None
            }
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
                needs_my_action=_capex_action_label(r, viewer_user_id, pending_ids) is not None,
                my_action_label=_capex_action_label(r, viewer_user_id, pending_ids),
            )
            for r in rows
        ]
        tab_counts: dict[str, int] = {}
        if not available_for_asset:
            for key in ("all", "needs_action", "done"):
                w = self._list_forms_where(key, viewer_user_id=viewer_user_id)
                tab_counts[key] = int(
                    self._db.scalar(select(func.count()).select_from(CapitalizationForm).where(*w))
                    or 0
                )
        return CapexFormListResponse(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            tab_counts=tab_counts,
        )

    def _list_forms_where(self, tab: str, *, viewer_user_id: int | None) -> list:
        if tab == "needs_action":
            if viewer_user_id is None:
                return [CapitalizationForm.id < 0]
            uid = int(viewer_user_id)
            pending_req_ids = pending_approval_request_ids_for_viewer(self._db, uid)
            return [
                or_(
                    and_(
                        CapitalizationForm.approval_request_id.is_not(None),
                        CapitalizationForm.approval_request_id.in_(pending_req_ids),
                    ),
                    and_(
                        CapitalizationForm.created_by == uid,
                        CapitalizationForm.status.in_(EDITABLE_STATUSES),
                    ),
                ),
                CapitalizationForm.status != STATUS_APPROVED,
                CapitalizationForm.status != STATUS_CANCELLED,
            ]
        if tab == "done":
            return [CapitalizationForm.status.in_((STATUS_APPROVED, STATUS_CANCELLED))]
        if tab == "all" or not tab:
            return []
        if tab == STATUS_IN_REWORK:
            return [CapitalizationForm.status.in_((STATUS_IN_REWORK, STATUS_REJECTED))]
        return [CapitalizationForm.status == tab]

    def get_form(self, form_id: int, *, viewer_user_id: int | None = None) -> CapexFormDetail:
        return self._to_detail(self._load(form_id), viewer_user_id=viewer_user_id)

    def list_assignees(
        self, *, level: str, cost_center_id: int | None = None
    ) -> CapexAssigneeListResponse:
        role_name = ASSIGNEE_LEVEL_ROLES.get(level.strip().lower())
        if role_name is None:
            raise ConflictError(
                "Invalid assignee level. Use hod, engineering, or central_finance."
            )
        role = self._db.scalar(select(Role).where(Role.name == role_name))
        if role is None:
            raise ConflictError(f"Role {role_name!r} is not configured.")
        users = _users_in_role(self._db, int(role.id), cost_center_id=cost_center_id)
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

    def list_assignees_by_role_id(
        self, *, role_id: int, cost_center_id: int | None = None
    ) -> CapexAssigneeListResponse:
        """Users in a workflow step role — keyed by role id so renames do not break the picker."""
        from modules.platform.approvals.step_roles import picker_role_ids, role_names_label

        role_ids = picker_role_ids(self._db, int(role_id))
        role = self._db.get(Role, int(role_ids[0]))
        if role is None:
            raise NotFoundError("Role", role_ids[0])
        users: list[User] = []
        seen: set[int] = set()
        for rid in role_ids:
            for user in _users_in_role(self._db, int(rid), cost_center_id=cost_center_id):
                if int(user.id) in seen:
                    continue
                seen.add(int(user.id))
                users.append(user)
        return CapexAssigneeListResponse(
            role_name=role_names_label(self._db, role_ids),
            items=[
                CapexAssigneeOption(
                    id=int(u.id),
                    full_name=u.full_name,
                    email=u.email,
                )
                for u in users
            ],
        )

    def list_assignees_for_action(
        self, *, action_code: str, cost_center_id: int | None = None
    ) -> CapexAssigneeListResponse:
        """Users in the first step role of the workflow mapped to this CapEx action."""
        wf = get_workflow_for_action(self._db, action_code)
        if wf is None or not wf.steps:
            raise ConflictError(
                "No active CapEx approval workflow is configured. Contact an administrator."
            )
        from modules.platform.approvals.step_roles import role_names_label, step_role_ids

        first = sorted(wf.steps, key=lambda s: int(s.step_order))[0]
        role_ids = step_role_ids(first)
        users: list[User] = []
        seen: set[int] = set()
        for rid in role_ids:
            for user in _users_in_role(self._db, int(rid), cost_center_id=cost_center_id):
                if int(user.id) in seen:
                    continue
                seen.add(int(user.id))
                users.append(user)
        return CapexAssigneeListResponse(
            role_name=role_names_label(self._db, role_ids),
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
            cost_center_id=self._validated_cost_center_id(data.cost_center_id),
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
            elif key == "cost_center_id":
                form.cost_center_id = self._validated_cost_center_id(value)
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

    def delete_draft_form(self, form_id: int, *, actor_user_id: int) -> None:
        raise ConflictError("Capitalization forms cannot be deleted. Archive the form instead.")

    def archive_form(self, form_id: int, *, actor_user_id: int) -> CapexFormDetail:
        form = self._load(form_id)
        if form.status not in EDITABLE_STATUSES:
            raise ConflictError(
                "Only draft, rejected, or in-rework capitalization forms can be archived."
            )
        if not _actor_may_discard_capex(form, actor_user_id=actor_user_id, db=self._db):
            raise ConflictError("Only the form creator can archive this capitalization form.")

        if form.approval_request_id is not None:
            now = datetime.now(timezone.utc)
            req = self._db.get(ApprovalRequest, int(form.approval_request_id))
            if req is not None and str(req.status) in ("pending", "in_rework"):
                req.status = "rejected"
            open_tasks = self._db.scalars(
                select(ApprovalTask).where(
                    ApprovalTask.request_id == int(form.approval_request_id),
                    ApprovalTask.status.in_(("pending", "open")),
                )
            ).all()
            for t in open_tasks:
                t.status = "closed"
                t.closed_at = now

        old_status = form.status
        form.status = STATUS_CANCELLED
        log_capex_event(
            self._db,
            form_id=int(form.id),
            action="archived",
            actor_user_id=actor_user_id,
            old_value={"status": old_status},
            new_value={"status": form.status},
        )
        self._db.commit()
        return self._to_detail(self._load(form_id), viewer_user_id=actor_user_id)

    def unarchive_form(self, form_id: int, *, actor_user_id: int) -> CapexFormDetail:
        form = self._load(form_id)
        if form.status != STATUS_CANCELLED:
            raise ConflictError("Only archived capitalization forms can be unarchived.")
        if not _actor_may_discard_capex(form, actor_user_id=actor_user_id, db=self._db):
            raise ConflictError("Only the form creator can unarchive this capitalization form.")

        restore = self._status_before_archive(int(form.id), allowed=EDITABLE_STATUSES)
        old_status = form.status
        form.status = restore
        log_capex_event(
            self._db,
            form_id=int(form.id),
            action="unarchived",
            actor_user_id=actor_user_id,
            old_value={"status": old_status},
            new_value={"status": form.status},
        )
        self._db.commit()
        return self._to_detail(self._load(form_id), viewer_user_id=actor_user_id)

    def _status_before_archive(self, form_id: int, *, allowed: frozenset[str]) -> str:
        row = self._db.scalar(
            select(CapitalizationFormAudit)
            .where(
                CapitalizationFormAudit.form_id == form_id,
                CapitalizationFormAudit.action == "archived",
            )
            .order_by(CapitalizationFormAudit.id.desc())
            .limit(1)
        )
        if row is not None and isinstance(row.old_value, dict):
            prev = str(row.old_value.get("status") or "").strip().lower()
            if prev in allowed:
                return prev
        return STATUS_DRAFT

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
                selectinload(ApprovalRequest.workflow).selectinload(ApprovalWorkflow.steps),
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

        # Reassign only on the first approval level (after draft / submit).
        wf_steps = sorted(
            (req.workflow.steps or []) if req.workflow is not None else [],
            key=lambda s: int(s.step_order),
        )
        first_order = int(wf_steps[0].step_order) if wf_steps else int(pending.step.step_order)
        if int(pending.step.step_order) != first_order:
            raise ConflictError("Approver can only be reassigned on the first approval level.")

        if pending.assigned_user_id is not None and int(pending.assigned_user_id) == int(
            assignee_user_id
        ):
            raise ConflictError("Select a different approver.")

        from modules.platform.approvals.step_roles import role_names_label, step_role_ids

        engine = ApprovalEngineService(self._db)
        role_ids = step_role_ids(pending.step)
        role_name = role_names_label(self._db, role_ids)
        role_users: list[User] = []
        seen: set[int] = set()
        for rid in role_ids:
            for user in _users_in_role(self._db, int(rid), cost_center_id=form.cost_center_id):
                if int(user.id) in seen:
                    continue
                seen.add(int(user.id))
                role_users.append(user)
        if not any(int(u.id) == int(assignee_user_id) for u in role_users):
            scope = " for this cost center" if form.cost_center_id is not None else ""
            raise ConflictError(
                f"Selected user is not an active member of role {role_name!r}{scope}."
            )

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
        role_users = _users_in_role(
            self._db, int(first_role.id), cost_center_id=form.cost_center_id
        )
        if not any(int(u.id) == int(assignee_user_id) for u in role_users):
            scope = " for this cost center" if form.cost_center_id is not None else ""
            raise ConflictError(
                f"Selected user is not an active member of role {first_role.name!r}{scope}."
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
        cc_ids: set[int] = set()
        for ev in rows:
            if ev.action != "updated":
                continue
            for blob in (ev.old_value, ev.new_value):
                if not isinstance(blob, dict) or "cost_center_id" not in blob:
                    continue
                raw = blob.get("cost_center_id")
                if raw is None:
                    continue
                try:
                    cc_ids.add(int(raw))
                except (TypeError, ValueError):
                    continue
        cost_centers = {
            int(cc.id): cc
            for cc in self._db.scalars(
                select(CostCenterMaster).where(CostCenterMaster.id.in_(cc_ids))
            ).all()
        } if cc_ids else {}

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
                            from_value=_audit_change_value(k, ov.get(k), cost_centers),
                            to_value=_audit_change_value(k, nv.get(k), cost_centers),
                        )
                    )
            elif ev.action in ("submitted", "resubmitted"):
                role = (nv.get("role_name") or "").strip() or None
                who = (nv.get("assignee_name") or "").strip() or None
                nxt = role or (who if who and who != "—" else None)
                detail = f"Next: {nxt}" if nxt else None
            elif ev.action == "reassigned":
                old_who = ov.get("assignee_name") or "—"
                new_who = nv.get("assignee_name") or "—"
                role = nv.get("role_name") or ov.get("role_name") or "—"
                detail = f"{old_who} → {new_who} · {role}"
            elif ev.action == "step_approved":
                role = nv.get("step_role_name")
                if role:
                    label = f"Approved · {role}"
                nxt_role = (nv.get("next_role_name") or "").strip() or None
                nxt = (nv.get("next_assignee_name") or "").strip() or None
                parts = []
                if nxt_role or nxt:
                    parts.append(f"Next: {nxt_role or nxt}")
                if nv.get("comment"):
                    parts.append(f"Comment: {nv['comment']}")
                detail = "\n".join(parts) if parts else None
            elif ev.action == "rejected":
                if nv.get("comment"):
                    detail = f"Reason: {nv['comment']}"
                role = nv.get("step_role_name")
                if role:
                    label = f"Rejected · {role}"
            elif ev.action == "approved":
                role = nv.get("step_role_name")
                if role:
                    label = f"Approved · {role}"
                if nv.get("comment"):
                    detail = f"Comment: {nv['comment']}"
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


def _capitalization_form_link(form_id: int) -> str:
    base = (
        os.environ.get("FRONTEND_APP_URL") or os.environ.get("FRONTEND_ORIGIN") or "http://localhost:5173"
    ).rstrip("/")
    return f"{base}/dashboard/capitalization/{int(form_id)}"


def approval_success_recipients(
    *,
    creator: User | None,
    cost_center_users: list[User],
) -> list[User]:
    """Submitter plus Cost Center Users covering the form's cost center, de-duplicated."""
    seen: set[int] = set()
    out: list[User] = []
    for user in (creator, *cost_center_users):
        if user is None or user.id is None:
            continue
        uid = int(user.id)
        if uid in seen or not bool(user.is_active) or not (user.email or "").strip():
            continue
        seen.add(uid)
        out.append(user)
    return out


def notify_capitalization_approved(db: Session, form: CapitalizationForm) -> None:
    creator = db.get(User, int(form.created_by)) if form.created_by is not None else None
    cc_users: list[User] = []
    if form.cost_center_id is not None:
        role = db.scalar(select(Role).where(Role.name == ROLE_COST_CENTER_USER))
        if role is not None:
            cc_users = _users_in_role(db, int(role.id), cost_center_id=form.cost_center_id)
    recipients = approval_success_recipients(creator=creator, cost_center_users=cc_users)
    if not recipients:
        return
    cc = form.cost_center
    if cc is None and form.cost_center_id is not None:
        cc = db.get(CostCenterMaster, int(form.cost_center_id))
    cost_center = _cost_center_label(cc, form.cost_center_id)
    form_link = _capitalization_form_link(int(form.id))
    from modules.platform.emails.service import enqueue_trigger_events

    enqueue_trigger_events(
        [
            (
                "CAPITALIZATION_APPROVED",
                {
                    "user_name": user.full_name or user.email,
                    "email": user.email,
                    "form_number": form.form_number,
                    "asset_name": form.asset_name,
                    "cost_center": cost_center,
                    "form_link": form_link,
                },
            )
            for user in recipients
        ]
    )


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
    try:
        notify_capitalization_approved(db, form)
    except Exception:
        # Approval is already committed; a mail failure must not undo it.
        pass


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
