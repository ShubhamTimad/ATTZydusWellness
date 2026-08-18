from __future__ import annotations

from datetime import date, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, case, false, func, or_, select
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import get_flat_permission_codes_for_user
from db.session import get_db
from modules.assets.lifecycle import LIFECYCLE_ACTIVE
from modules.assets.model import (
    AssetCategory,
    AssetInventoryInformation,
    AssetLocationInformation,
    AssetMaster,
)
from modules.orders.constants import ORDER_STATUS_APPROVED, ORDER_STATUS_ASSIGNED
from modules.orders.model import PhysicalOrder
from modules.transfers.model import AssetTransferOrder
from modules.disposals.model import AssetDisposalOrder
from modules.platform.org_units.model import OrgUnit
from modules.assets.fy_verification import (
    count_total_verification_events,
    resolve_verification_window,
)
from modules.platform.settings.financial_year import financial_year_period_for
from modules.platform.mfa.model import UserMfa
from modules.platform.users.model import User
from modules.platform.users.scope import load_viewer_org_scope
from modules.rbac_association import user_role

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

DASHBOARD_VIEW = "dashboard.view"
DASHBOARD_ORDERS_VIEW = "dashboard.orders.view"
DASHBOARD_ASSETS_VIEW = "dashboard.assets.view"
DASHBOARD_FY_VIEW = "dashboard.financial_year.view"
DASHBOARD_IT_VIEW = "dashboard.it.view"
DASHBOARD_TRANSFERS_VIEW = "dashboard.transfers.view"
DASHBOARD_DISPOSALS_VIEW = "dashboard.disposals.view"
# Orders list tab badges also call this endpoint.
_ORDER_LIST_COMPAT = "order.view"
_TRANSFER_LIST_COMPAT = "transfer.view"
_DISPOSAL_LIST_COMPAT = "disposal.view"


def _permission_variants(required: str) -> set[str]:
    variants = {required}
    if "." in required:
        variants.add(required.replace(".", ":", 1))
    if ":" in required:
        variants.add(required.replace(":", ".", 1))
    return variants


def _grants_any(grants: set[str], *codes: str) -> bool:
    for code in codes:
        if not grants.isdisjoint(_permission_variants(code)):
            return True
    return False


def _active_asset_filters():
    return (
        AssetMaster.deleted_at.is_(None),
        AssetMaster.lifecycle_status == LIFECYCLE_ACTIVE,
    )


def _approved_asset_filters():
    return (
        *_active_asset_filters(),
        AssetMaster.approval_status.in_(("approved", "not_required")),
    )


def _approved_fy_core(db: Session) -> tuple[int, int, Any, Any]:
    approved_total = int(
        db.scalar(select(func.count()).select_from(AssetMaster).where(*_approved_asset_filters())) or 0
    )
    period = financial_year_period_for()
    verified_in_fy_cond = and_(
        AssetInventoryInformation.last_verification_date.isnot(None),
        AssetInventoryInformation.last_verification_date >= period.start,
        AssetInventoryInformation.last_verification_date <= period.end,
    )
    verified_in_fy = int(
        db.scalar(
            select(func.count())
            .select_from(AssetMaster)
            .join(AssetInventoryInformation, AssetInventoryInformation.asset_id == AssetMaster.id)
            .where(*_approved_asset_filters(), verified_in_fy_cond)
        )
        or 0
    )
    return approved_total, verified_in_fy, period, verified_in_fy_cond


def _has_rfid_condition():
    return and_(AssetMaster.rfid_code.isnot(None), AssetMaster.rfid_code != "")


def _no_rfid_condition():
    return or_(AssetMaster.rfid_code.is_(None), AssetMaster.rfid_code == "")


def _apply_order_viewer_scope(stmt: Any, db: Session, viewer_user_id: int) -> Any:
    scope = load_viewer_org_scope(db, viewer_user_id)
    if scope.unrestricted:
        return stmt
    if scope.cost_center_ids is not None:
        if not scope.cost_center_ids:
            return stmt.where(false())
        return stmt.where(PhysicalOrder.cost_center_id.in_(scope.cost_center_ids))
    if scope.plant_ids is not None:
        return stmt.where(PhysicalOrder.plant_id.in_(scope.plant_ids))
    return stmt


