from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.orm import Session, selectinload

from modules.asset_masters.location_lookup import (
    resolve_plant_location_names,
    rewrite_audit_master_codes,
)
from modules.asset_masters.model import CostCenterAssetCustodian, CostCenterMaster
from modules.assets.lifecycle import (
    LIFECYCLE_ACTIVE,
    LIFECYCLE_PENDING_TRANSFER,
    mark_pending_transfer,
    restore_from_pending_transfer,
)
from modules.assets.model import (
    AssetFinancialInformation,
    AssetLocationInformation,
    AssetMaster,
)
from modules.errors import ConflictError, NotFoundError
from modules.list_sort import apply_sort_dir, archived_last_expr
from modules.platform.approvals.assignment_service import get_workflow_for_action
from modules.platform.approvals.list_inbox import pending_role_names_for_requests
from modules.platform.approvals.model import (
    ApprovalRequest,
    ApprovalStep,
    ApprovalTask,
    ApprovalWorkflow,
)
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
from modules.transfers.constants import (
    ACTION_SUBMIT,
    ACTIVE_STATUSES,
    ARCHIVABLE_STATUSES,
    ASSIGNEE_LEVEL_ROLES,
    CREATOR_ACTION_STATUSES,
    EDITABLE_STATUSES,
    ENTITY_TYPE,
    PENDING_APPROVAL_STATUSES,
    REJECTABLE_STATUSES,
    RESUMABLE_STATUSES,
    ROLE_TO_ASSIGNEE_LEVEL,
    STATUS_APPROVED_BY_CF,
    STATUS_CANCELLED,
    STATUS_CLOSED,
    STATUS_CONFIRMED_BY_CF,
    STATUS_DRAFT,
    STATUS_IN_REWORK,
    STATUS_LABELS,
    STATUS_PENDING_APPROVAL,
    TRANSFER_IN_PROGRESS_MESSAGE,
    STATUS_RECEIVED_BY_CC2,
    STATUS_REJECTED,
    SUBMITTABLE_STATUSES,
    status_codes_matching_search,
    transfer_needs_next_assignee,
)
from modules.transfers.model import AssetTransferOrder, AssetTransferOrderAudit, AssetTransferOrderItem
from modules.transfers.schema import (
    Cc2AssignTransferRequest,
    CfApproveTransferRequest,
    CfRejectTransferRequest,
    CreateTransferOrderRequest,
    SaveReceiveLocationsRequest,
    SubmitTransferOrderRequest,
    TransferApprovalPanel,
    TransferAssigneeListResponse,
    TransferAssigneeOption,
    TransferDestinationCostCenter,
    TransferOrderAuditPublic,
    TransferOrderDetail,
    TransferOrderItemPublic,
    TransferOrderListItem,
    TransferOrderListResponse,
    TransferListFilterCostCenter,
    TransferListFilterOptionsResponse,
    TransferListFilterPlant,
    TransferInProgressAsset,
    TransferWorkflowRunPublic,
    UpdateTransferOrderRequest,
    ValidateTransferAssetsResponse,
)

_TAB_STATUSES: dict[str, frozenset[str] | None] = {
    "all": None,
    "draft": EDITABLE_STATUSES,
    "pending": PENDING_APPROVAL_STATUSES,
    "assigned_to_cf": PENDING_APPROVAL_STATUSES,
    "rejected": RESUMABLE_STATUSES,
    "approved_by_cf": frozenset({STATUS_APPROVED_BY_CF}),
    "received_by_cc2": frozenset({STATUS_RECEIVED_BY_CC2}),
    "confirmed_by_cf": frozenset({STATUS_CONFIRMED_BY_CF}),
    "closed": frozenset({STATUS_CLOSED}),
    "active": ACTIVE_STATUSES,
}


def action_and_entity_for_order() -> tuple[str, str]:
    return ACTION_SUBMIT, ENTITY_TYPE


CREATOR_ASSIGNEE_ERROR = "Cannot assign this transfer order to the user who created it."


def exclude_creator_from_assignees(
    users: list[User],
    *,
    created_by: int | None = None,
    actor_user_id: int | None = None,
) -> list[User]:
    """Hide the order creator (or the actor on create) from workflow assignee pickers."""
    skip = created_by if created_by is not None else actor_user_id
    if skip is None:
        return users
    skip_id = int(skip)
    return [u for u in users if int(u.id) != skip_id]


def assert_assignee_is_not_creator(*, created_by: int | None, assigned_to: int) -> None:
    if created_by is not None and int(assigned_to) == int(created_by):
        raise ConflictError(CREATOR_ASSIGNEE_ERROR)


def _first_step_role(db: Session, workflow: ApprovalWorkflow) -> Role:
    if not workflow.steps:
        raise ConflictError("Active transfer workflow has no steps configured.")
    first = sorted(workflow.steps, key=lambda s: int(s.step_order))[0]
    role = db.get(Role, int(first.approver_role_id))
    if role is None:
        raise ConflictError("Workflow approver role is missing.")
    return role


def _strip_or_none(value: str | None) -> str | None:
    if value is None:
        return None
    s = value.strip()
    return s or None


def _actor_may_discard_transfer(order: AssetTransferOrder, *, actor_user_id: int, db: Session) -> bool:
    """Archive / unarchive: order creator (or platform superuser) only."""
    creator_id = int(order.created_by) if order.created_by is not None else None
    if creator_id is not None and creator_id == int(actor_user_id):
        return True
    viewer = db.get(User, int(actor_user_id))
    return viewer is not None and bool(viewer.is_superuser)


def _item_dest_custodian_ids(order: AssetTransferOrder) -> set[int]:
    ids: set[int] = set()
    order_cid = getattr(order, "to_asset_custodian_id", None)
    if order_cid is not None:
        ids.add(int(order_cid))
    for item in getattr(order, "items", None) or []:
        cid = getattr(item, "to_asset_custodian_id", None)
        if cid is not None:
            ids.add(int(cid))
    return ids


def _is_destination_actor(order: AssetTransferOrder, viewer_user_id: int | None) -> bool:
    if viewer_user_id is None:
        return False
    uid = int(viewer_user_id)
    if uid in _item_dest_custodian_ids(order):
        return True
    if order.assigned_to is not None and int(order.assigned_to) == uid:
        return True
    return False


def _is_returned_to_receiver(db: Session, order: AssetTransferOrder) -> bool:
    """Post-receive CF reject: same order awaits destination receive again (not creator resume)."""
    if not (order.rejection_reason or "").strip():
        return False
    # Legacy rows wrote approved_by_cf + reason before status was normalized to rejected.
    if order.status == STATUS_APPROVED_BY_CF:
        return True
    if order.status != STATUS_REJECTED:
        return False
    # Bounce keeps the approval request pending with receive reopened; creator reject closes it.
    if order.approval_request_id is None:
        return False
    req = db.get(ApprovalRequest, int(order.approval_request_id))
    return req is not None and str(req.status) == "pending"


def _list_action_label(
    db: Session,
    order: AssetTransferOrder,
    viewer_user_id: int | None,
    pending_kinds: dict[int, str],
) -> str | None:
    """Short label for what the viewer should do next on this order, if anything."""
    if viewer_user_id is None:
        return None
    uid = int(viewer_user_id)
    status = order.status
    bounced_to_receiver = _is_returned_to_receiver(db, order)
    # Creator resumes only when reject is theirs to restart — not a bounce to destination.
    if (
        status in RESUMABLE_STATUSES
        and not bounced_to_receiver
        and (order.created_by is not None and int(order.created_by) == uid)
    ):
        return "Restart"
    if status in EDITABLE_STATUSES and (
        (order.created_by is not None and int(order.created_by) == uid)
        or (
            order.assigned_to is not None
            and int(order.assigned_to) == uid
            and _is_destination_actor(order, uid)
        )
    ):
        return "Submit"
    req_id = int(order.approval_request_id) if order.approval_request_id is not None else None
    if req_id is not None and req_id in pending_kinds:
        kind = pending_kinds[req_id]
        return {
            "receive": "Receive",
            "confirm": "Confirm",
            "close": "Close",
        }.get(kind, "Approve")
    is_assignee = order.assigned_to is not None and int(order.assigned_to) == uid
    is_custodian = uid in _item_dest_custodian_ids(order)
    if (status == STATUS_APPROVED_BY_CF or bounced_to_receiver) and (
        is_assignee or is_custodian
    ):
        return "Receive"
    if status == STATUS_RECEIVED_BY_CC2 and is_assignee:
        return "Confirm"
    if status == STATUS_CONFIRMED_BY_CF and is_assignee:
        return "Close"
    return None


def _restore_destination_locations_from_audit(db: Session, order: AssetTransferOrder) -> bool:
    """If locations were cleared after reject, refill from the last receive audit entry."""
    if order.to_functional_location and order.to_actual_location:
        return False
    rows = db.scalars(
        select(AssetTransferOrderAudit)
        .where(AssetTransferOrderAudit.order_id == int(order.id))
        .order_by(AssetTransferOrderAudit.id.desc())
        .limit(40)
    ).all()
    for row in rows:
        nv = row.new_value if isinstance(row.new_value, dict) else None
        if not nv:
            continue
        fl = _strip_or_none(nv.get("to_functional_location") if isinstance(nv.get("to_functional_location"), str) else None)
        al = _strip_or_none(nv.get("to_actual_location") if isinstance(nv.get("to_actual_location"), str) else None)
        # Audit may store Location 1 / Location 2 under alternate keys from API mapping.
        if not fl:
            raw = nv.get("Location 1")
            fl = _strip_or_none(raw if isinstance(raw, str) else None)
        if not al:
            raw = nv.get("Location 2")
            al = _strip_or_none(raw if isinstance(raw, str) else None)
        if fl and al:
            order.to_functional_location = fl
            order.to_actual_location = al
            return True
    return False


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
    from modules.platform.approvals.org_scope import users_in_role

    return users_in_role(db, role_id)


def _log(
    db: Session,
    *,
    order_id: int,
    action: str,
    actor_user_id: int | None,
    old_value: dict | None = None,
    new_value: dict | None = None,
) -> None:
    db.add(
        AssetTransferOrderAudit(
            order_id=order_id,
            action=action,
            actor_user_id=actor_user_id,
            old_value=old_value,
            new_value=new_value,
        )
    )


def _user_display_name(db: Session, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    user = db.get(User, int(user_id))
    if user is None:
        return None
    name = (user.full_name or "").strip()
    return name or user.username or user.email or str(user.id)


def _transfer_list_sort_expr(sort_by: str):
    key = (sort_by or "created_at").strip().lower()
    if key == "order_number":
        return AssetTransferOrder.order_number
    if key == "status":
        return AssetTransferOrder.status
    if key == "created_at":
        return AssetTransferOrder.created_at
    if key == "plant_name":
        return (
            select(OrgUnit.name)
            .where(OrgUnit.id == AssetTransferOrder.plant_id)
            .correlate(AssetTransferOrder)
            .limit(1)
            .scalar_subquery()
        )
    if key == "from_cost_center_code":
        return (
            select(CostCenterMaster.code)
            .where(CostCenterMaster.id == AssetTransferOrder.from_cost_center_id)
            .correlate(AssetTransferOrder)
            .limit(1)
            .scalar_subquery()
        )
    if key == "to_cost_center_code":
        return (
            select(CostCenterMaster.code)
            .where(CostCenterMaster.id == AssetTransferOrder.to_cost_center_id)
            .correlate(AssetTransferOrder)
            .limit(1)
            .scalar_subquery()
        )
    if key == "assigned_to_name":
        return (
            select(User.full_name)
            .where(User.id == AssetTransferOrder.assigned_to)
            .correlate(AssetTransferOrder)
            .limit(1)
            .scalar_subquery()
        )
    if key == "asset_count":
        return (
            select(func.count(AssetTransferOrderItem.id))
            .where(AssetTransferOrderItem.order_id == AssetTransferOrder.id)
            .correlate(AssetTransferOrder)
            .scalar_subquery()
        )
    return AssetTransferOrder.created_at


def _audit_payload_for_api(
    db: Session,
    value: dict | None,
    *,
    plant_id: int | None = None,
    cache: dict | None = None,
) -> dict | None:
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
        ("to_asset_custodian_id", "to_asset_custodian_name"),
    ):
        if key in out:
            uid = out.get(key)
            if name_key not in out and isinstance(uid, int):
                name = _user_display_name(db, uid)
                if name:
                    out[name_key] = name
            out.pop(key, None)
    return rewrite_audit_master_codes(db, out, plant_id=plant_id, cache=cache)


