from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from core.permissions import get_flat_permission_codes_for_user
from modules.asset_masters.location_lookup import resolve_plant_location_names
from modules.asset_masters.model import (
    ActualLocationMaster,
    CostCenterAssetCustodian,
    CostCenterMaster,
    FunctionalLocationMaster,
)
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
    ARCHIVABLE_STATUSES,
    ASSIGNEE_LEVEL_ROLES,
    CREATOR_ACTION_STATUSES,
    EDITABLE_STATUSES,
    ENTITY_TYPE,
    ENTITY_TYPE_WITH_ENGINEERING,
    RESUMABLE_STATUSES,
    ROLE_TO_ASSIGNEE_LEVEL,
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
    disposal_needs_next_assignee,
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
    DisposalListFilterCostCenter,
    DisposalListFilterOptionsResponse,
    DisposalListFilterPlant,
    DisposalWorkflowRunPublic,
    ReceiveDisposalRequest,
    SubmitDisposalOrderRequest,
    UpdateDisposalOrderRequest,
)
from modules.errors import ConflictError, NotFoundError
from modules.list_sort import apply_sort_dir
from modules.platform.approvals.assignment_service import get_workflow_for_action
from modules.platform.approvals.list_inbox import (
    pending_approval_request_ids_for_viewer,
    pending_role_names_for_requests,
)
from modules.platform.approvals.model import (
    ApprovalAction,
    ApprovalRequest,
    ApprovalStep,
    ApprovalTask,
    ApprovalWorkflow,
)
from modules.platform.approvals.service import ApprovalEngineService, ApprovalError
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
    # needs_action is viewer-scoped (not a status set) — handled in list_orders.
    "needs_action": None,
    "done": frozenset({STATUS_CLOSED, STATUS_CANCELLED}),
    # Legacy status tabs (bookmarks / API).
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


_PLAIN_DRAFT_AUDIT_ACTIONS = frozenset({"created", "updated"})


def _is_plain_disposal_draft(db: Session, order: AssetDisposalOrder) -> bool:
    if order.status != STATUS_DRAFT:
        return False
    if order.approval_request_id is not None:
        return False
    extra = db.scalar(
        select(AssetDisposalOrderAudit.id)
        .where(
            AssetDisposalOrderAudit.order_id == int(order.id),
            AssetDisposalOrderAudit.action.not_in(_PLAIN_DRAFT_AUDIT_ACTIONS),
        )
        .limit(1)
    )
    return extra is None


def _actor_may_discard_disposal(order: AssetDisposalOrder, *, actor_user_id: int, db: Session) -> bool:
    creator_id = int(order.created_by) if order.created_by is not None else None
    if creator_id is not None and creator_id == int(actor_user_id):
        return True
    viewer = db.get(User, int(actor_user_id))
    return viewer is not None and bool(viewer.is_superuser)


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


def _scrapyard_locations_after_receive(
    db: Session, order: AssetDisposalOrder
) -> tuple[str | None, str | None]:
    """AL1/AL2 from last receive — also after CF bounce so details still show prior values."""
    show = order.status in (STATUS_PENDING_CF_CLOSE, STATUS_CLOSED) or _is_returned_to_receiver(
        db, order
    )
    if not show:
        return None, None
    row = db.scalar(
        select(AssetDisposalOrderAudit)
        .where(
            AssetDisposalOrderAudit.order_id == int(order.id),
            AssetDisposalOrderAudit.action == "received",
        )
        .order_by(AssetDisposalOrderAudit.id.desc())
        .limit(1)
    )
    if row is not None and isinstance(row.new_value, dict):
        fl = _strip_or_none(
            None
            if row.new_value.get("functional_location") is None
            else str(row.new_value.get("functional_location"))
        )
        al = _strip_or_none(
            None
            if row.new_value.get("actual_location") is None
            else str(row.new_value.get("actual_location"))
        )
        if fl or al:
            return fl, al
    # After bounce, assets are reverted — only use live asset locs when still at CF/closed.
    if order.status not in (STATUS_PENDING_CF_CLOSE, STATUS_CLOSED):
        return None, None
    for item in order.items or []:
        asset = item.asset
        if asset is None:
            continue
        fl = _asset_functional_location(asset)
        al = _asset_actual_location(asset)
        if fl or al:
            return fl, al
    return None, None


def _is_returned_to_receiver(db: Session, order: AssetDisposalOrder) -> bool:
    """Post-receive CF reject: same order awaits receiver again (not creator Restart)."""
    if not (order.rejection_comment or "").strip():
        return False
    # Legacy bounce wrote pending_receipt + comment before status was normalized to rejected.
    if order.status == STATUS_PENDING_RECEIPT:
        return True
    if order.status != STATUS_REJECTED:
        return False
    if order.approval_request_id is None:
        return False
    req = db.get(ApprovalRequest, int(order.approval_request_id))
    return req is not None and str(req.status) == "pending"


def require_scrapyard_locations(
    db: Session,
    *,
    plant_id: int,
    functional_location: str,
    actual_location: str,
) -> tuple[str, str]:
    """Actual Location 1/2 must be an active scrapyard FL + child AL for the plant."""
    fl_code = functional_location.strip()
    al_code = actual_location.strip()
    if not fl_code or not al_code:
        raise ConflictError("Actual Location 1 and Actual Location 2 are required.")
    fl = db.scalar(
        select(FunctionalLocationMaster).where(
            FunctionalLocationMaster.plant_id == int(plant_id),
            FunctionalLocationMaster.code == fl_code,
        )
    )
    if fl is None:
        raise ConflictError("Actual Location 1 was not found for this plant.")
    if not bool(fl.is_active):
        raise ConflictError("Actual Location 1 is inactive.")
    if not bool(getattr(fl, "is_scrapyard", False)):
        raise ConflictError(
            "Receive locations must be scrapyard Actual Location 1 / 2 for this plant."
        )
    al = db.scalar(
        select(ActualLocationMaster).where(
            ActualLocationMaster.functional_location_id == int(fl.id),
            ActualLocationMaster.code == al_code,
        )
    )
    if al is None:
        raise ConflictError("Actual Location 2 must belong to the selected scrapyard location.")
    if not bool(al.is_active):
        raise ConflictError("Actual Location 2 is inactive.")
    return fl.code, al.code


def _users_in_role(db: Session, role_id: int) -> list[User]:
    from modules.platform.approvals.org_scope import users_in_role

    return users_in_role(db, role_id)


def _first_step_role(db: Session, workflow: ApprovalWorkflow) -> Role:
    if not workflow.steps:
        raise ConflictError("Active disposal workflow has no steps configured.")
    first = sorted(workflow.steps, key=lambda s: int(s.step_order))[0]
    role = db.get(Role, int(first.approver_role_id))
    if role is None:
        raise ConflictError("Workflow approver role is missing.")
    return role


def _role_with_permission(db: Session, permission_code: str) -> Role | None:
    """First role that grants permission_code (rename-safe when seeded names drift)."""
    from modules.platform.permissions.model import Permission
    from modules.rbac_association import role_permission

    return db.scalar(
        select(Role)
        .select_from(role_permission)
        .join(Role, Role.id == role_permission.c.role_id)
        .join(Permission, Permission.id == role_permission.c.permission_id)
        .where(Permission.code == permission_code)
        .order_by(Role.id.asc())
        .limit(1)
    )


