from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from core.permissions import get_flat_permission_codes_for_user
from modules.asset_masters.model import CostCenterMaster
from modules.assets.lifecycle import (
    is_operational,
    mark_disposed,
    mark_pending_disposal,
    is_pending_disposal,
    restore_from_pending_disposal,
)
from modules.assets.model import (
    AssetFinancialInformation,
    AssetLocationInformation,
    AssetMaster,
)
from modules.disposals.audit import log_disposal_event
from modules.disposals.constants import (
    ACTION_SUBMIT,
    ACTION_SUBMIT_WITH_ENGINEERING,
    ASSIGNEE_LEVEL_ROLES,
    EDITABLE_STATUSES,
    ENTITY_TYPE,
    ENTITY_TYPE_WITH_ENGINEERING,
    ROLE_TO_ASSIGNEE_LEVEL,
    RECEIVER_ASSIGNEE_LEVEL,
    STATUS_CANCELLED,
    STATUS_CLOSED,
    STATUS_DRAFT,
    STATUS_IN_REWORK,
    STATUS_LABELS,
    STATUS_PENDING_APPROVAL,
    STATUS_PENDING_CF_CLOSE,
    STATUS_PENDING_RECEIPT,
    STATUS_REJECTED,
    SUBMITTABLE_STATUSES,
)
from modules.disposals.model import (
    AssetDisposalOrder,
    AssetDisposalOrderAudit,
    AssetDisposalOrderItem,
)
from modules.disposals.schema import (
    CloseDisposalRequest,
    CreateDisposalOrderRequest,
    DisposalApprovalPanel,
    DisposalAssigneeListResponse,
    DisposalAssigneeOption,
    DisposalOrderAuditPublic,
    DisposalOrderDetail,
    DisposalOrderItemPublic,
    DisposalOrderListItem,
    DisposalOrderListResponse,
    DisposalWorkflowRunPublic,
    ReceiveDisposalRequest,
    SubmitDisposalOrderRequest,
    UpdateDisposalOrderRequest,
)
from modules.errors import ConflictError, NotFoundError
from modules.platform.approvals.assignment_service import get_workflow_for_action
from modules.platform.approvals.model import ApprovalRequest, ApprovalTask, ApprovalWorkflow
from modules.platform.approvals.service import ApprovalEngineService, ApprovalError
from modules.platform.org_units.model import OrgUnit
from modules.platform.roles.model import Role
from modules.platform.tasks.service import (
    _build_workflow_steps_for_request,
    _split_approval_task_runs,
    build_workflow_preview_steps,
)
from modules.platform.users.model import User
from modules.rbac_association import user_role

PERMISSION_RECEIVE = "disposal.receive"
PERMISSION_CLOSE = "disposal.close"

_TAB_STATUSES: dict[str, frozenset[str] | None] = {
    "all": None,
    "draft": EDITABLE_STATUSES,
    "pending": frozenset({STATUS_PENDING_APPROVAL}),
    "receipt": frozenset({STATUS_PENDING_RECEIPT, STATUS_PENDING_CF_CLOSE}),
    "closed": frozenset({STATUS_CLOSED, STATUS_CANCELLED}),
}


def action_and_entity_for_order(*, requires_engineering: bool) -> tuple[str, str]:
    if requires_engineering:
        return ACTION_SUBMIT_WITH_ENGINEERING, ENTITY_TYPE_WITH_ENGINEERING
    return ACTION_SUBMIT, ENTITY_TYPE


def _strip_or_none(value: str | None) -> str | None:
    if value is None:
        return None
    s = value.strip()
    return s or None


def _asset_plant_id(asset: AssetMaster) -> int | None:
    loc = asset.location
    if loc is None or loc.plant_id is None:
        return None
    return int(loc.plant_id)


def _asset_cost_center(asset: AssetMaster) -> str | None:
    fin = asset.financial
    return _strip_or_none(fin.cost_center) if fin is not None else None


def _asset_functional_location(asset: AssetMaster) -> str | None:
    loc = asset.location
    return _strip_or_none(loc.functional_location) if loc is not None else None


def _asset_actual_location(asset: AssetMaster) -> str | None:
    loc = asset.location
    return _strip_or_none(loc.actual_location) if loc is not None else None


def _ensure_location(asset: AssetMaster) -> AssetLocationInformation:
    if asset.location is None:
        asset.location = AssetLocationInformation(asset_id=int(asset.id))
    return asset.location


def _ensure_financial(asset: AssetMaster) -> AssetFinancialInformation:
    if asset.financial is None:
        asset.financial = AssetFinancialInformation(asset_id=int(asset.id))
    return asset.financial


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
        raise ConflictError("Active disposal workflow has no steps configured.")
    first = sorted(workflow.steps, key=lambda s: int(s.step_order))[0]
    role = db.get(Role, int(first.approver_role_id))
    if role is None:
        raise ConflictError("Workflow approver role is missing.")
    return role


