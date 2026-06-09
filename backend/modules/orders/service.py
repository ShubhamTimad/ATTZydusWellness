from __future__ import annotations

import os
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from modules.asset_masters.model import CostCenterMaster
from modules.assets.model import AssetFinancialInformation, AssetLocationInformation, AssetMaster
from modules.errors import ConflictError, NotFoundError
from modules.orders.asset_order_audit import (
    log_asset_order_approved,
    log_asset_order_started,
    log_asset_physically_verified,
)
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
    ORDER_STATUS_ASSIGNED,
    ORDER_STATUS_CANCELLED,
    ORDER_STATUS_CLOSED,
    ORDER_STATUS_COMPLETED,
    ORDER_STATUS_DRAFT,
    ORDER_STATUS_IN_PROGRESS,
    ORDER_STATUS_PENDING_APPROVAL,
    ORDER_STATUS_PENDING_CLOSURE,
    ORDER_STATUS_REJECTED,
)
from modules.orders.model import PhysicalOrder, PhysicalOrderAudit, PhysicalOrderItem
from modules.orders.progress import build_order_progress, enrich_audit_rows
from modules.orders.schema import (
    ActiveOrderConflict,
    CreatePhysicalOrderRequest,
    ExecutorUserPublic,
    InvalidAssetRef,
    PhysicalOrderApprovalNotice,
    PhysicalOrderDetail,
    PhysicalOrderItemPublic,
    PhysicalOrderListItem,
    PhysicalOrderListResponse,
    ScanAssetResponse,
    ValidateAssetsResponse,
    VerifiedInFinancialYearRef,
)
from core.permissions import _get_cached_permission_snapshot, _has_any_permission
from modules.assets.audit_log import log_asset_event
from modules.assets.model import AssetInventoryInformation
from modules.platform.approvals.assignment_service import get_workflow_for_action
from modules.platform.settings.financial_year import financial_year_period_for, is_verified_in_financial_year
from modules.platform.approvals.model import ApprovalRequest, ApprovalTask, ApprovalWorkflow, TaskAuditLog
from modules.platform.approvals.service import ApprovalEngineService
from modules.platform.permissions.model import Permission
from modules.platform.users.model import User
from modules.rbac_association import role_permission, user_role


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _order_link(order_id: int) -> str:
    base = (os.environ.get("FRONTEND_APP_URL") or os.environ.get("FRONTEND_ORIGIN") or "http://localhost:5173").rstrip(
        "/"
    )
    return f"{base}/dashboard/orders/{int(order_id)}"