def _orders_module(db: Session, viewer_id: int) -> dict[str, Any]:
    status_rows = db.execute(
        _apply_order_viewer_scope(
            select(PhysicalOrder.status, func.count()).select_from(PhysicalOrder),
            db,
            viewer_id,
        ).group_by(PhysicalOrder.status)
    ).all()
    by_status = {str(s): int(c) for s, c in status_rows if s}
    approved_count = int(
        db.scalar(
            _apply_order_viewer_scope(
                select(func.count())
                .select_from(PhysicalOrder)
                .where(
                    PhysicalOrder.status == ORDER_STATUS_APPROVED,
                    PhysicalOrder.completed_at.is_not(None),
                ),
                db,
                viewer_id,
            )
        )
        or 0
    )
    assigned_count = int(
        db.scalar(
            _apply_order_viewer_scope(
                select(func.count())
                .select_from(PhysicalOrder)
                .where(
                    or_(
                        PhysicalOrder.status == ORDER_STATUS_ASSIGNED,
                        and_(
                            PhysicalOrder.status == ORDER_STATUS_APPROVED,
                            PhysicalOrder.completed_at.is_(None),
                        ),
                    )
                ),
                db,
                viewer_id,
            )
        )
        or 0
    )
    by_plant_order_rows = db.execute(
        _apply_order_viewer_scope(
            select(OrgUnit.name, func.count())
            .select_from(PhysicalOrder)
            .join(OrgUnit, OrgUnit.id == PhysicalOrder.plant_id, isouter=True),
            db,
            viewer_id,
        )
        .group_by(OrgUnit.name)
        .order_by(func.count().desc())
    ).all()
    return {
        "total_orders": sum(by_status.values()),
        "draft": by_status.get("draft", 0),
        "pending_approval": by_status.get("pending_approval", 0),
        "approved": approved_count,
        "assigned": assigned_count,
        "in_progress": by_status.get("in_progress", 0),
        "pending_closure_approval": by_status.get("pending_closure_approval", 0),
        "completed": by_status.get("completed", 0),
        "closed": by_status.get("closed", 0),
        "rejected": by_status.get("rejected", 0),
        "by_status": [
            {"status": k.replace("_", " ").title(), "count": v}
            for k, v in sorted(by_status.items())
        ],
        "by_plant": [
            {"plant": str(n or "Unassigned"), "count": int(c)} for n, c in by_plant_order_rows
        ],
    }


def _assets_module(db: Session) -> dict[str, Any]:
    asset_base = select(AssetMaster).where(AssetMaster.deleted_at.is_(None))
    total_assets = int(db.scalar(select(func.count()).select_from(asset_base.subquery())) or 0)
    active_assets = int(
        db.scalar(select(func.count()).select_from(AssetMaster).where(*_active_asset_filters())) or 0
    )
    rfid_tagged = int(
        db.scalar(
            select(func.count())
            .select_from(AssetMaster)
            .where(
                AssetMaster.deleted_at.is_(None),
                _has_rfid_condition(),
            )
        )
        or 0
    )
    rfid_not_tagged = max(total_assets - rfid_tagged, 0)
    rfid_coverage_pct = round((rfid_tagged / total_assets) * 100, 1) if total_assets else 0.0
    pending_approvals = int(
        db.scalar(
            select(func.count())
            .select_from(AssetMaster)
            .where(
                AssetMaster.deleted_at.is_(None),
                AssetMaster.approval_status == "pending",
            )
        )
        or 0
    )
    mismatch = int(
        db.scalar(
            select(func.count())
            .select_from(AssetInventoryInformation)
            .join(AssetMaster, AssetMaster.id == AssetInventoryInformation.asset_id)
            .where(
                AssetMaster.deleted_at.is_(None),
                AssetInventoryInformation.inventory_count.isnot(None),
                AssetInventoryInformation.physical_count.isnot(None),
                AssetInventoryInformation.inventory_count != AssetInventoryInformation.physical_count,
            )
        )
        or 0
    )
    seven_days_ago = date.today() - timedelta(days=6)
    recent = int(
        db.scalar(
            select(func.count())
            .select_from(AssetMaster)
            .where(
                AssetMaster.deleted_at.is_(None),
                func.date(AssetMaster.created_at) >= seven_days_ago,
            )
        )
        or 0
    )
    by_cat_rows = db.execute(
        select(AssetCategory.name, func.count())
        .select_from(AssetMaster)
        .join(AssetCategory, AssetCategory.id == AssetMaster.asset_category_id, isouter=True)
        .where(AssetMaster.deleted_at.is_(None))
        .group_by(AssetCategory.name)
        .order_by(func.count().desc())
    ).all()
    by_plant_rows = db.execute(
        select(OrgUnit.name, func.count())
        .select_from(AssetLocationInformation)
        .join(AssetMaster, AssetMaster.id == AssetLocationInformation.asset_id)
        .join(OrgUnit, OrgUnit.id == AssetLocationInformation.plant_id, isouter=True)
        .where(AssetMaster.deleted_at.is_(None))
        .group_by(OrgUnit.name)
        .order_by(func.count().desc())
    ).all()
    rfid_by_plant_rows = db.execute(
        select(
            OrgUnit.name,
            func.sum(case((_has_rfid_condition(), 1), else_=0)).label("tagged"),
            func.sum(case((_no_rfid_condition(), 1), else_=0)).label("not_tagged"),
        )
        .select_from(AssetMaster)
        .join(AssetLocationInformation, AssetLocationInformation.asset_id == AssetMaster.id, isouter=True)
        .join(OrgUnit, OrgUnit.id == AssetLocationInformation.plant_id, isouter=True)
        .where(AssetMaster.deleted_at.is_(None))
        .group_by(OrgUnit.name)
        .order_by(func.sum(case((_has_rfid_condition(), 1), else_=0)).desc())
    ).all()
    approved_assets = int(
        db.scalar(
            select(func.count())
            .select_from(
                select(AssetMaster.id)
                .where(
                    AssetMaster.deleted_at.is_(None),
                    func.lower(func.trim(AssetMaster.approval_status)) == "approved",
                )
                .subquery()
            )
        )
        or 0
    )
    _, verified_in_fy, _, _ = _approved_fy_core(db)
    return {
        "total_assets": total_assets,
        "active_assets": active_assets,
        "approved_assets": approved_assets,
        "verified_in_fy": verified_in_fy,
        "rfid_tagged": rfid_tagged,
        "rfid_not_tagged": rfid_not_tagged,
        "rfid_coverage_pct": rfid_coverage_pct,
        "pending_approvals": pending_approvals,
        "inventory_mismatch": mismatch,
        "recently_added": recent,
        "by_category": [{"category": str(n or "Uncategorized"), "count": int(c)} for n, c in by_cat_rows],
        "by_plant": [{"plant": str(n or "Unassigned"), "count": int(c)} for n, c in by_plant_rows],
        "rfid_by_plant": [
            {
                "plant": str(name or "Unassigned"),
                "tagged": int(tagged or 0),
                "not_tagged": int(not_tagged or 0),
            }
            for name, tagged, not_tagged in rfid_by_plant_rows
        ],
    }