def _user_display_name(db: Session, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    user = db.get(User, int(user_id))
    if user is None:
        return f"User #{user_id}"
    name = (user.full_name or "").strip()
    return name or user.username or user.email or str(user.id)


def _audit_payload_for_api(db: Session, value: dict | None) -> dict | None:
    """Human-readable audit fields for the UI (status labels, assignee names)."""
    if not value:
        return value
    out = dict(value)
    if isinstance(out.get("status"), str):
        code = out["status"]
        out["status"] = STATUS_LABELS.get(code, code.replace("_", " ").title())
    for key, name_key in (
        ("assigned_to", "assigned_to_name"),
        ("assignee_user_id", "assignee_name"),
        ("next_assignee_user_id", "next_assignee_name"),
    ):
        if key in out:
            uid = out.get(key)
            if name_key not in out and isinstance(uid, int):
                name = _user_display_name(db, uid)
                if name:
                    out[name_key] = name
            out.pop(key, None)
    return out


class DisposalOrderService:
    def __init__(self, db: Session) -> None:
        self._db = db

    # ------------------------------------------------------------------ loading

    def _next_order_number(self) -> str:
        year = datetime.now(timezone.utc).year
        prefix = f"ADO-{year}-"
        last = self._db.scalar(
            select(AssetDisposalOrder.order_number)
            .where(AssetDisposalOrder.order_number.like(f"{prefix}%"))
            .order_by(AssetDisposalOrder.id.desc())
            .limit(1)
        )
        seq = 1
        if last and last.startswith(prefix):
            try:
                seq = int(last[len(prefix) :]) + 1
            except ValueError:
                seq = 1
        return f"{prefix}{seq:04d}"

    def _load_order(self, order_id: int) -> AssetDisposalOrder:
        order = self._db.scalar(
            select(AssetDisposalOrder)
            .where(AssetDisposalOrder.id == order_id)
            .options(
                selectinload(AssetDisposalOrder.items)
                .selectinload(AssetDisposalOrderItem.asset)
                .selectinload(AssetMaster.location),
                selectinload(AssetDisposalOrder.items)
                .selectinload(AssetDisposalOrderItem.asset)
                .selectinload(AssetMaster.financial),
                selectinload(AssetDisposalOrder.plant),
                selectinload(AssetDisposalOrder.from_cost_center),
                selectinload(AssetDisposalOrder.creator),
                selectinload(AssetDisposalOrder.assignee),
            )
        )
        if order is None:
            raise NotFoundError("Disposal order", order_id)
        return order

    def _load_assets(self, asset_ids: list[int]) -> list[AssetMaster]:
        ids = list(dict.fromkeys(int(i) for i in asset_ids))
        if not ids:
            raise ConflictError("Select at least one asset.")
        assets = list(
            self._db.scalars(
                select(AssetMaster)
                .where(AssetMaster.id.in_(ids), AssetMaster.deleted_at.is_(None))
                .options(
                    selectinload(AssetMaster.location),
                    selectinload(AssetMaster.financial),
                )
            ).all()
        )
        found = {int(a.id) for a in assets}
        missing = [i for i in ids if i not in found]
        if missing:
            raise NotFoundError("Asset", missing[0])
        plants = {_asset_plant_id(a) for a in assets}
        if None in plants or len(plants) != 1:
            raise ConflictError("All assets on a disposal order must belong to the same plant.")
        return assets

    def _assert_assets_disposable(self, assets: list[AssetMaster]) -> None:
        """Only operational (active, approved) assets can be sent for disposal."""
        bad: list[str] = []
        for asset in assets:
            approval = (asset.approval_status or "").strip().lower()
            if not is_operational(asset.lifecycle_status) or approval not in {
                "approved",
                "not_required",
            }:
                bad.append(asset.asset_code or str(asset.id))
        if bad:
            sample = ", ".join(bad[:5])
            more = "…" if len(bad) > 5 else ""
            raise ConflictError(
                f"Only active, approved assets can be disposed: {sample}{more}."
            )

    def _assert_assets_match_order_reservation(
        self, assets: list[AssetMaster], *, reserved_asset_ids: set[int]
    ) -> None:
        """
        Draft/resubmit path: assets already on this disposal order may stay pending_disposal,
        but any newly added asset must still be active + approved.
        """
        bad: list[str] = []
        for asset in assets:
            approval = (asset.approval_status or "").strip().lower()
            asset_id = int(asset.id)
            if asset_id in reserved_asset_ids:
                if not (
                    is_pending_disposal(asset.lifecycle_status) or is_operational(asset.lifecycle_status)
                ) or approval not in {"approved", "not_required"}:
                    bad.append(asset.asset_code or str(asset.id))
                continue
            if not is_operational(asset.lifecycle_status) or approval not in {"approved", "not_required"}:
                bad.append(asset.asset_code or str(asset.id))
        if bad:
            sample = ", ".join(bad[:5])
            more = "…" if len(bad) > 5 else ""
            raise ConflictError(
                f"Only active, approved assets can be disposed: {sample}{more}."
            )

    def _resolve_from_cost_center(self, assets: list[AssetMaster]) -> CostCenterMaster | None:
        codes = {c for a in assets if (c := _asset_cost_center(a))}
        if len(codes) != 1:
            return None
        q = select(CostCenterMaster).where(CostCenterMaster.code == next(iter(codes)))
        plant_id = _asset_plant_id(assets[0])
        if plant_id is not None:
            q = q.where(CostCenterMaster.plant_id == plant_id)
        return self._db.scalar(q)

    def _replace_items(self, order: AssetDisposalOrder, assets: list[AssetMaster]) -> None:
        order.items.clear()
        self._db.flush()
        for asset in assets:
            order.items.append(
                AssetDisposalOrderItem(
                    asset_id=int(asset.id),
                    from_cost_center_code=_asset_cost_center(asset),
                    from_functional_location=_asset_functional_location(asset),
                    from_actual_location=_asset_actual_location(asset),
                )
            )

    def _assign(self, order: AssetDisposalOrder, *, to_user_id: int, by_user_id: int | None) -> None:
        order.assigned_to = int(to_user_id)
        order.assigned_by = by_user_id
        order.assigned_at = datetime.now(timezone.utc)

    def _order_assets(self, order: AssetDisposalOrder) -> list[AssetMaster]:
        assets = [item.asset for item in order.items if item.asset is not None]
        if assets:
            return assets
        return self._load_assets([int(item.asset_id) for item in order.items])

    def _mark_assets_pending_disposal(self, assets: list[AssetMaster]) -> None:
        for asset in assets:
            mark_pending_disposal(asset)

    def _restore_assets_active(self, assets: list[AssetMaster]) -> None:
        for asset in assets:
            restore_from_pending_disposal(asset)

    # -------------------------------------------------------------- assignees

    def list_assignees(self, *, level: str) -> DisposalAssigneeListResponse:
        role_name = ASSIGNEE_LEVEL_ROLES.get(level.strip().lower())
        if role_name is None:
            allowed = ", ".join(sorted(ASSIGNEE_LEVEL_ROLES))
            raise ConflictError(f"Invalid assignee level. Use one of: {allowed}.")
        role = self._db.scalar(select(Role).where(Role.name == role_name))
        if role is None:
            raise ConflictError(f"Role {role_name!r} is not configured.")
        return DisposalAssigneeListResponse(
            role_name=role_name,
            items=[
                DisposalAssigneeOption(id=int(u.id), full_name=u.full_name, email=u.email)
                for u in _users_in_role(self._db, int(role.id))
            ],
        )

    def list_assignees_for_action(self, *, action_code: str) -> DisposalAssigneeListResponse:
        """Users in the first step role of the workflow mapped to this disposal action."""
        wf = get_workflow_for_action(self._db, action_code)
        if wf is None or not wf.steps:
            raise ConflictError(
                "No active disposal approval workflow is configured. Contact an administrator."
            )
        role = _first_step_role(self._db, wf)
        return DisposalAssigneeListResponse(
            role_name=str(role.name),
            items=[
                DisposalAssigneeOption(id=int(u.id), full_name=u.full_name, email=u.email)
                for u in _users_in_role(self._db, int(role.id))
            ],
        )

    # ------------------------------------------------------------ create/edit

    def create_order(
        self, data: CreateDisposalOrderRequest, *, actor_user_id: int
    ) -> DisposalOrderDetail:
        assets = self._load_assets(data.asset_ids)
        self._assert_assets_disposable(assets)
        plant_id = _asset_plant_id(assets[0])
        if plant_id is None:
            raise ConflictError("Selected assets must have a plant.")
        from_cc = self._resolve_from_cost_center(assets)
        order = AssetDisposalOrder(
            order_number=self._next_order_number(),
            plant_id=int(plant_id),
            from_cost_center_id=int(from_cc.id) if from_cc is not None else None,
            requires_engineering=bool(data.requires_engineering),
            created_by=actor_user_id,
            status=STATUS_DRAFT,
            remarks=_strip_or_none(data.remarks),
        )
        self._db.add(order)
        self._db.flush()
        self._replace_items(order, assets)
        self._mark_assets_pending_disposal(assets)
        log_disposal_event(
            self._db,
            order_id=int(order.id),
            action="created",
            actor_user_id=actor_user_id,
            new_value={
                "order_number": order.order_number,
                "assets": [a.asset_code or str(a.id) for a in assets],
                "requires_engineering": bool(order.requires_engineering),
            },
        )
        if data.submit:
            if data.assignee_user_id is None:
                raise ConflictError("Select an approver before submitting.")
            self._submit(
                order,
                actor_user_id=actor_user_id,
                assignee_user_id=int(data.assignee_user_id),
            )
        else:
            self._db.commit()
        return self.get_order(int(order.id), viewer_user_id=actor_user_id)

    def update_order(
        self, order_id: int, data: UpdateDisposalOrderRequest, *, actor_user_id: int
    ) -> DisposalOrderDetail:
        order = self._load_order(order_id)
        if order.status not in EDITABLE_STATUSES:
            raise ConflictError(
                "Disposal order can only be edited while draft, rejected, or in rework."
            )
        before = {
            "remarks": order.remarks,
            "requires_engineering": bool(order.requires_engineering),
            "asset_count": len(order.items),
        }
        patch = data.model_dump(exclude_unset=True)
        if "remarks" in patch:
            order.remarks = _strip_or_none(patch["remarks"])
        if patch.get("requires_engineering") is not None:
            order.requires_engineering = bool(patch["requires_engineering"])
        if patch.get("asset_ids") is not None:
            previous_assets = self._order_assets(order)
            assets = self._load_assets(patch["asset_ids"])
            old_ids = {int(a.id) for a in previous_assets}
            self._assert_assets_match_order_reservation(assets, reserved_asset_ids=old_ids)
            plant_id = _asset_plant_id(assets[0])
            if plant_id is None or int(plant_id) != int(order.plant_id):
                raise ConflictError("Assets must remain on the same plant as the disposal order.")
            from_cc = self._resolve_from_cost_center(assets)
            new_ids = {int(a.id) for a in assets}
            removed_assets = [a for a in previous_assets if int(a.id) not in new_ids]
            added_assets = [a for a in assets if int(a.id) not in old_ids]
            self._restore_assets_active(removed_assets)
            order.from_cost_center_id = int(from_cc.id) if from_cc is not None else None
            self._replace_items(order, assets)
            self._mark_assets_pending_disposal(added_assets)
        log_disposal_event(
            self._db,
            order_id=int(order.id),
            action="updated",
            actor_user_id=actor_user_id,
            old_value=before,
            new_value={
                "remarks": order.remarks,
                "requires_engineering": bool(order.requires_engineering),
                "asset_count": len(order.items),
            },
        )
        self._db.commit()
        return self.get_order(order_id, viewer_user_id=actor_user_id)

    def archive_draft_order(
        self, order_id: int, *, actor_user_id: int
    ) -> DisposalOrderDetail:
        """Archive a draft — keep the order for history and reactivate its assets."""
        order = self._load_order(order_id)
        if order.status != STATUS_DRAFT:
            raise ConflictError("Only draft disposal orders can be archived.")
        creator_id = int(order.created_by) if order.created_by is not None else None
        if creator_id is not None and creator_id != int(actor_user_id):
            viewer = self._db.get(User, int(actor_user_id))
            if viewer is None or not viewer.is_superuser:
                raise ConflictError("Only the draft creator can archive this disposal order.")
        assets = self._order_assets(order)
        self._restore_assets_active(assets)
        old_status = order.status
        order.status = STATUS_CANCELLED
        log_disposal_event(
            self._db,
            order_id=int(order.id),
            action="archived",
            actor_user_id=actor_user_id,
            old_value={"status": old_status},
            new_value={
                "status": order.status,
                "reactivated_assets": [a.asset_code or str(a.id) for a in assets],
            },
        )
        self._db.commit()
        return self.get_order(order_id, viewer_user_id=actor_user_id)

    # ---------------------------------------------------------------- submit

    def submit_order(
        self, order_id: int, data: SubmitDisposalOrderRequest, *, actor_user_id: int
    ) -> DisposalOrderDetail:
        order = self._load_order(order_id)
        if data.requires_engineering is not None and order.status in EDITABLE_STATUSES:
            order.requires_engineering = bool(data.requires_engineering)
            self._db.flush()
        self._submit(
            order,
            actor_user_id=actor_user_id,
            assignee_user_id=int(data.assignee_user_id),
        )
        return self.get_order(order_id, viewer_user_id=actor_user_id)

    def _order_payload(self, order: AssetDisposalOrder, *, action_code: str) -> dict:
        return {
            "action_code": action_code,
            "order_number": order.order_number,
            "asset_count": len(order.items),
            "requires_engineering": bool(order.requires_engineering),
            "from_cost_center_code": (
                order.from_cost_center.code if order.from_cost_center is not None else None
            ),
        }

    def _submit(
        self,
        order: AssetDisposalOrder,
        *,
        actor_user_id: int,
        assignee_user_id: int,
    ) -> None:
        if order.status not in SUBMITTABLE_STATUSES:
            raise ConflictError("Disposal order cannot be submitted in its current status.")
        assets = self._order_assets(order)
        if not assets:
            raise ConflictError("Select at least one asset before submitting.")
        self._assert_assets_match_order_reservation(
            assets, reserved_asset_ids={int(a.id) for a in assets}
        )

        action_code, entity_type = action_and_entity_for_order(
            requires_engineering=bool(order.requires_engineering)
        )
        wf = get_workflow_for_action(self._db, action_code)
        if wf is None:
            raise ConflictError(
                "No active disposal approval workflow is configured. Contact an administrator."
            )
        first_role = _first_step_role(self._db, wf)
        if not any(
            int(u.id) == int(assignee_user_id)
            for u in _users_in_role(self._db, int(first_role.id))
        ):
            raise ConflictError(
                f"Selected user is not an active member of role {first_role.name!r}."
            )

        engine = ApprovalEngineService(self._db)
        assign_meta = {
            "assignee_user_id": int(assignee_user_id),
            "assignee_name": _user_display_name(self._db, assignee_user_id),
            "role_name": str(first_role.name),
        }
        try:
            existing = (
                self._db.get(ApprovalRequest, int(order.approval_request_id))
                if order.approval_request_id
                else None
            )
            # ponytail: toggling engineering after a reject switches entity_type, so the old
            # request is abandoned and a fresh one is created (prior attempts stay in the audit
            # log, not in the approval panel). Upgrade path: snapshot runs like CapEx does.
            same_workflow = (
                existing is not None
                and str(existing.entity_type) == entity_type
                and int(existing.workflow_id) == int(wf.id)
            )
            if same_workflow and order.status in (STATUS_REJECTED, STATUS_IN_REWORK):
                try:
                    engine.resubmit_rejected_request(
                        request_id=int(order.approval_request_id),
                        actor_user_id=actor_user_id,
                        assigned_user_id=int(assignee_user_id),
                    )
                    order.status = STATUS_PENDING_APPROVAL
                    order.rejection_comment = None
                    self._assign(order, to_user_id=assignee_user_id, by_user_id=actor_user_id)
                    log_disposal_event(
                        self._db,
                        order_id=int(order.id),
                        action="resubmitted",
                        actor_user_id=actor_user_id,
                        new_value=assign_meta,
                    )
                    self._db.commit()
                    return
                except ApprovalError:
                    pass

            req = engine.create_request_for_entity(
                workflow=wf,
                entity_type=entity_type,
                entity_id=int(order.id),
                payload=self._order_payload(order, action_code=action_code),
                created_by=actor_user_id,
                assigned_user_id=int(assignee_user_id),
            )
            order.approval_request_id = int(req.id)
            order.status = STATUS_PENDING_APPROVAL
            order.rejection_comment = None
            self._assign(order, to_user_id=assignee_user_id, by_user_id=actor_user_id)
            log_disposal_event(
                self._db,
                order_id=int(order.id),
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

    def reassign_approver(
        self, order_id: int, *, actor_user_id: int, assignee_user_id: int
    ) -> DisposalOrderDetail:
        """Move the current pending approval task to a different user in the same role."""
        order = self._load_order(order_id)
        if order.status != STATUS_PENDING_APPROVAL:
            raise ConflictError(
                "Approver can only be reassigned while the order is pending approval."
            )
        if order.approval_request_id is None:
            raise ConflictError("No active approval request to reassign.")
        req = self._db.scalar(
            select(ApprovalRequest)
            .where(ApprovalRequest.id == int(order.approval_request_id))
            .options(selectinload(ApprovalRequest.tasks).selectinload(ApprovalTask.step))
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
        if not any(int(u.id) == int(assignee_user_id) for u in engine._users_for_role(role_id)):
            raise ConflictError(f"Selected user is not an active member of role {role_name!r}.")

        old_id = int(pending.assigned_user_id) if pending.assigned_user_id is not None else None
        pending.assigned_user_id = int(assignee_user_id)
        pending.assigned_role_id = None
        self._assign(order, to_user_id=assignee_user_id, by_user_id=actor_user_id)
        self._db.flush()

        from modules.platform.approvals.model import TaskAuditLog

        self._db.add(
            TaskAuditLog(
                task_id=int(pending.id),
                action="assigned",
                actor_user_id=actor_user_id,
                old_value={"assigned_user_id": old_id},
                new_value={"assigned_user_id": int(assignee_user_id)},
            )
        )
        log_disposal_event(
            self._db,
            order_id=int(order.id),
            action="reassigned",
            actor_user_id=actor_user_id,
            old_value={
                "assignee_user_id": old_id,
                "assignee_name": _user_display_name(self._db, old_id),
                "role_name": role_name,
            },
            new_value={
                "assignee_user_id": int(assignee_user_id),
                "assignee_name": _user_display_name(self._db, assignee_user_id),
                "role_name": role_name,
            },
        )
        try:
            engine._notify_approvers_for_task(task=pending, req=req)
        except Exception:
            pass
        self._db.commit()
        return self.get_order(order_id, viewer_user_id=actor_user_id)

    # ------------------------------------------------------- receive / close

    def _actor_may_act(self, order: AssetDisposalOrder, *, actor_user_id: int, permission: str) -> bool:
        """Assigned user, a holder of the stage permission, or a superuser."""
        if order.assigned_to is not None and int(order.assigned_to) == int(actor_user_id):
            return True
        actor = self._db.get(User, actor_user_id)
        if actor is not None and actor.is_superuser:
            return True
        codes = set(get_flat_permission_codes_for_user(self._db, actor_user_id))
        return permission in codes or permission.replace(".", ":", 1) in codes

    def receive_order(
        self, order_id: int, data: ReceiveDisposalRequest, *, actor_user_id: int
    ) -> DisposalOrderDetail:
        order = self._load_order(order_id)
        if order.status != STATUS_PENDING_RECEIPT:
            raise ConflictError("Only fully approved disposal orders can be received.")
        if not self._actor_may_act(
            order, actor_user_id=actor_user_id, permission=PERMISSION_RECEIVE
        ):
            raise ConflictError("Only the assigned receiver can receive this disposal order.")

        cc = self._db.get(CostCenterMaster, int(data.cost_center_id))
        if cc is None:
            raise NotFoundError("Cost center", data.cost_center_id)
        if int(cc.plant_id) != int(order.plant_id):
            raise ConflictError(
                "Receive cost center must belong to the same plant as the assets."
            )

        cf_user = self._db.get(User, int(data.assigned_to))
        if cf_user is None or not cf_user.is_active:
            raise NotFoundError("User", data.assigned_to)

        functional_location = data.functional_location.strip()
        actual_location = data.actual_location.strip()
        if not functional_location or not actual_location:
            raise ConflictError("Actual Location 1 and Actual Location 2 are required.")

        for item in order.items:
            asset = item.asset
            if asset is None:
                continue
            loc = _ensure_location(asset)
            loc.functional_location = functional_location
            loc.actual_location = actual_location
            _ensure_financial(asset).cost_center = cc.code

        old_status = order.status
        if data.remarks is not None:
            order.remarks = _strip_or_none(data.remarks)
        order.status = STATUS_PENDING_CF_CLOSE
        self._assign(order, to_user_id=int(cf_user.id), by_user_id=actor_user_id)
        log_disposal_event(
            self._db,
            order_id=int(order.id),
            action="received",
            actor_user_id=actor_user_id,
            old_value={"status": old_status},
            new_value={
                "status": order.status,
                "assigned_to": int(cf_user.id),
                "cost_center": cc.code,
                "functional_location": functional_location,
                "actual_location": actual_location,
            },
        )
        self._db.commit()
        return self.get_order(order_id, viewer_user_id=actor_user_id)

    def close_order(
        self, order_id: int, data: CloseDisposalRequest, *, actor_user_id: int
    ) -> DisposalOrderDetail:
        order = self._load_order(order_id)
        if order.status != STATUS_PENDING_CF_CLOSE:
            raise ConflictError("Only disposal orders that have been received can be approved.")
        if not self._actor_may_act(order, actor_user_id=actor_user_id, permission=PERMISSION_CLOSE):
            raise ConflictError("Only the assigned Central Finance user can approve this order.")

        disposed: list[str] = []
        for item in order.items:
            asset = item.asset
            if asset is None:
                continue
            mark_disposed(asset)
            disposed.append(asset.asset_code or str(asset.id))

        old_status = order.status
        if data.remarks is not None:
            order.remarks = _strip_or_none(data.remarks)
        order.status = STATUS_CLOSED
        order.closed_at = datetime.now(timezone.utc)
        log_disposal_event(
            self._db,
            order_id=int(order.id),
            action="closed",
            actor_user_id=actor_user_id,
            old_value={"status": old_status},
            new_value={"status": order.status, "disposed_assets": disposed},
        )
        self._db.commit()
        return self.get_order(order_id, viewer_user_id=actor_user_id)

    # -------------------------------------------------------- approval panel

    def _workflow_runs_for_request(
        self, req: ApprovalRequest
    ) -> list[DisposalWorkflowRunPublic]:
        out: list[DisposalWorkflowRunPublic] = []
        wf_step_ids = {int(s.id) for s in (req.workflow.steps if req.workflow else [])}
        live_tasks = [
            t for t in (req.tasks or []) if t.step_id is not None and int(t.step_id) in wf_step_ids
        ]
        runs = _split_approval_task_runs(live_tasks)
        for idx, run_tasks in enumerate(runs):
            is_last = idx == len(runs) - 1
            has_reject = any(str(t.status).lower() == "rejected" for t in run_tasks)
            if is_last and str(req.status).lower() == "pending" and not has_reject:
                status_override = None
            elif has_reject:
                status_override = "rejected"
            elif is_last:
                status_override = str(req.status)
            else:
                status_override = "rejected"
            out.append(
                DisposalWorkflowRunPublic(
                    attempt=idx + 1,
                    request_id=int(req.id),
                    request_status=status_override or str(req.status),
                    is_current=is_last,
                    workflow_steps=_build_workflow_steps_for_request(
                        self._db, req, tasks=run_tasks, status_override=status_override
                    ),
                )
            )
        return out

    def _approval_panel(
        self, order: AssetDisposalOrder, *, viewer_user_id: int | None
    ) -> DisposalApprovalPanel | None:
        if order.approval_request_id is None:
            # Show a preview of the workflow steps even before submission.
            action_code, _ = action_and_entity_for_order(
                requires_engineering=bool(order.requires_engineering)
            )
            wf = get_workflow_for_action(self._db, action_code)
            if wf is None or not wf.steps:
                return None
            preview_steps = build_workflow_preview_steps(self._db, wf)
            if not preview_steps:
                return None
            return DisposalApprovalPanel(
                request_id=0,
                request_status="preview",
                workflow_steps=preview_steps,
            )
        req = self._db.scalar(
            select(ApprovalRequest)
            .where(ApprovalRequest.id == int(order.approval_request_id))
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
            if str(t.task_type) != "approval" or str(t.status).lower() != "pending":
                continue
            pending_task = t
            if (
                viewer_user_id is not None
                and t.assigned_user_id is not None
                and int(t.assigned_user_id) == int(viewer_user_id)
            ):
                my_pending = int(t.id)
            break

        current_assignee_id: int | None = None
        current_assignee_name: str | None = None
        current_role: str | None = None
        current_level: str | None = None
        if pending_task is not None:
            if pending_task.assigned_user_id is not None:
                current_assignee_id = int(pending_task.assigned_user_id)
                current_assignee_name = _user_display_name(self._db, current_assignee_id)
            if pending_task.step is not None:
                role = self._db.get(Role, int(pending_task.step.approver_role_id))
                if role is not None:
                    current_role = role.name
                    current_level = ROLE_TO_ASSIGNEE_LEVEL.get(role.name)

        is_final = True
        needs_next = False
        next_role: str | None = None
        next_level: str | None = None
        if str(req.status) == "pending" and steps:
            current = next((s for s in steps if s.phase == "current"), None)
            if current is not None:
                is_final = int(current.step_order) >= int(current.total_steps)
                if is_final:
                    # Store Person names the receiver who will take the assets.
                    needs_next = True
                    next_level = RECEIVER_ASSIGNEE_LEVEL
                    next_role = "Receiver"
                else:
                    nxt = next(
                        (s for s in steps if int(s.step_order) == int(current.step_order) + 1),
                        None,
                    )
                    if nxt is not None:
                        needs_next = True
                        next_role = nxt.approver_role_name or None
                        if next_role:
                            next_level = ROLE_TO_ASSIGNEE_LEVEL.get(next_role)
        return DisposalApprovalPanel(
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
            is_final_step=is_final,
            needs_next_assignee=needs_next,
            next_step_role_name=next_role,
            next_assignee_level=next_level,
        )

    # ------------------------------------------------------------------ reads

    def list_orders(self, *, tab: str, page: int, page_size: int) -> DisposalOrderListResponse:
        statuses = _TAB_STATUSES.get(tab, None)
        where = [AssetDisposalOrder.status.in_(statuses)] if statuses is not None else []
        total = int(
            self._db.scalar(select(func.count()).select_from(AssetDisposalOrder).where(*where)) or 0
        )
        rows = list(
            self._db.scalars(
                select(AssetDisposalOrder)
                .where(*where)
                .options(
                    selectinload(AssetDisposalOrder.plant),
                    selectinload(AssetDisposalOrder.from_cost_center),
                    selectinload(AssetDisposalOrder.creator),
                    selectinload(AssetDisposalOrder.assignee),
                    selectinload(AssetDisposalOrder.items),
                )
                .order_by(AssetDisposalOrder.id.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            ).all()
        )
        return DisposalOrderListResponse(
            items=[
                DisposalOrderListItem(
                    id=int(r.id),
                    order_number=r.order_number,
                    plant_name=(r.plant.name or r.plant.code or "") if r.plant else "",
                    from_cost_center_code=r.from_cost_center.code if r.from_cost_center else None,
                    asset_count=len(r.items),
                    status=r.status,
                    requires_engineering=bool(r.requires_engineering),
                    assigned_to_name=r.assignee.full_name if r.assignee else None,
                    created_by_name=r.creator.full_name if r.creator else None,
                    created_at=r.created_at,
                )
                for r in rows
            ],
            total=total,
            page=page,
            page_size=page_size,
        )

    def list_audit(self, order_id: int) -> list[DisposalOrderAuditPublic]:
        if self._db.get(AssetDisposalOrder, order_id) is None:
            raise NotFoundError("Disposal order", order_id)
        rows = list(
            self._db.scalars(
                select(AssetDisposalOrderAudit)
                .where(AssetDisposalOrderAudit.order_id == int(order_id))
                .options(selectinload(AssetDisposalOrderAudit.actor))
                .order_by(AssetDisposalOrderAudit.id.desc())
            ).all()
        )
        return [
            DisposalOrderAuditPublic(
                id=int(a.id),
                action=str(a.action),
                actor_name=(
                    (a.actor.full_name or a.actor.email) if a.actor is not None else "System"
                ),
                old_value=_audit_payload_for_api(self._db, a.old_value),
                new_value=_audit_payload_for_api(self._db, a.new_value),
                created_at=a.created_at,
            )
            for a in rows
        ]

    def get_order(self, order_id: int, *, viewer_user_id: int | None = None) -> DisposalOrderDetail:
        order = self._load_order(order_id)
        viewer = self._db.get(User, viewer_user_id) if viewer_user_id else None
        is_super = bool(viewer is not None and viewer.is_superuser)
        is_creator = (
            viewer_user_id is not None
            and order.created_by is not None
            and int(order.created_by) == int(viewer_user_id)
        )
        plant = order.plant
        plant_name = ""
        if isinstance(plant, OrgUnit):
            plant_name = plant.name or plant.code or ""

        return DisposalOrderDetail(
            id=int(order.id),
            order_number=order.order_number,
            plant_id=int(order.plant_id),
            plant_name=plant_name,
            from_cost_center_id=(
                int(order.from_cost_center_id) if order.from_cost_center_id else None
            ),
            from_cost_center_code=order.from_cost_center.code if order.from_cost_center else None,
            from_cost_center_description=(
                order.from_cost_center.description if order.from_cost_center else None
            ),
            requires_engineering=bool(order.requires_engineering),
            status=order.status,
            remarks=order.remarks,
            rejection_comment=order.rejection_comment,
            approval_request_id=(
                int(order.approval_request_id) if order.approval_request_id else None
            ),
            created_by=int(order.created_by) if order.created_by else None,
            created_by_name=order.creator.full_name if order.creator else None,
            assigned_to=int(order.assigned_to) if order.assigned_to else None,
            assigned_to_name=order.assignee.full_name if order.assignee else None,
            assigned_at=order.assigned_at,
            closed_at=order.closed_at,
            created_at=order.created_at,
            updated_at=order.updated_at,
            items=[
                DisposalOrderItemPublic(
                    id=int(i.id),
                    asset_id=int(i.asset_id),
                    asset_code=i.asset.asset_code if i.asset else "",
                    asset_name=i.asset.asset_name if i.asset else "",
                    from_cost_center_code=i.from_cost_center_code,
                    from_functional_location=i.from_functional_location,
                    from_actual_location=i.from_actual_location,
                )
                for i in order.items
            ],
            audit=self.list_audit(int(order.id)),
            approval_panel=self._approval_panel(order, viewer_user_id=viewer_user_id),
            can_submit=(order.status in SUBMITTABLE_STATUSES) and (is_creator or is_super),
            can_edit=(order.status in EDITABLE_STATUSES) and (is_creator or is_super),
            can_receive=(
                order.status == STATUS_PENDING_RECEIPT
                and viewer_user_id is not None
                and self._actor_may_act(
                    order, actor_user_id=int(viewer_user_id), permission=PERMISSION_RECEIVE
                )
            ),
            can_close=(
                order.status == STATUS_PENDING_CF_CLOSE
                and viewer_user_id is not None
                and self._actor_may_act(
                    order, actor_user_id=int(viewer_user_id), permission=PERMISSION_CLOSE
                )
            ),
        )


# ------------------------------------------------- approval engine callbacks


def finalize_disposal_approval(
    db: Session,
    *,
    order_id: int,
    approver_user_id: int | None,
    step_role_name: str | None = None,
    comment: str | None = None,
    scrapyard_user_id: int | None = None,
) -> None:
    """Final approval: Store Person hands the order to the selected receiver."""
    order = db.get(AssetDisposalOrder, order_id)
    if order is None:
        return
    if scrapyard_user_id is None:
        raise ConflictError("Select the receiver before giving final approval.")
    receiver = db.get(User, int(scrapyard_user_id))
    if receiver is None or not receiver.is_active:
        raise NotFoundError("User", scrapyard_user_id)
    order.status = STATUS_PENDING_RECEIPT
    order.rejection_comment = None
    order.assigned_to = int(receiver.id)
    order.assigned_by = approver_user_id
    order.assigned_at = datetime.now(timezone.utc)
    log_disposal_event(
        db,
        order_id=int(order.id),
        action="approved",
        actor_user_id=approver_user_id,
        new_value={
            "status": order.status,
            "step_role_name": step_role_name,
            "assigned_to": int(receiver.id),
            "comment": (comment or "").strip() or None,
        },
    )
    db.commit()


def reject_disposal_approval(
    db: Session,
    *,
    order_id: int,
    approver_user_id: int | None,
    comment: str | None,
    step_role_name: str | None = None,
) -> None:
    order = db.get(AssetDisposalOrder, order_id)
    if order is None:
        return
    order.status = STATUS_IN_REWORK
    order.rejection_comment = (comment or "").strip() or None
    if order.created_by is not None:
        order.assigned_to = int(order.created_by)
        order.assigned_by = approver_user_id
        order.assigned_at = datetime.now(timezone.utc)
    log_disposal_event(
        db,
        order_id=int(order.id),
        action="rejected",
        actor_user_id=approver_user_id,
        new_value={
            "status": order.status,
            "comment": order.rejection_comment,
            "step_role_name": step_role_name,
        },
    )
    db.commit()


def log_disposal_step_approved(
    db: Session,
    *,
    order_id: int,
    actor_user_id: int | None,
    step_role_name: str | None,
    next_assignee_user_id: int | None,
    next_role_name: str | None,
    comment: str | None = None,
) -> None:
    order = db.get(AssetDisposalOrder, order_id)
    if order is not None and next_assignee_user_id is not None:
        order.assigned_to = int(next_assignee_user_id)
        order.assigned_by = actor_user_id
        order.assigned_at = datetime.now(timezone.utc)
    log_disposal_event(
        db,
        order_id=order_id,
        action="step_approved",
        actor_user_id=actor_user_id,
        new_value={
            "step_role_name": step_role_name,
            "next_assignee_user_id": next_assignee_user_id,
            "next_assignee_name": _user_display_name(db, next_assignee_user_id),
            "next_role_name": next_role_name,
            "comment": (comment or "").strip() or None,
        },
    )