class PhysicalOrderService:
    def __init__(self, db: Session) -> None:
        self._db = db

    @staticmethod
    def _is_physically_verified(item: PhysicalOrderItem) -> bool:
        return item.scan_time is not None

    @staticmethod
    def _physically_verified_count(items: list[PhysicalOrderItem]) -> int:
        return sum(1 for i in items if i.scan_time is not None)

    @staticmethod
    def _pending_physical_count(items: list[PhysicalOrderItem]) -> int:
        return sum(
            1
            for i in items
            if i.scan_time is None and i.verification_status != ITEM_STATUS_REJECTED
        )

    @staticmethod
    def _rejected_item_count(items: list[PhysicalOrderItem]) -> int:
        return sum(1 for i in items if i.verification_status == ITEM_STATUS_REJECTED)

    def _assert_closure_reviewer(self, order: PhysicalOrder, *, actor_user_id: int) -> None:
        if order.created_by == actor_user_id:
            return
        snapshot = _get_cached_permission_snapshot(self._db, actor_user_id)
        if _has_any_permission(snapshot, ("order.approve",)):
            return
        raise ConflictError("Only the order creator or an approver can review closure at this stage.")

    def _reopen_for_execution(
        self,
        order: PhysicalOrder,
        *,
        actor_user_id: int,
        reason: str | None = None,
        rejected_codes: list[str] | None = None,
    ) -> None:
        """Return order to executor after closure rejection."""
        order.status = ORDER_STATUS_IN_PROGRESS
        for item in order.items:
            if self._is_physically_verified(item):
                item.verification_status = ITEM_STATUS_APPROVED
                item.rejection_reason = None
                continue
            # Keep rejected status + reason visible for executor re-work.
        log_order_event(
            self._db,
            order_id=int(order.id),
            action="returned_for_execution",
            actor_user_id=actor_user_id,
            new_value={
                "reason": reason or "Closure approval rejected.",
                "rejected_asset_codes": rejected_codes or [],
            },
        )
        self._mark_closure_request_in_rework(order)
        if order.assigned_to:
            try:
                from modules.platform.emails.service import EmailNotificationService

                assignee = self._db.get(User, order.assigned_to)
                if assignee and assignee.email:
                    EmailNotificationService(self._db).trigger_event(
                        event_code="ORDER_RETURNED_FOR_EXECUTION",
                        payload={
                            "user_name": assignee.full_name,
                            "email": assignee.email,
                            "order_number": order.order_number,
                            "reason": reason or "Closure approval rejected.",
                            "order_link": _order_link(int(order.id)),
                        },
                    )
            except Exception:
                pass

    def _complete_closure_approval(self, order: PhysicalOrder, *, actor_user_id: int) -> None:
        for item in order.items:
            if item.verification_status == ITEM_STATUS_PENDING:
                item.verification_status = ITEM_STATUS_APPROVED
                item.rejection_reason = None
        order.status = ORDER_STATUS_COMPLETED
        order.completed_at = _now_utc()
        log_order_event(
            self._db,
            order_id=int(order.id),
            action="closure_approved",
            actor_user_id=actor_user_id,
        )
        log_order_event(
            self._db,
            order_id=int(order.id),
            action="completed",
            actor_user_id=actor_user_id,
        )
        self._notify_completed(order)

    def _maybe_complete_closure_after_item_approval(
        self,
        order: PhysicalOrder,
        *,
        actor_user_id: int,
    ) -> bool:
        if any(i.verification_status == ITEM_STATUS_REJECTED for i in order.items):
            return False
        if not all(i.verification_status == ITEM_STATUS_APPROVED for i in order.items):
            return False
        self._complete_closure_approval(order, actor_user_id=actor_user_id)
        return True

    def _latest_closure_approval_request(self, order_id: int) -> ApprovalRequest | None:
        return self._db.scalar(
            select(ApprovalRequest)
            .where(
                ApprovalRequest.entity_type == ENTITY_TYPE_CLOSURE,
                ApprovalRequest.entity_id == int(order_id),
            )
            .order_by(ApprovalRequest.id.desc())
            .limit(1)
        )

    def _close_pending_approval_tasks(self, request_id: int) -> None:
        now = _now_utc()
        tasks = self._db.scalars(
            select(ApprovalTask).where(
                ApprovalTask.request_id == request_id,
                ApprovalTask.status == "pending",
            )
        ).all()
        for task in tasks:
            task.status = "closed"
            task.closed_at = now

    def _mark_closure_request_in_rework(self, order: PhysicalOrder) -> None:
        req = self._db.scalar(
            select(ApprovalRequest).where(
                ApprovalRequest.entity_type == ENTITY_TYPE_CLOSURE,
                ApprovalRequest.entity_id == int(order.id),
                ApprovalRequest.status == "pending",
            )
        )
        if req is None:
            return
        self._close_pending_approval_tasks(int(req.id))
        req.status = "in_rework"

    def _restart_closure_approval_request(
        self,
        req: ApprovalRequest,
        order: PhysicalOrder,
        *,
        actor_user_id: int,
        workflow: ApprovalWorkflow,
    ) -> ApprovalRequest:
        engine = ApprovalEngineService(self._db)
        self._close_pending_approval_tasks(int(req.id))
        steps = sorted(workflow.steps, key=lambda s: int(s.step_order))
        if not steps:
            raise ConflictError("Active workflow has no steps configured.")
        first = steps[0]
        req.payload = self._order_payload(order, action_code=ACTION_COMPLETE)
        req.status = "pending"
        req.current_step = int(first.step_order)
        req.last_resubmitted_at = _now_utc()
        self._db.flush()
        engine._create_tasks_for_step(req, first)
        new_task = self._db.scalar(
            select(ApprovalTask)
            .where(ApprovalTask.request_id == req.id)
            .order_by(ApprovalTask.id.desc())
            .limit(1)
        )
        if new_task is not None:
            self._db.add(
                TaskAuditLog(
                    task_id=int(new_task.id),
                    action="resubmitted",
                    actor_user_id=actor_user_id,
                    new_value={"request_id": int(req.id), "phase": "closure"},
                )
            )
        return req

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
                    selectinload(AssetMaster.inventory),
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
        period = financial_year_period_for()
        already_verified: list[VerifiedInFinancialYearRef] = []
        for a in assets:
            if int(a.id) not in eligible:
                continue
            inv = a.inventory
            last_dt = inv.last_verification_date if inv else None
            if not is_verified_in_financial_year(last_dt):
                continue
            already_verified.append(
                VerifiedInFinancialYearRef(
                    asset_id=int(a.id),
                    asset_code=a.asset_code,
                    asset_name=a.asset_name,
                    last_verification_date=last_dt,
                    physical_count=inv.physical_count if inv else None,
                )
            )
        return ValidateAssetsResponse(
            eligible_asset_ids=eligible,
            active_order_conflicts=active_conflicts,
            missing_rfid=missing_rfid,
            plant_mismatch=plant_mismatch,
            cost_center_mismatch=cc_mismatch,
            financial_year_label=period.label,
            financial_year_start=period.start,
            financial_year_end=period.end,
            already_verified_in_fy=already_verified,
        )

    def _user_can_execute_orders(self, user_id: int) -> bool:
        snapshot = _get_cached_permission_snapshot(self._db, user_id)
        return _has_any_permission(snapshot, ("order.execute",))

    def list_executors(self) -> list[ExecutorUserPublic]:
        """Active users who may be assigned to execute physical orders."""
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

    def _apply_pending_verification_resets(
        self,
        order: PhysicalOrder,
        *,
        actor_user_id: int | None,
    ) -> list[str]:
        raw = order.reset_verification_asset_ids or []
        asset_ids = [int(x) for x in raw]
        if not asset_ids:
            return []
        period = financial_year_period_for()
        codes = self._reset_physical_verification_for_assets(
            asset_ids,
            actor_user_id=actor_user_id,
            order_number=order.order_number,
            financial_year_label=period.label,
        )
        order.reset_verification_asset_ids = None
        return codes

    def _build_approval_notice(self, order: PhysicalOrder) -> PhysicalOrderApprovalNotice | None:
        if order.status != ORDER_STATUS_PENDING_APPROVAL:
            return None
        period = financial_year_period_for()
        reset_set = {int(x) for x in (order.reset_verification_asset_ids or [])}
        fy_codes: list[str] = []
        reset_codes: list[str] = []
        for item in order.items:
            asset = item.asset
            if asset is None:
                continue
            inv = asset.inventory
            last_dt = inv.last_verification_date if inv else None
            if is_verified_in_financial_year(last_dt):
                fy_codes.append(asset.asset_code)
            if int(item.asset_id) in reset_set:
                reset_codes.append(asset.asset_code)
        if not fy_codes and not reset_codes:
            return None
        message_parts: list[str] = []
        if fy_codes:
            message_parts.append(
                f"{len(fy_codes)} asset(s) were already physically verified in {period.label}."
            )
        if reset_codes:
            message_parts.append(
                f"{len(reset_codes)} asset(s) will have physical count set to 0 and verification date cleared "
                "when this order is approved."
            )
        return PhysicalOrderApprovalNotice(
            financial_year_label=period.label,
            financial_year_start=period.start,
            financial_year_end=period.end,
            fy_verified_asset_codes=fy_codes,
            reset_on_approval_asset_codes=reset_codes,
            message=" ".join(message_parts),
        )

    def _reset_physical_verification_for_assets(
        self,
        asset_ids: list[int],
        *,
        actor_user_id: int,
        order_number: str,
        financial_year_label: str,
    ) -> list[str]:
        if not asset_ids:
            return []
        assets = self._load_assets(asset_ids)
        reset_codes: list[str] = []
        for asset in assets:
            inv = asset.inventory
            if inv is None:
                inv = AssetInventoryInformation(asset_id=int(asset.id))
                self._db.add(inv)
                asset.inventory = inv
            old_physical = inv.physical_count
            old_verified = inv.last_verification_date
            if old_physical in (None, 0) and old_verified is None:
                continue
            inv.physical_count = 0
            inv.last_verification_date = None
            reset_codes.append(asset.asset_code)
            log_asset_event(
                self._db,
                asset_id=int(asset.id),
                actor_user_id=actor_user_id,
                action="physical_verification_reset",
                section="inventory",
                old_value={
                    "physical_count": old_physical,
                    "last_verification_date": old_verified.isoformat() if old_verified else None,
                },
                new_value={
                    "physical_count": 0,
                    "last_verification_date": None,
                    "reason": "re_audit_for_physical_order",
                    "order_number": order_number,
                    "financial_year": financial_year_label,
                },
            )
        return reset_codes

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

        eligible_set = set(validation.eligible_asset_ids)
        reset_ids = {int(i) for i in (body.reset_verification_asset_ids or [])}
        if reset_ids - eligible_set:
            raise ConflictError("Reset verification is only allowed for assets in this order.")
        period = financial_year_period_for()
        order_number = self._next_order_number()
        if reset_ids:
            for asset in assets:
                if int(asset.id) not in reset_ids:
                    continue
                inv = asset.inventory
                last_dt = inv.last_verification_date if inv else None
                if not is_verified_in_financial_year(last_dt):
                    raise ConflictError(
                        f"Asset {asset.asset_code} has not been physically verified in {period.label}."
                    )

        order = PhysicalOrder(
            order_number=order_number,
            plant_id=plant_id,
            cost_center_id=cost_center_id,
            created_by=actor_user_id,
            assigned_to=body.assigned_to,
            status=ORDER_STATUS_DRAFT,
            remarks=body.remarks,
            reset_verification_asset_ids=sorted(reset_ids) if reset_ids else None,
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
            new_value={
                "order_number": order.order_number,
                "asset_count": len(assets),
                "reset_on_approval_asset_ids": sorted(reset_ids) if reset_ids else [],
                "financial_year": period.label if reset_ids else None,
            },
        )
        if body.submit:
            self._submit_for_creation_approval(order, actor_user_id=actor_user_id)
        else:
            self._db.commit()
        return self.get_order(int(order.id))

    def _order_payload(self, order: PhysicalOrder, *, action_code: str) -> dict[str, Any]:
        cc = order.cost_center
        notice = self._build_approval_notice(order)
        payload: dict[str, Any] = {
            "action_code": action_code,
            "order_number": order.order_number,
            "order_id": int(order.id),
            "plant_id": int(order.plant_id),
            "cost_center_code": cc.code if cc else "",
            "asset_count": len(order.items),
        }
        if notice is not None:
            payload["approval_notice"] = notice.model_dump(mode="json")
        return payload

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
            reset_codes = self._apply_pending_verification_resets(order, actor_user_id=actor_user_id)
            log_order_event(
                self._db,
                order_id=int(order.id),
                action="approved",
                actor_user_id=actor_user_id,
                new_value={
                    "auto_approved": True,
                    "reset_verification_assets": reset_codes,
                },
            )
            for item in order.items:
                if item.verification_status != ITEM_STATUS_REJECTED:
                    log_asset_order_approved(
                        self._db,
                        asset_id=int(item.asset_id),
                        order=order,
                        actor_user_id=actor_user_id,
                    )
            self._activate_assignment(order, actor_user_id=actor_user_id)
        self._db.commit()

    def _activate_assignment(self, order: PhysicalOrder, *, actor_user_id: int | None) -> None:
        if order.assigned_to is None:
            raise ConflictError("Order has no intended assignee.")
        now = _now_utc()
        order.assigned_by = actor_user_id or order.created_by
        order.assigned_at = now
        order.status = ORDER_STATUS_ASSIGNED
        log_order_event(
            self._db,
            order_id=int(order.id),
            action="assignment_changed",
            actor_user_id=actor_user_id,
            new_value={"assigned_to": int(order.assigned_to), "auto_assigned": True},
        )
        self._notify_assigned(order)

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
                        "order_link": _order_link(int(order.id)),
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
            base = base.where(
                PhysicalOrder.assigned_to == viewer_id,
                PhysicalOrder.status.in_(
                    (
                        ORDER_STATUS_ASSIGNED,
                        ORDER_STATUS_IN_PROGRESS,
                        ORDER_STATUS_PENDING_CLOSURE,
                        ORDER_STATUS_COMPLETED,
                    )
                ),
            )
        elif tab == "assigned":
            base = base.where(PhysicalOrder.status == ORDER_STATUS_ASSIGNED)
        elif tab == "in_progress":
            base = base.where(PhysicalOrder.status == ORDER_STATUS_IN_PROGRESS)
        elif tab == "pending_closure":
            base = base.where(PhysicalOrder.status == ORDER_STATUS_PENDING_CLOSURE)
        elif tab == "completed":
            base = base.where(PhysicalOrder.status == ORDER_STATUS_COMPLETED)
        elif tab == "closed":
            base = base.where(PhysicalOrder.status == ORDER_STATUS_CLOSED)
        elif tab == "all":
            pass
        else:
            base = base.where(
                PhysicalOrder.status.in_(
                    (
                        ORDER_STATUS_PENDING_APPROVAL,
                        ORDER_STATUS_APPROVED,
                        ORDER_STATUS_ASSIGNED,
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
                selectinload(PhysicalOrder.items).selectinload(PhysicalOrderItem.asset).selectinload(
                    AssetMaster.inventory
                ),
            )
        )
        if order is None:
            raise NotFoundError("PhysicalOrder", order_id)
        return order

    def _to_item_public(self, item: PhysicalOrderItem) -> PhysicalOrderItemPublic:
        a = item.asset
        verifier = self._user_name(item.verified_by)
        inv = a.inventory if a else None
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
            physically_verified=self._is_physically_verified(item),
            last_verification_date=inv.last_verification_date if inv else None,
        )

    def get_order(self, order_id: int) -> PhysicalOrderDetail:
        order = self._load_order(order_id)
        physically_verified = self._physically_verified_count(order.items)
        pending_physical = self._pending_physical_count(order.items)
        rejected_items = self._rejected_item_count(order.items)
        audit_rows = self._db.scalars(
            select(PhysicalOrderAudit)
            .where(PhysicalOrderAudit.order_id == order_id)
            .order_by(PhysicalOrderAudit.created_at.asc())
        ).all()
        audit = enrich_audit_rows(
            audit_rows,
            user_name_fn=self._user_name,
            db=self._db,
            order_id=order_id,
        )
        progress = build_order_progress(
            self._db,
            order,
            audit_rows=list(audit_rows),
            user_name_fn=self._user_name,
        )
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
            closed_at=order.closed_at,
            created_at=order.created_at,
            approval_request_id=order.approval_request_id,
            items=[self._to_item_public(i) for i in order.items],
            verified_count=physically_verified,
            physically_verified_count=physically_verified,
            pending_physical_count=pending_physical,
            rejected_item_count=rejected_items,
            total_count=len(order.items),
            audit=audit,
            progress=progress,
            approval_notice=self._build_approval_notice(order),
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
            assignee = self._db.get(User, assigned_to)
            if assignee is None or not assignee.is_active:
                raise NotFoundError("User", assigned_to)
            old = order.assigned_to
            order.assigned_to = assigned_to
            log_order_event(
                self._db,
                order_id=order_id,
                action="assignment_changed",
                actor_user_id=actor_user_id,
                old_value={"assigned_to": old},
                new_value={"assigned_to": assigned_to, "intended_only": True},
            )
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

    def _find_pending_creation_task(
        self, order: PhysicalOrder, *, actor_user_id: int
    ) -> ApprovalTask | None:
        req_id = order.approval_request_id
        if req_id is None:
            req = self._db.scalar(
                select(ApprovalRequest)
                .where(
                    ApprovalRequest.entity_type == ENTITY_TYPE_CREATION,
                    ApprovalRequest.entity_id == int(order.id),
                )
                .order_by(ApprovalRequest.created_at.desc())
                .limit(1)
            )
            req_id = int(req.id) if req is not None else None
        if req_id is None:
            return None

        engine = ApprovalEngineService(self._db)
        role_ids = engine._role_ids_for_user(actor_user_id)
        tasks = self._db.scalars(
            select(ApprovalTask).where(
                ApprovalTask.request_id == req_id,
                ApprovalTask.status == "pending",
            )
        ).all()
        for task in tasks:
            if task.assigned_user_id == actor_user_id:
                return task
            if task.assigned_role_id is not None and int(task.assigned_role_id) in role_ids:
                return task
        return None

    def approve_creation_order(self, order_id: int, *, actor_user_id: int) -> PhysicalOrderDetail:
        order = self._load_order(order_id)
        if order.status != ORDER_STATUS_PENDING_APPROVAL:
            raise ConflictError("Order is not pending approval.")
        for item in order.items:
            if item.verification_status == ITEM_STATUS_PENDING:
                item.verification_status = ITEM_STATUS_APPROVED
                item.rejection_reason = None
        self._db.flush()

        task = self._find_pending_creation_task(order, actor_user_id=actor_user_id)
        if task is not None:
            ApprovalEngineService(self._db).act_on_task(
                task_id=int(task.id),
                actor_user_id=actor_user_id,
                action="approve",
                comment=None,
            )
        else:
            finalize_creation_approval(
                self._db,
                order_id=order_id,
                approver_user_id=actor_user_id,
            )
        return self.get_order(order_id)

    def approve_all_items(self, order_id: int, *, actor_user_id: int) -> PhysicalOrderDetail:
        order = self._load_order(order_id)
        if order.status == ORDER_STATUS_PENDING_CLOSURE:
            self._assert_closure_reviewer(order, actor_user_id=actor_user_id)
            for item in order.items:
                if item.verification_status == ITEM_STATUS_PENDING:
                    item.verification_status = ITEM_STATUS_APPROVED
                    item.rejection_reason = None
            self._complete_closure_approval(order, actor_user_id=actor_user_id)
            self._db.commit()
            return self.get_order(order_id)
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
        id_set = set(item_ids)
        if order.status == ORDER_STATUS_PENDING_CLOSURE:
            self._assert_closure_reviewer(order, actor_user_id=actor_user_id)
            if not id_set:
                raise ConflictError("Select at least one line item to approve.")
            order_item_ids = {int(i.id) for i in order.items}
            if id_set - order_item_ids:
                raise ConflictError("One or more selected line items are not on this order.")
            for item in order.items:
                if item.id in id_set:
                    item.verification_status = ITEM_STATUS_APPROVED
                    item.rejection_reason = None
            if id_set == order_item_ids:
                self._complete_closure_approval(order, actor_user_id=actor_user_id)
            else:
                self._maybe_complete_closure_after_item_approval(
                    order,
                    actor_user_id=actor_user_id,
                )
            self._db.commit()
            return self.get_order(order_id)
        if order.status != ORDER_STATUS_PENDING_APPROVAL:
            raise ConflictError("Order is not pending approval.")
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
        if order.status == ORDER_STATUS_PENDING_APPROVAL:
            id_set = set(item_ids)
            for item in order.items:
                if item.id in id_set:
                    item.verification_status = ITEM_STATUS_REJECTED
                    item.rejection_reason = rejection_reason.strip()
            self._db.commit()
            return self.get_order(order_id)
        if order.status == ORDER_STATUS_PENDING_CLOSURE:
            self._assert_closure_reviewer(order, actor_user_id=actor_user_id)
            id_set = set(item_ids)
            reason = rejection_reason.strip()
            if not reason:
                raise ConflictError("A rejection reason is required.")
            selected = [i for i in order.items if i.id in id_set]
            if not selected:
                raise ConflictError("Select at least one line item to reject.")
            verified_selected = [i for i in selected if self._is_physically_verified(i)]
            if verified_selected and not any(not self._is_physically_verified(i) for i in selected):
                raise ConflictError(
                    "Physically verified assets cannot be rejected at closure. "
                    "Select non-verified assets only."
                )
            targets = [i for i in selected if not self._is_physically_verified(i)]
            if not targets:
                raise ConflictError(
                    "No non-verified assets in selection. Physically verified lines cannot be rejected."
                )
            rejected_codes: list[str] = []
            for item in targets:
                item.verification_status = ITEM_STATUS_REJECTED
                item.rejection_reason = reason
                rejected_codes.append(item.asset_code)
            log_order_event(
                self._db,
                order_id=order_id,
                action="closure_items_rejected",
                actor_user_id=actor_user_id,
                new_value={"asset_codes": rejected_codes, "reason": reason},
            )
            self._reopen_for_execution(
                order,
                actor_user_id=actor_user_id,
                reason=reason,
                rejected_codes=rejected_codes,
            )
            self._db.commit()
            return self.get_order(order_id)
        raise ConflictError("Order is not in an approval phase.")

    def reject_execution_items(
        self,
        order_id: int,
        item_ids: list[int],
        *,
        rejection_reason: str,
        actor_user_id: int,
    ) -> PhysicalOrderDetail:
        order = self._load_order(order_id)
        if order.status != ORDER_STATUS_IN_PROGRESS:
            raise ConflictError("Order is not in progress.")
        if order.assigned_to != actor_user_id:
            raise ConflictError("Only the assigned executor can reject line items.")
        id_set = set(item_ids)
        reason = rejection_reason.strip()
        if not reason:
            raise ConflictError("A rejection reason is required.")
        rejected_codes: list[str] = []
        for item in order.items:
            if item.id not in id_set:
                continue
            if self._is_physically_verified(item):
                raise ConflictError(f"Cannot reject verified asset {item.asset_code}.")
            if item.verification_status == ITEM_STATUS_REJECTED:
                continue
            item.verification_status = ITEM_STATUS_REJECTED
            item.rejection_reason = reason
            rejected_codes.append(item.asset_code)
        if not rejected_codes:
            raise ConflictError("No eligible line items to reject.")
        log_order_event(
            self._db,
            order_id=order_id,
            action="execution_items_rejected",
            actor_user_id=actor_user_id,
            new_value={"asset_codes": rejected_codes, "reason": reason},
        )
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

    def reassign_order(
        self,
        order_id: int,
        *,
        assigned_to: int,
        actor_user_id: int,
    ) -> PhysicalOrderDetail:
        order = self._load_order(order_id)
        if order.status != ORDER_STATUS_ASSIGNED:
            raise ConflictError("Order can only be reassigned before work starts.")
        if assigned_to == order.assigned_to:
            raise ConflictError("Select a different executor to reassign this order.")
        assignee = self._db.get(User, assigned_to)
        if assignee is None or not assignee.is_active:
            raise NotFoundError("User", assigned_to)
        if not self._user_can_execute_orders(int(assignee.id)):
            raise ConflictError("Assignee must have permission to execute physical orders.")
        old_id = order.assigned_to
        old_name = self._user_name(old_id)
        new_name = assignee.full_name
        order.assigned_to = assigned_to
        order.assigned_by = actor_user_id
        order.assigned_at = _now_utc()
        log_order_event(
            self._db,
            order_id=order_id,
            action="reassigned",
            actor_user_id=actor_user_id,
            old_value={
                "assigned_to": old_id,
                "assigned_to_name": old_name,
            },
            new_value={
                "assigned_to": assigned_to,
                "assigned_to_name": new_name,
            },
        )
        self._notify_assigned(order)
        self._db.commit()
        return self.get_order(order_id)

    def close_order(self, order_id: int, *, actor_user_id: int) -> PhysicalOrderDetail:
        order = self._load_order(order_id)
        if order.status != ORDER_STATUS_COMPLETED:
            raise ConflictError("Order must be completed before it can be closed.")
        order.status = ORDER_STATUS_CLOSED
        order.closed_at = _now_utc()
        log_order_event(
            self._db,
            order_id=order_id,
            action="closed",
            actor_user_id=actor_user_id,
        )
        self._db.commit()
        return self.get_order(order_id)

    def start_order(self, order_id: int, *, actor_user_id: int) -> PhysicalOrderDetail:
        order = self._load_order(order_id)
        if order.status not in (ORDER_STATUS_ASSIGNED, ORDER_STATUS_APPROVED):
            raise ConflictError("Order must be assigned before starting.")
        if order.assigned_to != actor_user_id:
            raise ConflictError("Only the assigned executor can start this order.")
        order.status = ORDER_STATUS_IN_PROGRESS
        order.started_at = _now_utc()
        order.started_by = actor_user_id
        for item in order.items:
            if self._is_physically_verified(item):
                continue
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
        for item in order.items:
            if item.verification_status != ITEM_STATUS_REJECTED:
                log_asset_order_started(
                    self._db,
                    asset_id=int(item.asset_id),
                    order=order,
                    actor_user_id=actor_user_id,
                )
        self._db.commit()
        return self.get_order(order_id)

    def scan_asset(
        self,
        order_id: int,
        *,
        scan_value: str,
        item_id: int | None = None,
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
        if not val:
            raise ConflictError("Scan value is required.")

        item: PhysicalOrderItem | None = None
        if item_id is not None:
            item = next((i for i in order.items if int(i.id) == int(item_id)), None)
            if item is None:
                raise NotFoundError("PhysicalOrderItem", item_id)
        else:
            for i in order.items:
                a = i.asset
                if not a:
                    continue
                rfid = (a.rfid_code or "").strip().upper()
                if rfid and rfid == val:
                    item = i
                    break

        if item is None:
            raise NotFoundError("Asset in order", scan_value)

        if self._is_physically_verified(item):
            raise ConflictError(
                "This asset was already physically verified and cannot be scanned again."
            )

        a = item.asset
        if a is None:
            raise ConflictError("Asset not found for this line item.")
        rfid = (a.rfid_code or "").strip().upper()
        if not rfid:
            raise ConflictError("Asset has no RFID code attached.")
        if rfid != val:
            raise ConflictError("Scanned RFID does not match this asset's RFID code.")

        now = _now_utc()
        item.verification_status = ITEM_STATUS_APPROVED
        item.scan_time = now
        item.verified_by = actor_user_id
        item.rejection_reason = None
        log_order_event(
            self._db,
            order_id=order_id,
            action="asset_verified",
            actor_user_id=actor_user_id,
            new_value={
                "asset_id": int(item.asset_id),
                "asset_code": a.asset_code,
                "rfid_code": rfid,
            },
        )
        inv = a.inventory
        old_physical = inv.physical_count if inv else None
        old_verified = inv.last_verification_date if inv else None
        if inv:
            inv.physical_count = 1
            inv.last_verification_date = date.today()
        log_asset_physically_verified(
            self._db,
            asset=a,
            order=order,
            actor_user_id=actor_user_id,
            old_physical=old_physical,
            old_verified=old_verified,
        )
        self._db.commit()
        order = self._load_order(order_id)
        physically_verified = self._physically_verified_count(order.items)
        return ScanAssetResponse(
            item=self._to_item_public(item),
            verified_count=physically_verified,
            total_count=len(order.items),
        )

    def submit_closure(self, order_id: int, *, actor_user_id: int) -> PhysicalOrderDetail:
        order = self._load_order(order_id)
        if order.status != ORDER_STATUS_IN_PROGRESS:
            raise ConflictError("Order is not in progress.")
        if order.assigned_to != actor_user_id:
            raise ConflictError("Only the assigned executor can submit for closure.")
        pending = [
            i
            for i in order.items
            if not self._is_physically_verified(i) and i.verification_status != ITEM_STATUS_REJECTED
        ]
        if pending:
            raise ConflictError(
                "Every line must be verified by RFID scan or rejected before submitting for closure."
            )
        for item in order.items:
            item.verification_status = ITEM_STATUS_PENDING
            item.rejection_reason = None
        wf = get_workflow_for_action(self._db, ACTION_COMPLETE)
        if wf:
            engine = ApprovalEngineService(self._db)
            existing = self._latest_closure_approval_request(order_id)
            if existing and str(existing.status) == "pending":
                req = self._restart_closure_approval_request(
                    existing,
                    order,
                    actor_user_id=actor_user_id,
                    workflow=wf,
                )
            elif existing and str(existing.status) in ("in_rework", "rejected"):
                self._db.flush()
                req, _ = engine.resubmit_rejected_request(
                    request_id=int(existing.id),
                    actor_user_id=actor_user_id,
                )
                log_order_event(
                    self._db,
                    order_id=order_id,
                    action="closure_submitted",
                    actor_user_id=actor_user_id,
                    new_value={"approval_request_id": int(req.id), "resubmitted": True},
                )
                self._db.commit()
                return self.get_order(order_id)
            else:
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
        self._assert_closure_reviewer(order, actor_user_id=actor_user_id)
        rejected = [i for i in order.items if i.verification_status == ITEM_STATUS_REJECTED]
        if rejected:
            self._reopen_for_execution(
                order,
                actor_user_id=actor_user_id,
                reason="Closure approval rejected.",
                rejected_codes=[i.asset_code for i in rejected],
            )
        else:
            self._complete_closure_approval(order, actor_user_id=actor_user_id)
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
                        "order_link": _order_link(int(order.id)),
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
                            "order_link": _order_link(int(order.id)),
                        },
                    )
        except Exception:
            pass