def _financial_year_module(db: Session) -> dict[str, Any]:
    approved_total, verified_in_fy, period, verified_in_fy_cond = _approved_fy_core(db)
    pending_fy_verification = max(approved_total - verified_in_fy, 0)
    coverage_pct = round((verified_in_fy / approved_total) * 100, 1) if approved_total else 0.0
    total_fy_verification_events = count_total_verification_events(
        db, resolve_verification_window(period)
    )
    fy_by_plant_rows = db.execute(
        select(
            OrgUnit.name,
            func.sum(case((verified_in_fy_cond, 1), else_=0)).label("verified"),
            func.sum(case((~verified_in_fy_cond, 1), else_=0)).label("pending"),
        )
        .select_from(AssetMaster)
        .join(AssetInventoryInformation, AssetInventoryInformation.asset_id == AssetMaster.id)
        .join(AssetLocationInformation, AssetLocationInformation.asset_id == AssetMaster.id, isouter=True)
        .join(OrgUnit, OrgUnit.id == AssetLocationInformation.plant_id, isouter=True)
        .where(*_approved_asset_filters())
        .group_by(OrgUnit.name)
        .order_by(func.sum(case((~verified_in_fy_cond, 1), else_=0)).desc())
    ).all()
    return {
        "label": period.label,
        "start": period.start.isoformat(),
        "end": period.end.isoformat(),
        "total_rfid_assets": approved_total,
        "verified_in_fy": verified_in_fy,
        "pending_fy_verification": pending_fy_verification,
        "total_fy_verification_events": total_fy_verification_events,
        "coverage_pct": coverage_pct,
        "by_plant": [
            {
                "plant": str(name or "Unassigned"),
                "verified": int(verified or 0),
                "pending": int(pending or 0),
            }
            for name, verified, pending in fy_by_plant_rows
        ],
    }