def sync_open_transfer_asset_lifecycles(db: Session) -> int:
    """Mark assets on open transfer orders as pending_transfer (idempotent backfill)."""
    open_asset_ids = (
        select(AssetTransferOrderItem.asset_id)
        .join(AssetTransferOrder, AssetTransferOrderItem.order_id == AssetTransferOrder.id)
        .where(AssetTransferOrder.status.in_(tuple(ACTIVE_STATUSES)))
    )
    result = db.execute(
        update(AssetMaster)
        .where(
            AssetMaster.deleted_at.is_(None),
            func.lower(func.trim(AssetMaster.lifecycle_status)) == LIFECYCLE_ACTIVE,
            AssetMaster.id.in_(open_asset_ids),
        )
        .values(lifecycle_status=LIFECYCLE_PENDING_TRANSFER)
    )
    n = int(getattr(result, "rowcount", 0) or 0)
    if n:
        db.commit()
    return n


class TransferOrderService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def _next_order_number(self) -> str:
        year = datetime.now(timezone.utc).year
        prefix = f"ATR-{year}-"
        last = self._db.scalar(
            select(AssetTransferOrder.order_number)
            .where(AssetTransferOrder.order_number.like(f"{prefix}%"))
            .order_by(AssetTransferOrder.id.desc())
            .limit(1)
        )
        seq = 1
        if last and last.startswith(prefix):
            try:
                seq = int(last[len(prefix) :]) + 1
            except ValueError:
                seq = 1
        return f"{prefix}{seq:04d}"

    def _role_by_name(self, name: str) -> Role:
        role = self._db.scalar(select(Role).where(Role.name == name))
        if role is None:
            raise ConflictError(f"Role {name!r} is not configured.")
        return role

    def _assert_user_in_role(self, user_id: int, role_name: str) -> User:
        user = self._db.get(User, user_id)
        if user is None or not user.is_active:
            raise NotFoundError("User", user_id)
        role = self._role_by_name(role_name)
        pool_ids = {int(u.id) for u in _users_in_role(self._db, int(role.id))}
        if int(user_id) not in pool_ids and not user.is_superuser:
            raise ConflictError(f"Selected user is not in the {role_name!r} role.")
        return user

    def _assert_user_in_role_id(self, user_id: int, role_id: int) -> User:
        user = self._db.get(User, user_id)
        if user is None or not user.is_active:
            raise NotFoundError("User", user_id)
        from modules.platform.approvals.step_roles import picker_role_ids, role_names_label, users_in_any_role

        role_ids = picker_role_ids(self._db, int(role_id))
        role = self._db.get(Role, int(role_ids[0]))
        if role is None:
            raise NotFoundError("Role", role_ids[0])
        pool_ids = {int(u.id) for u in users_in_any_role(self._db, role_ids)}
        if int(user_id) not in pool_ids and not user.is_superuser:
            raise ConflictError(
                f"Selected user is not in the {role_names_label(self._db, role_ids)!r} role."
            )
        return user

    def _workflow_step_role_id(
        self, order: AssetTransferOrder, *, step_kind: str
    ) -> int | None:
        """Role id for a step_kind on the order's live workflow (rename-safe)."""
        if order.approval_request_id is None:
            return None
        req = self._db.scalar(
            select(ApprovalRequest)
            .where(ApprovalRequest.id == int(order.approval_request_id))
            .options(selectinload(ApprovalRequest.workflow).selectinload(ApprovalWorkflow.steps))
        )
        if req is None or req.workflow is None:
            return None
        for step in sorted(req.workflow.steps or [], key=lambda s: int(s.step_order)):
            if str(getattr(step, "step_kind", None) or "approve") == step_kind:
                return int(step.approver_role_id)
        return None

    def _picker_step_for_order(
        self, order: AssetTransferOrder, *, first_step: bool = False
    ) -> ApprovalStep | None:
        """Workflow step whose role/org_scope drive the next-assignee picker."""
        if order.approval_request_id is not None and not first_step:
            req = self._db.scalar(
                select(ApprovalRequest)
                .where(ApprovalRequest.id == int(order.approval_request_id))
                .options(
                    selectinload(ApprovalRequest.workflow).selectinload(ApprovalWorkflow.steps)
                )
            )
            if req is not None and req.workflow is not None and str(req.status) == "pending":
                steps = sorted(req.workflow.steps or [], key=lambda s: int(s.step_order))
                current = next(
                    (s for s in steps if int(s.step_order) == int(req.current_step)),
                    None,
                )
                if current is not None:
                    return next(
                        (s for s in steps if int(s.step_order) == int(current.step_order) + 1),
                        None,
                    )
        wf = None
        if order.approval_request_id is not None:
            req = self._db.get(ApprovalRequest, int(order.approval_request_id))
            if req is not None:
                wf = self._db.scalar(
                    select(ApprovalWorkflow)
                    .where(ApprovalWorkflow.id == int(req.workflow_id))
                    .options(selectinload(ApprovalWorkflow.steps))
                )
        if wf is None:
            wf = get_workflow_for_action(self._db, ACTION_SUBMIT)
        if wf is None or not wf.steps:
            return None
        return sorted(wf.steps, key=lambda s: int(s.step_order))[0]

    def _assignee_pool(
        self,
        *,
        role_id: int,
        order: AssetTransferOrder | None = None,
        step: ApprovalStep | None = None,
    ) -> tuple[Role, list[User]]:
        from modules.platform.approvals.org_scope import (
            filter_users_by_cost_center,
            resolve_scoped_cost_center_id,
        )

        from modules.platform.approvals.step_roles import picker_role_ids, users_in_any_role

        role_ids = picker_role_ids(self._db, int(role_id), step)
        role = self._db.get(Role, int(role_ids[0]))
        if role is None:
            raise NotFoundError("Role", role_ids[0])
        users = users_in_any_role(self._db, role_ids)
        if order is not None and step is not None:
            cc_id = resolve_scoped_cost_center_id(
                getattr(step, "org_scope", None),
                source_cost_center_id=(
                    int(order.from_cost_center_id) if order.from_cost_center_id else None
                ),
                destination_cost_center_id=(
                    int(order.to_cost_center_id) if order.to_cost_center_id else None
                ),
            )
            users = filter_users_by_cost_center(users, cost_center_id=cc_id)
        if order is not None:
            users = exclude_creator_from_assignees(users, created_by=order.created_by)
        return role, users

    def list_assignees(self, *, level: str) -> TransferAssigneeListResponse:
        role_name = ASSIGNEE_LEVEL_ROLES.get(level.strip().lower())
        if role_name is None:
            allowed = ", ".join(sorted(ASSIGNEE_LEVEL_ROLES))
            raise ConflictError(f"Invalid assignee level. Use one of: {allowed}.")
        role = self._role_by_name(role_name)
        _role, users = self._assignee_pool(role_id=int(role.id))
        return TransferAssigneeListResponse(
            role_name=role_name,
            items=[
                TransferAssigneeOption(id=int(u.id), full_name=u.full_name, email=u.email)
                for u in users
            ],
        )

    def list_assignees_by_role_id(
        self,
        *,
        role_id: int | None = None,
        order_id: int | None = None,
        actor_user_id: int | None = None,
    ) -> TransferAssigneeListResponse:
        """Users in a workflow step role — resolved from the order so a stale role id still works."""
        order = self._load_order(int(order_id)) if order_id is not None else None
        step = self._picker_step_for_order(order) if order is not None else None
        rid = int(step.approver_role_id) if step is not None else role_id
        if rid is None:
            raise ConflictError(
                "No approver role is configured for the next step of this transfer workflow."
            )
        from modules.platform.approvals.step_roles import picker_role_ids, role_names_label

        role, users = self._assignee_pool(role_id=rid, order=order, step=step)
        if order is None:
            users = exclude_creator_from_assignees(users, actor_user_id=actor_user_id)
        return TransferAssigneeListResponse(
            role_name=role_names_label(self._db, picker_role_ids(self._db, rid, step)),
            items=[
                TransferAssigneeOption(id=int(u.id), full_name=u.full_name, email=u.email)
                for u in users
            ],
        )

    def list_assignees_for_action(
        self,
        *,
        action_code: str = ACTION_SUBMIT,
        order_id: int | None = None,
        actor_user_id: int | None = None,
    ) -> TransferAssigneeListResponse:
        """Users in the first step role of the workflow mapped to this transfer action."""
        order = self._load_order(int(order_id)) if order_id is not None else None
        step = (
            self._picker_step_for_order(order, first_step=True)
            if order is not None
            else None
        )
        if step is None:
            wf = get_workflow_for_action(self._db, action_code)
            if wf is None or not wf.steps:
                raise ConflictError(
                    "No active transfer approval workflow is configured. Contact an administrator."
                )
            step = sorted(wf.steps, key=lambda s: int(s.step_order))[0]
        from modules.platform.approvals.step_roles import role_names_label, step_role_ids

        role, users = self._assignee_pool(
            role_id=int(step.approver_role_id), order=order, step=step
        )
        if order is None:
            users = exclude_creator_from_assignees(users, actor_user_id=actor_user_id)
        return TransferAssigneeListResponse(
            role_name=role_names_label(self._db, step_role_ids(step)),
            items=[
                TransferAssigneeOption(id=int(u.id), full_name=u.full_name, email=u.email)
                for u in users
            ],
        )

    def list_destination_cost_centers(self, *, plant_id: int) -> list[TransferDestinationCostCenter]:
        """Active plant CCs except scrapyards — destination is not limited to the creator's CCs."""
        plant = self._db.get(OrgUnit, int(plant_id))
        if plant is None or plant.type != "PLANT":
            raise NotFoundError("Plant", plant_id)
        rows = list(
            self._db.scalars(
                select(CostCenterMaster)
                .where(
                    CostCenterMaster.plant_id == int(plant_id),
                    CostCenterMaster.is_active.is_(True),
                    CostCenterMaster.is_scrapyard.is_(False),
                )
                .order_by(CostCenterMaster.code.asc())
            ).all()
        )
        return [
            TransferDestinationCostCenter(
                id=int(r.id),
                code=r.code,
                name=r.name,
                description=r.description,
                plant_id=int(r.plant_id),
                is_active=bool(r.is_active),
            )
            for r in rows
        ]

    def list_cost_center_users(self, *, cost_center_id: int) -> TransferAssigneeListResponse:
        """Active users designated as asset custodians for a cost center."""
        cc = self._db.get(CostCenterMaster, int(cost_center_id))
        if cc is None:
            raise NotFoundError("Cost center", cost_center_id)
        users = list(
            self._db.scalars(
                select(User)
                .join(
                    CostCenterAssetCustodian,
                    CostCenterAssetCustodian.user_id == User.id,
                )
                .where(
                    CostCenterAssetCustodian.cost_center_id == int(cost_center_id),
                    User.is_active.is_(True),
                )
                .order_by(User.full_name.asc(), User.id.asc())
            ).all()
        )
        return TransferAssigneeListResponse(
            role_name=f"Cost center {cc.code} custodians",
            items=[
                TransferAssigneeOption(id=int(u.id), full_name=u.full_name, email=u.email)
                for u in users
            ],
        )

    def _resolve_to_asset_custodian(self, *, cost_center_id: int, user_id: int) -> User:
        user = self._db.get(User, int(user_id))
        if user is None or not user.is_active:
            raise NotFoundError("User", user_id)
        linked = self._db.scalar(
            select(CostCenterAssetCustodian.id).where(
                CostCenterAssetCustodian.cost_center_id == int(cost_center_id),
                CostCenterAssetCustodian.user_id == int(user_id),
            )
        )
        if linked is None and not user.is_superuser:
            raise ConflictError(
                "Selected asset custodian must be assigned to the destination cost center."
            )
        return user

    def _assert_actor_is_custodian(
        self, assets: list[AssetMaster], *, actor_user_id: int
    ) -> None:
        """Only the assigned asset custodian (or a superuser) may create/edit transfers."""
        actor = self._db.get(User, actor_user_id)
        if actor is not None and actor.is_superuser:
            return
        not_yours: list[str] = []
        for asset in assets:
            custodian_id = asset.asset_custodian_id
            if custodian_id is None or int(custodian_id) != int(actor_user_id):
                not_yours.append(asset.asset_code or str(asset.id))
        if not_yours:
            sample = ", ".join(not_yours[:5])
            more = "…" if len(not_yours) > 5 else ""
            raise ConflictError(
                "Only the asset custodian can create a transfer order for these assets: "
                f"{sample}{more}."
            )

    def _assert_actor_may_submit_transfer(
        self,
        order: AssetTransferOrder,
        assets: list[AssetMaster],
        *,
        actor_user_id: int,
    ) -> None:
        """Source custodian on first submit; destination actor may resubmit after reject restart."""
        try:
            self._assert_actor_is_custodian(assets, actor_user_id=actor_user_id)
            return
        except ConflictError:
            # After reject restart / resume, destination assignee (or creator) may resubmit draft.
            if (
                order.status == STATUS_DRAFT
                and order.assigned_to is not None
                and int(order.assigned_to) == int(actor_user_id)
                and (
                    _is_destination_actor(order, actor_user_id)
                    or (
                        order.created_by is not None
                        and int(order.created_by) == int(actor_user_id)
                    )
                )
            ):
                return
            raise

    def _assert_assets_approved_for_transfer(
        self, assets: list[AssetMaster], *, reserved_asset_ids: set[int] | None = None
    ) -> None:
        """Transfer orders may only include approved (or approval-not-required) active assets.

        Draft/resubmit: assets already on this order may stay pending_transfer.
        """
        reserved = reserved_asset_ids or set()
        locked: list[str] = []
        bad: list[str] = []
        for asset in assets:
            lifecycle = (asset.lifecycle_status or "").strip().lower()
            approval = (asset.approval_status or "").strip().lower()
            if approval not in {"approved", "not_required"}:
                bad.append(asset.asset_code or str(asset.id))
                continue
            if int(asset.id) in reserved:
                if lifecycle not in {LIFECYCLE_ACTIVE, LIFECYCLE_PENDING_TRANSFER}:
                    bad.append(asset.asset_code or str(asset.id))
                continue
            if lifecycle == LIFECYCLE_PENDING_TRANSFER:
                locked.append(asset.asset_code or str(asset.id))
                continue
            if lifecycle != LIFECYCLE_ACTIVE:
                bad.append(asset.asset_code or str(asset.id))
        if locked:
            raise ConflictError(TRANSFER_IN_PROGRESS_MESSAGE)
        if bad:
            sample = ", ".join(bad[:5])
            more = "…" if len(bad) > 5 else ""
            raise ConflictError(
                "Only approved assets can be included on a transfer order: "
                f"{sample}{more}."
            )

    def validate_assets(self, asset_ids: list[int]) -> ValidateTransferAssetsResponse:
        """Return assets that already have an open transfer — list-page check before create."""
        assets = self._load_assets(asset_ids)
        in_progress: list[TransferInProgressAsset] = []
        for asset in assets:
            lifecycle = (asset.lifecycle_status or "").strip().lower()
            if lifecycle == LIFECYCLE_PENDING_TRANSFER:
                in_progress.append(
                    TransferInProgressAsset(
                        asset_id=int(asset.id),
                        asset_code=str(asset.asset_code or asset.id),
                        asset_name=str(asset.asset_name or ""),
                    )
                )
        return ValidateTransferAssetsResponse(in_progress=in_progress)

    def _order_assets(self, order: AssetTransferOrder) -> list[AssetMaster]:
        assets = [item.asset for item in order.items if item.asset is not None]
        if assets:
            return assets
        return self._load_assets([int(item.asset_id) for item in order.items])

    def _mark_assets_pending_transfer(self, assets: list[AssetMaster]) -> None:
        for asset in assets:
            mark_pending_transfer(asset)

    def _restore_assets_active(self, assets: list[AssetMaster]) -> None:
        for asset in assets:
            restore_from_pending_transfer(asset)

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
            raise ConflictError("All assets on a transfer order must belong to the same plant.")
        return assets

    def _resolve_from_cost_center(self, assets: list[AssetMaster]) -> CostCenterMaster | None:
        codes = {c for a in assets if (c := _asset_cost_center(a))}
        if len(codes) != 1:
            return None
        code = next(iter(codes))
        plant_id = _asset_plant_id(assets[0])
        q = select(CostCenterMaster).where(CostCenterMaster.code == code)
        if plant_id is not None:
            q = q.where(CostCenterMaster.plant_id == plant_id)
        return self._db.scalar(q)

    def _assert_same_from_cost_center(self, assets: list[AssetMaster]) -> CostCenterMaster:
        """One transfer = one source cost center → one destination cost center."""
        missing = [
            (a.asset_code or str(a.id)) for a in assets if not _asset_cost_center(a)
        ]
        if missing:
            sample = ", ".join(missing[:5])
            more = "…" if len(missing) > 5 else ""
            raise ConflictError(
                "Every asset on a transfer must have a cost center. Missing for: "
                f"{sample}{more}."
            )
        codes = {_asset_cost_center(a) for a in assets}
        if len(codes) != 1:
            raise ConflictError(
                "All assets on a transfer order must belong to the same cost center. "
                "Create a separate transfer for each source cost center."
            )
        from_cc = self._resolve_from_cost_center(assets)
        if from_cc is None:
            raise ConflictError("Could not resolve the source cost center for the selected assets.")
        return from_cc

    def _assert_destination_differs(
        self, assets: list[AssetMaster], to_cc: CostCenterMaster
    ) -> None:
        if bool(getattr(to_cc, "is_scrapyard", False)):
            raise ConflictError("Scrapyard cost centers cannot be a transfer destination.")
        source_codes = {c for a in assets if (c := _asset_cost_center(a))}
        if to_cc.code in source_codes:
            raise ConflictError(
                "Destination cost center must be different from the assets' current cost center."
            )

    def _load_order(self, order_id: int) -> AssetTransferOrder:
        order = self._db.scalar(
            select(AssetTransferOrder)
            .where(AssetTransferOrder.id == order_id)
            .options(
                selectinload(AssetTransferOrder.items)
                .selectinload(AssetTransferOrderItem.to_asset_custodian),
                selectinload(AssetTransferOrder.items)
                .selectinload(AssetTransferOrderItem.asset)
                .selectinload(AssetMaster.location),
                selectinload(AssetTransferOrder.items)
                .selectinload(AssetTransferOrderItem.asset)
                .selectinload(AssetMaster.financial),
                selectinload(AssetTransferOrder.plant),
                selectinload(AssetTransferOrder.from_cost_center),
                selectinload(AssetTransferOrder.to_cost_center),
                selectinload(AssetTransferOrder.to_asset_custodian),
                selectinload(AssetTransferOrder.creator),
                selectinload(AssetTransferOrder.assignee),
            )
        )
        if order is None:
            raise NotFoundError("Transfer order", order_id)
        return order

    def _normalize_legacy_rework_orders(self) -> None:
        """Fold legacy in_rework rows into rejected (status is no longer used)."""
        updated = self._db.execute(
            AssetTransferOrder.__table__.update()
            .where(AssetTransferOrder.status == STATUS_IN_REWORK)
            .values(status=STATUS_REJECTED)
        )
        if getattr(updated, "rowcount", 0):
            self._db.commit()
        sync_open_transfer_asset_lifecycles(self._db)

    def _assign(self, order: AssetTransferOrder, *, to_user_id: int, by_user_id: int) -> None:
        order.assigned_to = to_user_id
        order.assigned_by = by_user_id
        order.assigned_at = datetime.now(timezone.utc)

    def _replace_items(
        self,
        order: AssetTransferOrder,
        assets: list[AssetMaster],
        dest_custodian_ids: dict[int, int] | None = None,
    ) -> None:
        dest_custodian_ids = dest_custodian_ids or {}
        order.items.clear()
        self._db.flush()
        for asset in assets:
            dest_id = dest_custodian_ids.get(int(asset.id))
            order.items.append(
                AssetTransferOrderItem(
                    asset_id=int(asset.id),
                    from_cost_center_code=_asset_cost_center(asset),
                    from_functional_location=_asset_functional_location(asset),
                    from_actual_location=_asset_actual_location(asset),
                    from_asset_custodian_id=(
                        int(asset.asset_custodian_id) if asset.asset_custodian_id else None
                    ),
                    to_asset_custodian_id=int(dest_id) if dest_id else None,
                )
            )

    def _dest_custodian_ids_for_assets(
        self,
        asset_ids: list[int],
        *,
        fallback_id: int | None,
        item_custodians: list | None,
        cost_center_id: int,
    ) -> dict[int, int]:
        mapping: dict[int, int] = {}
        for row in item_custodians or []:
            if isinstance(row, dict):
                mapping[int(row["asset_id"])] = int(row["to_asset_custodian_id"])
            else:
                mapping[int(row.asset_id)] = int(row.to_asset_custodian_id)
        missing = [i for i in asset_ids if i not in mapping]
        if missing:
            if fallback_id is None:
                raise ConflictError("Select a destination asset custodian for every asset.")
            for i in missing:
                mapping[i] = int(fallback_id)
        extra = set(mapping) - set(int(i) for i in asset_ids)
        if extra:
            raise ConflictError("Destination custodians include assets not on this transfer.")
        resolved: dict[int, int] = {}
        cache: dict[int, int] = {}
        for aid, uid in mapping.items():
            if uid not in cache:
                user = self._resolve_to_asset_custodian(
                    cost_center_id=int(cost_center_id), user_id=int(uid)
                )
                cache[uid] = int(user.id)
            resolved[aid] = cache[uid]
        return resolved

    def _apply_item_dest_custodians(
        self, order: AssetTransferOrder, dest_custodian_ids: dict[int, int]
    ) -> None:
        for item in order.items:
            dest_id = dest_custodian_ids.get(int(item.asset_id))
            if dest_id is not None:
                item.to_asset_custodian_id = int(dest_id)
        first = next(
            (int(i.to_asset_custodian_id) for i in order.items if i.to_asset_custodian_id is not None),
            None,
        )
        order.to_asset_custodian_id = first

    def create_order(
        self, data: CreateTransferOrderRequest, *, actor_user_id: int
    ) -> TransferOrderDetail:
        assets = self._load_assets(data.asset_ids)
        self._assert_actor_is_custodian(assets, actor_user_id=actor_user_id)
        self._assert_assets_approved_for_transfer(assets)
        from_cc = self._assert_same_from_cost_center(assets)
        plant_id = _asset_plant_id(assets[0])
        if plant_id is None:
            raise ConflictError("Selected assets must have a plant.")
        to_cc = self._db.get(CostCenterMaster, int(data.to_cost_center_id))
        if to_cc is None:
            raise NotFoundError("Cost center", data.to_cost_center_id)
        if int(to_cc.plant_id) != int(plant_id):
            raise ConflictError("Destination cost center must belong to the same plant as the assets.")
        self._assert_destination_differs(assets, to_cc)
        to_custodian_ids = self._dest_custodian_ids_for_assets(
            [int(a.id) for a in assets],
            fallback_id=data.to_asset_custodian_id,
            item_custodians=data.item_custodians,
            cost_center_id=int(to_cc.id),
        )
        first_dest = next(iter(to_custodian_ids.values()))
        order = AssetTransferOrder(
            order_number=self._next_order_number(),
            plant_id=plant_id,
            from_cost_center_id=int(from_cc.id),
            to_cost_center_id=int(to_cc.id),
            to_asset_custodian_id=int(first_dest),
            to_functional_location=_strip_or_none(data.to_functional_location),
            to_actual_location=_strip_or_none(data.to_actual_location),
            created_by=actor_user_id,
            status=STATUS_DRAFT,
            remarks=_strip_or_none(data.remarks),
        )
        self._db.add(order)
        self._db.flush()
        self._replace_items(order, assets, dest_custodian_ids=to_custodian_ids)
        self._mark_assets_pending_transfer(assets)
        _log(
            self._db,
            order_id=int(order.id),
            action="created",
            actor_user_id=actor_user_id,
            new_value={
                "order_number": order.order_number,
                "assets": [a.asset_code or str(a.id) for a in assets],
            },
        )
        if data.submit:
            if data.assigned_to is None:
                raise ConflictError("Select an approver before submitting.")
            self._submit(
                order,
                actor_user_id=actor_user_id,
                assigned_to=int(data.assigned_to),
                remarks=_strip_or_none(data.remarks),
            )
        else:
            self._db.commit()
        return self.get_order(int(order.id), viewer_user_id=actor_user_id)

    def update_order(
        self, order_id: int, data: UpdateTransferOrderRequest, *, actor_user_id: int
    ) -> TransferOrderDetail:
        order = self._load_order(order_id)
        if order.status not in EDITABLE_STATUSES:
            raise ConflictError(
                "Transfer order can only be edited while draft. "
                "Restart a rejected transfer before making changes."
            )
        before = {
            "to_cost_center_id": order.to_cost_center_id,
            "to_asset_custodian_id": order.to_asset_custodian_id,
            "to_functional_location": order.to_functional_location,
            "to_actual_location": order.to_actual_location,
            "remarks": order.remarks,
            "item_custodians": {
                int(item.asset_id): getattr(item, "to_asset_custodian_id", None)
                for item in order.items
            },
        }
        patch = data.model_dump(exclude_unset=True)
        if "to_cost_center_id" in patch and patch["to_cost_center_id"] is not None:
            to_cc = self._db.get(CostCenterMaster, int(patch["to_cost_center_id"]))
            if to_cc is None:
                raise NotFoundError("Cost center", patch["to_cost_center_id"])
            assets_for_check = [item.asset for item in order.items if item.asset is not None]
            if not assets_for_check:
                assets_for_check = self._load_assets([int(item.asset_id) for item in order.items])
            self._assert_destination_differs(assets_for_check, to_cc)
            order.to_cost_center_id = int(to_cc.id)
            if "to_asset_custodian_id" not in patch and "item_custodians" not in patch:
                order.to_asset_custodian_id = None
                for item in order.items:
                    item.to_asset_custodian_id = None
        dest_map: dict[int, int] | None = None
        if "item_custodians" in patch or (
            "to_asset_custodian_id" in patch and patch["to_asset_custodian_id"] is not None
        ):
            dest_map = self._dest_custodian_ids_for_assets(
                [int(item.asset_id) for item in order.items]
                if "asset_ids" not in patch or patch.get("asset_ids") is None
                else [int(i) for i in patch["asset_ids"]],
                fallback_id=patch.get("to_asset_custodian_id", order.to_asset_custodian_id),
                item_custodians=patch.get("item_custodians"),
                cost_center_id=int(order.to_cost_center_id),
            )
            if "asset_ids" not in patch or patch.get("asset_ids") is None:
                self._apply_item_dest_custodians(order, dest_map)
        if "to_functional_location" in patch:
            order.to_functional_location = _strip_or_none(patch["to_functional_location"])
        if "to_actual_location" in patch:
            order.to_actual_location = _strip_or_none(patch["to_actual_location"])
        if "remarks" in patch:
            order.remarks = _strip_or_none(patch["remarks"])
        if "asset_ids" in patch and patch["asset_ids"] is not None:
            previous_assets = self._order_assets(order)
            old_ids = {int(a.id) for a in previous_assets}
            assets = self._load_assets(patch["asset_ids"])
            self._assert_actor_is_custodian(assets, actor_user_id=actor_user_id)
            self._assert_assets_approved_for_transfer(assets, reserved_asset_ids=old_ids)
            plant_id = _asset_plant_id(assets[0])
            if plant_id is None or plant_id != int(order.plant_id):
                raise ConflictError("Assets must remain on the same plant as the transfer order.")
            from_cc = self._assert_same_from_cost_center(assets)
            new_ids = {int(a.id) for a in assets}
            self._restore_assets_active([a for a in previous_assets if int(a.id) not in new_ids])
            order.from_cost_center_id = int(from_cc.id)
            self._replace_items(order, assets, dest_custodian_ids=dest_map)
            if dest_map:
                self._apply_item_dest_custodians(order, dest_map)
            self._mark_assets_pending_transfer([a for a in assets if int(a.id) not in old_ids])
        after = {
            "to_cost_center_id": order.to_cost_center_id,
            "to_asset_custodian_id": order.to_asset_custodian_id,
            "to_functional_location": order.to_functional_location,
            "to_actual_location": order.to_actual_location,
            "remarks": order.remarks,
            "item_custodians": {
                int(item.asset_id): getattr(item, "to_asset_custodian_id", None)
                for item in order.items
            },
        }
        if after != before:
            _log(
                self._db,
                order_id=int(order.id),
                action="updated",
                actor_user_id=actor_user_id,
                old_value={k: v for k, v in before.items() if k != "item_custodians"},
                new_value={k: v for k, v in after.items() if k != "item_custodians"},
            )
        self._db.commit()
        return self.get_order(int(order.id), viewer_user_id=actor_user_id)

    def delete_draft_order(self, order_id: int, *, actor_user_id: int) -> None:
        raise ConflictError("Transfer orders cannot be deleted. Archive the order instead.")

    def archive_order(self, order_id: int, *, actor_user_id: int) -> TransferOrderDetail:
        """Archive a draft transfer (same order id, kept for audit)."""
        order = self._load_order(order_id)
        if order.status not in ARCHIVABLE_STATUSES:
            raise ConflictError(
                "Only draft transfer orders can be archived."
            )
        if not _actor_may_discard_transfer(order, actor_user_id=actor_user_id, db=self._db):
            raise ConflictError("Only the order creator can archive this transfer order.")

        self._restore_assets_active(self._order_assets(order))

        # Close leftover approval/rework inbox items so archived orders leave the queue.
        if order.approval_request_id is not None:
            now = datetime.now(timezone.utc)
            req = self._db.get(ApprovalRequest, int(order.approval_request_id))
            if req is not None and str(req.status) in ("pending", "in_rework"):
                req.status = "rejected"
            open_tasks = self._db.scalars(
                select(ApprovalTask).where(
                    ApprovalTask.request_id == int(order.approval_request_id),
                    ApprovalTask.status.in_(("pending", "open")),
                )
            ).all()
            for t in open_tasks:
                t.status = "closed"
                t.closed_at = now

        old_status = order.status
        order.status = STATUS_CANCELLED
        order.closed_at = None
        _log(
            self._db,
            order_id=int(order.id),
            action="archived",
            actor_user_id=actor_user_id,
            old_value={"status": old_status},
            new_value={"status": order.status},
        )
        self._db.commit()
        return self.get_order(order_id, viewer_user_id=actor_user_id)

    def unarchive_order(self, order_id: int, *, actor_user_id: int) -> TransferOrderDetail:
        """Restore an archived transfer to its pre-archive editable status."""
        order = self._load_order(order_id)
        if order.status != STATUS_CANCELLED:
            raise ConflictError("Only archived transfer orders can be unarchived.")
        if not _actor_may_discard_transfer(order, actor_user_id=actor_user_id, db=self._db):
            raise ConflictError("Only the order creator can unarchive this transfer order.")

        restore = self._status_before_archive(int(order.id), allowed=ARCHIVABLE_STATUSES)
        assets = self._order_assets(order)
        blocked = [
            a.asset_code or str(a.id)
            for a in assets
            if (a.lifecycle_status or "").strip().lower() != LIFECYCLE_ACTIVE
        ]
        if blocked:
            raise ConflictError(
                "Cannot unarchive: these assets are no longer available — "
                + ", ".join(blocked)
            )
        self._mark_assets_pending_transfer(assets)
        old_status = order.status
        order.status = restore
        _log(
            self._db,
            order_id=int(order.id),
            action="unarchived",
            actor_user_id=actor_user_id,
            old_value={"status": old_status},
            new_value={"status": order.status},
        )
        self._db.commit()
        return self.get_order(order_id, viewer_user_id=actor_user_id)

    def _status_before_archive(self, order_id: int, *, allowed: frozenset[str]) -> str:
        row = self._db.scalar(
            select(AssetTransferOrderAudit)
            .where(
                AssetTransferOrderAudit.order_id == order_id,
                AssetTransferOrderAudit.action == "archived",
            )
            .order_by(AssetTransferOrderAudit.id.desc())
            .limit(1)
        )
        if row is not None and isinstance(row.old_value, dict):
            prev = str(row.old_value.get("status") or "").strip().lower()
            if prev in allowed:
                return prev
        return STATUS_DRAFT

    def restart_transfer_for_resubmit(
        self, order_id: int, *, actor_user_id: int
    ) -> TransferOrderDetail:
        """After CF reject returns to receiver: reopen same order as draft for full approve flow."""
        order = self._load_order(order_id)
        if not _is_returned_to_receiver(self._db, order):
            raise ConflictError(
                "Only a transfer returned to the receiver after reject can be restarted."
            )
        actor = self._db.get(User, int(actor_user_id))
        is_super = bool(actor and actor.is_superuser)
        is_dest = _is_destination_actor(order, actor_user_id)
        if not (is_super or is_dest):
            raise ConflictError(
                "Only the destination custodian assigned to this location can restart this transfer."
            )

        now = datetime.now(timezone.utc)
        old_request_id = (
            int(order.approval_request_id) if order.approval_request_id is not None else None
        )
        if order.approval_request_id is not None:
            req = self._db.get(ApprovalRequest, int(order.approval_request_id))
            if req is not None and str(req.status) in ("pending", "in_rework"):
                req.status = "rejected"
            open_tasks = self._db.scalars(
                select(ApprovalTask).where(
                    ApprovalTask.request_id == int(order.approval_request_id),
                    ApprovalTask.status.in_(("pending", "open")),
                )
            ).all()
            for t in open_tasks:
                t.status = "closed"
                t.closed_at = now

        old_status = order.status
        order.status = STATUS_DRAFT
        order.rejection_reason = None
        order.approval_request_id = None
        self._assign(order, to_user_id=int(actor_user_id), by_user_id=actor_user_id)
        _log(
            self._db,
            order_id=int(order.id),
            action="restart_transfer",
            actor_user_id=actor_user_id,
            old_value={"status": old_status, "approval_request_id": old_request_id},
            new_value={
                "status": order.status,
                "note": "Restarted as draft for full approve flow on the same order",
            },
        )
        self._db.commit()
        return self.get_order(order_id, viewer_user_id=actor_user_id)

    def resume_rejected_order(
        self, order_id: int, *, actor_user_id: int
    ) -> TransferOrderDetail:
        """Rejected / legacy in_rework → draft so the creator starts approval from the beginning."""
        order = self._load_order(order_id)
        if order.status not in RESUMABLE_STATUSES:
            raise ConflictError(
                "Only a rejected transfer order can be restarted."
            )
        if not _actor_may_discard_transfer(order, actor_user_id=actor_user_id, db=self._db):
            raise ConflictError("Only the order creator can restart this transfer order.")
        old_status = order.status
        old_request_id = (
            int(order.approval_request_id) if order.approval_request_id is not None else None
        )
        order.status = STATUS_DRAFT
        order.rejection_reason = None
        order.approval_request_id = None
        order.assigned_to = int(order.created_by) if order.created_by is not None else None
        order.assigned_by = actor_user_id
        order.assigned_at = datetime.now(timezone.utc)
        _log(
            self._db,
            order_id=int(order.id),
            action="restarted",
            actor_user_id=actor_user_id,
            old_value={"status": old_status, "approval_request_id": old_request_id},
            new_value={"status": order.status},
        )
        self._db.commit()
        return self.get_order(order_id, viewer_user_id=actor_user_id)

    def _order_payload(self, order: AssetTransferOrder, *, action_code: str) -> dict:
        return {
            "action_code": action_code,
            "order_number": order.order_number,
            "asset_count": len(order.items),
            "from_cost_center_code": (
                order.from_cost_center.code if order.from_cost_center is not None else None
            ),
            "to_cost_center_code": (
                order.to_cost_center.code if order.to_cost_center is not None else None
            ),
        }

    def _submit(
        self,
        order: AssetTransferOrder,
        *,
        actor_user_id: int,
        assigned_to: int,
        remarks: str | None,
    ) -> None:
        if order.status not in SUBMITTABLE_STATUSES:
            raise ConflictError("Transfer order cannot be submitted in its current status.")
        assets = [item.asset for item in order.items if item.asset is not None]
        if not assets:
            assets = self._load_assets([int(item.asset_id) for item in order.items])
        self._assert_actor_may_submit_transfer(order, assets, actor_user_id=actor_user_id)
        self._assert_assets_approved_for_transfer(
            assets, reserved_asset_ids={int(a.id) for a in assets}
        )
        self._assert_same_from_cost_center(assets)
        if order.to_asset_custodian_id is None:
            raise ConflictError("Destination asset custodian is required before submitting.")
        assert_assignee_is_not_creator(created_by=order.created_by, assigned_to=int(assigned_to))

        action_code, entity_type = action_and_entity_for_order()
        wf = get_workflow_for_action(self._db, action_code)
        if wf is None:
            raise ConflictError(
                "No active transfer approval workflow is configured. Contact an administrator."
            )
        first_step = sorted(wf.steps, key=lambda s: int(s.step_order))[0]
        from modules.platform.approvals.step_roles import role_names_label, step_role_ids

        first_role, pool = self._assignee_pool(
            role_id=int(first_step.approver_role_id), order=order, step=first_step
        )
        if not any(int(u.id) == int(assigned_to) for u in pool):
            raise ConflictError(
                f"Selected user is not an active member of role {role_names_label(self._db, step_role_ids(first_step))!r} "
                "for this step's cost center scope."
            )

        if remarks is not None:
            order.remarks = remarks

        engine = ApprovalEngineService(self._db)
        assign_meta = {
            "assignee_user_id": int(assigned_to),
            "assignee_name": _user_display_name(self._db, assigned_to),
            "role_name": str(first_role.name),
        }
        try:
            req = engine.create_request_for_entity(
                workflow=wf,
                entity_type=entity_type,
                entity_id=int(order.id),
                payload=self._order_payload(order, action_code=action_code),
                created_by=actor_user_id,
                assigned_user_id=int(assigned_to),
            )
            order.approval_request_id = int(req.id)
            order.status = STATUS_PENDING_APPROVAL
            order.rejection_reason = None
            self._assign(order, to_user_id=assigned_to, by_user_id=actor_user_id)
            _log(
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

    def submit_order(
        self, order_id: int, data: SubmitTransferOrderRequest, *, actor_user_id: int
    ) -> TransferOrderDetail:
        order = self._load_order(order_id)
        self._submit(
            order,
            actor_user_id=actor_user_id,
            assigned_to=int(data.assigned_to),
            remarks=_strip_or_none(data.remarks),
        )
        return self.get_order(order_id, viewer_user_id=actor_user_id)

    def cf_approve(
        self, order_id: int, data: CfApproveTransferRequest, *, actor_user_id: int
    ) -> TransferOrderDetail:
        del order_id, data, actor_user_id
        raise ConflictError(
            "Approve this transfer from My Tasks / the approval workflow; "
            "the CF approve shortcut is retired."
        )

    def _actor_may_cf_reject(self, order: AssetTransferOrder, *, actor_user_id: int) -> bool:
        actor = self._db.get(User, actor_user_id)
        if actor is not None and actor.is_superuser:
            return True
        from core.permissions import get_flat_permission_codes_for_user

        codes = set(get_flat_permission_codes_for_user(self._db, actor_user_id))
        return bool(codes & {"transfer.approve", "transfer.manage", "transfer:approve", "transfer:manage"})

    def _revert_assets_after_receive(self, order: AssetTransferOrder) -> None:
        """Restore cost center / locations / custodian from line-item snapshots."""
        _revert_transfer_assets_after_receive(order)

    def cf_reject(
        self, order_id: int, data: CfRejectTransferRequest, *, actor_user_id: int
    ) -> TransferOrderDetail:
        order = self._load_order(order_id)
        if order.status not in REJECTABLE_STATUSES:
            raise ConflictError(
                "This transfer cannot be rejected after approval. "
                "Reject is only available during the approval steps."
            )
        if not self._actor_may_cf_reject(order, actor_user_id=actor_user_id):
            raise ConflictError("Only Central Finance can reject this transfer order.")
        reason = data.reason.strip()
        if not reason:
            raise ConflictError("Rejection reason is required.")
        old_status = order.status
        if old_status in {STATUS_RECEIVED_BY_CC2, STATUS_CONFIRMED_BY_CF}:
            self._revert_assets_after_receive(order)
        order.status = STATUS_REJECTED
        order.rejection_reason = reason
        order.closed_at = None
        if order.created_by is not None:
            self._assign(order, to_user_id=int(order.created_by), by_user_id=actor_user_id)
        _log(
            self._db,
            order_id=int(order.id),
            action="cf_rejected",
            actor_user_id=actor_user_id,
            old_value={"status": old_status},
            new_value={"status": order.status, "rejection_reason": reason},
        )
        self._db.commit()
        return self.get_order(order_id, viewer_user_id=actor_user_id)

    def _assert_actor_may_receive(
        self, order: AssetTransferOrder, *, actor_user_id: int
    ) -> None:
        if order.status != STATUS_APPROVED_BY_CF and not _is_returned_to_receiver(
            self._db, order
        ):
            raise ConflictError("Only CF-approved transfer orders can be received by the custodian.")
        if not _item_dest_custodian_ids(order):
            raise ConflictError("Destination asset custodian is missing on this transfer.")
        actor = self._db.get(User, actor_user_id)
        is_super = actor is not None and actor.is_superuser
        if (
            not is_super
            and int(actor_user_id) not in _item_dest_custodian_ids(order)
            and (order.assigned_to is None or int(order.assigned_to) != int(actor_user_id))
        ):
            raise ConflictError(
                "Only the selected destination asset custodian can receive this transfer."
            )

    def save_receive_locations(
        self, order_id: int, data: SaveReceiveLocationsRequest, *, actor_user_id: int
    ) -> TransferOrderDetail:
        """Park the receiver's progress: save the locations picked so far, finish later."""
        order = self._load_order(order_id)
        self._assert_actor_may_receive(order, actor_user_id=actor_user_id)
        by_asset = {int(row.asset_id): row for row in data.item_locations}
        saved: list[dict] = []
        for item in order.items:
            row = by_asset.get(int(item.asset_id))
            if row is None:
                continue
            fl = _strip_or_none(row.to_functional_location)
            al = _strip_or_none(row.to_actual_location)
            if (item.to_functional_location, item.to_actual_location) == (fl, al):
                continue
            item.to_functional_location = fl
            item.to_actual_location = al
            saved.append(
                {
                    "asset_code": item.asset.asset_code if item.asset else str(item.asset_id),
                    "to_functional_location": fl,
                    "to_actual_location": al,
                }
            )
        if not saved:
            return self.get_order(order_id, viewer_user_id=actor_user_id)
        _log(
            self._db,
            order_id=int(order.id),
            action="receive_locations_saved",
            actor_user_id=actor_user_id,
            new_value={"item_locations": saved},
        )
        self._db.commit()
        return self.get_order(order_id, viewer_user_id=actor_user_id)

    def cc2_assign_to_cf(
        self, order_id: int, data: Cc2AssignTransferRequest, *, actor_user_id: int
    ) -> TransferOrderDetail:
        order = self._load_order(order_id)
        self._assert_actor_may_receive(order, actor_user_id=actor_user_id)
        confirm_role_id = self._workflow_step_role_id(order, step_kind="confirm")
        if confirm_role_id is None:
            confirm_role_id = self._workflow_step_role_id(order, step_kind="close")
        if confirm_role_id is None:
            raise ConflictError(
                "Transfer workflow has no confirm/close step — cannot assign next user by role name."
            )
        self._assert_user_in_role_id(int(data.assigned_to), confirm_role_id)
        assert_assignee_is_not_creator(created_by=order.created_by, assigned_to=int(data.assigned_to))

        if data.remarks is not None:
            order.remarks = _strip_or_none(data.remarks)

        locations_before = _item_location_snapshot(order)
        fl, al = _apply_receive_assets(
            self._db,
            order,
            functional_location=data.to_functional_location or "",
            actual_location=data.to_actual_location or "",
            item_locations=data.item_locations,
        )
        to_cc = self._db.get(CostCenterMaster, int(order.to_cost_center_id))
        custodian_id = (
            int(order.to_asset_custodian_id) if order.to_asset_custodian_id is not None else None
        )

        old_status = order.status
        order.status = STATUS_RECEIVED_BY_CC2
        self._assign(order, to_user_id=int(data.assigned_to), by_user_id=actor_user_id)
        _log(
            self._db,
            order_id=int(order.id),
            action="cc2_assigned_to_cf",
            actor_user_id=actor_user_id,
            old_value={"status": old_status},
            new_value={
                "status": order.status,
                "assigned_to_name": _user_display_name(self._db, int(data.assigned_to)),
                "asset_custodian_id": custodian_id,
                "to_cost_center": to_cc.code if to_cc else None,
                "to_functional_location": fl,
                "to_actual_location": al,
                "item_locations": _changed_item_locations(order, locations_before),
            },
        )
        self._db.commit()
        return self.get_order(order_id, viewer_user_id=actor_user_id)

    def cf_confirm(self, order_id: int, *, actor_user_id: int) -> TransferOrderDetail:
        order = self._load_order(order_id)
        if order.status != STATUS_RECEIVED_BY_CC2:
            raise ConflictError("Only transfer orders received by CC2 can be confirmed by CF.")
        if order.assigned_to is not None and int(order.assigned_to) != int(actor_user_id):
            actor = self._db.get(User, actor_user_id)
            if actor is None or not actor.is_superuser:
                raise ConflictError("Only the assigned Central Finance user can confirm this order.")
        old_status = order.status
        order.status = STATUS_CONFIRMED_BY_CF
        _log(
            self._db,
            order_id=int(order.id),
            action="cf_confirmed",
            actor_user_id=actor_user_id,
            old_value={"status": old_status},
            new_value={"status": order.status},
        )
        self._db.commit()
        return self.get_order(order_id, viewer_user_id=actor_user_id)

    def cf_close(self, order_id: int, *, actor_user_id: int) -> TransferOrderDetail:
        order = self._load_order(order_id)
        if order.status != STATUS_CONFIRMED_BY_CF:
            raise ConflictError("Only transfer orders confirmed by CF can be closed.")
        if order.assigned_to is not None and int(order.assigned_to) != int(actor_user_id):
            actor = self._db.get(User, actor_user_id)
            if actor is None or not actor.is_superuser:
                raise ConflictError("Only the assigned Central Finance user can close this order.")
        old_status = order.status
        order.status = STATUS_CLOSED
        order.closed_at = datetime.now(timezone.utc)
        self._restore_assets_active(self._order_assets(order))
        _log(
            self._db,
            order_id=int(order.id),
            action="cf_closed",
            actor_user_id=actor_user_id,
            old_value={"status": old_status},
            new_value={"status": order.status},
        )
        self._db.commit()
        return self.get_order(order_id, viewer_user_id=actor_user_id)

    def list_column_filter_options(
        self,
        *,
        viewer_user_id: int | None = None,
        plant_id: int | None = None,
    ) -> TransferListFilterOptionsResponse:
        """Distinct plant / CC / status values present on transfer orders in list scope."""
        where = self._list_orders_where("all", viewer_user_id=viewer_user_id)
        all_ids = (
            select(AssetTransferOrder.id)
            .where(*where)
            .order_by(None)
            .scalar_subquery()
        )
        plant_rows = self._db.execute(
            select(OrgUnit.id, OrgUnit.code, OrgUnit.name)
            .where(
                OrgUnit.id.in_(
                    select(AssetTransferOrder.plant_id)
                    .where(AssetTransferOrder.id.in_(all_ids))
                    .distinct()
                )
            )
            .order_by(OrgUnit.code, OrgUnit.name)
        ).all()
        plants = [
            TransferListFilterPlant(
                id=int(pid),
                code=str(code) if code else None,
                name=str(name or ""),
            )
            for pid, code, name in plant_rows
        ]

        scoped = select(AssetTransferOrder.id).where(*where)
        if plant_id is not None:
            scoped = scoped.where(AssetTransferOrder.plant_id == int(plant_id))
        scoped_ids = scoped.order_by(None).scalar_subquery()

        def _cc_options(id_subq) -> list[TransferListFilterCostCenter]:
            rows = self._db.execute(
                select(
                    CostCenterMaster.id,
                    CostCenterMaster.code,
                    CostCenterMaster.name,
                    CostCenterMaster.plant_id,
                )
                .where(CostCenterMaster.id.in_(id_subq))
                .order_by(CostCenterMaster.code, CostCenterMaster.name)
            ).all()
            return [
                TransferListFilterCostCenter(
                    id=int(cid),
                    code=str(code),
                    name=str(name) if name else None,
                    plant_id=int(ppid) if ppid is not None else None,
                )
                for cid, code, name, ppid in rows
            ]

        from_ids = (
            select(AssetTransferOrder.from_cost_center_id)
            .where(
                AssetTransferOrder.id.in_(scoped_ids),
                AssetTransferOrder.from_cost_center_id.is_not(None),
            )
            .distinct()
        )
        to_ids = (
            select(AssetTransferOrder.to_cost_center_id)
            .where(
                AssetTransferOrder.id.in_(scoped_ids),
                AssetTransferOrder.to_cost_center_id.is_not(None),
            )
            .distinct()
        )
        statuses = [
            str(s)
            for s in self._db.scalars(
                select(AssetTransferOrder.status)
                .where(AssetTransferOrder.id.in_(scoped_ids))
                .distinct()
                .order_by(AssetTransferOrder.status)
            ).all()
            if s
        ]
        return TransferListFilterOptionsResponse(
            plants=plants,
            from_cost_centers=_cc_options(from_ids),
            to_cost_centers=_cc_options(to_ids),
            statuses=statuses,
        )

    def list_orders(
        self,
        *,
        tab: str,
        page: int,
        page_size: int,
        viewer_user_id: int | None = None,
        search: str | None = None,
        order_number: str | None = None,
        plant_id: int | None = None,
        from_cost_center_id: int | None = None,
        to_cost_center_id: int | None = None,
        status: str | None = None,
        asset_count: int | None = None,
        assigned_to: str | None = None,
        created_on: date | None = None,
        sort_by: str = "created_at",
        sort_dir: str = "desc",
    ) -> TransferOrderListResponse:
        self._normalize_legacy_rework_orders()
        tab_key = (tab or "needs_action").strip().lower()
        where = self._list_orders_where(tab_key, viewer_user_id=viewer_user_id)
        where.extend(
            self._list_filter_clauses(
                search=search,
                order_number=order_number,
                plant_id=plant_id,
                from_cost_center_id=from_cost_center_id,
                to_cost_center_id=to_cost_center_id,
                status=status,
                asset_count=asset_count,
                assigned_to=assigned_to,
                created_on=created_on,
            )
        )
        total = int(
            self._db.scalar(
                select(func.count()).select_from(AssetTransferOrder).where(*where)
            )
            or 0
        )
        stmt = (
            select(AssetTransferOrder)
            .where(*where)
            .options(
                selectinload(AssetTransferOrder.plant),
                selectinload(AssetTransferOrder.from_cost_center),
                selectinload(AssetTransferOrder.to_cost_center),
                selectinload(AssetTransferOrder.creator),
                selectinload(AssetTransferOrder.assignee),
                selectinload(AssetTransferOrder.items),
            )
        )
        stmt = apply_sort_dir(
            stmt,
            _transfer_list_sort_expr(sort_by),
            sort_dir=sort_dir,
            tiebreaker=AssetTransferOrder.id,
            pin_last=archived_last_expr(AssetTransferOrder.status, status_filter=status),
        )
        rows = list(
            self._db.scalars(
                stmt.offset((page - 1) * page_size).limit(page_size)
            ).all()
        )
        pending_kinds = self._pending_step_kinds_for_viewer(viewer_user_id)
        pending_roles = pending_role_names_for_requests(
            self._db,
            [
                int(r.approval_request_id)
                for r in rows
                if r.approval_request_id is not None
                and r.status in PENDING_APPROVAL_STATUSES | {STATUS_APPROVED_BY_CF}
            ],
        )
        items = []
        for r in rows:
            may_discard = (
                viewer_user_id is not None
                and _actor_may_discard_transfer(
                    r, actor_user_id=int(viewer_user_id), db=self._db
                )
            )
            action_label = _list_action_label(self._db, r, viewer_user_id, pending_kinds)
            items.append(
                TransferOrderListItem(
                    id=int(r.id),
                    order_number=r.order_number,
                    plant_name=(r.plant.name if r.plant else "") or (r.plant.code if r.plant else ""),
                    from_cost_center_code=r.from_cost_center.code if r.from_cost_center else None,
                    to_cost_center_code=r.to_cost_center.code if r.to_cost_center else "",
                    asset_count=len(r.items),
                    status=r.status,
                    assigned_to_name=r.assignee.full_name if r.assignee else None,
                    pending_role_name=(
                        pending_roles.get(int(r.approval_request_id))
                        if r.status in PENDING_APPROVAL_STATUSES | {STATUS_APPROVED_BY_CF}
                        and r.approval_request_id is not None
                        else None
                    ),
                    created_by_name=r.creator.full_name if r.creator else None,
                    created_at=r.created_at,
                    can_delete=False,
                    can_archive=bool(may_discard and r.status in ARCHIVABLE_STATUSES),
                    can_unarchive=bool(may_discard and r.status == STATUS_CANCELLED),
                    needs_my_action=action_label is not None,
                    my_action_label=action_label,
                )
            )
        return TransferOrderListResponse(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            tab_counts=self._list_tab_counts(viewer_user_id=viewer_user_id),
        )

    def _list_filter_clauses(
        self,
        *,
        search: str | None = None,
        order_number: str | None = None,
        plant_id: int | None = None,
        from_cost_center_id: int | None = None,
        to_cost_center_id: int | None = None,
        status: str | None = None,
        asset_count: int | None = None,
        assigned_to: str | None = None,
        created_on: date | None = None,
    ) -> list:
        clauses: list = []
        if plant_id is not None:
            clauses.append(AssetTransferOrder.plant_id == int(plant_id))
        if from_cost_center_id is not None:
            clauses.append(AssetTransferOrder.from_cost_center_id == int(from_cost_center_id))
        if to_cost_center_id is not None:
            clauses.append(AssetTransferOrder.to_cost_center_id == int(to_cost_center_id))
        status_q = (status or "").strip().lower()
        if status_q:
            clauses.append(AssetTransferOrder.status == status_q)
        if asset_count is not None:
            item_count = (
                select(func.count(AssetTransferOrderItem.id))
                .where(AssetTransferOrderItem.order_id == AssetTransferOrder.id)
                .correlate(AssetTransferOrder)
                .scalar_subquery()
            )
            clauses.append(item_count == int(asset_count))
        if created_on is not None:
            clauses.append(func.date(AssetTransferOrder.created_at) == created_on)
        onum = (order_number or "").strip()
        if onum:
            clauses.append(AssetTransferOrder.order_number.ilike(f"%{onum}%"))
        assignee_q = (assigned_to or "").strip()
        if assignee_q:
            clauses.append(
                AssetTransferOrder.assignee.has(User.full_name.ilike(f"%{assignee_q}%"))
            )
        q = (search or "").strip()
        if q:
            pattern = f"%{q}%"
            search_parts = [
                AssetTransferOrder.order_number.ilike(pattern),
                AssetTransferOrder.plant.has(
                    or_(OrgUnit.name.ilike(pattern), OrgUnit.code.ilike(pattern))
                ),
                AssetTransferOrder.from_cost_center.has(
                    CostCenterMaster.code.ilike(pattern)
                ),
                AssetTransferOrder.to_cost_center.has(
                    CostCenterMaster.code.ilike(pattern)
                ),
                AssetTransferOrder.assignee.has(User.full_name.ilike(pattern)),
                AssetTransferOrder.creator.has(User.full_name.ilike(pattern)),
            ]
            status_codes = status_codes_matching_search(q)
            if status_codes:
                search_parts.append(AssetTransferOrder.status.in_(status_codes))
            clauses.append(or_(*search_parts))
        return clauses

    def _pending_approval_request_ids(self, viewer_user_id: int):
        """Pending approval/rework request ids assigned to this viewer (user or role)."""
        uid = int(viewer_user_id)
        role_ids = select(user_role.c.role_id).where(user_role.c.user_id == uid)
        approval_ids = select(ApprovalTask.request_id).where(
            ApprovalTask.request_id.is_not(None),
            ApprovalTask.task_type == "approval",
            ApprovalTask.status == "pending",
            or_(
                ApprovalTask.assigned_user_id == uid,
                and_(
                    ApprovalTask.assigned_user_id.is_(None),
                    ApprovalTask.assigned_role_id.in_(role_ids),
                ),
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

    def _pending_step_kinds_for_viewer(self, viewer_user_id: int | None) -> dict[int, str]:
        if viewer_user_id is None:
            return {}
        uid = int(viewer_user_id)
        role_ids = select(user_role.c.role_id).where(user_role.c.user_id == uid)
        rows = self._db.execute(
            select(ApprovalTask.request_id, ApprovalStep.step_kind)
            .join(ApprovalStep, ApprovalStep.id == ApprovalTask.step_id)
            .where(
                ApprovalTask.request_id.is_not(None),
                ApprovalTask.task_type == "approval",
                ApprovalTask.status == "pending",
                or_(
                    ApprovalTask.assigned_user_id == uid,
                    and_(
                        ApprovalTask.assigned_user_id.is_(None),
                        ApprovalTask.assigned_role_id.in_(role_ids),
                    ),
                ),
            )
        ).all()
        out: dict[int, str] = {}
        for request_id, kind in rows:
            if request_id is None:
                continue
            out[int(request_id)] = str(kind or "approve").lower()
        return out

    def _needs_action_clauses(self, viewer_user_id: int) -> list:
        uid = int(viewer_user_id)
        pending_req_ids = self._pending_approval_request_ids(uid)
        # Rejected bounce-back to destination — same order, receive again.
        bounced_to_receiver = and_(
            AssetTransferOrder.status == STATUS_REJECTED,
            AssetTransferOrder.rejection_reason.is_not(None),
            AssetTransferOrder.rejection_reason != "",
            AssetTransferOrder.to_asset_custodian_id.is_not(None),
            AssetTransferOrder.assigned_to == AssetTransferOrder.to_asset_custodian_id,
        )
        return [
            or_(
                and_(
                    AssetTransferOrder.approval_request_id.is_not(None),
                    AssetTransferOrder.approval_request_id.in_(pending_req_ids),
                ),
                # Creator: draft always; rejected/rework only when assigned back to them
                # (not when bounce sent the order to the destination assignee).
                and_(
                    AssetTransferOrder.created_by == uid,
                    AssetTransferOrder.status.in_(CREATOR_ACTION_STATUSES),
                    or_(
                        AssetTransferOrder.status == STATUS_DRAFT,
                        AssetTransferOrder.assigned_to == uid,
                    ),
                ),
                and_(
                    AssetTransferOrder.assigned_to == uid,
                    AssetTransferOrder.status.in_(
                        (
                            STATUS_DRAFT,
                            STATUS_APPROVED_BY_CF,
                            STATUS_RECEIVED_BY_CC2,
                            STATUS_CONFIRMED_BY_CF,
                            STATUS_REJECTED,
                        )
                    ),
                ),
                and_(
                    AssetTransferOrder.to_asset_custodian_id == uid,
                    or_(
                        AssetTransferOrder.status == STATUS_APPROVED_BY_CF,
                        bounced_to_receiver,
                    ),
                ),
            ),
            AssetTransferOrder.status != STATUS_CANCELLED,
            AssetTransferOrder.status != STATUS_CLOSED,
        ]

    def _list_orders_where(self, tab: str, *, viewer_user_id: int | None) -> list:
        if tab == "needs_action":
            if viewer_user_id is None:
                return [AssetTransferOrder.id < 0]
            return self._needs_action_clauses(int(viewer_user_id))
        if tab in ("done", "closed"):
            return [
                AssetTransferOrder.status.in_((STATUS_CLOSED, STATUS_CANCELLED)),
            ]
        if tab == "all":
            return []
        # Legacy status tabs still work for bookmarks / API clients.
        statuses = _TAB_STATUSES.get(tab)
        if statuses is None and tab in _TAB_STATUSES:
            return []
        if statuses is None:
            # Unknown tab → same as needs_action when viewer known, else active open set.
            if viewer_user_id is not None:
                return self._needs_action_clauses(int(viewer_user_id))
            return [AssetTransferOrder.status.in_(ACTIVE_STATUSES)]
        return [AssetTransferOrder.status.in_(statuses)]

    def _list_tab_counts(self, *, viewer_user_id: int | None) -> dict[str, int]:
        counts: dict[str, int] = {}
        for key in ("needs_action", "done", "all"):
            where = self._list_orders_where(key, viewer_user_id=viewer_user_id)
            counts[key] = int(
                self._db.scalar(
                    select(func.count()).select_from(AssetTransferOrder).where(*where)
                )
                or 0
            )
        return counts

    # -------------------------------------------------------- approval panel

    def _workflow_runs_for_request(
        self, req: ApprovalRequest
    ) -> list[TransferWorkflowRunPublic]:
        out: list[TransferWorkflowRunPublic] = []
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
                TransferWorkflowRunPublic(
                    attempt=idx + 1,
                    request_id=int(req.id),
                    request_status=status_override or str(req.status),
                    is_current=is_last,
                    workflow_steps=_build_workflow_steps_for_request(
                        self._db, req, tasks=run_tasks, status_override=status_override
                    ),
                )
            )
        # Rejection stays on the earlier attempt only. The live run must show a clean
        # path (completed → current → upcoming) so restart-after-reject progress bars match.
        return out

    def _approval_panel(
        self, order: AssetTransferOrder, *, viewer_user_id: int | None
    ) -> TransferApprovalPanel | None:
        if order.approval_request_id is None:
            # Show a preview of the workflow steps even before submission.
            action_code, _ = action_and_entity_for_order()
            wf = get_workflow_for_action(self._db, action_code)
            if wf is None or not wf.steps:
                return None
            preview_steps = build_workflow_preview_steps(self._db, wf)
            if not preview_steps:
                return None
            return TransferApprovalPanel(
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

        pending_tasks = [
            t
            for t in (req.tasks or [])
            if str(t.task_type) == "approval" and str(t.status).lower() == "pending"
        ]
        pending_task: ApprovalTask | None = (
            max(pending_tasks, key=lambda t: int(t.id)) if pending_tasks else None
        )
        my_pending: int | None = None
        if viewer_user_id is not None:
            for t in sorted(pending_tasks, key=lambda x: int(x.id), reverse=True):
                if t.assigned_user_id is not None and int(t.assigned_user_id) == int(viewer_user_id):
                    my_pending = int(t.id)
                    pending_task = t
                    break

        # Role-assigned pending: still expose as my task when viewer has that role.
        if my_pending is None and pending_task is not None and pending_task.assigned_role_id is not None:
            if viewer_user_id is not None:
                from modules.rbac_association import user_role as ur

                has_role = self._db.scalar(
                    select(ur.c.user_id).where(
                        ur.c.user_id == int(viewer_user_id),
                        ur.c.role_id == int(pending_task.assigned_role_id),
                    ).limit(1)
                )
                if has_role is not None:
                    my_pending = int(pending_task.id)

        current_assignee_id: int | None = None
        current_assignee_name: str | None = None
        current_role: str | None = None
        current_level: str | None = None
        current_kind = "approve"
        if pending_task is not None:
            if pending_task.assigned_user_id is not None:
                current_assignee_id = int(pending_task.assigned_user_id)
                current_assignee_name = _user_display_name(self._db, current_assignee_id)
            if pending_task.step is not None:
                from modules.platform.approvals.step_roles import role_names_label, step_role_ids

                current_role = role_names_label(self._db, step_role_ids(pending_task.step))
                role = self._db.get(Role, int(pending_task.step.approver_role_id))
                if role is not None:
                    current_level = ROLE_TO_ASSIGNEE_LEVEL.get(role.name)
                current_kind = str(getattr(pending_task.step, "step_kind", None) or "approve")

        is_final = True
        needs_next = False
        next_role: str | None = None
        next_role_id: int | None = None
        next_level: str | None = None
        next_kind: str | None = None
        current_role_id: int | None = (
            int(pending_task.step.approver_role_id)
            if pending_task is not None and pending_task.step is not None
            else None
        )
        wf_steps = sorted(
            (req.workflow.steps or []) if req.workflow is not None else [],
            key=lambda s: int(s.step_order),
        )
        if str(req.status) == "pending" and steps:
            current = next((s for s in steps if s.phase == "current"), None)
            if current is not None:
                is_final = int(current.step_order) >= int(current.total_steps)
                current_kind = str(getattr(current, "step_kind", None) or current_kind)
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
                        next_role = role_names_label(self._db, step_role_ids(nxt_row))
                        role = self._db.get(Role, next_role_id)
                        if role is not None:
                            next_level = ROLE_TO_ASSIGNEE_LEVEL.get(role.name)
                        next_kind = str(getattr(nxt_row, "step_kind", None) or "approve")
                        needs_next = transfer_needs_next_assignee(
                            current_kind=current_kind,
                            next_kind=next_kind,
                            current_role_id=current_role_id,
                            next_role_id=next_role_id,
                        )
        return TransferApprovalPanel(
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
            is_final_step=is_final,
            needs_next_assignee=needs_next,
            next_step_role_name=next_role,
            next_assignee_role_id=next_role_id,
            next_assignee_level=next_level,
            next_step_kind=next_kind,
        )

    def get_order(self, order_id: int, *, viewer_user_id: int | None = None) -> TransferOrderDetail:
        self._normalize_legacy_rework_orders()
        order = self._load_order(order_id)
        audits = list(
            self._db.scalars(
                select(AssetTransferOrderAudit)
                .where(AssetTransferOrderAudit.order_id == int(order.id))
                .order_by(AssetTransferOrderAudit.id.desc())
                .limit(50)
            ).all()
        )
        actor_ids = {a.actor_user_id for a in audits if a.actor_user_id}
        actors = {
            int(u.id): u
            for u in self._db.scalars(select(User).where(User.id.in_(actor_ids))).all()
        } if actor_ids else {}

        viewer = self._db.get(User, viewer_user_id) if viewer_user_id else None
        is_assignee = (
            viewer_user_id is not None
            and order.assigned_to is not None
            and int(order.assigned_to) == int(viewer_user_id)
        )
        is_creator = (
            viewer_user_id is not None
            and order.created_by is not None
            and int(order.created_by) == int(viewer_user_id)
        )
        is_super = bool(viewer and viewer.is_superuser)
        panel = self._approval_panel(order, viewer_user_id=viewer_user_id)
        is_dest = _is_destination_actor(order, viewer_user_id)
        returned_to_receiver = _is_returned_to_receiver(self._db, order)
        # Heal legacy bounce rows that kept approved_by_cf after reject.
        if returned_to_receiver and order.status == STATUS_APPROVED_BY_CF:
            order.status = STATUS_REJECTED
            self._db.commit()
        # Bounce must sit with destination assignee — not the creator.
        if returned_to_receiver and order.to_asset_custodian_id is not None:
            custodian_id = int(order.to_asset_custodian_id)
            if order.assigned_to is None or int(order.assigned_to) != custodian_id:
                order.assigned_to = custodian_id
                self._db.commit()
        if returned_to_receiver and _restore_destination_locations_from_audit(self._db, order):
            self._db.commit()
        may_edit_rework = is_creator or is_super or (
            is_dest and is_assignee and order.status == STATUS_DRAFT
        )

        plant = order.plant
        plant_name = ""
        if isinstance(plant, OrgUnit):
            plant_name = plant.name or plant.code or ""

        to_fl_name, to_al_name = resolve_plant_location_names(
            self._db,
            plant_id=int(order.plant_id),
            functional_location_code=order.to_functional_location,
            actual_location_code=order.to_actual_location,
        )
        from_name_cache: dict[tuple[str, str], tuple[str | None, str | None]] = {}
        audit_name_cache: dict = {}

        def _from_names(fl: str | None, al: str | None) -> tuple[str | None, str | None]:
            key = ((fl or "").strip(), (al or "").strip())
            if key not in from_name_cache:
                from_name_cache[key] = resolve_plant_location_names(
                    self._db,
                    plant_id=int(order.plant_id),
                    functional_location_code=fl,
                    actual_location_code=al,
                )
            return from_name_cache[key]

        item_publics: list[TransferOrderItemPublic] = []
        for i in order.items:
            fl_n, al_n = _from_names(i.from_functional_location, i.from_actual_location)
            to_fl_n, to_al_n = _from_names(i.to_functional_location, i.to_actual_location)
            item_publics.append(
                TransferOrderItemPublic(
                    id=int(i.id),
                    asset_id=int(i.asset_id),
                    asset_code=i.asset.asset_code if i.asset else "",
                    asset_name=i.asset.asset_name if i.asset else "",
                    from_cost_center_code=i.from_cost_center_code,
                    from_functional_location=i.from_functional_location,
                    from_actual_location=i.from_actual_location,
                    from_functional_location_name=fl_n,
                    from_actual_location_name=al_n,
                    to_asset_custodian_id=(
                        int(i.to_asset_custodian_id) if i.to_asset_custodian_id else None
                    ),
                    to_asset_custodian_name=(
                        i.to_asset_custodian.full_name if i.to_asset_custodian else None
                    ),
                    to_functional_location=i.to_functional_location,
                    to_actual_location=i.to_actual_location,
                    to_functional_location_name=to_fl_n,
                    to_actual_location_name=to_al_n,
                )
            )

        return TransferOrderDetail(
            id=int(order.id),
            order_number=order.order_number,
            plant_id=int(order.plant_id),
            plant_name=plant_name,
            from_cost_center_id=int(order.from_cost_center_id) if order.from_cost_center_id else None,
            from_cost_center_code=order.from_cost_center.code if order.from_cost_center else None,
            from_cost_center_description=(
                order.from_cost_center.description if order.from_cost_center else None
            ),
            to_cost_center_id=int(order.to_cost_center_id),
            to_cost_center_code=order.to_cost_center.code if order.to_cost_center else "",
            to_cost_center_description=(
                order.to_cost_center.description if order.to_cost_center else None
            ),
            to_asset_custodian_id=(
                int(order.to_asset_custodian_id) if order.to_asset_custodian_id else None
            ),
            to_asset_custodian_name=(
                order.to_asset_custodian.full_name if order.to_asset_custodian else None
            ),
            to_functional_location=order.to_functional_location,
            to_actual_location=order.to_actual_location,
            to_functional_location_name=to_fl_name,
            to_actual_location_name=to_al_name,
            status=order.status,
            remarks=order.remarks,
            rejection_reason=order.rejection_reason,
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
            items=item_publics,
            audit=[
                TransferOrderAuditPublic(
                    id=int(a.id),
                    action=a.action,
                    actor_name=(
                        actors[int(a.actor_user_id)].full_name
                        if a.actor_user_id and int(a.actor_user_id) in actors
                        else None
                    ),
                    old_value=_audit_payload_for_api(
                        self._db, a.old_value, plant_id=int(order.plant_id), cache=audit_name_cache
                    ),
                    new_value=_audit_payload_for_api(
                        self._db, a.new_value, plant_id=int(order.plant_id), cache=audit_name_cache
                    ),
                    created_at=a.created_at,
                )
                for a in audits
            ],
            approval_panel=panel,
            can_submit=(order.status in SUBMITTABLE_STATUSES) and may_edit_rework,
            can_cf_decide=False,
            # Reject only during approval steps (engine); never after approval → receive/confirm/close.
            can_cf_reject=False,
            can_cc2_assign=_can_operational_flag(
                order,
                panel=panel,
                legacy_ok=(
                    (order.status == STATUS_APPROVED_BY_CF or returned_to_receiver)
                    and (
                        is_super
                        or is_assignee
                        or (
                            viewer_user_id is not None
                            and int(viewer_user_id) in _item_dest_custodian_ids(order)
                        )
                    )
                ),
                step_kind="receive",
            ),
            can_cf_confirm=_can_operational_flag(
                order,
                panel=panel,
                legacy_ok=(order.status == STATUS_RECEIVED_BY_CC2) and (is_assignee or is_super),
                step_kind="confirm",
            ),
            can_cf_close=_can_operational_flag(
                order,
                panel=panel,
                legacy_ok=(order.status == STATUS_CONFIRMED_BY_CF) and (is_assignee or is_super),
                step_kind="close",
            ),
            can_edit=(order.status in EDITABLE_STATUSES) and may_edit_rework,
            can_resume=(order.status in RESUMABLE_STATUSES)
            and not returned_to_receiver
            and (is_creator or is_super),
            can_delete=False,
            can_archive=(
                viewer_user_id is not None
                and order.status in ARCHIVABLE_STATUSES
                and _actor_may_discard_transfer(
                    order, actor_user_id=int(viewer_user_id), db=self._db
                )
            ),
            can_unarchive=(
                viewer_user_id is not None
                and order.status == STATUS_CANCELLED
                and _actor_may_discard_transfer(
                    order, actor_user_id=int(viewer_user_id), db=self._db
                )
            ),
            can_restart_transfer=returned_to_receiver and (is_super or is_dest),
        )


def _can_operational_flag(
    order: AssetTransferOrder,
    *,
    panel: TransferApprovalPanel | None,
    legacy_ok: bool,
    step_kind: str,
) -> bool:
    """Engine pending task wins; while request is still pending, hide legacy-only gates."""
    if panel is not None and panel.my_pending_task_id is not None and panel.current_step_kind == step_kind:
        return True
    # Pending receive/confirm/close: still allow the operational actor (e.g. destination
    # custodian after CF reject returns the order to them).
    if (
        panel is not None
        and panel.request_status == "pending"
        and panel.current_step_kind == step_kind
        and panel.pending_task_id is not None
        and legacy_ok
    ):
        return True
    if order.approval_request_id is not None and panel is not None and panel.request_status == "pending":
        return False
    return legacy_ok


# ------------------------------------------------- approval engine callbacks


def _revert_transfer_assets_after_receive(order: AssetTransferOrder) -> None:
    """Restore cost center / locations / custodian from line-item snapshots."""
    for item in order.items:
        asset = item.asset
        if asset is None:
            continue
        if item.from_cost_center_code:
            fin = _ensure_financial(asset)
            fin.cost_center = item.from_cost_center_code
        loc = _ensure_location(asset)
        loc.functional_location = item.from_functional_location
        loc.actual_location = item.from_actual_location
        asset.asset_custodian_id = (
            int(item.from_asset_custodian_id) if item.from_asset_custodian_id else None
        )


def _receive_loc_map(item_locations: list | None) -> dict[int, tuple[str, str]]:
    out: dict[int, tuple[str, str]] = {}
    for row in item_locations or []:
        if isinstance(row, dict):
            aid = int(row["asset_id"])
            fl = _strip_or_none(row.get("to_functional_location"))
            al = _strip_or_none(row.get("to_actual_location"))
        else:
            aid = int(row.asset_id)
            fl = _strip_or_none(getattr(row, "to_functional_location", None))
            al = _strip_or_none(getattr(row, "to_actual_location", None))
        if fl and al:
            out[aid] = (fl, al)
    return out


def _item_location_snapshot(order: AssetTransferOrder) -> dict[int, tuple[str | None, str | None]]:
    return {
        int(i.asset_id): (i.to_functional_location, i.to_actual_location) for i in order.items
    }


def _changed_item_locations(
    order: AssetTransferOrder, before: dict[int, tuple[str | None, str | None]]
) -> list[dict]:
    """Audit rows for assets this action actually moved — locations saved earlier are not repeated."""
    rows: list[dict] = []
    for item in order.items:
        if before.get(int(item.asset_id)) == (item.to_functional_location, item.to_actual_location):
            continue
        rows.append(
            {
                "asset_code": (item.asset.asset_code if item.asset else str(item.asset_id)),
                "to_functional_location": item.to_functional_location,
                "to_actual_location": item.to_actual_location,
                "to_asset_custodian_id": (
                    int(item.to_asset_custodian_id) if item.to_asset_custodian_id else None
                ),
            }
        )
    return rows


def _apply_receive_assets(
    db: Session,
    order: AssetTransferOrder,
    *,
    functional_location: str,
    actual_location: str,
    cost_center_id: int | None = None,
    item_locations: list | None = None,
) -> tuple[str, str]:
    """Update order + per-asset locations/CC/custodian. Does not change assignee or status."""
    loc_map = _receive_loc_map(item_locations)
    fallback_fl = _strip_or_none(functional_location)
    fallback_al = _strip_or_none(actual_location)
    if cost_center_id is not None:
        order.to_cost_center_id = int(cost_center_id)
    to_cc = db.get(CostCenterMaster, int(order.to_cost_center_id))
    if to_cc is None:
        raise ConflictError("Destination cost center is missing.")
    if not order.items:
        raise ConflictError("Transfer has no assets to receive.")
    for item in order.items:
        pair = loc_map.get(int(item.asset_id))
        if pair is None and fallback_fl and fallback_al:
            pair = (fallback_fl, fallback_al)
        if pair is None:
            raise ConflictError(
                "Actual Location 1 and Actual Location 2 are required for every asset when receiving."
            )
        custodian_id = (
            int(item.to_asset_custodian_id)
            if item.to_asset_custodian_id is not None
            else (
                int(order.to_asset_custodian_id) if order.to_asset_custodian_id is not None else None
            )
        )
        if custodian_id is None:
            raise ConflictError("Destination asset custodian is missing on this transfer.")
        item.to_functional_location, item.to_actual_location = pair
        if item.to_asset_custodian_id is None:
            item.to_asset_custodian_id = custodian_id
        asset = item.asset
        if asset is None:
            continue
        fin = _ensure_financial(asset)
        fin.cost_center = to_cc.code
        loc = _ensure_location(asset)
        loc.functional_location = pair[0]
        loc.actual_location = pair[1]
        asset.asset_custodian_id = custodian_id
    first = order.items[0]
    order.to_functional_location = first.to_functional_location
    order.to_actual_location = first.to_actual_location
    if order.to_asset_custodian_id is None and first.to_asset_custodian_id is not None:
        order.to_asset_custodian_id = int(first.to_asset_custodian_id)
    return order.to_functional_location or "", order.to_actual_location or ""


def apply_transfer_enter_receive(
    db: Session,
    *,
    order_id: int,
    actor_user_id: int | None,
    next_assignee_user_id: int,
    step_role_name: str | None = None,
    next_role_name: str | None = None,
    comment: str | None = None,
) -> None:
    """After last approve step: order awaits destination receive."""
    order = db.get(AssetTransferOrder, order_id)
    if order is None:
        return
    old_status = order.status
    order.status = STATUS_APPROVED_BY_CF
    order.rejection_reason = None
    order.assigned_to = int(next_assignee_user_id)
    order.assigned_by = actor_user_id
    order.assigned_at = datetime.now(timezone.utc)
    _log(
        db,
        order_id=int(order.id),
        action="approved",
        actor_user_id=actor_user_id,
        old_value={"status": old_status},
        new_value={
            "status": order.status,
            "step_role_name": step_role_name,
            "assigned_to": int(next_assignee_user_id),
            "next_role_name": next_role_name,
            "comment": (comment or "").strip() or None,
        },
    )


def apply_transfer_receive(
    db: Session,
    *,
    order_id: int,
    actor_user_id: int,
    functional_location: str | None,
    actual_location: str | None,
    next_assignee_user_id: int,
    step_role_name: str | None = None,
    comment: str | None = None,
    cost_center_id: int | None = None,
    item_locations: list | None = None,
) -> None:
    _ = cost_center_id  # Ignored: destination CC is fixed at submit; receiver sets locations only.
    order = db.get(AssetTransferOrder, order_id)
    if order is None:
        return
    # Ensure items/asset relationships are loaded for relocation.
    order = db.scalar(
        select(AssetTransferOrder)
        .where(AssetTransferOrder.id == int(order_id))
        .options(
            selectinload(AssetTransferOrder.items).selectinload(AssetTransferOrderItem.asset),
        )
    )
    if order is None:
        return
    locations_before = _item_location_snapshot(order)
    fl, al = _apply_receive_assets(
        db,
        order,
        functional_location=functional_location or "",
        actual_location=actual_location or "",
        item_locations=item_locations,
        # Receiver may only set Actual Location 1/2; destination CC is fixed at submit.
        cost_center_id=None,
    )
    old_status = order.status
    order.status = STATUS_RECEIVED_BY_CC2
    order.rejection_reason = None
    order.assigned_to = int(next_assignee_user_id)
    order.assigned_by = actor_user_id
    order.assigned_at = datetime.now(timezone.utc)
    to_cc = db.get(CostCenterMaster, int(order.to_cost_center_id))
    _log(
        db,
        order_id=int(order.id),
        action="cc2_assigned_to_cf",
        actor_user_id=actor_user_id,
        old_value={"status": old_status},
        new_value={
            "status": order.status,
            "step_role_name": step_role_name,
            "assigned_to_name": _user_display_name(db, int(next_assignee_user_id)),
            "asset_custodian_id": int(order.to_asset_custodian_id) if order.to_asset_custodian_id else None,
            "to_cost_center": to_cc.code if to_cc else None,
            "to_functional_location": fl,
            "to_actual_location": al,
            "item_locations": _changed_item_locations(order, locations_before),
            "comment": (comment or "").strip() or None,
        },
    )


def apply_transfer_confirm(
    db: Session,
    *,
    order_id: int,
    actor_user_id: int,
    next_assignee_user_id: int,
    step_role_name: str | None = None,
    comment: str | None = None,
) -> None:
    order = db.get(AssetTransferOrder, order_id)
    if order is None:
        return
    old_status = order.status
    order.status = STATUS_CONFIRMED_BY_CF
    order.assigned_to = int(next_assignee_user_id)
    order.assigned_by = actor_user_id
    order.assigned_at = datetime.now(timezone.utc)
    _log(
        db,
        order_id=int(order.id),
        action="cf_confirmed",
        actor_user_id=actor_user_id,
        old_value={"status": old_status},
        new_value={
            "status": order.status,
            "step_role_name": step_role_name,
            "assigned_to": int(next_assignee_user_id),
            "comment": (comment or "").strip() or None,
        },
    )


def apply_transfer_close(
    db: Session,
    *,
    order_id: int,
    actor_user_id: int | None,
    step_role_name: str | None = None,
    comment: str | None = None,
) -> None:
    order = db.scalar(
        select(AssetTransferOrder)
        .where(AssetTransferOrder.id == int(order_id))
        .options(
            selectinload(AssetTransferOrder.items).selectinload(AssetTransferOrderItem.asset),
        )
    )
    if order is None:
        return
    old_status = order.status
    order.status = STATUS_CLOSED
    order.closed_at = datetime.now(timezone.utc)
    for item in order.items:
        if item.asset is not None:
            restore_from_pending_transfer(item.asset)
    _log(
        db,
        order_id=int(order.id),
        action="cf_closed",
        actor_user_id=actor_user_id,
        old_value={"status": old_status},
        new_value={
            "status": order.status,
            "step_role_name": step_role_name,
            "comment": (comment or "").strip() or None,
        },
    )


def finalize_transfer_approval(
    db: Session,
    *,
    order_id: int,
    approver_user_id: int | None,
    step_role_name: str | None = None,
    comment: str | None = None,
) -> None:
    """Legacy finalize: set pending-receive and assign destination custodian.

    Prefer step-kind callbacks (`apply_transfer_enter_receive` / close) for engine flows.
    """
    order = db.get(AssetTransferOrder, order_id)
    if order is None:
        return
    if order.to_asset_custodian_id is None:
        raise ConflictError("Destination asset custodian is required before final approval.")
    custodian = db.get(User, int(order.to_asset_custodian_id))
    if custodian is None or not custodian.is_active:
        raise NotFoundError("User", order.to_asset_custodian_id)
    apply_transfer_enter_receive(
        db,
        order_id=int(order.id),
        actor_user_id=approver_user_id,
        next_assignee_user_id=int(custodian.id),
        step_role_name=step_role_name,
        comment=comment,
    )
    db.commit()


def reject_transfer_approval(
    db: Session,
    *,
    order_id: int,
    approver_user_id: int | None,
    comment: str | None,
    step_role_name: str | None = None,
) -> str:
    """Apply reject on the transfer order.

    Returns ``\"receiver\"`` when post-receive reject sends the same order back to the
    destination custodian (not draft/rework). Otherwise ``\"creator\"``.
    """
    order = db.scalar(
        select(AssetTransferOrder)
        .where(AssetTransferOrder.id == int(order_id))
        .options(
            selectinload(AssetTransferOrder.items).selectinload(AssetTransferOrderItem.asset),
        )
    )
    if order is None:
        return "creator"

    reason = (comment or "").strip() or None
    old_status = order.status
    order.rejection_reason = reason

    # After receive (or confirm): revert assets and reopen receive on the same order.
    if old_status in {STATUS_RECEIVED_BY_CC2, STATUS_CONFIRMED_BY_CF}:
        _revert_transfer_assets_after_receive(order)
        # Status Rejected (not approved_by_cf) so list/detail badges match the reject.
        # Receive stays open via the approval engine; _is_returned_to_receiver detects this.
        order.status = STATUS_REJECTED
        order.closed_at = None
        # Keep destination CC + locations so the receiver sees the same values to edit.
        receiver_id = (
            int(order.to_asset_custodian_id) if order.to_asset_custodian_id is not None else None
        )
        if receiver_id is not None:
            order.assigned_to = receiver_id
            order.assigned_by = approver_user_id
            order.assigned_at = datetime.now(timezone.utc)
        _log(
            db,
            order_id=int(order.id),
            action="rejected",
            actor_user_id=approver_user_id,
            old_value={"status": old_status},
            new_value={
                "status": order.status,
                "rejection_reason": reason,
                "step_role_name": step_role_name,
                "returned_to": "receiver",
                "assigned_to": receiver_id,
            },
        )
        return "receiver"

    order.status = STATUS_REJECTED
    if order.created_by is not None:
        order.assigned_to = int(order.created_by)
        order.assigned_by = approver_user_id
        order.assigned_at = datetime.now(timezone.utc)
    _log(
        db,
        order_id=int(order.id),
        action="rejected",
        actor_user_id=approver_user_id,
        old_value={"status": old_status},
        new_value={
            "status": order.status,
            "rejection_reason": reason,
            "step_role_name": step_role_name,
            "returned_to": "creator",
            "assigned_to": int(order.assigned_to) if order.assigned_to is not None else None,
        },
    )
    return "creator"


def log_transfer_step_approved(
    db: Session,
    *,
    order_id: int,
    actor_user_id: int | None,
    step_role_name: str | None,
    next_assignee_user_id: int | None,
    next_role_name: str | None,
    comment: str | None = None,
) -> None:
    order = db.get(AssetTransferOrder, order_id)
    if order is not None and next_assignee_user_id is not None:
        order.assigned_to = int(next_assignee_user_id)
        order.assigned_by = actor_user_id
        order.assigned_at = datetime.now(timezone.utc)
    _log(
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