# --- Approval engine hooks (called from ApprovalEngineService) ---


def finalize_creation_approval(db: Session, *, order_id: int, approver_user_id: int | None) -> None:
    svc = PhysicalOrderService(db)
    try:
        order = svc._load_order(order_id)
    except NotFoundError:
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
        svc._notify_rejected(order, "One or more assets were rejected.")
    else:
        for item in order.items:
            if item.verification_status == ITEM_STATUS_PENDING:
                item.verification_status = ITEM_STATUS_APPROVED
        order.status = ORDER_STATUS_APPROVED
        reset_codes = svc._apply_pending_verification_resets(order, actor_user_id=approver_user_id)
        log_order_event(
            db,
            order_id=order_id,
            action="approved",
            actor_user_id=approver_user_id,
            new_value={"reset_verification_assets": reset_codes},
        )
        for item in order.items:
            if item.verification_status != ITEM_STATUS_REJECTED:
                log_asset_order_approved(
                    db,
                    asset_id=int(item.asset_id),
                    order=order,
                    actor_user_id=approver_user_id,
                )
        svc._activate_assignment(order, actor_user_id=approver_user_id)
    db.commit()


def finalize_closure_approval(db: Session, *, order_id: int, approver_user_id: int | None) -> None:
    svc = PhysicalOrderService(db)
    try:
        order = svc._load_order(order_id)
    except NotFoundError:
        return
    rejected = [i for i in order.items if i.verification_status == ITEM_STATUS_REJECTED]
    if rejected:
        svc._reopen_for_execution(
            order,
            actor_user_id=approver_user_id,
            reason="Closure approval rejected.",
            rejected_codes=[i.asset_code for i in rejected],
        )
    else:
        svc._complete_closure_approval(order, actor_user_id=approver_user_id)
    db.commit()


def reject_order_approval(
    db: Session,
    *,
    order_id: int,
    entity_type: str,
    approver_user_id: int | None,
    comment: str | None,
) -> None:
    svc = PhysicalOrderService(db)
    try:
        order = svc._load_order(order_id)
    except NotFoundError:
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
