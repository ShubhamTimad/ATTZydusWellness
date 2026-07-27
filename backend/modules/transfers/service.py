from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from modules.asset_masters.model import CostCenterMaster
from modules.assets.model import AssetMaster
from modules.errors import ConflictError, NotFoundError
from modules.platform.org_units.model import OrgUnit
from modules.platform.roles.model import Role
from modules.platform.users.model import User
from modules.rbac_association import user_role
from modules.transfers.constants import (
    ACTIVE_STATUSES,
    ASSIGNEE_LEVEL_ROLES,
    EDITABLE_STATUSES,
    ROLE_CENTRAL_FINANCE,
    ROLE_COST_CENTER_USER,
    STATUS_APPROVED_BY_CF,
    STATUS_ASSIGNED_TO_CF,
    STATUS_CLOSED,
    STATUS_DRAFT,
    STATUS_RECEIVED_BY_CC2,
    STATUS_REJECTED,
)
from modules.transfers.model import AssetTransferOrder, AssetTransferOrderAudit, AssetTransferOrderItem
from modules.transfers.schema import (
    Cc2AssignTransferRequest,
    CfApproveTransferRequest,
    CfRejectTransferRequest,
    CreateTransferOrderRequest,
    SubmitTransferOrderRequest,
    TransferAssigneeListResponse,
    TransferAssigneeOption,
    TransferOrderAuditPublic,
    TransferOrderDetail,
    TransferOrderItemPublic,
    TransferOrderListItem,
    TransferOrderListResponse,
    UpdateTransferOrderRequest,
)

_TAB_STATUSES: dict[str, frozenset[str] | None] = {
    "all": None,
    "draft": frozenset({STATUS_DRAFT}),
    "assigned_to_cf": frozenset({STATUS_ASSIGNED_TO_CF}),
    "rejected": frozenset({STATUS_REJECTED}),
    "approved_by_cf": frozenset({STATUS_APPROVED_BY_CF}),
    "received_by_cc2": frozenset({STATUS_RECEIVED_BY_CC2}),
    "closed": frozenset({STATUS_CLOSED}),
    "active": ACTIVE_STATUSES,
}


