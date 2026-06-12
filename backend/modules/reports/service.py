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
    ORDER_STATUS_ASSIGNED,
    ORDER_STATUS_CLOSED,
    ORDER_STATUS_COMPLETED,
    ORDER_STATUS_IN_PROGRESS,
)
from modules.orders.model import PhysicalOrder
from modules.platform.org_units.model import OrgUnit
from modules.platform.users.model import User
from modules.assets.fy_verification import resolve_verification_window, verified_asset_ids_in_window
from modules.platform.settings.financial_year import resolve_financial_year_period
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
        fy_start_year: int | None = None,
        generated_by_user_id: int | None = None,
    ) -> ReportDocument:
        if report_key == "financial_year_verification":
            return self._financial_year_verification(
                plant_id=plant_id,
                fy_status=fy_status,
                fy_start_year=fy_start_year,
                generated_by_user_id=generated_by_user_id,
            )
        if report_key == "physical_orders_summary":
            return self._physical_orders_summary(
                plant_id=plant_id,
                status=status,
                generated_by_user_id=generated_by_user_id,
            )
        raise ValueError(f"Unknown report: {report_key}")

    def _generated_by_label(self, user_id: int | None) -> str:
        if user_id is None:
            return "—"
        user = self._db.get(User, user_id)
        if user is None:
            return "—"
        if user.email:
            return f"{user.full_name} ({user.email})"
        return user.full_name

    def _plant_filter_label(self, plant_id: int | None) -> str:
        if plant_id is None:
            return "All plants"
        plant = self._db.get(OrgUnit, plant_id)
        if plant is None:
            return "—"
        return f"{plant.name} ({plant.code})"

    def _order_status_filter_label(self, status: str | None) -> str:
        if not status:
            return "All statuses"
        return _status_label(status.strip().lower())

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

    def _financial_year_verification(
        self,
        *,
        plant_id: int | None,
        fy_status: str | None,
        fy_start_year: int | None = None,
        generated_by_user_id: int | None = None,
    ) -> ReportDocument:
        period = resolve_financial_year_period(fy_start_year)
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
        generated_at = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M")
        summary = (
            ("Generated by", self._generated_by_label(generated_by_user_id)),
            ("Generated at", generated_at),
            ("Financial year", period.label),
            ("Plant", self._plant_filter_label(plant_id)),
            ("Verification scope", scope_label),
            ("Period", f"{window.start.isoformat()} – {window.end.isoformat()}"),
            ("Total assets", str(len(data))),
        )
        return ReportDocument(
            title=f"Financial year physical verification · {period.label}",
            subtitle=f"{scope_label} · {len(data)} assets",
            summary=summary,
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

    def _physical_orders_summary(
        self,
        *,
        plant_id: int | None,
        status: str | None,
        generated_by_user_id: int | None = None,
    ) -> ReportDocument:
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
        total_assets = 0
        for order in rows:
            cc = order.cost_center
            asset_count = len(order.items)
            total_assets += asset_count
            data.append(
                [
                    order.order_number,
                    order.plant.name if order.plant else "",
                    cc.code if cc else "",
                    _status_label(order.status),
                    str(asset_count),
                    order.assignee.full_name if order.assignee else "",
                    order.creator.full_name if order.creator else "",
                    _fmt_dt(order.created_at),
                    _fmt_dt(order.completed_at),
                ]
            )
        generated_at = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M")
        summary = (
            ("Generated by", self._generated_by_label(generated_by_user_id)),
            ("Generated at", generated_at),
            ("Plant", self._plant_filter_label(plant_id)),
            ("Order status", self._order_status_filter_label(status)),
            ("Total orders", str(len(data))),
            ("Total assets", str(total_assets)),
        )
        return ReportDocument(
            title="Physical orders",
            subtitle=f"{len(data)} orders · {total_assets} assets",
            summary=summary,
            headers=headers,
            rows=data,
        )


ORDER_STATUS_OPTIONS = [
    ORDER_STATUS_ASSIGNED,
    ORDER_STATUS_IN_PROGRESS,
    ORDER_STATUS_COMPLETED,
    ORDER_STATUS_CLOSED,
]

FY_STATUS_OPTIONS = ["all", "verified", "pending"]
FY_STATUS_LABELS = {
    "all": "All assets",
    "verified": "Physically verified only",
    "pending": "Pending verification only",
}