def _user_display_name(db: Session, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    user = db.get(User, int(user_id))
    if user is None:
        return f"User #{user_id}"
    name = (user.full_name or "").strip()
    return name or user.username or user.email or str(user.id)


def _disposal_list_sort_expr(sort_by: str):
    key = (sort_by or "created_at").strip().lower()
    if key == "order_number":
        return AssetDisposalOrder.order_number
    if key == "status":
        return AssetDisposalOrder.status
    if key == "created_at":
        return AssetDisposalOrder.created_at
    if key == "plant_name":
        return (
            select(OrgUnit.name)
            .where(OrgUnit.id == AssetDisposalOrder.plant_id)
            .correlate(AssetDisposalOrder)
            .limit(1)
            .scalar_subquery()
        )
    if key == "from_cost_center_code":
        return (
            select(CostCenterMaster.code)
            .where(CostCenterMaster.id == AssetDisposalOrder.from_cost_center_id)
            .correlate(AssetDisposalOrder)
            .limit(1)
            .scalar_subquery()
        )
    if key == "assigned_to_name":
        return (
            select(User.full_name)
            .where(User.id == AssetDisposalOrder.assigned_to)
            .correlate(AssetDisposalOrder)
            .limit(1)
            .scalar_subquery()
        )
    if key == "asset_count":
        return (
            select(func.count(AssetDisposalOrderItem.id))
            .where(AssetDisposalOrderItem.order_id == AssetDisposalOrder.id)
            .correlate(AssetDisposalOrder)
            .scalar_subquery()
        )
    return AssetDisposalOrder.created_at


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
                selectinload(AssetDisposalOrder.to_cost_center),
                selectinload(AssetDisposalOrder.creator),
                selectinload(AssetDisposalOrder.assignee),
                selectinload(AssetDisposalOrder.receiver),
            )
        )
        if order is None:
            raise NotFoundError("Disposal order", order_id)
        return order

    def _normalize_legacy_rework_orders(self) -> None:
        """Fold legacy in_rework rows into rejected (status is no longer used)."""
        updated = self._db.execute(
            AssetDisposalOrder.__table__.update()
            .where(AssetDisposalOrder.status == STATUS_IN_REWORK)
            .values(status=STATUS_REJECTED)
        )
        if getattr(updated, "rowcount", 0):
            self._db.commit()

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

    def _require_scrapyard_cost_center(
        self, *, plant_id: int, cost_center_id: int
    ) -> CostCenterMaster:
        cc = self._db.get(CostCenterMaster, int(cost_center_id))
        if cc is None:
            raise NotFoundError("Cost center", cost_center_id)
        if int(cc.plant_id) != int(plant_id):
            raise ConflictError("Scrapyard cost center must belong to the same plant as the assets.")
        if not bool(getattr(cc, "is_scrapyard", False)):
            raise ConflictError("Selected cost center is not marked as a scrapyard.")
        if not bool(cc.is_active):
            raise ConflictError("Scrapyard cost center is inactive.")
        return cc

    def list_cost_center_custodians(self, *, cost_center_id: int) -> DisposalAssigneeListResponse:
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
        return DisposalAssigneeListResponse(
            role_name=f"Cost center {cc.code} custodians",
            items=[
                DisposalAssigneeOption(id=int(u.id), full_name=u.full_name, email=u.email)
                for u in users
            ],
        )

    def _assert_cc_custodian(self, *, cost_center_id: int, user_id: int) -> User:
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
                "Selected custodian must be assigned to the scrapyard cost center."
            )
        return user

    def _require_scrapyard_locations(
        self, *, plant_id: int, functional_location: str, actual_location: str
    ) -> tuple[str, str]:
        return require_scrapyard_locations(
            self._db,
            plant_id=plant_id,
            functional_location=functional_location,
            actual_location=actual_location,
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

    def _picker_step_for_order(
        self, order: AssetDisposalOrder, *, first_step: bool = False
    ) -> ApprovalStep | None:
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
            action_code, _ = action_and_entity_for_order(
                requires_engineering=bool(getattr(order, "requires_engineering", False))
            )
            wf = get_workflow_for_action(self._db, action_code)
        if wf is None or not wf.steps:
            return None
        return sorted(wf.steps, key=lambda s: int(s.step_order))[0]

    def _assignee_pool(
        self,
        *,
        role_id: int,
        order: AssetDisposalOrder | None = None,
        step: ApprovalStep | None = None,
        source_cost_center_id: int | None = None,
        destination_cost_center_id: int | None = None,
        fallback_scope: str | None = None,
    ) -> tuple[Role, list[User]]:
        from modules.platform.approvals.org_scope import (
            ORG_SCOPE_SOURCE,
            effective_step_org_scope,
            filter_users_by_cost_center,
            resolve_scoped_cost_center_id,
        )

        role = self._db.get(Role, int(role_id))
        if role is None:
            raise NotFoundError("Role", role_id)
        users = _users_in_role(self._db, int(role.id))
        src = source_cost_center_id
        dst = destination_cost_center_id
        if order is not None:
            if src is None and order.from_cost_center_id:
                src = int(order.from_cost_center_id)
            if dst is None and order.to_cost_center_id:
                dst = int(order.to_cost_center_id)
        default_scope = fallback_scope
        if default_scope is None and (order is not None or src is not None or dst is not None):
            default_scope = ORG_SCOPE_SOURCE
        scope = effective_step_org_scope(step, default=default_scope)
        if scope is None:
            return role, users
        cc_id = resolve_scoped_cost_center_id(
            scope,
            source_cost_center_id=src,
            destination_cost_center_id=dst,
        )
        users = filter_users_by_cost_center(users, cost_center_id=cc_id)
        return role, users

    def list_assignees(self, *, level: str) -> DisposalAssigneeListResponse:
        role_name = ASSIGNEE_LEVEL_ROLES.get(level.strip().lower())
        if role_name is None:
            allowed = ", ".join(sorted(ASSIGNEE_LEVEL_ROLES))
            raise ConflictError(f"Invalid assignee level. Use one of: {allowed}.")
        role = self._db.scalar(select(Role).where(Role.name == role_name))
        if role is None:
            raise ConflictError(f"Role {role_name!r} is not configured.")
        _role, users = self._assignee_pool(role_id=int(role.id))
        return DisposalAssigneeListResponse(
            role_name=role_name,
            items=[
                DisposalAssigneeOption(id=int(u.id), full_name=u.full_name, email=u.email)
                for u in users
            ],
        )

    def list_assignees_by_role_id(
        self,
        *,
        role_id: int,
        order_id: int | None = None,
        source_cost_center_id: int | None = None,
        destination_cost_center_id: int | None = None,
    ) -> DisposalAssigneeListResponse:
        from modules.platform.approvals.org_scope import ORG_SCOPE_DESTINATION

        order = self._load_order(int(order_id)) if order_id is not None else None
        step = self._picker_step_for_order(order) if order is not None else None
        rid = int(step.approver_role_id) if step is not None else int(role_id)
        # Last-step receiver has no next workflow step — pool is scrapyard Cost Center User.
        fallback = ORG_SCOPE_DESTINATION if step is None and order is not None else None
        role, users = self._assignee_pool(
            role_id=rid,
            order=order,
            step=step,
            source_cost_center_id=source_cost_center_id,
            destination_cost_center_id=destination_cost_center_id,
            fallback_scope=fallback,
        )
        return DisposalAssigneeListResponse(
            role_name=str(role.name),
            items=[
                DisposalAssigneeOption(id=int(u.id), full_name=u.full_name, email=u.email)
                for u in users
            ],
        )

    def list_assignees_for_action(
        self,
        *,
        action_code: str,
        order_id: int | None = None,
        source_cost_center_id: int | None = None,
        destination_cost_center_id: int | None = None,
        asset_ids: list[int] | None = None,
    ) -> DisposalAssigneeListResponse:
        """Users in the first step role of the workflow mapped to this disposal action."""
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
                    "No active disposal approval workflow is configured. Contact an administrator."
                )
            step = sorted(wf.steps, key=lambda s: int(s.step_order))[0]
        src = source_cost_center_id
        if src is None and order is None and asset_ids:
            assets = self._load_assets(asset_ids)
            from_cc = self._resolve_from_cost_center(assets)
            src = int(from_cc.id) if from_cc is not None else None
        role, users = self._assignee_pool(
            role_id=int(step.approver_role_id),
            order=order,
            step=step,
            source_cost_center_id=src,
            destination_cost_center_id=destination_cost_center_id,
        )
        return DisposalAssigneeListResponse(
            role_name=str(role.name),
            items=[
                DisposalAssigneeOption(id=int(u.id), full_name=u.full_name, email=u.email)
                for u in users
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
        to_cc = None
        if data.to_cost_center_id is not None:
            to_cc = self._require_scrapyard_cost_center(
                plant_id=int(plant_id), cost_center_id=int(data.to_cost_center_id)
            )
        if data.submit and to_cc is None:
            raise ConflictError("Select a scrapyard cost center before submitting.")
        receiver = None
        if data.receiver_user_id is not None:
            if to_cc is None:
                raise ConflictError("Select a scrapyard cost center before choosing a custodian.")
            receiver = self._assert_cc_custodian(
                cost_center_id=int(to_cc.id), user_id=int(data.receiver_user_id)
            )
        if data.submit and receiver is None:
            raise ConflictError("Select a custodian for the scrapyard cost center.")
        order = AssetDisposalOrder(
            order_number=self._next_order_number(),
            plant_id=int(plant_id),
            from_cost_center_id=int(from_cc.id) if from_cc is not None else None,
            to_cost_center_id=int(to_cc.id) if to_cc is not None else None,
            requires_engineering=bool(data.requires_engineering),
            created_by=actor_user_id,
            status=STATUS_DRAFT,
            remarks=_strip_or_none(data.remarks),
            receiver_user_id=int(receiver.id) if receiver is not None else None,
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
                "to_cost_center": to_cc.code if to_cc is not None else None,
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
                "Disposal order can only be edited while draft. "
                "Restart a rejected or in-rework order before making changes."
            )
        before = {
            "remarks": order.remarks,
            "requires_engineering": bool(order.requires_engineering),
            "asset_count": len(order.items),
            "to_cost_center_id": (
                int(order.to_cost_center_id) if order.to_cost_center_id else None
            ),
        }
        patch = data.model_dump(exclude_unset=True)
        if "remarks" in patch:
            order.remarks = _strip_or_none(patch["remarks"])
        if patch.get("requires_engineering") is not None:
            order.requires_engineering = bool(patch["requires_engineering"])
        if "to_cost_center_id" in patch:
            if patch["to_cost_center_id"] is None:
                order.to_cost_center_id = None
            else:
                to_cc = self._require_scrapyard_cost_center(
                    plant_id=int(order.plant_id),
                    cost_center_id=int(patch["to_cost_center_id"]),
                )
                order.to_cost_center_id = int(to_cc.id)
        if patch.get("asset_ids") is not None:
            previous_assets = self._order_assets(order)
            assets = self._load_assets(patch["asset_ids"])
            old_ids = {int(a.id) for a in previous_assets}
            self._assert_assets_match_order_reservation(assets, reserved_asset_ids=old_ids)
            plant_id = _asset_plant_id(assets[0])
            if plant_id is None:
                raise ConflictError("Selected assets must have a plant.")
            # Rework/draft may move the order to another plant the actor can access.
            order.plant_id = int(plant_id)
            from_cc = self._resolve_from_cost_center(assets)
            new_ids = {int(a.id) for a in assets}
            removed_assets = [a for a in previous_assets if int(a.id) not in new_ids]
            added_assets = [a for a in assets if int(a.id) not in old_ids]
            self._restore_assets_active(removed_assets)
            order.from_cost_center_id = int(from_cc.id) if from_cc is not None else None
            # Plant may have changed — drop scrapyard if it no longer fits.
            if order.to_cost_center_id is not None:
                try:
                    to_cc = self._require_scrapyard_cost_center(
                        plant_id=int(order.plant_id),
                        cost_center_id=int(order.to_cost_center_id),
                    )
                    order.to_cost_center_id = int(to_cc.id)
                except ConflictError:
                    order.to_cost_center_id = None
            self._replace_items(order, assets)
            self._mark_assets_pending_disposal(added_assets)
        if "receiver_user_id" in patch:
            rid = patch["receiver_user_id"]
            if rid is None or order.to_cost_center_id is None:
                order.receiver_user_id = None
            else:
                self._assert_cc_custodian(
                    cost_center_id=int(order.to_cost_center_id), user_id=int(rid)
                )
                order.receiver_user_id = int(rid)
        elif order.receiver_user_id is not None:
            if order.to_cost_center_id is None:
                order.receiver_user_id = None
            else:
                try:
                    self._assert_cc_custodian(
                        cost_center_id=int(order.to_cost_center_id),
                        user_id=int(order.receiver_user_id),
                    )
                except (ConflictError, NotFoundError):
                    order.receiver_user_id = None
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
                "to_cost_center_id": (
                    int(order.to_cost_center_id) if order.to_cost_center_id else None
                ),
            },
        )
        self._db.commit()
        return self.get_order(order_id, viewer_user_id=actor_user_id)

    def resume_rejected_order(
        self, order_id: int, *, actor_user_id: int
    ) -> DisposalOrderDetail:
        """Rejected / legacy in_rework → draft so the creator starts approval from the beginning."""
        order = self._load_order(order_id)
        if order.status not in RESUMABLE_STATUSES:
            raise ConflictError(
                "Only a rejected or in-rework disposal order can be restarted."
            )
        if _is_returned_to_receiver(self._db, order):
            raise ConflictError(
                "This disposal was returned to the receiver — they must receive again, "
                "not restart as draft."
            )
        if not _actor_may_discard_disposal(order, actor_user_id=actor_user_id, db=self._db):
            raise ConflictError("Only the order creator can restart this disposal order.")
        old_status = order.status
        order.status = STATUS_DRAFT
        order.rejection_comment = None
        order.approval_request_id = None
        order.assigned_to = int(order.created_by) if order.created_by is not None else None
        order.assigned_by = actor_user_id
        order.assigned_at = datetime.now(timezone.utc)
        log_disposal_event(
            self._db,
            order_id=int(order.id),
            action="restarted",
            actor_user_id=actor_user_id,
            old_value={"status": old_status},
            new_value={"status": order.status},
        )
        self._db.commit()
        return self.get_order(order_id, viewer_user_id=actor_user_id)

    def delete_draft_order(self, order_id: int, *, actor_user_id: int) -> None:
        """Hard-delete a plain draft that was never submitted / approved / rejected."""
        order = self._load_order(order_id)
        if not _is_plain_disposal_draft(self._db, order):
            raise ConflictError(
                "Only a plain draft disposal (no submit, approve, or reject history) "
                "can be deleted. Archive it instead to keep the audit trail."
            )
        if not _actor_may_discard_disposal(order, actor_user_id=actor_user_id, db=self._db):
            raise ConflictError("Only the draft creator can delete this disposal order.")
        assets = self._order_assets(order)
        self._restore_assets_active(assets)
        self._db.delete(order)
        self._db.commit()

    def archive_draft_order(
        self, order_id: int, *, actor_user_id: int
    ) -> DisposalOrderDetail:
        """Archive an editable disposal that already has workflow history."""
        order = self._load_order(order_id)
        if order.status not in ARCHIVABLE_STATUSES:
            raise ConflictError(
                "Only draft disposal orders can be archived."
            )
        if _is_plain_disposal_draft(self._db, order):
            raise ConflictError(
                "This is a plain draft with no approval history — delete it instead of archiving."
            )
        if not _actor_may_discard_disposal(order, actor_user_id=actor_user_id, db=self._db):
            raise ConflictError("Only the order creator can archive this disposal order.")

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

    def unarchive_order(self, order_id: int, *, actor_user_id: int) -> DisposalOrderDetail:
        """Restore an archived disposal to its pre-archive editable status."""
        order = self._load_order(order_id)
        if order.status != STATUS_CANCELLED:
            raise ConflictError("Only archived disposal orders can be unarchived.")
        if not _actor_may_discard_disposal(order, actor_user_id=actor_user_id, db=self._db):
            raise ConflictError("Only the order creator can unarchive this disposal order.")

        restore = self._status_before_archive(int(order.id), allowed=ARCHIVABLE_STATUSES)
        assets = self._order_assets(order)
        blocked = [
            a.asset_code or str(a.id)
            for a in assets
            if not is_operational(a.lifecycle_status)
        ]
        if blocked:
            raise ConflictError(
                "Cannot unarchive: these assets are no longer available — "
                + ", ".join(blocked)
            )
        self._mark_assets_pending_disposal(assets)
        old_status = order.status
        order.status = restore
        log_disposal_event(
            self._db,
            order_id=int(order.id),
            action="unarchived",
            actor_user_id=actor_user_id,
            old_value={"status": old_status},
            new_value={
                "status": order.status,
                "pending_disposal_assets": [a.asset_code or str(a.id) for a in assets],
            },
        )
        self._db.commit()
        return self.get_order(order_id, viewer_user_id=actor_user_id)

    def _status_before_archive(self, order_id: int, *, allowed: frozenset[str]) -> str:
        row = self._db.scalar(
            select(AssetDisposalOrderAudit)
            .where(
                AssetDisposalOrderAudit.order_id == order_id,
                AssetDisposalOrderAudit.action == "archived",
            )
            .order_by(AssetDisposalOrderAudit.id.desc())
            .limit(1)
        )
        if row is not None and isinstance(row.old_value, dict):
            prev = str(row.old_value.get("status") or "").strip().lower()
            if prev in allowed:
                return prev
        return STATUS_DRAFT

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
        if order.to_cost_center_id is None:
            raise ConflictError("Select a scrapyard cost center before submitting.")
        if not (order.remarks or "").strip():
            raise ConflictError("Disposal reason is required.")
        if order.receiver_user_id is None:
            raise ConflictError("Select a custodian for the scrapyard cost center.")
        self._require_scrapyard_cost_center(
            plant_id=int(order.plant_id), cost_center_id=int(order.to_cost_center_id)
        )

        action_code, entity_type = action_and_entity_for_order(
            requires_engineering=bool(order.requires_engineering)
        )
        wf = get_workflow_for_action(self._db, action_code)
        if wf is None:
            raise ConflictError(
                "No active disposal approval workflow is configured. Contact an administrator."
            )
        first_step = sorted(wf.steps, key=lambda s: int(s.step_order))[0]
        first_role, pool = self._assignee_pool(
            role_id=int(first_step.approver_role_id), order=order, step=first_step
        )
        if not any(int(u.id) == int(assignee_user_id) for u in pool):
            raise ConflictError(
                f"Selected user is not an active member of role {first_role.name!r} "
                "for this step's cost center scope."
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
        """Assigned user, or superuser; permission alone only when nobody is assigned."""
        if order.assigned_to is not None and int(order.assigned_to) == int(actor_user_id):
            return True
        actor = self._db.get(User, actor_user_id)
        if actor is not None and actor.is_superuser:
            return True
        # Someone else is the assignee — permission holders must not act for them.
        if order.assigned_to is not None:
            return False
        codes = set(get_flat_permission_codes_for_user(self._db, actor_user_id))
        return permission in codes or permission.replace(".", ":", 1) in codes

    def _pending_step_task(
        self, order: AssetDisposalOrder, *, step_kind: str
    ) -> ApprovalTask | None:
        if order.approval_request_id is None:
            return None
        kind = (step_kind or "approve").strip().lower()
        rows = self._db.scalars(
            select(ApprovalTask)
            .join(ApprovalStep, ApprovalStep.id == ApprovalTask.step_id)
            .where(
                ApprovalTask.request_id == int(order.approval_request_id),
                ApprovalTask.task_type == "approval",
                ApprovalTask.status == "pending",
                ApprovalStep.step_kind == kind,
            )
            .order_by(ApprovalTask.id.asc())
        ).all()
        return rows[0] if rows else None

    def _heal_stale_receive_task(self, order: AssetDisposalOrder) -> bool:
        """REST receive can leave the engine receive task open after status already advanced."""
        if order.status != STATUS_PENDING_CF_CLOSE or order.assigned_to is None:
            return False
        if order.approval_request_id is None:
            return False
        task = self._pending_step_task(order, step_kind="receive")
        if task is None or task.step_id is None:
            return False
        req = self._db.scalar(
            select(ApprovalRequest)
            .where(ApprovalRequest.id == int(order.approval_request_id))
            .options(
                selectinload(ApprovalRequest.workflow).selectinload(ApprovalWorkflow.steps),
            )
        )
        if req is None or str(req.status) != "pending" or req.workflow is None:
            return False
        steps_sorted = sorted(req.workflow.steps or [], key=lambda s: int(s.step_order))
        idx = next(
            (i for i, s in enumerate(steps_sorted) if int(s.id) == int(task.step_id)),
            None,
        )
        if idx is None or idx >= len(steps_sorted) - 1:
            return False
        next_step = steps_sorted[idx + 1]
        now = datetime.now(timezone.utc)
        task.status = "approved"
        task.acted_at = now
        actor_id = (
            int(order.receiver_user_id)
            if order.receiver_user_id is not None
            else int(order.assigned_by)
            if order.assigned_by is not None
            else None
        )
        self._db.add(
            ApprovalAction(
                task_id=int(task.id),
                user_id=actor_id,
                action="approve",
                comment="Synced after receive",
            )
        )
        ApprovalEngineService(self._db)._create_tasks_for_step(
            req, next_step, assigned_user_id=int(order.assigned_to)
        )
        req.current_step = int(next_step.step_order)
        self._db.commit()
        return True

    def receive_order(
        self, order_id: int, data: ReceiveDisposalRequest, *, actor_user_id: int
    ) -> DisposalOrderDetail:
        order = self._load_order(order_id)
        returned = _is_returned_to_receiver(self._db, order)
        if order.status != STATUS_PENDING_RECEIPT and not returned:
            raise ConflictError("Only fully approved disposal orders can be received.")
        if not self._actor_may_act(
            order, actor_user_id=actor_user_id, permission=PERMISSION_RECEIVE
        ):
            raise ConflictError("Only the assigned receiver can receive this disposal order.")

        # Engine workflows: REST receive must advance the pending receive task (not leave it open).
        pending_receive = self._pending_step_task(order, step_kind="receive")
        if pending_receive is not None:
            try:
                ApprovalEngineService(self._db).act_on_task(
                    task_id=int(pending_receive.id),
                    actor_user_id=actor_user_id,
                    action="approve",
                    comment=_strip_or_none(data.remarks),
                    next_assigned_user_id=int(data.assigned_to),
                    to_functional_location=data.functional_location,
                    to_actual_location=data.actual_location,
                )
            except ApprovalError as exc:
                raise ConflictError(str(exc)) from exc
            return self.get_order(order_id, viewer_user_id=actor_user_id)

        if order.to_cost_center_id is None:
            raise ConflictError("Scrapyard cost center must be set on the order before receive.")
        cc = self._require_scrapyard_cost_center(
            plant_id=int(order.plant_id), cost_center_id=int(order.to_cost_center_id)
        )
        # Destination CC is fixed at submit; ignore any client override.
        order.to_cost_center_id = int(cc.id)

        cf_user = self._db.get(User, int(data.assigned_to))
        if cf_user is None or not cf_user.is_active:
            raise NotFoundError("User", data.assigned_to)

        functional_location, actual_location = self._require_scrapyard_locations(
            plant_id=int(order.plant_id),
            functional_location=data.functional_location,
            actual_location=data.actual_location,
        )

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
        order.rejection_comment = None
        if order.receiver_user_id is None:
            order.receiver_user_id = int(actor_user_id)
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

        pending_close = self._pending_step_task(order, step_kind="close")
        if pending_close is not None:
            try:
                ApprovalEngineService(self._db).act_on_task(
                    task_id=int(pending_close.id),
                    actor_user_id=actor_user_id,
                    action="approve",
                    comment=_strip_or_none(data.remarks),
                )
            except ApprovalError as exc:
                raise ConflictError(str(exc)) from exc
            return self.get_order(order_id, viewer_user_id=actor_user_id)

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
        current_kind = "approve"
        current_role_id: int | None = None
        if pending_task is not None:
            if pending_task.assigned_user_id is not None:
                current_assignee_id = int(pending_task.assigned_user_id)
                current_assignee_name = _user_display_name(self._db, current_assignee_id)
            if pending_task.step is not None:
                current_role_id = int(pending_task.step.approver_role_id)
                role = self._db.get(Role, current_role_id)
                if role is not None:
                    current_role = role.name
                    current_level = ROLE_TO_ASSIGNEE_LEVEL.get(role.name)
                current_kind = str(getattr(pending_task.step, "step_kind", None) or "approve")

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
        has_ops = any(
            str(getattr(s, "step_kind", None) or "approve") in ("receive", "confirm", "close")
            for s in wf_steps
        )
        if str(req.status) == "pending" and steps:
            current = next((s for s in steps if s.phase == "current"), None)
            if current is not None:
                is_final = int(current.step_order) >= int(current.total_steps)
                current_kind = str(getattr(current, "step_kind", None) or current_kind)
                if is_final and not has_ops:
                    # Legacy post-approval receiver: role that grants disposal.receive
                    # (rename-safe — not looked up by display name).
                    needs_next = True
                    receiver = _role_with_permission(self._db, "disposal.receive")
                    if receiver is not None:
                        next_role_id = int(receiver.id)
                        next_role = receiver.name
                elif not is_final:
                    nxt_row = next(
                        (
                            s
                            for s in wf_steps
                            if int(s.step_order) == int(current.step_order) + 1
                        ),
                        None,
                    )
                    if nxt_row is not None:
                        next_role_id = int(nxt_row.approver_role_id)
                        next_kind = str(getattr(nxt_row, "step_kind", None) or "approve")
                        role = self._db.get(Role, next_role_id)
                        if role is not None:
                            next_role = role.name
                            next_level = ROLE_TO_ASSIGNEE_LEVEL.get(role.name)
                        needs_next = disposal_needs_next_assignee(
                            current_kind=current_kind,
                            next_kind=next_kind,
                            current_role_id=current_role_id,
                            next_role_id=next_role_id,
                        )
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
            current_step_kind=current_kind,
            is_final_step=is_final,
            needs_next_assignee=needs_next,
            next_step_role_name=next_role,
            next_assignee_role_id=next_role_id,
            next_assignee_level=next_level,
            next_step_kind=next_kind,
        )

    # ------------------------------------------------------------------ reads

    def list_column_filter_options(
        self,
        *,
        viewer_user_id: int | None = None,
        plant_id: int | None = None,
    ) -> DisposalListFilterOptionsResponse:
        """Distinct plant / CC / status values present on disposal orders in list scope."""
        where = self._list_orders_where("all", viewer_user_id=viewer_user_id)
        all_ids = (
            select(AssetDisposalOrder.id)
            .where(*where)
            .order_by(None)
            .scalar_subquery()
        )
        plant_rows = self._db.execute(
            select(OrgUnit.id, OrgUnit.code, OrgUnit.name)
            .where(
                OrgUnit.id.in_(
                    select(AssetDisposalOrder.plant_id)
                    .where(AssetDisposalOrder.id.in_(all_ids))
                    .distinct()
                )
            )
            .order_by(OrgUnit.code, OrgUnit.name)
        ).all()
        plants = [
            DisposalListFilterPlant(
                id=int(pid),
                code=str(code) if code else None,
                name=str(name or ""),
            )
            for pid, code, name in plant_rows
        ]

        scoped = select(AssetDisposalOrder.id).where(*where)
        if plant_id is not None:
            scoped = scoped.where(AssetDisposalOrder.plant_id == int(plant_id))
        scoped_ids = scoped.order_by(None).scalar_subquery()

        cc_rows = self._db.execute(
            select(
                CostCenterMaster.id,
                CostCenterMaster.code,
                CostCenterMaster.name,
                CostCenterMaster.plant_id,
            )
            .where(
                CostCenterMaster.id.in_(
                    select(AssetDisposalOrder.from_cost_center_id)
                    .where(
                        AssetDisposalOrder.id.in_(scoped_ids),
                        AssetDisposalOrder.from_cost_center_id.is_not(None),
                    )
                    .distinct()
                )
            )
            .order_by(CostCenterMaster.code, CostCenterMaster.name)
        ).all()
        from_cost_centers = [
            DisposalListFilterCostCenter(
                id=int(cid),
                code=str(code),
                name=str(name) if name else None,
                plant_id=int(ppid) if ppid is not None else None,
            )
            for cid, code, name, ppid in cc_rows
        ]
        statuses = [
            str(s)
            for s in self._db.scalars(
                select(AssetDisposalOrder.status)
                .where(AssetDisposalOrder.id.in_(scoped_ids))
                .distinct()
                .order_by(AssetDisposalOrder.status)
            ).all()
            if s
        ]
        return DisposalListFilterOptionsResponse(
            plants=plants,
            from_cost_centers=from_cost_centers,
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
        status: str | None = None,
        asset_count: int | None = None,
        assigned_to: str | None = None,
        created_on: date | None = None,
        sort_by: str = "created_at",
        sort_dir: str = "desc",
    ) -> DisposalOrderListResponse:
        self._normalize_legacy_rework_orders()
        tab_key = (tab or "needs_action").strip().lower()
        where = self._list_orders_where(tab_key, viewer_user_id=viewer_user_id)
        where.extend(
            self._list_filter_clauses(
                search=search,
                order_number=order_number,
                plant_id=plant_id,
                from_cost_center_id=from_cost_center_id,
                status=status,
                asset_count=asset_count,
                assigned_to=assigned_to,
                created_on=created_on,
            )
        )
        total = int(
            self._db.scalar(select(func.count()).select_from(AssetDisposalOrder).where(*where)) or 0
        )
        stmt = (
            select(AssetDisposalOrder)
            .where(*where)
            .options(
                selectinload(AssetDisposalOrder.plant),
                selectinload(AssetDisposalOrder.from_cost_center),
                selectinload(AssetDisposalOrder.creator),
                selectinload(AssetDisposalOrder.assignee),
                selectinload(AssetDisposalOrder.items),
            )
        )
        stmt = apply_sort_dir(
            stmt,
            _disposal_list_sort_expr(sort_by),
            sort_dir=sort_dir,
            tiebreaker=AssetDisposalOrder.id,
        )
        rows = list(
            self._db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).all()
        )
        pending_roles = pending_role_names_for_requests(
            self._db,
            [
                int(r.approval_request_id)
                for r in rows
                if r.approval_request_id is not None
                and r.status in {STATUS_PENDING_APPROVAL, STATUS_PENDING_RECEIPT}
            ],
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
                    pending_role_name=(
                        pending_roles.get(int(r.approval_request_id))
                        if r.status in {STATUS_PENDING_APPROVAL, STATUS_PENDING_RECEIPT}
                        and r.approval_request_id is not None
                        else None
                    ),
                    created_by_name=r.creator.full_name if r.creator else None,
                    created_at=r.created_at,
                    needs_my_action=self._row_needs_action(r, viewer_user_id),
                    my_action_label=self._row_action_label(r, viewer_user_id),
                    can_delete=bool(
                        viewer_user_id is not None
                        and _is_plain_disposal_draft(self._db, r)
                        and _actor_may_discard_disposal(
                            r, actor_user_id=int(viewer_user_id), db=self._db
                        )
                    ),
                    can_archive=bool(
                        viewer_user_id is not None
                        and r.status in ARCHIVABLE_STATUSES
                        and not _is_plain_disposal_draft(self._db, r)
                        and _actor_may_discard_disposal(
                            r, actor_user_id=int(viewer_user_id), db=self._db
                        )
                    ),
                    can_unarchive=bool(
                        viewer_user_id is not None
                        and r.status == STATUS_CANCELLED
                        and _actor_may_discard_disposal(
                            r, actor_user_id=int(viewer_user_id), db=self._db
                        )
                    ),
                )
                for r in rows
            ],
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
        status: str | None = None,
        asset_count: int | None = None,
        assigned_to: str | None = None,
        created_on: date | None = None,
    ) -> list:
        clauses: list = []
        if plant_id is not None:
            clauses.append(AssetDisposalOrder.plant_id == int(plant_id))
        if from_cost_center_id is not None:
            clauses.append(AssetDisposalOrder.from_cost_center_id == int(from_cost_center_id))
        status_q = (status or "").strip().lower()
        if status_q:
            clauses.append(AssetDisposalOrder.status == status_q)
        if asset_count is not None:
            item_count = (
                select(func.count(AssetDisposalOrderItem.id))
                .where(AssetDisposalOrderItem.order_id == AssetDisposalOrder.id)
                .correlate(AssetDisposalOrder)
                .scalar_subquery()
            )
            clauses.append(item_count == int(asset_count))
        if created_on is not None:
            clauses.append(func.date(AssetDisposalOrder.created_at) == created_on)
        onum = (order_number or "").strip()
        if onum:
            clauses.append(AssetDisposalOrder.order_number.ilike(f"%{onum}%"))
        assignee_q = (assigned_to or "").strip()
        if assignee_q:
            clauses.append(
                AssetDisposalOrder.assignee.has(User.full_name.ilike(f"%{assignee_q}%"))
            )
        q = (search or "").strip()
        if q:
            pattern = f"%{q}%"
            clauses.append(
                or_(
                    AssetDisposalOrder.order_number.ilike(pattern),
                    AssetDisposalOrder.plant.has(
                        or_(OrgUnit.name.ilike(pattern), OrgUnit.code.ilike(pattern))
                    ),
                    AssetDisposalOrder.from_cost_center.has(
                        CostCenterMaster.code.ilike(pattern)
                    ),
                    AssetDisposalOrder.assignee.has(User.full_name.ilike(pattern)),
                    AssetDisposalOrder.creator.has(User.full_name.ilike(pattern)),
                )
            )
        return clauses

    def _list_orders_where(self, tab: str, *, viewer_user_id: int | None) -> list:
        if tab == "needs_action":
            if viewer_user_id is None:
                return [AssetDisposalOrder.id < 0]
            return self._needs_action_clauses(int(viewer_user_id))
        if tab in ("done", "closed"):
            return [AssetDisposalOrder.status.in_((STATUS_CLOSED, STATUS_CANCELLED))]
        if tab == "all":
            return []
        statuses = _TAB_STATUSES.get(tab)
        if statuses is None and tab in _TAB_STATUSES:
            return []
        if statuses is None:
            return []
        return [AssetDisposalOrder.status.in_(statuses)]

    def _needs_action_clauses(self, viewer_user_id: int) -> list:
        uid = int(viewer_user_id)
        pending_req_ids = pending_approval_request_ids_for_viewer(self._db, uid)
        return [
            or_(
                and_(
                    AssetDisposalOrder.approval_request_id.is_not(None),
                    AssetDisposalOrder.approval_request_id.in_(pending_req_ids),
                ),
                # Creator: draft always; rejected only when assigned back to them
                # (not when CF bounce sent the order to the receiver).
                and_(
                    AssetDisposalOrder.created_by == uid,
                    AssetDisposalOrder.status.in_(CREATOR_ACTION_STATUSES),
                    or_(
                        AssetDisposalOrder.status == STATUS_DRAFT,
                        AssetDisposalOrder.assigned_to == uid,
                    ),
                ),
                and_(
                    AssetDisposalOrder.assigned_to == uid,
                    AssetDisposalOrder.status.in_(
                        (
                            STATUS_PENDING_RECEIPT,
                            STATUS_PENDING_CF_CLOSE,
                            STATUS_REJECTED,
                        )
                    ),
                ),
            ),
            AssetDisposalOrder.status != STATUS_CANCELLED,
            AssetDisposalOrder.status != STATUS_CLOSED,
        ]

    def _list_tab_counts(self, *, viewer_user_id: int | None) -> dict[str, int]:
        counts: dict[str, int] = {}
        for key in ("all", "needs_action", "done"):
            where = self._list_orders_where(key, viewer_user_id=viewer_user_id)
            counts[key] = int(
                self._db.scalar(
                    select(func.count()).select_from(AssetDisposalOrder).where(*where)
                )
                or 0
            )
        return counts

    def _row_needs_action(
        self, order: AssetDisposalOrder, viewer_user_id: int | None
    ) -> bool:
        return self._row_action_label(order, viewer_user_id) is not None

    def _row_action_label(
        self, order: AssetDisposalOrder, viewer_user_id: int | None
    ) -> str | None:
        if viewer_user_id is None:
            return None
        uid = int(viewer_user_id)
        returned = _is_returned_to_receiver(self._db, order)
        if (
            order.status in RESUMABLE_STATUSES
            and not returned
            and order.created_by is not None
            and int(order.created_by) == uid
        ):
            return "Restart"
        if order.status in EDITABLE_STATUSES and order.created_by is not None and int(order.created_by) == uid:
            return "Submit" if order.status == STATUS_DRAFT else "Resubmit"
        if order.assigned_to is not None and int(order.assigned_to) == uid:
            if order.status == STATUS_PENDING_RECEIPT or returned:
                return "Receive"
            if order.status == STATUS_PENDING_CF_CLOSE:
                return "Close"
        if order.approval_request_id is not None and order.status == STATUS_PENDING_APPROVAL:
            pending_ids = {
                int(x)
                for x in self._db.scalars(pending_approval_request_ids_for_viewer(self._db, uid)).all()
                if x is not None
            }
            if int(order.approval_request_id) in pending_ids:
                return "Approve"
        return None

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
        self._normalize_legacy_rework_orders()
        order = self._load_order(order_id)
        # Heal orders received via REST while an engine receive task was still open.
        if self._heal_stale_receive_task(order):
            order = self._load_order(order_id)
        # Heal legacy bounce rows that kept pending_receipt after CF reject.
        if (
            order.status == STATUS_PENDING_RECEIPT
            and (order.rejection_comment or "").strip()
            and order.approval_request_id is not None
        ):
            req = self._db.get(ApprovalRequest, int(order.approval_request_id))
            if req is not None and str(req.status) == "pending":
                order.status = STATUS_REJECTED
                self._db.commit()
        returned_to_receiver = _is_returned_to_receiver(self._db, order)
        if returned_to_receiver and order.receiver_user_id is not None:
            receiver_id = int(order.receiver_user_id)
            if order.assigned_to is None or int(order.assigned_to) != receiver_id:
                order.assigned_to = receiver_id
                self._db.commit()
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

        panel = self._approval_panel(order, viewer_user_id=viewer_user_id)
        legacy_receive = (
            (order.status == STATUS_PENDING_RECEIPT or returned_to_receiver)
            and viewer_user_id is not None
            and self._actor_may_act(
                order, actor_user_id=int(viewer_user_id), permission=PERMISSION_RECEIVE
            )
        )
        legacy_close = (
            order.status == STATUS_PENDING_CF_CLOSE
            and viewer_user_id is not None
            and self._actor_may_act(
                order, actor_user_id=int(viewer_user_id), permission=PERMISSION_CLOSE
            )
        )
        to_fl, to_al = _scrapyard_locations_after_receive(self._db, order)
        to_fl_name, to_al_name = resolve_plant_location_names(
            self._db,
            plant_id=int(order.plant_id),
            functional_location_code=to_fl,
            actual_location_code=to_al,
        )
        from_name_cache: dict[tuple[str, str], tuple[str | None, str | None]] = {}

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

        item_publics: list[DisposalOrderItemPublic] = []
        for i in order.items:
            fl_n, al_n = _from_names(i.from_functional_location, i.from_actual_location)
            item_publics.append(
                DisposalOrderItemPublic(
                    id=int(i.id),
                    asset_id=int(i.asset_id),
                    asset_code=i.asset.asset_code if i.asset else "",
                    asset_name=i.asset.asset_name if i.asset else "",
                    from_cost_center_code=i.from_cost_center_code,
                    from_functional_location=i.from_functional_location,
                    from_actual_location=i.from_actual_location,
                    from_functional_location_name=fl_n,
                    from_actual_location_name=al_n,
                )
            )

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
            to_cost_center_id=(
                int(order.to_cost_center_id) if order.to_cost_center_id else None
            ),
            to_cost_center_code=order.to_cost_center.code if order.to_cost_center else None,
            to_cost_center_description=(
                order.to_cost_center.description if order.to_cost_center else None
            ),
            to_functional_location=to_fl,
            to_actual_location=to_al,
            to_functional_location_name=to_fl_name,
            to_actual_location_name=to_al_name,
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
            receiver_user_id=int(order.receiver_user_id) if order.receiver_user_id else None,
            receiver_name=order.receiver.full_name if order.receiver else None,
            assigned_at=order.assigned_at,
            closed_at=order.closed_at,
            created_at=order.created_at,
            updated_at=order.updated_at,
            items=item_publics,
            audit=self.list_audit(int(order.id)),
            approval_panel=panel,
            can_submit=(order.status in SUBMITTABLE_STATUSES) and (is_creator or is_super),
            can_edit=(order.status in EDITABLE_STATUSES) and (is_creator or is_super),
            can_resume=(
                order.status in RESUMABLE_STATUSES
                and not returned_to_receiver
                and (is_creator or is_super)
            ),
            can_receive=_can_disposal_operational_flag(
                order,
                panel=panel,
                legacy_ok=legacy_receive,
                step_kind="receive",
                allow_rejected_receive=returned_to_receiver,
            ),
            can_close=_can_disposal_operational_flag(
                order, panel=panel, legacy_ok=legacy_close, step_kind="close"
            ),
            can_delete=_is_plain_disposal_draft(self._db, order) and (is_creator or is_super),
            can_archive=(
                order.status in ARCHIVABLE_STATUSES
                and not _is_plain_disposal_draft(self._db, order)
                and (is_creator or is_super)
            ),
            can_unarchive=(
                order.status == STATUS_CANCELLED and (is_creator or is_super)
            ),
        )


