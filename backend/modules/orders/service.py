from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from modules.asset_masters.model import CostCenterMaster
from modules.assets.model import AssetFinancialInformation, AssetLocationInformation, AssetMaster
from modules.errors import ConflictError, NotFoundError
from modules.orders.audit import log_order_event
from modules.orders.constants import (
    ACTION_COMPLETE,
    ACTION_CREATE,
    ACTIVE_ORDER_STATUSES,
    ENTITY_TYPE_CLOSURE,
    ENTITY_TYPE_CREATION,
    ITEM_STATUS_APPROVED,
    ITEM_STATUS_PENDING,
    ITEM_STATUS_REJECTED,
    ORDER_STATUS_APPROVED,
    ORDER_STATUS_CANCELLED,
    ORDER_STATUS_COMPLETED,
    ORDER_STATUS_DRAFT,
    ORDER_STATUS_IN_PROGRESS,
    ORDER_STATUS_PENDING_APPROVAL,
    ORDER_STATUS_PENDING_CLOSURE,
    ORDER_STATUS_REJECTED,
)
from modules.orders.model import PhysicalOrder, PhysicalOrderAudit, PhysicalOrderItem
from modules.orders.schema import (
    ActiveOrderConflict,
    CreatePhysicalOrderRequest,
    ExecutorUserPublic,
    InvalidAssetRef,
    PhysicalOrderAuditPublic,
    PhysicalOrderDetail,
    PhysicalOrderItemPublic,
    PhysicalOrderListItem,
    PhysicalOrderListResponse,
    ScanAssetResponse,
    ValidateAssetsResponse,
)
from modules.platform.approvals.assignment_service import get_workflow_for_action
from modules.platform.approvals.service import ApprovalEngineService
from modules.platform.permissions.model import Permission
from modules.platform.tasks.service import TaskService
from modules.platform.users.model import User
from modules.rbac_association import role_permission, user_role


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


