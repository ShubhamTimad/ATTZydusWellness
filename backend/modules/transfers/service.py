from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from modules.asset_masters.model import CostCenterAssetCustodian, CostCenterMaster
from modules.assets.lifecycle import LIFECYCLE_ACTIVE
from modules.assets.model import (
    AssetFinancialInformation,
    AssetLocationInformation,
    AssetMaster,
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
from modules.transfers.constants import (
    ACTION_SUBMIT,
    ACTIVE_STATUSES,
    ASSIGNEE_LEVEL_ROLES,
    EDITABLE_STATUSES,
    ENTITY_TYPE,
    PENDING_APPROVAL_STATUSES,
    REJECTABLE_STATUSES,
    ROLE_CENTRAL_FINANCE,
    ROLE_TO_ASSIGNEE_LEVEL,
    STATUS_APPROVED_BY_CF,
    STATUS_CLOSED,
    STATUS_CONFIRMED_BY_CF,
    STATUS_DRAFT,
    STATUS_IN_REWORK,
    STATUS_LABELS,
    STATUS_PENDING_APPROVAL,
    STATUS_RECEIVED_BY_CC2,
    STATUS_REJECTED,
    SUBMITTABLE_STATUSES,
)
from modules.transfers.model import AssetTransferOrder, AssetTransferOrderAudit, AssetTransferOrderItem
from modules.transfers.schema import (
    Cc2AssignTransferRequest,
    CfApproveTransferRequest,
    CfRejectTransferRequest,
    CreateTransferOrderRequest,
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
    TransferWorkflowRunPublic,
    UpdateTransferOrderRequest,
)

_TAB_STATUSES: dict[str, frozenset[str] | None] = {
    "all": None,
    "draft": EDITABLE_STATUSES,
    "pending": PENDING_APPROVAL_STATUSES | frozenset({STATUS_IN_REWORK}),
    "assigned_to_cf": PENDING_APPROVAL_STATUSES | frozenset({STATUS_IN_REWORK}),
    "rejected": frozenset({STATUS_REJECTED}),
    "approved_by_cf": frozenset({STATUS_APPROVED_BY_CF}),
    "received_by_cc2": frozenset({STATUS_RECEIVED_BY_CC2}),
    "confirmed_by_cf": frozenset({STATUS_CONFIRMED_BY_CF}),
    "closed": frozenset({STATUS_CLOSED}),
    "active": ACTIVE_STATUSES,
}


def action_and_entity_for_order() -> tuple[str, str]:
    return ACTION_SUBMIT, ENTITY_TYPE


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
        ("to_asset_custodian_id", "to_asset_custodian_name"),
    ):
        if key in out:
            uid = out.get(key)
            if name_key not in out and isinstance(uid, int):
                name = _user_display_name(db, uid)
                if name:
                    out[name_key] = name
            out.pop(key, None)
    return out


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

    def list_assignees(self, *, level: str) -> TransferAssigneeListResponse:
        role_name = ASSIGNEE_LEVEL_ROLES.get(level.strip().lower())
        if role_name is None:
            allowed = ", ".join(sorted(ASSIGNEE_LEVEL_ROLES))
            raise ConflictError(f"Invalid assignee level. Use one of: {allowed}.")
        role = self._role_by_name(role_name)
        users = _users_in_role(self._db, int(role.id))
        return TransferAssigneeListResponse(
            role_name=role_name,
            items=[
                TransferAssigneeOption(id=int(u.id), full_name=u.full_name, email=u.email)
                for u in users
            ],
        )

    def list_assignees_for_action(
        self, *, action_code: str = ACTION_SUBMIT
    ) -> TransferAssigneeListResponse:
        """Users in the first step role of the workflow mapped to this transfer action."""
        wf = get_workflow_for_action(self._db, action_code)
        if wf is None or not wf.steps:
            raise ConflictError(
                "No active transfer approval workflow is configured. Contact an administrator."
            )
        role = _first_step_role(self._db, wf)
        return TransferAssigneeListResponse(
            role_name=str(role.name),
            items=[
                TransferAssigneeOption(id=int(u.id), full_name=u.full_name, email=u.email)
                for u in _users_in_role(self._db, int(role.id))
            ],
        )

    def list_destination_cost_centers(self, *, plant_id: int) -> list[TransferDestinationCostCenter]:
        """All active cost centers on the plant — destination is not limited to the creator's CCs."""
        plant = self._db.get(OrgUnit, int(plant_id))
        if plant is None or plant.type != "PLANT":
            raise NotFoundError("Plant", plant_id)
        rows = list(
            self._db.scalars(
                select(CostCenterMaster)
                .where(
                    CostCenterMaster.plant_id == int(plant_id),
                    CostCenterMaster.is_active.is_(True),
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

    def _assert_assets_approved_for_transfer(self, assets: list[AssetMaster]) -> None:
        """Transfer orders may only include approved (or approval-not-required) active assets."""
        bad: list[str] = []
        for asset in assets:
            lifecycle = (asset.lifecycle_status or "").strip().lower()
            approval = (asset.approval_status or "").strip().lower()
            if lifecycle != LIFECYCLE_ACTIVE or approval not in {"approved", "not_required"}:
                bad.append(asset.asset_code or str(asset.id))
        if bad:
            sample = ", ".join(bad[:5])
            more = "…" if len(bad) > 5 else ""
            raise ConflictError(
                "Only approved assets can be included on a transfer order: "
                f"{sample}{more}."
            )

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

    def _assign(self, order: AssetTransferOrder, *, to_user_id: int, by_user_id: int) -> None:
        order.assigned_to = to_user_id
        order.assigned_by = by_user_id
        order.assigned_at = datetime.now(timezone.utc)

    def _replace_items(self, order: AssetTransferOrder, assets: list[AssetMaster]) -> None:
        order.items.clear()
        self._db.flush()
        for asset in assets:
            order.items.append(
                AssetTransferOrderItem(
                    asset_id=int(asset.id),
                    from_cost_center_code=_asset_cost_center(asset),
                    from_functional_location=_asset_functional_location(asset),
                    from_actual_location=_asset_actual_location(asset),
                    from_asset_custodian_id=(
                        int(asset.asset_custodian_id) if asset.asset_custodian_id else None
                    ),
                )
            )

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
        to_custodian = self._resolve_to_asset_custodian(
            cost_center_id=int(to_cc.id),
            user_id=int(data.to_asset_custodian_id),
        )
        order = AssetTransferOrder(
            order_number=self._next_order_number(),
            plant_id=plant_id,
            from_cost_center_id=int(from_cc.id),
            to_cost_center_id=int(to_cc.id),
            to_asset_custodian_id=int(to_custodian.id),
            to_functional_location=_strip_or_none(data.to_functional_location),
            to_actual_location=_strip_or_none(data.to_actual_location),
            created_by=actor_user_id,
            status=STATUS_DRAFT,
            remarks=_strip_or_none(data.remarks),
        )
        self._db.add(order)
        self._db.flush()
        self._replace_items(order, assets)
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
                "Transfer order can only be edited while draft, rejected, or in rework."
            )
        before = {
            "to_cost_center_id": order.to_cost_center_id,
            "to_asset_custodian_id": order.to_asset_custodian_id,
            "to_functional_location": order.to_functional_location,
            "to_actual_location": order.to_actual_location,
            "remarks": order.remarks,
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
            if "to_asset_custodian_id" not in patch:
                order.to_asset_custodian_id = None
        if "to_asset_custodian_id" in patch and patch["to_asset_custodian_id"] is not None:
            self._resolve_to_asset_custodian(
                cost_center_id=int(order.to_cost_center_id),
                user_id=int(patch["to_asset_custodian_id"]),
            )
            order.to_asset_custodian_id = int(patch["to_asset_custodian_id"])
        if "to_functional_location" in patch:
            order.to_functional_location = _strip_or_none(patch["to_functional_location"])
        if "to_actual_location" in patch:
            order.to_actual_location = _strip_or_none(patch["to_actual_location"])
        if "remarks" in patch:
            order.remarks = _strip_or_none(patch["remarks"])
        if "asset_ids" in patch and patch["asset_ids"] is not None:
            assets = self._load_assets(patch["asset_ids"])
            self._assert_actor_is_custodian(assets, actor_user_id=actor_user_id)
            self._assert_assets_approved_for_transfer(assets)
            plant_id = _asset_plant_id(assets[0])
            if plant_id is None or plant_id != int(order.plant_id):
                raise ConflictError("Assets must remain on the same plant as the transfer order.")
            from_cc = self._assert_same_from_cost_center(assets)
            order.from_cost_center_id = int(from_cc.id)
            self._replace_items(order, assets)
        _log(
            self._db,
            order_id=int(order.id),
            action="updated",
            actor_user_id=actor_user_id,
            old_value=before,
            new_value={
                "to_cost_center_id": order.to_cost_center_id,
                "to_asset_custodian_id": order.to_asset_custodian_id,
                "to_functional_location": order.to_functional_location,
                "to_actual_location": order.to_actual_location,
                "remarks": order.remarks,
            },
        )
        self._db.commit()
        return self.get_order(int(order.id), viewer_user_id=actor_user_id)

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
        self._assert_actor_is_custodian(assets, actor_user_id=actor_user_id)
        self._assert_assets_approved_for_transfer(assets)
        self._assert_same_from_cost_center(assets)
        if order.to_asset_custodian_id is None:
            raise ConflictError("Destination asset custodian is required before submitting.")

        action_code, entity_type = action_and_entity_for_order()
        wf = get_workflow_for_action(self._db, action_code)
        if wf is None:
            raise ConflictError(
                "No active transfer approval workflow is configured. Contact an administrator."
            )
        first_role = _first_step_role(self._db, wf)
        if not any(
            int(u.id) == int(assigned_to)
            for u in _users_in_role(self._db, int(first_role.id))
        ):
            raise ConflictError(
                f"Selected user is not an active member of role {first_role.name!r}."
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
            existing = (
                self._db.get(ApprovalRequest, int(order.approval_request_id))
                if order.approval_request_id
                else None
            )
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
                        assigned_user_id=int(assigned_to),
                    )
                    order.status = STATUS_PENDING_APPROVAL
                    order.rejection_reason = None
                    self._assign(order, to_user_id=assigned_to, by_user_id=actor_user_id)
                    _log(
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
        try:
            self._assert_user_in_role(actor_user_id, ROLE_CENTRAL_FINANCE)
            return True
        except ConflictError:
            return False

    def _revert_assets_after_receive(self, order: AssetTransferOrder) -> None:
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

    def cc2_assign_to_cf(
        self, order_id: int, data: Cc2AssignTransferRequest, *, actor_user_id: int
    ) -> TransferOrderDetail:
        order = self._load_order(order_id)
        if order.status != STATUS_APPROVED_BY_CF:
            raise ConflictError("Only CF-approved transfer orders can be received by the custodian.")
        if order.to_asset_custodian_id is None:
            raise ConflictError("Destination asset custodian is missing on this transfer.")
        actor = self._db.get(User, actor_user_id)
        is_super = actor is not None and actor.is_superuser
        if int(order.to_asset_custodian_id) != int(actor_user_id) and not is_super:
            raise ConflictError(
                "Only the selected destination asset custodian can receive this transfer."
            )
        self._assert_user_in_role(int(data.assigned_to), ROLE_CENTRAL_FINANCE)

        if data.remarks is not None:
            order.remarks = _strip_or_none(data.remarks)

        fl, al = _apply_receive_assets(
            self._db,
            order,
            functional_location=data.to_functional_location,
            actual_location=data.to_actual_location,
        )
        to_cc = self._db.get(CostCenterMaster, int(order.to_cost_center_id))
        custodian_id = int(order.to_asset_custodian_id)

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

    def list_orders(
        self, *, tab: str, page: int, page_size: int
    ) -> TransferOrderListResponse:
        statuses = _TAB_STATUSES.get(tab, ACTIVE_STATUSES)
        where = []
        if statuses is not None:
            where.append(AssetTransferOrder.status.in_(statuses))
        total = int(
            self._db.scalar(
                select(func.count()).select_from(AssetTransferOrder).where(*where)
            )
            or 0
        )
        rows = list(
            self._db.scalars(
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
                .order_by(AssetTransferOrder.id.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            ).all()
        )
        items = [
            TransferOrderListItem(
                id=int(r.id),
                order_number=r.order_number,
                plant_name=(r.plant.name if r.plant else "") or (r.plant.code if r.plant else ""),
                from_cost_center_code=r.from_cost_center.code if r.from_cost_center else None,
                to_cost_center_code=r.to_cost_center.code if r.to_cost_center else "",
                asset_count=len(r.items),
                status=r.status,
                assigned_to_name=r.assignee.full_name if r.assignee else None,
                created_by_name=r.creator.full_name if r.creator else None,
                created_at=r.created_at,
            )
            for r in rows
        ]
        return TransferOrderListResponse(items=items, total=total, page=page, page_size=page_size)

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
        if pending_task is not None:
            if pending_task.assigned_user_id is not None:
                current_assignee_id = int(pending_task.assigned_user_id)
                current_assignee_name = _user_display_name(self._db, current_assignee_id)
            if pending_task.step is not None:
                role = self._db.get(Role, int(pending_task.step.approver_role_id))
                if role is not None:
                    current_role = role.name
                    current_level = ROLE_TO_ASSIGNEE_LEVEL.get(role.name)
                current_kind = str(getattr(pending_task.step, "step_kind", None) or "approve")

        is_final = True
        needs_next = False
        next_role: str | None = None
        next_level: str | None = None
        next_kind: str | None = None
        if str(req.status) == "pending" and steps:
            current = next((s for s in steps if s.phase == "current"), None)
            if current is not None:
                is_final = int(current.step_order) >= int(current.total_steps)
                current_kind = str(getattr(current, "step_kind", None) or current_kind)
                if not is_final:
                    nxt = next(
                        (s for s in steps if int(s.step_order) == int(current.step_order) + 1),
                        None,
                    )
                    if nxt is not None:
                        next_role = nxt.approver_role_name or None
                        if next_role:
                            next_level = ROLE_TO_ASSIGNEE_LEVEL.get(next_role)
                        next_kind = str(getattr(nxt, "step_kind", None) or "approve")
                        # confirm → close with same role: same CF closes, no next-user picker
                        same_role_confirm_to_close = (
                            current_kind == "confirm"
                            and next_kind == "close"
                            and (current_role or "") == (next_role or "")
                        )
                        needs_next = not same_role_confirm_to_close
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
            next_assignee_level=next_level,
            next_step_kind=next_kind,
        )

    def get_order(self, order_id: int, *, viewer_user_id: int | None = None) -> TransferOrderDetail:
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

        plant = order.plant
        plant_name = ""
        if isinstance(plant, OrgUnit):
            plant_name = plant.name or plant.code or ""

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
            items=[
                TransferOrderItemPublic(
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
            audit=[
                TransferOrderAuditPublic(
                    id=int(a.id),
                    action=a.action,
                    actor_name=(
                        actors[int(a.actor_user_id)].full_name
                        if a.actor_user_id and int(a.actor_user_id) in actors
                        else None
                    ),
                    old_value=_audit_payload_for_api(self._db, a.old_value),
                    new_value=_audit_payload_for_api(self._db, a.new_value),
                    created_at=a.created_at,
                )
                for a in audits
            ],
            approval_panel=panel,
            can_submit=(order.status in SUBMITTABLE_STATUSES) and (is_creator or is_super),
            can_cf_decide=False,
            # Reject only during approval steps (engine); never after approval → receive/confirm/close.
            can_cf_reject=False,
            can_cc2_assign=_can_operational_flag(
                order,
                panel=panel,
                legacy_ok=(
                    order.status == STATUS_APPROVED_BY_CF
                    and (
                        is_super
                        or (
                            order.to_asset_custodian_id is not None
                            and int(order.to_asset_custodian_id) == int(viewer_user_id or 0)
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
            can_edit=(order.status in EDITABLE_STATUSES) and (is_creator or is_super),
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
    if order.approval_request_id is not None and panel is not None and panel.request_status == "pending":
        return False
    return legacy_ok


# ------------------------------------------------- approval engine callbacks


def _apply_receive_assets(
    db: Session,
    order: AssetTransferOrder,
    *,
    functional_location: str,
    actual_location: str,
) -> tuple[str, str]:
    """Update order + asset locations/CC/custodian. Does not change assignee or status."""
    fl = _strip_or_none(functional_location)
    al = _strip_or_none(actual_location)
    if not fl or not al:
        raise ConflictError(
            "Actual Location 1 and Actual Location 2 are required when receiving assets."
        )
    to_cc = db.get(CostCenterMaster, int(order.to_cost_center_id))
    if to_cc is None:
        raise ConflictError("Destination cost center is missing.")
    if order.to_asset_custodian_id is None:
        raise ConflictError("Destination asset custodian is missing on this transfer.")
    custodian_id = int(order.to_asset_custodian_id)
    order.to_functional_location = fl
    order.to_actual_location = al
    for item in order.items:
        asset = item.asset
        if asset is None:
            continue
        fin = _ensure_financial(asset)
        fin.cost_center = to_cc.code
        loc = _ensure_location(asset)
        loc.functional_location = fl
        loc.actual_location = al
        asset.asset_custodian_id = custodian_id
    return fl, al


def apply_transfer_enter_receive(
    db: Session,
    *,
    order_id: int,
    actor_user_id: int | None,
    next_assignee_user_id: int,
    step_role_name: str | None = None,
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
) -> None:
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
    fl, al = _apply_receive_assets(
        db,
        order,
        functional_location=functional_location or "",
        actual_location=actual_location or "",
    )
    old_status = order.status
    order.status = STATUS_RECEIVED_BY_CC2
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
    order = db.get(AssetTransferOrder, order_id)
    if order is None:
        return
    old_status = order.status
    order.status = STATUS_CLOSED
    order.closed_at = datetime.now(timezone.utc)
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
) -> None:
    order = db.get(AssetTransferOrder, order_id)
    if order is None:
        return
    order.status = STATUS_IN_REWORK
    order.rejection_reason = (comment or "").strip() or None
    if order.created_by is not None:
        order.assigned_to = int(order.created_by)
        order.assigned_by = approver_user_id
        order.assigned_at = datetime.now(timezone.utc)
    _log(
        db,
        order_id=int(order.id),
        action="rejected",
        actor_user_id=approver_user_id,
        new_value={
            "status": order.status,
            "rejection_reason": order.rejection_reason,
            "step_role_name": step_role_name,
        },
    )
    db.commit()


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