def _can_disposal_operational_flag(
    order: AssetDisposalOrder,
    *,
    panel: DisposalApprovalPanel | None,
    legacy_ok: bool,
    step_kind: str,
    allow_rejected_receive: bool = False,
) -> bool:
    """Engine pending task wins; while the approval request is open, hide legacy-only gates."""
    # Status is source of truth — never show Receive after assets already moved to CF.
    if step_kind == "receive":
        if order.status == STATUS_PENDING_RECEIPT:
            pass
        elif order.status == STATUS_REJECTED and allow_rejected_receive:
            pass
        else:
            return False
    if step_kind == "close" and order.status != STATUS_PENDING_CF_CLOSE:
        return False
    if (
        panel is not None
        and panel.my_pending_task_id is not None
        and (panel.current_step_kind or "approve") == step_kind
    ):
        return True
    if (
        order.approval_request_id is not None
        and panel is not None
        and str(panel.request_status) == "pending"
    ):
        # Bounce-to-receiver: assigned receiver may still use REST receive while the
        # engine request stays open.
        if allow_rejected_receive and legacy_ok:
            return True
        return False
    return legacy_ok


# ------------------------------------------------- approval engine callbacks


def apply_disposal_enter_receive(
    db: Session,
    *,
    order_id: int,
    actor_user_id: int | None,
    next_assignee_user_id: int,
    step_role_name: str | None = None,
    next_role_name: str | None = None,
    comment: str | None = None,
) -> None:
    """After last approve before a receive step: order awaits Cost Center User receive."""
    order = db.get(AssetDisposalOrder, order_id)
    if order is None:
        return
    old_status = order.status
    order.status = STATUS_PENDING_RECEIPT
    order.rejection_comment = None
    order.receiver_user_id = int(next_assignee_user_id)
    order.assigned_to = int(next_assignee_user_id)
    order.assigned_by = actor_user_id
    order.assigned_at = datetime.now(timezone.utc)
    log_disposal_event(
        db,
        order_id=int(order.id),
        action="approved",
        actor_user_id=actor_user_id,
        old_value={"status": old_status},
        new_value={
            "status": order.status,
            "step_role_name": step_role_name,
            "assigned_to": int(next_assignee_user_id),
            "receiver_user_id": int(next_assignee_user_id),
            "next_role_name": next_role_name,
            "comment": (comment or "").strip() or None,
        },
    )