class PhysicalOrderService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def _user_name(self, user_id: int | None) -> str | None:
        if user_id is None:
            return None
        u = self._db.get(User, user_id)
        return u.full_name if u else None

    def _next_order_number(self) -> str:
        year = datetime.now(timezone.utc).year
        prefix = f"PVO-{year}-"
        last = self._db.scalar(
            select(PhysicalOrder.order_number)
            .where(PhysicalOrder.order_number.like(f"{prefix}%"))
            .order_by(PhysicalOrder.id.desc())
            .limit(1)
        )
        seq = 1
        if last:
            try:
                seq = int(str(last).split("-")[-1]) + 1
            except ValueError:
                seq = 1
        return f"{prefix}{seq:05d}"

    def _load_assets(self, asset_ids: list[int]) -> list[AssetMaster]:
        assets = list(
            self._db.scalars(
                select(AssetMaster)
                .where(AssetMaster.id.in_(asset_ids), AssetMaster.deleted_at.is_(None))
                .options(
                    selectinload(AssetMaster.location).selectinload(AssetLocationInformation.plant),
                    selectinload(AssetMaster.financial),
                )
            ).all()
        )
        found = {a.id for a in assets}
        missing = [i for i in asset_ids if i not in found]
        if missing:
            raise NotFoundError("AssetMaster", missing[0])
        return assets

    def _resolve_cost_center_id(self, plant_id: int, cost_center_code: str) -> int:
        cc = self._db.scalar(
            select(CostCenterMaster).where(
                CostCenterMaster.plant_id == plant_id,
                CostCenterMaster.code == cost_center_code,
            )
        )
        if cc is None:
            raise ConflictError(
                f"Cost center '{cost_center_code}' is not defined for this plant in reference masters."
            )
        return int(cc.id)

    def validate_assets(self, asset_ids: list[int]) -> ValidateAssetsResponse:
        assets = self._load_assets(asset_ids)
        active_conflicts: list[ActiveOrderConflict] = []
        missing_rfid: list[InvalidAssetRef] = []
        plant_mismatch: list[InvalidAssetRef] = []
        cc_mismatch: list[InvalidAssetRef] = []
        blocked: set[int] = set()

        active_rows = self._db.execute(
            select(
                PhysicalOrderItem.asset_id,
                AssetMaster.asset_code,
                AssetMaster.asset_name,
                PhysicalOrder.id,
                PhysicalOrder.order_number,
                PhysicalOrder.status,
            )
            .join(PhysicalOrder, PhysicalOrder.id == PhysicalOrderItem.order_id)
            .join(AssetMaster, AssetMaster.id == PhysicalOrderItem.asset_id)
            .where(
                PhysicalOrderItem.asset_id.in_(asset_ids),
                PhysicalOrder.status.in_(tuple(ACTIVE_ORDER_STATUSES)),
            )
        ).all()
        for aid, code, name, oid, onum, ost in active_rows:
            blocked.add(int(aid))
            active_conflicts.append(
                ActiveOrderConflict(
                    asset_id=int(aid),
                    asset_code=str(code),
                    asset_name=str(name),
                    order_id=int(oid),
                    order_number=str(onum),
                    order_status=str(ost),
                )
            )

        plant_ids = set()
        cc_codes = set()
        for a in assets:
            loc = a.location
            fin = a.financial
            pid = int(loc.plant_id) if loc and loc.plant_id else None
            cc = (fin.cost_center or "").strip() if fin else ""
            if pid:
                plant_ids.add(pid)
            if cc:
                cc_codes.add(cc)

        ref_plant = next(iter(plant_ids)) if len(plant_ids) == 1 else None
        ref_cc = next(iter(cc_codes)) if len(cc_codes) == 1 else None

        for a in assets:
            if int(a.id) in blocked:
                continue
            if not (a.rfid_code or "").strip():
                missing_rfid.append(
                    InvalidAssetRef(
                        asset_id=int(a.id),
                        asset_code=a.asset_code,
                        asset_name=a.asset_name,
                    )
                )
                blocked.add(int(a.id))
                continue
            loc = a.location
            fin = a.financial
            pid = int(loc.plant_id) if loc and loc.plant_id else None
            pname = loc.plant.name if loc and loc.plant else None
            cc = (fin.cost_center or "").strip() if fin else ""
            if ref_plant is not None and pid != ref_plant:
                plant_mismatch.append(
                    InvalidAssetRef(
                        asset_id=int(a.id),
                        asset_code=a.asset_code,
                        asset_name=a.asset_name,
                        plant_id=pid,
                        plant_name=pname,
                    )
                )
                blocked.add(int(a.id))
            elif len(plant_ids) > 1 and pid != ref_plant:
                plant_mismatch.append(
                    InvalidAssetRef(
                        asset_id=int(a.id),
                        asset_code=a.asset_code,
                        asset_name=a.asset_name,
                        plant_id=pid,
                        plant_name=pname,
                    )
                )
                blocked.add(int(a.id))
            if ref_cc is not None and cc != ref_cc:
                cc_mismatch.append(
                    InvalidAssetRef(
                        asset_id=int(a.id),
                        asset_code=a.asset_code,
                        asset_name=a.asset_name,
                        cost_center_code=cc or None,
                    )
                )
                blocked.add(int(a.id))
            elif len(cc_codes) > 1 and cc != ref_cc:
                cc_mismatch.append(
                    InvalidAssetRef(
                        asset_id=int(a.id),
                        asset_code=a.asset_code,
                        asset_name=a.asset_name,
                        cost_center_code=cc or None,
                    )
                )
                blocked.add(int(a.id))

        eligible = [int(a.id) for a in assets if int(a.id) not in blocked]
        return ValidateAssetsResponse(
            eligible_asset_ids=eligible,
            active_order_conflicts=active_conflicts,
            missing_rfid=missing_rfid,
            plant_mismatch=plant_mismatch,
            cost_center_mismatch=cc_mismatch,
        )

    def list_executors(self) -> list[ExecutorUserPublic]:
        perm = self._db.scalar(select(Permission.id).where(Permission.code == "order.execute"))
        if perm is None:
            return []
        user_ids = {
            int(uid)
            for uid in self._db.execute(
                select(user_role.c.user_id)
                .join(role_permission, role_permission.c.role_id == user_role.c.role_id)
                .where(role_permission.c.permission_id == perm)
            ).scalars()
        }
        if not user_ids:
            return []
        users = self._db.scalars(
            select(User).where(User.id.in_(user_ids), User.is_active.is_(True)).order_by(User.full_name)
        ).all()
        return [
            ExecutorUserPublic(id=int(u.id), full_name=u.full_name, email=u.email) for u in users
        ]

    def create_order(
        self,
        body: CreatePhysicalOrderRequest,
        *,
        actor_user_id: int,
    ) -> PhysicalOrderDetail:
        validation = self.validate_assets(body.asset_ids)
        if not validation.eligible_asset_ids:
            if validation.missing_rfid and len(validation.missing_rfid) == len(body.asset_ids):
                raise ConflictError(
                    "Physical orders require assets with an attached RFID code. "
                    "Attach RFID on the asset before adding it to an order."
                )
            raise ConflictError("No eligible assets to create an order.")
        assets = self._load_assets(validation.eligible_asset_ids)
        first = assets[0]
        loc = first.location
        fin = first.financial
        if not loc or not loc.plant_id:
            raise ConflictError("Assets must have a plant assigned.")
        plant_id = int(loc.plant_id)
        cc_code = (fin.cost_center or "").strip() if fin else ""
        if not cc_code:
            raise ConflictError("Assets must have a cost center assigned.")
        cost_center_id = self._resolve_cost_center_id(plant_id, cc_code)

        assignee = self._db.get(User, body.assigned_to)
        if assignee is None or not assignee.is_active:
            raise NotFoundError("User", body.assigned_to)

        now = _now_utc()
        order = PhysicalOrder(
            order_number=self._next_order_number(),
            plant_id=plant_id,
            cost_center_id=cost_center_id,
            created_by=actor_user_id,
            assigned_to=body.assigned_to,
            assigned_by=actor_user_id,
            assigned_at=now,
            status=ORDER_STATUS_DRAFT,
            remarks=body.remarks,
        )
        self._db.add(order)
        self._db.flush()
        for a in assets:
            self._db.add(
                PhysicalOrderItem(
                    order_id=order.id,
                    asset_id=a.id,
                    verification_status=ITEM_STATUS_PENDING,
                )
            )
        log_order_event(
            self._db,
            order_id=int(order.id),
            action="order_created",
            actor_user_id=actor_user_id,
            new_value={"order_number": order.order_number, "asset_count": len(assets)},
        )
        log_order_event(
            self._db,
            order_id=int(order.id),
            action="assignment_changed",
            actor_user_id=actor_user_id,
            new_value={"assigned_to": body.assigned_to},
        )
        self._notify_assigned(order)
        if body.submit:
            self._submit_for_creation_approval(order, actor_user_id=actor_user_id)
        else:
            self._db.commit()
        return self.get_order(int(order.id))

    def _order_payload(self, order: PhysicalOrder, *, action_code: str) -> dict[str, Any]:
        cc = order.cost_center
        return {
            "action_code": action_code,
            "order_number": order.order_number,
            "order_id": int(order.id),
            "plant_id": int(order.plant_id),
            "cost_center_code": cc.code if cc else "",
            "asset_count": len(order.items),
        }

    def _submit_for_creation_approval(self, order: PhysicalOrder, *, actor_user_id: int) -> None:
        if order.status not in (ORDER_STATUS_DRAFT, ORDER_STATUS_REJECTED):
            raise ConflictError("Order cannot be submitted in its current status.")
        wf = get_workflow_for_action(self._db, ACTION_CREATE)
        if wf:
            engine = ApprovalEngineService(self._db)
            req = engine.create_request_for_entity(
                workflow=wf,
                entity_type=ENTITY_TYPE_CREATION,
                entity_id=int(order.id),
                payload=self._order_payload(order, action_code=ACTION_CREATE),
                created_by=actor_user_id,
            )
            order.approval_request_id = int(req.id)
            order.status = ORDER_STATUS_PENDING_APPROVAL
            log_order_event(
                self._db,
                order_id=int(order.id),
                action="submitted_for_approval",
                actor_user_id=actor_user_id,
                new_value={"approval_request_id": int(req.id)},
            )
        else:
            order.status = ORDER_STATUS_APPROVED
            log_order_event(
                self._db,
                order_id=int(order.id),
                action="approved",
                actor_user_id=actor_user_id,
                new_value={"auto_approved": True},
            )
            self._create_executor_task(order, actor_user_id=actor_user_id)
        self._db.commit()

    def _create_executor_task(self, order: PhysicalOrder, *, actor_user_id: int | None) -> None:
        if order.assigned_to is None:
            return
        TaskService(self._db).create_manual_task(
            actor_user_id=actor_user_id or int(order.created_by or order.assigned_to),
            title=f"Execute physical verification: {order.order_number}",
            description="Start verification and scan assets for this order.",
            assigned_to_user_id=int(order.assigned_to),
            priority="high",
            due_date=None,
            entity_type=ENTITY_TYPE_CREATION,
            entity_id=int(order.id),
            form_schema=None,
            form_data=None,
        )

    def _notify_assigned(self, order: PhysicalOrder) -> None:
        try:
            from modules.platform.emails.service import EmailNotificationService

            assignee = self._db.get(User, order.assigned_to) if order.assigned_to else None
            if assignee and assignee.email:
                EmailNotificationService(self._db).trigger_event(
                    event_code="ORDER_ASSIGNED",
                    payload={
                        "user_name": assignee.full_name,
                        "email": assignee.email,
                        "order_number": order.order_number,
                    },
                )
        except Exception:
            pass

    def list_orders(
        self,
        *,
        tab: str,
        page: int,
        page_size: int,
        viewer_id: int,
    ) -> PhysicalOrderListResponse:
        base = select(PhysicalOrder).options(
            selectinload(PhysicalOrder.plant),
            selectinload(PhysicalOrder.cost_center),
            selectinload(PhysicalOrder.creator),
            selectinload(PhysicalOrder.assignee),
            selectinload(PhysicalOrder.items),
        )
        tab = tab.strip().lower()
        if tab == "pending_approval":
            base = base.where(PhysicalOrder.status == ORDER_STATUS_PENDING_APPROVAL)
        elif tab == "my_orders":
            base = base.where(PhysicalOrder.created_by == viewer_id)
        elif tab == "assigned_to_me":
            base = base.where(PhysicalOrder.assigned_to == viewer_id)
        elif tab == "in_progress":
            base = base.where(PhysicalOrder.status == ORDER_STATUS_IN_PROGRESS)
        elif tab == "pending_closure":
            base = base.where(PhysicalOrder.status == ORDER_STATUS_PENDING_CLOSURE)
        elif tab == "completed":
            base = base.where(PhysicalOrder.status == ORDER_STATUS_COMPLETED)
        elif tab == "all":
            pass
        else:
            base = base.where(
                PhysicalOrder.status.in_(
                    (
                        ORDER_STATUS_PENDING_APPROVAL,
                        ORDER_STATUS_APPROVED,
                        ORDER_STATUS_IN_PROGRESS,
                        ORDER_STATUS_PENDING_CLOSURE,
                    )
                )
            )

        total = int(self._db.scalar(select(func.count()).select_from(base.subquery())) or 0)
        rows = self._db.scalars(
            base.order_by(PhysicalOrder.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
        items = [self._to_list_item(o) for o in rows]
        return PhysicalOrderListResponse(items=items, total=total, page=page, page_size=page_size)

    def _to_list_item(self, order: PhysicalOrder) -> PhysicalOrderListItem:
        cc = order.cost_center
        return PhysicalOrderListItem(
            id=int(order.id),
            order_number=order.order_number,
            plant_id=int(order.plant_id),
            plant_name=order.plant.name if order.plant else "",
            cost_center_id=int(order.cost_center_id),
            cost_center_code=cc.code if cc else "",
            cost_center_description=cc.description if cc else "",
            asset_count=len(order.items),
            status=order.status,
            assigned_to_name=order.assignee.full_name if order.assignee else None,
            created_by_name=order.creator.full_name if order.creator else None,
            created_at=order.created_at,
        )

    def _load_order(self, order_id: int) -> PhysicalOrder:
        order = self._db.scalar(
            select(PhysicalOrder)
            .where(PhysicalOrder.id == order_id)
            .options(
                selectinload(PhysicalOrder.plant),
                selectinload(PhysicalOrder.cost_center),
                selectinload(PhysicalOrder.creator),
                selectinload(PhysicalOrder.assignee),
                selectinload(PhysicalOrder.items).selectinload(PhysicalOrderItem.asset),
            )
        )
        if order is None:
            raise NotFoundError("PhysicalOrder", order_id)
        return order

    def _to_item_public(self, item: PhysicalOrderItem) -> PhysicalOrderItemPublic:
        a = item.asset
        verifier = self._user_name(item.verified_by)
        return PhysicalOrderItemPublic(
            id=int(item.id),
            asset_id=int(item.asset_id),
            asset_code=a.asset_code if a else "",
            asset_name=a.asset_name if a else "",
            rfid_code=a.rfid_code if a else None,
            verification_status=item.verification_status,
            rejection_reason=item.rejection_reason,
            scan_time=item.scan_time,
            verified_by_name=verifier,
        )

    def get_order(self, order_id: int) -> PhysicalOrderDetail:
        order = self._load_order(order_id)
        verified = sum(1 for i in order.items if i.verification_status == ITEM_STATUS_APPROVED)
        audit_rows = self._db.scalars(
            select(PhysicalOrderAudit)
            .where(PhysicalOrderAudit.order_id == order_id)
            .order_by(PhysicalOrderAudit.created_at.asc())
        ).all()
        audit = [
            PhysicalOrderAuditPublic(
                id=int(r.id),
                action=r.action,
                actor_name=self._user_name(r.actor_user_id),
                old_value=r.old_value,
                new_value=r.new_value,
                created_at=r.created_at,
            )
            for r in audit_rows
        ]
        cc = order.cost_center
        return PhysicalOrderDetail(
            id=int(order.id),
            order_number=order.order_number,
            plant_id=int(order.plant_id),
            plant_name=order.plant.name if order.plant else "",
            cost_center_id=int(order.cost_center_id),
            cost_center_code=cc.code if cc else "",
            cost_center_description=cc.description if cc else "",
            status=order.status,
            remarks=order.remarks,
            created_by=order.created_by,
            created_by_name=self._user_name(order.created_by),
            assigned_to=order.assigned_to,
            assigned_to_name=self._user_name(order.assigned_to),
            assigned_by_name=self._user_name(order.assigned_by),
            assigned_at=order.assigned_at,
            started_at=order.started_at,
            started_by_name=self._user_name(order.started_by),
            completed_at=order.completed_at,
            created_at=order.created_at,
            approval_request_id=order.approval_request_id,
            items=[self._to_item_public(i) for i in order.items],
            verified_count=verified,
            total_count=len(order.items),
            audit=audit,
        )

    def update_order(
        self,
        order_id: int,
        *,
        actor_user_id: int,
        assigned_to: int | None = None,
        remarks: str | None = None,
        asset_ids: list[int] | None = None,
    ) -> PhysicalOrderDetail:
        order = self._load_order(order_id)
        if order.status not in (ORDER_STATUS_DRAFT, ORDER_STATUS_REJECTED):
            raise ConflictError("Only draft or rejected orders can be edited.")
        if assigned_to is not None:
            old = order.assigned_to
            order.assigned_to = assigned_to
            order.assigned_by = actor_user_id
            order.assigned_at = _now_utc()
            log_order_event(
                self._db,
                order_id=order_id,
                action="assignment_changed",
                actor_user_id=actor_user_id,
                old_value={"assigned_to": old},
                new_value={"assigned_to": assigned_to},
            )
            self._notify_assigned(order)
        if remarks is not None:
            order.remarks = remarks
        if asset_ids is not None:
            validation = self.validate_assets(asset_ids)
            if not validation.eligible_asset_ids:
                raise ConflictError("No eligible assets.")
            assets = self._load_assets(validation.eligible_asset_ids)
            self._db.execute(
                PhysicalOrderItem.__table__.delete().where(PhysicalOrderItem.order_id == order_id)
            )
            for a in assets:
                self._db.add(
                    PhysicalOrderItem(
                        order_id=order_id,
                        asset_id=a.id,
                        verification_status=ITEM_STATUS_PENDING,
                    )
                )
        self._db.commit()
        return self.get_order(order_id)

    def submit_order(self, order_id: int, *, actor_user_id: int) -> PhysicalOrderDetail:
        order = self._load_order(order_id)
        if order.created_by != actor_user_id:
            raise ConflictError("Only the order creator can submit.")
        for item in order.items:
            item.verification_status = ITEM_STATUS_PENDING
            item.rejection_reason = None
        self._submit_for_creation_approval(order, actor_user_id=actor_user_id)
        return self.get_order(order_id)

    def approve_all_items(self, order_id: int, *, actor_user_id: int) -> PhysicalOrderDetail:
        order = self._load_order(order_id)
        if order.status != ORDER_STATUS_PENDING_APPROVAL:
            raise ConflictError("Order is not pending approval.")
        for item in order.items:
            if item.verification_status == ITEM_STATUS_PENDING:
                item.verification_status = ITEM_STATUS_APPROVED
                item.rejection_reason = None
        self._db.commit()
        return self.get_order(order_id)

    def approve_items(self, order_id: int, item_ids: list[int], *, actor_user_id: int) -> PhysicalOrderDetail:
        order = self._load_order(order_id)
        if order.status != ORDER_STATUS_PENDING_APPROVAL:
            raise ConflictError("Order is not pending approval.")
        id_set = set(item_ids)
        for item in order.items:
            if item.id in id_set:
                item.verification_status = ITEM_STATUS_APPROVED
                item.rejection_reason = None
        self._db.commit()
        return self.get_order(order_id)

    def reject_items(
        self,
        order_id: int,
        item_ids: list[int],
        *,
        rejection_reason: str,
        actor_user_id: int,
    ) -> PhysicalOrderDetail:
        order = self._load_order(order_id)
        if order.status not in (ORDER_STATUS_PENDING_APPROVAL, ORDER_STATUS_PENDING_CLOSURE):
            raise ConflictError("Order is not in an approval phase.")
        id_set = set(item_ids)
        for item in order.items:
            if item.id in id_set:
                item.verification_status = ITEM_STATUS_REJECTED
                item.rejection_reason = rejection_reason.strip()
        self._db.commit()
        return self.get_order(order_id)

    def reject_order(self, order_id: int, *, reason: str, actor_user_id: int) -> PhysicalOrderDetail:
        order = self._load_order(order_id)
        if order.status not in (ORDER_STATUS_PENDING_APPROVAL, ORDER_STATUS_PENDING_CLOSURE):
            raise ConflictError("Order is not in an approval phase.")
        for item in order.items:
            if item.verification_status == ITEM_STATUS_PENDING:
                item.verification_status = ITEM_STATUS_REJECTED
                item.rejection_reason = reason.strip()
        order.status = ORDER_STATUS_REJECTED
        log_order_event(
            self._db,
            order_id=order_id,
            action="rejected",
            actor_user_id=actor_user_id,
            new_value={"reason": reason},
        )
        self._notify_rejected(order, reason)
        self._db.commit()
        return self.get_order(order_id)

    def start_order(self, order_id: int, *, actor_user_id: int) -> PhysicalOrderDetail:
        order = self._load_order(order_id)
        if order.status != ORDER_STATUS_APPROVED:
            raise ConflictError("Order must be approved before starting.")
        if order.assigned_to != actor_user_id:
            raise ConflictError("Only the assigned executor can start this order.")
        order.status = ORDER_STATUS_IN_PROGRESS
        order.started_at = _now_utc()
        order.started_by = actor_user_id
        for item in order.items:
            item.verification_status = ITEM_STATUS_PENDING
            item.rejection_reason = None
            item.scan_time = None
            item.verified_by = None
        log_order_event(
            self._db,
            order_id=order_id,
            action="started",
            actor_user_id=actor_user_id,
        )
        self._db.commit()
        return self.get_order(order_id)

    def scan_asset(
        self,
        order_id: int,
        *,
        scan_value: str,
        actor_user_id: int,
    ) -> ScanAssetResponse:
        order = self._db.scalar(
            select(PhysicalOrder)
            .where(PhysicalOrder.id == order_id)
            .options(
                selectinload(PhysicalOrder.items)
                .selectinload(PhysicalOrderItem.asset)
                .selectinload(AssetMaster.inventory),
            )
        )
        if order is None:
            raise NotFoundError("PhysicalOrder", order_id)
        if order.status != ORDER_STATUS_IN_PROGRESS:
            raise ConflictError("Order is not in progress.")
        if order.assigned_to != actor_user_id:
            raise ConflictError("Only the assigned executor can scan assets.")
        val = scan_value.strip().upper()
        item = None
        for i in order.items:
            a = i.asset
            if not a:
                continue
            if (a.rfid_code or "").strip().upper() == val or a.asset_code.strip().upper() == val:
                item = i
                break
        if item is None:
            raise NotFoundError("Asset in order", scan_value)
        now = _now_utc()
        item.verification_status = ITEM_STATUS_APPROVED
        item.scan_time = now
        item.verified_by = actor_user_id
        log_order_event(
            self._db,
            order_id=order_id,
            action="asset_verified",
            actor_user_id=actor_user_id,
            new_value={"asset_id": int(item.asset_id), "scan_value": scan_value},
        )
        inv = item.asset.inventory if item.asset else None
        if inv:
            inv.physical_count = inv.inventory_count or 1
            inv.last_verification_date = date.today()
        self._db.commit()
        order = self._load_order(order_id)
        verified = sum(1 for i in order.items if i.verification_status == ITEM_STATUS_APPROVED)
        return ScanAssetResponse(
            item=self._to_item_public(item),
            verified_count=verified,
            total_count=len(order.items),
        )

    def submit_closure(self, order_id: int, *, actor_user_id: int) -> PhysicalOrderDetail:
        order = self._load_order(order_id)
        if order.status != ORDER_STATUS_IN_PROGRESS:
            raise ConflictError("Order is not in progress.")
        if order.assigned_to != actor_user_id:
            raise ConflictError("Only the assigned executor can submit for closure.")
        pending = [i for i in order.items if i.verification_status != ITEM_STATUS_APPROVED]
        if pending:
            raise ConflictError("All assets must be verified before submitting for closure.")
        wf = get_workflow_for_action(self._db, ACTION_COMPLETE)
        if wf:
            engine = ApprovalEngineService(self._db)
            req = engine.create_request_for_entity(
                workflow=wf,
                entity_type=ENTITY_TYPE_CLOSURE,
                entity_id=int(order.id),
                payload=self._order_payload(order, action_code=ACTION_COMPLETE),
                created_by=actor_user_id,
            )
            order.approval_request_id = int(req.id)
            order.status = ORDER_STATUS_PENDING_CLOSURE
            log_order_event(
                self._db,
                order_id=order_id,
                action="closure_submitted",
                actor_user_id=actor_user_id,
                new_value={"approval_request_id": int(req.id)},
            )
        else:
            order.status = ORDER_STATUS_COMPLETED
            order.completed_at = _now_utc()
            log_order_event(
                self._db,
                order_id=order_id,
                action="completed",
                actor_user_id=actor_user_id,
            )
            self._notify_completed(order)
        self._db.commit()
        return self.get_order(order_id)

    def approve_closure_order(self, order_id: int, *, actor_user_id: int) -> PhysicalOrderDetail:
        order = self._load_order(order_id)
        if order.status != ORDER_STATUS_PENDING_CLOSURE:
            raise ConflictError("Order is not pending closure approval.")
        rejected = [i for i in order.items if i.verification_status == ITEM_STATUS_REJECTED]
        if rejected:
            order.status = ORDER_STATUS_REJECTED
            log_order_event(
                self._db,
                order_id=order_id,
                action="rejected",
                actor_user_id=actor_user_id,
                new_value={"phase": "closure"},
            )
            self._notify_rejected(order, "One or more assets were rejected.")
        else:
            order.status = ORDER_STATUS_COMPLETED
            order.completed_at = _now_utc()
            log_order_event(
                self._db,
                order_id=order_id,
                action="closure_approved",
                actor_user_id=actor_user_id,
            )
            log_order_event(
                self._db,
                order_id=order_id,
                action="completed",
                actor_user_id=actor_user_id,
            )
            self._notify_completed(order)
        self._db.commit()
        return self.get_order(order_id)

    def _notify_rejected(self, order: PhysicalOrder, reason: str) -> None:
        try:
            from modules.platform.emails.service import EmailNotificationService

            creator = self._db.get(User, order.created_by) if order.created_by else None
            if creator and creator.email:
                EmailNotificationService(self._db).trigger_event(
                    event_code="ORDER_REJECTED",
                    payload={
                        "user_name": creator.full_name,
                        "email": creator.email,
                        "order_number": order.order_number,
                        "reason": reason,
                    },
                )
        except Exception:
            pass

    def _notify_completed(self, order: PhysicalOrder) -> None:
        try:
            from modules.platform.emails.service import EmailNotificationService

            for uid in {order.created_by, order.assigned_to}:
                if uid is None:
                    continue
                u = self._db.get(User, uid)
                if u and u.email:
                    EmailNotificationService(self._db).trigger_event(
                        event_code="ORDER_COMPLETED",
                        payload={
                            "user_name": u.full_name,
                            "email": u.email,
                            "order_number": order.order_number,
                        },
                    )
        except Exception:
            pass


# --- Approval engine hooks (called from ApprovalEngineService) ---


def finalize_creation_approval(db: Session, *, order_id: int, approver_user_id: int | None) -> None:
    order = db.get(PhysicalOrder, order_id)
    if order is None:
        return
    rejected = [i for i in order.items if i.verification_status == ITEM_STATUS_REJECTED]
    if rejected:
        order.status = ORDER_STATUS_REJECTED
        log_order_event(
            db,
            order_id=order_id,
            action="rejected",
            actor_user_id=approver_user_id,
            new_value={"phase": "creation"},
        )
        PhysicalOrderService(db)._notify_rejected(order, "One or more assets were rejected.")
    else:
        for item in order.items:
            if item.verification_status == ITEM_STATUS_PENDING:
                item.verification_status = ITEM_STATUS_APPROVED
        order.status = ORDER_STATUS_APPROVED
        log_order_event(
            db,
            order_id=order_id,
            action="approved",
            actor_user_id=approver_user_id,
        )
        PhysicalOrderService(db)._create_executor_task(order, actor_user_id=approver_user_id)
    db.commit()


def finalize_closure_approval(db: Session, *, order_id: int, approver_user_id: int | None) -> None:
    order = db.get(PhysicalOrder, order_id)
    if order is None:
        return
    rejected = [i for i in order.items if i.verification_status == ITEM_STATUS_REJECTED]
    if rejected:
        order.status = ORDER_STATUS_REJECTED
        log_order_event(
            db,
            order_id=order_id,
            action="rejected",
            actor_user_id=approver_user_id,
            new_value={"phase": "closure"},
        )
        PhysicalOrderService(db)._notify_rejected(order, "Closure rejected.")
    else:
        order.status = ORDER_STATUS_COMPLETED
        order.completed_at = _now_utc()
        log_order_event(
            db,
            order_id=order_id,
            action="closure_approved",
            actor_user_id=approver_user_id,
        )
        log_order_event(
            db,
            order_id=order_id,
            action="completed",
            actor_user_id=approver_user_id,
        )
        PhysicalOrderService(db)._notify_completed(order)
    db.commit()


def reject_order_approval(
    db: Session,
    *,
    order_id: int,
    entity_type: str,
    approver_user_id: int | None,
    comment: str | None,
) -> None:
    order = db.get(PhysicalOrder, order_id)
    if order is None:
        return
    order.status = ORDER_STATUS_REJECTED
    log_order_event(
        db,
        order_id=order_id,
        action="rejected",
        actor_user_id=approver_user_id,
        new_value={"comment": comment, "entity_type": entity_type},
    )
    PhysicalOrderService(db)._notify_rejected(order, comment or "Rejected")
    db.commit()