def _strip_or_none(value: str | None) -> str | None:
    if value is None:
        return None
    s = value.strip()
    return s or None


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
            raise ConflictError("Invalid assignee level. Use cost_center or central_finance.")
        role = self._role_by_name(role_name)
        users = _users_in_role(self._db, int(role.id))
        return TransferAssigneeListResponse(
            role_name=role_name,
            items=[
                TransferAssigneeOption(id=int(u.id), full_name=u.full_name, email=u.email)
                for u in users
                if not u.is_superuser
            ],
        )

    def _load_assets(self, asset_ids: list[int]) -> list[AssetMaster]:
        ids = list(dict.fromkeys(int(i) for i in asset_ids))
        if not ids:
            raise ConflictError("Select at least one asset.")
        assets = list(
            self._db.scalars(select(AssetMaster).where(AssetMaster.id.in_(ids))).all()
        )
        found = {int(a.id) for a in assets}
        missing = [i for i in ids if i not in found]
        if missing:
            raise NotFoundError("Asset", missing[0])
        plants = {int(a.plant_id) for a in assets if a.plant_id is not None}
        if len(plants) != 1 or any(a.plant_id is None for a in assets):
            raise ConflictError("All assets on a transfer order must belong to the same plant.")
        return assets

    def _resolve_from_cost_center(self, assets: list[AssetMaster]) -> CostCenterMaster | None:
        codes = {(a.cost_center or "").strip() for a in assets if (a.cost_center or "").strip()}
        if len(codes) != 1:
            return None
        code = next(iter(codes))
        return self._db.scalar(select(CostCenterMaster).where(CostCenterMaster.code == code))

    def _load_order(self, order_id: int) -> AssetTransferOrder:
        order = self._db.scalar(
            select(AssetTransferOrder)
            .where(AssetTransferOrder.id == order_id)
            .options(
                selectinload(AssetTransferOrder.items).selectinload(AssetTransferOrderItem.asset),
                selectinload(AssetTransferOrder.plant),
                selectinload(AssetTransferOrder.from_cost_center),
                selectinload(AssetTransferOrder.to_cost_center),
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
                    from_cost_center_code=_strip_or_none(asset.cost_center),
                    from_functional_location=_strip_or_none(asset.functional_location),
                    from_actual_location=_strip_or_none(asset.actual_location),
                )
            )

    def create_order(
        self, data: CreateTransferOrderRequest, *, actor_user_id: int
    ) -> TransferOrderDetail:
        assets = self._load_assets(data.asset_ids)
        plant_id = int(assets[0].plant_id)
        to_cc = self._db.get(CostCenterMaster, int(data.to_cost_center_id))
        if to_cc is None:
            raise NotFoundError("Cost center", data.to_cost_center_id)
        from_cc = self._resolve_from_cost_center(assets)
        order = AssetTransferOrder(
            order_number=self._next_order_number(),
            plant_id=plant_id,
            from_cost_center_id=int(from_cc.id) if from_cc else None,
            to_cost_center_id=int(to_cc.id),
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
            new_value={"order_number": order.order_number, "asset_ids": [int(a.id) for a in assets]},
        )
        if data.submit:
            if data.assigned_to is None:
                raise ConflictError("Select a Central Finance user before submitting.")
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
            raise ConflictError("Transfer order can only be edited while draft or rejected.")
        before = {
            "to_cost_center_id": order.to_cost_center_id,
            "to_functional_location": order.to_functional_location,
            "to_actual_location": order.to_actual_location,
            "remarks": order.remarks,
        }
        patch = data.model_dump(exclude_unset=True)
        if "to_cost_center_id" in patch and patch["to_cost_center_id"] is not None:
            to_cc = self._db.get(CostCenterMaster, int(patch["to_cost_center_id"]))
            if to_cc is None:
                raise NotFoundError("Cost center", patch["to_cost_center_id"])
            order.to_cost_center_id = int(to_cc.id)
        if "to_functional_location" in patch:
            order.to_functional_location = _strip_or_none(patch["to_functional_location"])
        if "to_actual_location" in patch:
            order.to_actual_location = _strip_or_none(patch["to_actual_location"])
        if "remarks" in patch:
            order.remarks = _strip_or_none(patch["remarks"])
        if "asset_ids" in patch and patch["asset_ids"] is not None:
            assets = self._load_assets(patch["asset_ids"])
            plant_id = int(assets[0].plant_id)
            if plant_id != int(order.plant_id):
                raise ConflictError("Assets must remain on the same plant as the transfer order.")
            from_cc = self._resolve_from_cost_center(assets)
            order.from_cost_center_id = int(from_cc.id) if from_cc else None
            self._replace_items(order, assets)
        _log(
            self._db,
            order_id=int(order.id),
            action="updated",
            actor_user_id=actor_user_id,
            old_value=before,
            new_value={
                "to_cost_center_id": order.to_cost_center_id,
                "to_functional_location": order.to_functional_location,
                "to_actual_location": order.to_actual_location,
                "remarks": order.remarks,
            },
        )
        self._db.commit()
        return self.get_order(int(order.id), viewer_user_id=actor_user_id)

    def _submit(
        self,
        order: AssetTransferOrder,
        *,
        actor_user_id: int,
        assigned_to: int,
        remarks: str | None,
    ) -> None:
        if order.status not in EDITABLE_STATUSES:
            raise ConflictError("Only draft or rejected transfer orders can be submitted.")
        self._assert_user_in_role(assigned_to, ROLE_CENTRAL_FINANCE)
        old_status = order.status
        if remarks is not None:
            order.remarks = remarks
        order.rejection_reason = None
        order.status = STATUS_ASSIGNED_TO_CF
        self._assign(order, to_user_id=assigned_to, by_user_id=actor_user_id)
        _log(
            self._db,
            order_id=int(order.id),
            action="submitted",
            actor_user_id=actor_user_id,
            old_value={"status": old_status},
            new_value={"status": order.status, "assigned_to": assigned_to},
        )
        self._db.commit()

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
        order = self._load_order(order_id)
        if order.status != STATUS_ASSIGNED_TO_CF:
            raise ConflictError("Only orders assigned to Central Finance can be approved.")
        if order.assigned_to is not None and int(order.assigned_to) != int(actor_user_id):
            # Superusers / manage can still act; soft check for named assignee.
            actor = self._db.get(User, actor_user_id)
            if actor is None or not actor.is_superuser:
                raise ConflictError("Only the assigned Central Finance user can approve this order.")
        self._assert_user_in_role(int(data.assigned_to), ROLE_COST_CENTER_USER)
        if data.to_cost_center_id is not None:
            to_cc = self._db.get(CostCenterMaster, int(data.to_cost_center_id))
            if to_cc is None:
                raise NotFoundError("Cost center", data.to_cost_center_id)
            order.to_cost_center_id = int(to_cc.id)
        if data.to_functional_location is not None:
            order.to_functional_location = _strip_or_none(data.to_functional_location)
        if data.to_actual_location is not None:
            order.to_actual_location = _strip_or_none(data.to_actual_location)
        if data.remarks is not None:
            order.remarks = _strip_or_none(data.remarks)

        to_cc = self._db.get(CostCenterMaster, int(order.to_cost_center_id))
        if to_cc is None:
            raise ConflictError("Destination cost center is missing.")
        for item in order.items:
            asset = item.asset
            if asset is None:
                continue
            asset.cost_center = to_cc.code
            asset.functional_location = order.to_functional_location
            asset.actual_location = order.to_actual_location

        old_status = order.status
        order.status = STATUS_APPROVED_BY_CF
        order.rejection_reason = None
        self._assign(order, to_user_id=int(data.assigned_to), by_user_id=actor_user_id)
        _log(
            self._db,
            order_id=int(order.id),
            action="cf_approved",
            actor_user_id=actor_user_id,
            old_value={"status": old_status},
            new_value={
                "status": order.status,
                "assigned_to": int(data.assigned_to),
                "to_cost_center": to_cc.code,
                "to_functional_location": order.to_functional_location,
                "to_actual_location": order.to_actual_location,
            },
        )
        self._db.commit()
        return self.get_order(order_id, viewer_user_id=actor_user_id)

    def cf_reject(
        self, order_id: int, data: CfRejectTransferRequest, *, actor_user_id: int
    ) -> TransferOrderDetail:
        order = self._load_order(order_id)
        if order.status != STATUS_ASSIGNED_TO_CF:
            raise ConflictError("Only orders assigned to Central Finance can be rejected.")
        if order.assigned_to is not None and int(order.assigned_to) != int(actor_user_id):
            actor = self._db.get(User, actor_user_id)
            if actor is None or not actor.is_superuser:
                raise ConflictError("Only the assigned Central Finance user can reject this order.")
        reason = data.reason.strip()
        if not reason:
            raise ConflictError("Rejection reason is required.")
        old_status = order.status
        order.status = STATUS_REJECTED
        order.rejection_reason = reason
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
            raise ConflictError("Only CF-approved transfer orders can be received by CC2.")
        if order.assigned_to is not None and int(order.assigned_to) != int(actor_user_id):
            actor = self._db.get(User, actor_user_id)
            if actor is None or not actor.is_superuser:
                raise ConflictError("Only the assigned Cost Center 2 user can receive this order.")
        self._assert_user_in_role(int(data.assigned_to), ROLE_CENTRAL_FINANCE)
        if data.remarks is not None:
            order.remarks = _strip_or_none(data.remarks)
        old_status = order.status
        order.status = STATUS_RECEIVED_BY_CC2
        self._assign(order, to_user_id=int(data.assigned_to), by_user_id=actor_user_id)
        _log(
            self._db,
            order_id=int(order.id),
            action="cc2_assigned_to_cf",
            actor_user_id=actor_user_id,
            old_value={"status": old_status},
            new_value={"status": order.status, "assigned_to": int(data.assigned_to)},
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
        order.status = STATUS_CLOSED
        order.closed_at = datetime.now(timezone.utc)
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
            to_functional_location=order.to_functional_location,
            to_actual_location=order.to_actual_location,
            status=order.status,
            remarks=order.remarks,
            rejection_reason=order.rejection_reason,
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
                    old_value=a.old_value,
                    new_value=a.new_value,
                    created_at=a.created_at,
                )
                for a in audits
            ],
            can_submit=(order.status in EDITABLE_STATUSES) and (is_creator or is_super),
            can_cf_decide=(order.status == STATUS_ASSIGNED_TO_CF) and (is_assignee or is_super),
            can_cc2_assign=(order.status == STATUS_APPROVED_BY_CF) and (is_assignee or is_super),
            can_cf_confirm=(order.status == STATUS_RECEIVED_BY_CC2) and (is_assignee or is_super),
            can_edit=(order.status in EDITABLE_STATUSES) and (is_creator or is_super),
        )