def apply_disposal_receive(
    db: Session,
    *,
    order_id: int,
    actor_user_id: int,
    cost_center_id: int | None,
    functional_location: str | None,
    actual_location: str | None,
    next_assignee_user_id: int,
    step_role_name: str | None = None,
    comment: str | None = None,
) -> None:
    """Receive step: keep order scrapyard CC, set scrapyard Actual Location 1/2, hand to CF."""
    order = db.scalar(
        select(AssetDisposalOrder)
        .where(AssetDisposalOrder.id == int(order_id))
        .options(
            selectinload(AssetDisposalOrder.items).selectinload(AssetDisposalOrderItem.asset),
        )
    )
    if order is None:
        return
    # Destination scrapyard is fixed at submit; ignore client cost_center_id.
    _ = cost_center_id
    if order.to_cost_center_id is None:
        raise ConflictError("Scrapyard cost center must be set on the order before receive.")
    cc = db.get(CostCenterMaster, int(order.to_cost_center_id))
    if cc is None:
        raise NotFoundError("Cost center", order.to_cost_center_id)
    if int(cc.plant_id) != int(order.plant_id):
        raise ConflictError(
            "Receive cost center must belong to the same plant as the assets."
        )
    if not bool(getattr(cc, "is_scrapyard", False)):
        raise ConflictError("Selected cost center is not marked as a scrapyard.")
    if not bool(cc.is_active):
        raise ConflictError("Scrapyard cost center is inactive.")
    fl, al = require_scrapyard_locations(
        db,
        plant_id=int(order.plant_id),
        functional_location=functional_location or "",
        actual_location=actual_location or "",
    )

    for item in order.items:
        asset = item.asset
        if asset is None:
            continue
        loc = _ensure_location(asset)
        loc.functional_location = fl
        loc.actual_location = al
        _ensure_financial(asset).cost_center = cc.code

    old_status = order.status
    order.to_cost_center_id = int(cc.id)
    order.status = STATUS_PENDING_CF_CLOSE
    order.rejection_comment = None
    # Keep receiver_user_id so a later CF reject can return here for location edits.
    if order.receiver_user_id is None:
        order.receiver_user_id = int(actor_user_id)
    order.assigned_to = int(next_assignee_user_id)
    order.assigned_by = actor_user_id
    order.assigned_at = datetime.now(timezone.utc)
    log_disposal_event(
        db,
        order_id=int(order.id),
        action="received",
        actor_user_id=actor_user_id,
        old_value={"status": old_status},
        new_value={
            "status": order.status,
            "step_role_name": step_role_name,
            "assigned_to": int(next_assignee_user_id),
            "cost_center": cc.code,
            "functional_location": fl,
            "actual_location": al,
            "comment": (comment or "").strip() or None,
        },
    )


