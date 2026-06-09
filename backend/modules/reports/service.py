from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from modules.assets.lifecycle import LIFECYCLE_ACTIVE
from modules.assets.model import (
    AssetCategory,
    AssetLocationInformation,
    AssetMaster,
)
from modules.orders.constants import (
    ORDER_STATUS_APPROVED,
    ORDER_STATUS_ASSIGNED,
    ORDER_STATUS_CLOSED,
    ORDER_STATUS_COMPLETED,
    ORDER_STATUS_DRAFT,
    ORDER_STATUS_IN_PROGRESS,
    ORDER_STATUS_PENDING_APPROVAL,
    ORDER_STATUS_PENDING_CLOSURE,
    ORDER_STATUS_REJECTED,
)
from modules.orders.model import PhysicalOrder
from modules.platform.org_units.model import OrgUnit
from modules.assets.fy_verification import resolve_verification_window, verified_asset_ids_in_window
from modules.platform.settings.financial_year import financial_year_period_for
from modules.reports.export import ReportDocument


def _fmt_date(value: date | datetime | None) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    return value.isoformat()


def _fmt_dt(value: datetime | None) -> str:
    if value is None:
        return ""
    return value.astimezone().strftime("%Y-%m-%d %H:%M")


def _status_label(status: str) -> str:
    return status.replace("_", " ").title()


class ReportService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def list_plants(self) -> list[dict[str, str | int]]:
        rows = self._db.execute(
            select(OrgUnit.id, OrgUnit.name, OrgUnit.code)
            .where(OrgUnit.type == "PLANT")
            .order_by(OrgUnit.name.asc())
        ).all()
        return [{"id": int(rid), "name": str(name), "code": str(code)} for rid, name, code in rows]

    def list_categories(self) -> list[AssetCategory]:
        return list(
            self._db.scalars(
                select(AssetCategory)
                .where(AssetCategory.is_active.is_(True))
                .order_by(AssetCategory.name.asc())
            ).all()
        )

    def build(
        self,
        report_key: str,
        *,
        plant_id: int | None = None,
        status: str | None = None,
        fy_status: str | None = None,
    ) -> ReportDocument:
        if report_key == "financial_year_verification":
            return self._financial_year_verification(plant_id=plant_id, fy_status=fy_status)
        if report_key == "physical_orders_summary":
            return self._physical_orders_summary(plant_id=plant_id, status=status)
        raise ValueError(f"Unknown report: {report_key}")

    def _asset_base_query(self, *, plant_id: int | None):
        base = (
            select(AssetMaster)
            .where(AssetMaster.deleted_at.is_(None))
            .options(
                selectinload(AssetMaster.category),
                selectinload(AssetMaster.location).selectinload(AssetLocationInformation.plant),
                selectinload(AssetMaster.financial),
                selectinload(AssetMaster.inventory),
            )
            .order_by(AssetMaster.asset_code.asc())
        )
        if plant_id is not None:
            base = base.join(AssetLocationInformation).where(AssetLocationInformation.plant_id == plant_id)
        return base

    def _financial_year_verification(self, *, plant_id: int | None, fy_status: str | None) -> ReportDocument:
        period = financial_year_period_for()
        window = resolve_verification_window(period)
        normalized_fy = (fy_status or "all").strip().lower()
        if normalized_fy not in FY_STATUS_OPTIONS:
            normalized_fy = "all"

        base = self._asset_base_query(plant_id=plant_id).where(
            AssetMaster.lifecycle_status == LIFECYCLE_ACTIVE,
            AssetMaster.rfid_code.isnot(None),
            AssetMaster.rfid_code != "",
        )
        rows = self._db.scalars(base).unique().all()
        verified_ids = verified_asset_ids_in_window(self._db, window, plant_id=plant_id)

        headers = [
            "Asset code",
            "Asset name",
            "Plant",
            "RFID code",
            "Last verification",
            "Status",
            "Financial year",
        ]
        data = []
        for asset in rows:
            loc = asset.location
            inv = asset.inventory
            last = inv.last_verification_date if inv else None
            verified = int(asset.id) in verified_ids
            row_status = "Verified" if verified else "Pending"
            if normalized_fy == "verified" and not verified:
                continue
            if normalized_fy == "pending" and verified:
                continue
            data.append(
                [
                    asset.asset_code,
                    asset.asset_name,
                    loc.plant.name if loc and loc.plant else "",
                    asset.rfid_code or "",
                    _fmt_date(last),
                    row_status,
                    period.label,
                ]
            )
        scope_label = {
            "verified": "Physically verified only",
            "pending": "Pending verification only",
            "all": "All RFID-tagged assets",
        }[normalized_fy]
        return ReportDocument(
            title=f"Financial year physical verification · {period.label}",
            subtitle=(
                f"{scope_label} · {window.start.isoformat()} – {window.end.isoformat()} · "
                f"{len(data)} assets"
            ),
            headers=headers,
            rows=data,
        )

    def _orders_base_query(self, *, plant_id: int | None, status: str | None):
        base = (
            select(PhysicalOrder)
            .options(
                selectinload(PhysicalOrder.plant),
                selectinload(PhysicalOrder.cost_center),
                selectinload(PhysicalOrder.creator),
                selectinload(PhysicalOrder.assignee),
                selectinload(PhysicalOrder.items),
            )
            .order_by(PhysicalOrder.created_at.desc())
        )
        if plant_id is not None:
            base = base.where(PhysicalOrder.plant_id == plant_id)
        if status:
            base = base.where(PhysicalOrder.status == status.strip().lower())
        return base

    def _physical_orders_summary(self, *, plant_id: int | None, status: str | None) -> ReportDocument:
        rows = self._db.scalars(self._orders_base_query(plant_id=plant_id, status=status)).all()
        headers = [
            "Order number",
            "Plant",
            "Cost center",
            "Status",
            "Assets",
            "Assignee",
            "Created by",
            "Created at",
            "Completed at",
        ]
        data = []
        for order in rows:
            cc = order.cost_center
            data.append(
                [
                    order.order_number,
                    order.plant.name if order.plant else "",
                    cc.code if cc else "",
                    _status_label(order.status),
                    str(len(order.items)),
                    order.assignee.full_name if order.assignee else "",
                    order.creator.full_name if order.creator else "",
                    _fmt_dt(order.created_at),
                    _fmt_dt(order.completed_at),
                ]
            )
        return ReportDocument(
            title="Physical orders",
            subtitle=f"Generated {datetime.now().strftime('%Y-%m-%d %H:%M')} · {len(data)} orders",
            headers=headers,
            rows=data,
        )


ORDER_STATUS_OPTIONS = [
    ORDER_STATUS_PENDING_APPROVAL,
    ORDER_STATUS_ASSIGNED,
    ORDER_STATUS_IN_PROGRESS,
    ORDER_STATUS_PENDING_CLOSURE,
    ORDER_STATUS_COMPLETED,
    ORDER_STATUS_CLOSED,
    ORDER_STATUS_APPROVED,
    ORDER_STATUS_DRAFT,
    ORDER_STATUS_REJECTED,
]

FY_STATUS_OPTIONS = ["all", "verified", "pending"]
FY_STATUS_LABELS = {
    "all": "All assets",
    "verified": "Physically verified only",
    "pending": "Pending verification only",
}
