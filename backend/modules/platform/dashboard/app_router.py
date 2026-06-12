from __future__ import annotations

from datetime import date, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
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
from modules.platform.org_units.model import OrgUnit
from modules.assets.fy_verification import (
    count_total_verification_events,
    resolve_verification_window,
)
from modules.platform.settings.financial_year import financial_year_period_for


router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _active_asset_filters():
    return (
        AssetMaster.deleted_at.is_(None),
        AssetMaster.lifecycle_status == LIFECYCLE_ACTIVE,
    )


def _rfid_asset_filters():
    return (
        *_active_asset_filters(),
        AssetMaster.rfid_code.isnot(None),
        AssetMaster.rfid_code != "",
    )


def _has_rfid_condition():
    return and_(AssetMaster.rfid_code.isnot(None), AssetMaster.rfid_code != "")


def _no_rfid_condition():
    return or_(AssetMaster.rfid_code.is_(None), AssetMaster.rfid_code == "")


@router.get("/summary")
def get_dashboard_summary(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """
    Org-wide dashboard summary. Same modules for every authenticated user:
    physical verification orders, asset register, and financial-year tagging.
    """
    _ = current

    asset_base = select(AssetMaster).where(AssetMaster.deleted_at.is_(None))
    total_assets = int(db.scalar(select(func.count()).select_from(asset_base.subquery())) or 0)
    active_assets = int(
        db.scalar(select(func.count()).select_from(AssetMaster).where(*_active_asset_filters())) or 0
    )
    rfid_tagged = int(
        db.scalar(select(func.count()).select_from(AssetMaster).where(*_rfid_asset_filters())) or 0
    )
    rfid_not_tagged = max(active_assets - rfid_tagged, 0)
    rfid_coverage_pct = round((rfid_tagged / active_assets) * 100, 1) if active_assets else 0.0
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
        .where(*_active_asset_filters())
        .group_by(OrgUnit.name)
        .order_by(func.sum(case((_has_rfid_condition(), 1), else_=0)).desc())
    ).all()

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
            .where(*_rfid_asset_filters(), verified_in_fy_cond)
        )
        or 0
    )
    pending_fy_verification = max(rfid_tagged - verified_in_fy, 0)
    coverage_pct = round((verified_in_fy / rfid_tagged) * 100, 1) if rfid_tagged else 0.0
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
        .where(*_rfid_asset_filters())
        .group_by(OrgUnit.name)
        .order_by(func.sum(case((~verified_in_fy_cond, 1), else_=0)).desc())
    ).all()

    status_rows = db.execute(
        select(PhysicalOrder.status, func.count())
        .select_from(PhysicalOrder)
        .group_by(PhysicalOrder.status)
    ).all()
    by_status = {str(s): int(c) for s, c in status_rows if s}
    approved_count = int(
        db.scalar(
            select(func.count())
            .select_from(PhysicalOrder)
            .where(
                PhysicalOrder.status == ORDER_STATUS_APPROVED,
                PhysicalOrder.completed_at.is_not(None),
            )
        )
        or 0
    )
    assigned_count = int(
        db.scalar(
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
            )
        )
        or 0
    )
    by_plant_order_rows = db.execute(
        select(OrgUnit.name, func.count())
        .select_from(PhysicalOrder)
        .join(OrgUnit, OrgUnit.id == PhysicalOrder.plant_id, isouter=True)
        .group_by(OrgUnit.name)
        .order_by(func.count().desc())
    ).all()

    return {
        "modules": {
            "orders": {
                "total_orders": sum(by_status.values()),
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
                "by_plant": [{"plant": str(n or "Unassigned"), "count": int(c)} for n, c in by_plant_order_rows],
            },
            "assets": {
                "total_assets": total_assets,
                "active_assets": active_assets,
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
            },
            "financial_year": {
                "label": period.label,
                "start": period.start.isoformat(),
                "end": period.end.isoformat(),
                "total_rfid_assets": rfid_tagged,
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
            },
        }
    }