def apply_disposal_close(
    db: Session,
    *,
    order_id: int,
    actor_user_id: int,
    step_role_name: str | None = None,
    comment: str | None = None,
) -> None:
    order = db.scalar(
        select(AssetDisposalOrder)
        .where(AssetDisposalOrder.id == int(order_id))
        .options(
            selectinload(AssetDisposalOrder.items).selectinload(AssetDisposalOrderItem.asset),
        )
    )
    if order is None:
        return
    disposed: list[str] = []
    for item in order.items:
        asset = item.asset
        if asset is None:
            continue
        mark_disposed(asset)
        disposed.append(asset.asset_code or str(asset.id))
    old_status = order.status
    order.status = STATUS_CLOSED
    order.closed_at = datetime.now(timezone.utc)
    log_disposal_event(
        db,
        order_id=int(order.id),
        action="closed",
        actor_user_id=actor_user_id,
        old_value={"status": old_status},
        new_value={
            "status": order.status,
            "step_role_name": step_role_name,
            "disposed_assets": disposed,
            "comment": (comment or "").strip() or None,
        },
    )


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
    order.receiver_user_id = int(receiver.id)
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
            "receiver_user_id": int(receiver.id),
            "comment": (comment or "").strip() or None,
        },
    )
    db.commit()


def _revert_disposal_assets_after_receive(order: AssetDisposalOrder) -> None:
    """Restore cost center / locations from line-item snapshots taken at create."""
    for item in order.items:
        asset = item.asset
        if asset is None:
            continue
        if item.from_cost_center_code:
            _ensure_financial(asset).cost_center = item.from_cost_center_code
        loc = _ensure_location(asset)
        loc.functional_location = item.from_functional_location
        loc.actual_location = item.from_actual_location


