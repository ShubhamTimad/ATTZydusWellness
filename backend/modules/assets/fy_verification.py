"""Physical verification counts and filters by date window (within a financial year)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from modules.assets.lifecycle import LIFECYCLE_ACTIVE
from modules.assets.model import (
    AssetAuditEvent,
    AssetInventoryInformation,
    AssetLocationInformation,
    AssetMaster,
)
from modules.platform.settings.financial_year import FinancialYearPeriod

PHYSICAL_VERIFICATION_AUDIT_ACTION = "physical_order_verified"


@dataclass(frozen=True)
class VerificationWindow:
    start: date
    end: date
    financial_year_label: str | None = None


def resolve_verification_window(
    period: FinancialYearPeriod,
    *,
    scan_from: date | None = None,
    scan_to: date | None = None,
) -> VerificationWindow:
    """Clamp scan dates to the financial year boundaries."""
    start = scan_from if scan_from is not None else period.start
    end = scan_to if scan_to is not None else period.end
    start = max(start, period.start)
    end = min(end, period.end)
    if start > end:
        start, end = period.start, period.end
    return VerificationWindow(start=start, end=end, financial_year_label=period.label)


def _scan_date_filters(window: VerificationWindow):
    return (
        AssetAuditEvent.action == PHYSICAL_VERIFICATION_AUDIT_ACTION,
        func.date(AssetAuditEvent.created_at) >= window.start,
        func.date(AssetAuditEvent.created_at) <= window.end,
    )


def _rfid_active_base(
    *,
    plant_id: int | None = None,
    category_id: int | None = None,
    search: str | None = None,
):
    from sqlalchemy import or_

    base = (
        select(AssetMaster.id)
        .where(
            AssetMaster.deleted_at.is_(None),
            AssetMaster.lifecycle_status == LIFECYCLE_ACTIVE,
            AssetMaster.rfid_code.isnot(None),
            AssetMaster.rfid_code != "",
        )
    )
    if category_id is not None:
        base = base.where(AssetMaster.asset_category_id == category_id)
    if plant_id is not None:
        base = base.join(AssetLocationInformation).where(AssetLocationInformation.plant_id == plant_id)
    if search:
        q = f"%{search.strip()}%"
        base = base.where(
            or_(
                AssetMaster.asset_name.ilike(q),
                AssetMaster.asset_code.ilike(q),
                AssetMaster.combined_asset_number.ilike(q),
                AssetMaster.serial_no.ilike(q),
                AssetMaster.rfid_code.ilike(q),
            )
        )
    return base


def verified_asset_ids_in_window(
    db: Session,
    window: VerificationWindow,
    *,
    plant_id: int | None = None,
    category_id: int | None = None,
    search: str | None = None,
) -> set[int]:
    scan_subq = (
        select(AssetAuditEvent.asset_id)
        .where(*_scan_date_filters(window))
        .distinct()
        .subquery()
    )
    base = _rfid_active_base(plant_id=plant_id, category_id=category_id, search=search)
    base = base.where(AssetMaster.id.in_(select(scan_subq.c.asset_id)))
    return {int(x) for x in db.scalars(base).all()}


def count_verifications_by_asset(
    db: Session,
    asset_ids: list[int],
    window: VerificationWindow,
) -> dict[int, int]:
    if not asset_ids:
        return {}
    rows = db.execute(
        select(
            AssetAuditEvent.asset_id,
            func.count().label("cnt"),
        )
        .where(
            AssetAuditEvent.asset_id.in_(asset_ids),
            *_scan_date_filters(window),
        )
        .group_by(AssetAuditEvent.asset_id)
    ).all()
    return {int(row.asset_id): int(row.cnt) for row in rows}


def count_total_verification_events(
    db: Session,
    window: VerificationWindow,
    *,
    plant_id: int | None = None,
    category_id: int | None = None,
) -> int:
    stmt = (
        select(func.count())
        .select_from(AssetAuditEvent)
        .join(AssetMaster, AssetMaster.id == AssetAuditEvent.asset_id)
        .where(
            AssetMaster.deleted_at.is_(None),
            *_scan_date_filters(window),
        )
    )
    if category_id is not None:
        stmt = stmt.where(AssetMaster.asset_category_id == category_id)
    if plant_id is not None:
        stmt = stmt.join(AssetLocationInformation).where(AssetLocationInformation.plant_id == plant_id)
    return int(db.scalar(stmt) or 0)


def fy_verification_summary(
    db: Session,
    window: VerificationWindow,
    *,
    plant_id: int | None = None,
    category_id: int | None = None,
    search: str | None = None,
) -> dict[str, int]:
    verified_ids = verified_asset_ids_in_window(
        db,
        window,
        plant_id=plant_id,
        category_id=category_id,
        search=search,
    )
    rfid_base = _rfid_active_base(plant_id=plant_id, category_id=category_id, search=search)
    total_rfid = int(db.scalar(select(func.count()).select_from(rfid_base.subquery())) or 0)
    verified_count = len(verified_ids)
    pending_count = max(total_rfid - verified_count, 0)
    scan_count = count_total_verification_events(
        db, window, plant_id=plant_id, category_id=category_id
    )
    return {
        "total_rfid_assets": total_rfid,
        "verified_assets": verified_count,
        "pending_assets": pending_count,
        "total_verification_scans": scan_count,
    }


def is_verified_in_window(last_verification_date: date | None, window: VerificationWindow) -> bool:
    if last_verification_date is None:
        return False
    return window.start <= last_verification_date <= window.end