def _it_module(db: Session) -> dict[str, Any]:
    """IT admin section: user account health (active, inactive, onboarding, MFA, roles)."""
    total = int(db.scalar(select(func.count()).select_from(User)) or 0)
    active = int(
        db.scalar(select(func.count()).select_from(User).where(User.is_active.is_(True))) or 0
    )
    inactive = max(total - active, 0)
    seven_days_ago = date.today() - timedelta(days=6)
    new_users = int(
        db.scalar(
            select(func.count())
            .select_from(User)
            .where(func.date(User.created_at) >= seven_days_ago)
        )
        or 0
    )
    assigned = select(user_role.c.user_id)
    without_role = int(
        db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.is_active.is_(True), User.id.not_in(assigned))
        )
        or 0
    )
    mfa_done = select(UserMfa.user_id).where(UserMfa.setup_completed.is_(True))
    mfa_pending = int(
        db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.is_active.is_(True), User.id.not_in(mfa_done))
        )
        or 0
    )
    return {
        "total_users": total,
        "active_users": active,
        "inactive_users": inactive,
        "new_users_last_7_days": new_users,
        "without_role": without_role,
        "mfa_pending": mfa_pending,
    }


_TRANSFER_CLOSED = frozenset({"closed", "cancelled"})
_DISPOSAL_CLOSED = frozenset({"closed", "cancelled"})
_TRANSFER_OPEN_ACTION = frozenset(
    {"approved_by_cf", "received_by_cc2", "confirmed_by_cf", "pending_approval", "assigned_to_cf"}
)
_DISPOSAL_OPEN_ACTION = frozenset({"pending_approval", "pending_receipt", "pending_cf_close"})


def _workflow_order_module(db: Session, model: Any, *, closed: frozenset[str], action: frozenset[str]) -> dict[str, Any]:
    status_rows = db.execute(
        select(model.status, func.count()).select_from(model).group_by(model.status)
    ).all()
    by_status = {str(s): int(c) for s, c in status_rows if s}
    total = sum(by_status.values())
    closed_n = sum(by_status.get(s, 0) for s in closed)
    rejected = by_status.get("rejected", 0) + by_status.get("in_rework", 0)
    awaiting = sum(by_status.get(s, 0) for s in action)
    open_n = max(total - closed_n, 0)
    return {
        "total": total,
        "open": open_n,
        "closed": closed_n,
        "rejected": rejected,
        "draft": by_status.get("draft", 0),
        "pending_approval": by_status.get("pending_approval", 0) + by_status.get("assigned_to_cf", 0),
        "awaiting_action": awaiting,
        "by_status": [
            {"status": k.replace("_", " ").title(), "count": v}
            for k, v in sorted(by_status.items())
        ],
    }


@router.get("/summary")
def get_dashboard_summary(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """
    Dashboard summary for the authenticated user.

    Modules are included only when the role has the matching dashboard section
    permission (orders also returned for ``order.view`` so the orders list badges work).
    """
    viewer_id = int(current.subject)
    grants = set(get_flat_permission_codes_for_user(db, viewer_id))

    can_orders = _grants_any(grants, DASHBOARD_ORDERS_VIEW, _ORDER_LIST_COMPAT)
    can_assets = _grants_any(grants, DASHBOARD_ASSETS_VIEW)
    can_fy = _grants_any(grants, DASHBOARD_FY_VIEW)
    can_it = _grants_any(grants, DASHBOARD_IT_VIEW)
    can_transfers = _grants_any(grants, DASHBOARD_TRANSFERS_VIEW, _TRANSFER_LIST_COMPAT)
    can_disposals = _grants_any(grants, DASHBOARD_DISPOSALS_VIEW, _DISPOSAL_LIST_COMPAT)
    can_page = (
        _grants_any(grants, DASHBOARD_VIEW)
        or can_orders
        or can_assets
        or can_fy
        or can_it
        or can_transfers
        or can_disposals
    )

    if not can_page:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")

    modules: dict[str, Any] = {}
    if can_orders:
        modules["orders"] = _orders_module(db, viewer_id)
    if can_assets:
        modules["assets"] = _assets_module(db)
    if can_fy:
        modules["financial_year"] = _financial_year_module(db)
    if can_transfers:
        modules["transfers"] = _workflow_order_module(
            db, AssetTransferOrder, closed=_TRANSFER_CLOSED, action=_TRANSFER_OPEN_ACTION
        )
    if can_disposals:
        modules["disposals"] = _workflow_order_module(
            db, AssetDisposalOrder, closed=_DISPOSAL_CLOSED, action=_DISPOSAL_OPEN_ACTION
        )
    if can_it:
        modules["it"] = _it_module(db)

    return {
        "visible_sections": {
            "orders": can_orders and _grants_any(grants, DASHBOARD_ORDERS_VIEW),
            "assets": can_assets,
            "financial_year": can_fy,
            "transfers": can_transfers and _grants_any(grants, DASHBOARD_TRANSFERS_VIEW),
            "disposals": can_disposals and _grants_any(grants, DASHBOARD_DISPOSALS_VIEW),
            "it": can_it,
        },
        "modules": modules,
    }