def _resolve_disposal_receiver_id(db: Session, order: AssetDisposalOrder) -> int | None:
    """Prefer persisted receiver; fall back to last enter-receive / receive assignee."""
    if order.receiver_user_id is not None:
        return int(order.receiver_user_id)
    # Legacy rows created before receiver_user_id existed.
    from modules.disposals.model import AssetDisposalOrderAudit

    rows = db.scalars(
        select(AssetDisposalOrderAudit)
        .where(
            AssetDisposalOrderAudit.order_id == int(order.id),
            AssetDisposalOrderAudit.action.in_(("approved", "received")),
        )
        .order_by(AssetDisposalOrderAudit.id.desc())
    ).all()
    for row in rows:
        new_val = row.new_value if isinstance(row.new_value, dict) else {}
        if row.action == "approved" and new_val.get("status") == STATUS_PENDING_RECEIPT:
            assigned = new_val.get("assigned_to") or new_val.get("receiver_user_id")
            if assigned is not None:
                return int(assigned)
        if row.action == "received" and row.actor_user_id is not None:
            return int(row.actor_user_id)
    return None


def reject_disposal_approval(
    db: Session,
    *,
    order_id: int,
    approver_user_id: int | None,
    comment: str | None,
    step_role_name: str | None = None,
) -> str:
    """Apply reject on the disposal order.

    Returns ``\"receiver\"`` when CF/post-receive reject sends the order back for
    location edits. Otherwise ``\"creator\"`` (terminal rejected → Restart → draft).
    """
    order = db.scalar(
        select(AssetDisposalOrder)
        .where(AssetDisposalOrder.id == int(order_id))
        .options(
            selectinload(AssetDisposalOrder.items).selectinload(AssetDisposalOrderItem.asset),
        )
    )
    if order is None:
        return "creator"

    reason = (comment or "").strip() or None
    old_status = order.status
    order.rejection_comment = reason

    # After receive: revert locations and reopen receive for the Cost Center User.
    if old_status == STATUS_PENDING_CF_CLOSE:
        receiver_id = _resolve_disposal_receiver_id(db, order)
        if receiver_id is None:
            raise ConflictError(
                "Receiver is missing on this disposal order; cannot return it for re-receive."
            )
        order.receiver_user_id = receiver_id
        _revert_disposal_assets_after_receive(order)
        # Status Rejected (not pending_receipt) so list/detail badges match the reject.
        # Receive stays open via the approval engine; _is_returned_to_receiver detects this.
        order.status = STATUS_REJECTED
        order.closed_at = None
        order.assigned_to = receiver_id
        order.assigned_by = approver_user_id
        order.assigned_at = datetime.now(timezone.utc)
        log_disposal_event(
            db,
            order_id=int(order.id),
            action="rejected",
            actor_user_id=approver_user_id,
            old_value={"status": old_status},
            new_value={
                "status": order.status,
                "comment": reason,
                "step_role_name": step_role_name,
                "returned_to": "receiver",
                "assigned_to": receiver_id,
            },
        )
        return "receiver"

    # Approve-chain or receive-step reject → terminal rejected for the creator.
    order.status = STATUS_REJECTED
    if order.created_by is not None:
        order.assigned_to = int(order.created_by)
        order.assigned_by = approver_user_id
        order.assigned_at = datetime.now(timezone.utc)
    log_disposal_event(
        db,
        order_id=int(order.id),
        action="rejected",
        actor_user_id=approver_user_id,
        old_value={"status": old_status},
        new_value={
            "status": order.status,
            "comment": reason,
            "step_role_name": step_role_name,
            "returned_to": "creator",
            "assigned_to": int(order.assigned_to) if order.assigned_to is not None else None,
        },
    )
    return "creator"


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
