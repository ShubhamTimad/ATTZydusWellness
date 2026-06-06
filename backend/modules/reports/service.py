from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from modules.assets.lifecycle import LIFECYCLE_ACTIVE
from modules.assets.model import (
    AssetInventoryInformation,
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
from modules.orders.model import PhysicalOrder, PhysicalOrderItem
from modules.platform.org_units.model import OrgUnit
from modules.platform.settings.financial_year import financial_year_period_for, is_verified_in_financial_year
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

    def build(
        self,
        report_key: str,
        *,
        plant_id: int | None = None,
        status: str | None = None,
        fy_status: str | None = None,
    ) -> ReportDocument:
        if report_key == "asset_register":
            return self._asset_register(plant_id=plant_id)
        if report_key == "financial_year_verification":
            return self._financial_year_verification(plant_id=plant_id, fy_status=fy_status)
        if report_key == "physical_orders_summary":
            return self._physical_orders_summary(plant_id=plant_id, status=status)
        if report_key == "physical_order_details":
            return self._physical_order_details(plant_id=plant_id, status=status)
        if report_key == "inventory_mismatch":
            return self._inventory_mismatch(plant_id=plant_id)
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

    def _asset_register(self, *, plant_id: int | None) -> ReportDocument:
        rows = self._db.scalars(self._asset_base_query(plant_id=plant_id)).unique().all()
        headers = [
            "Asset code",
            "Asset name",
            "Category",
            "Plant",
            "RFID code",
            "Lifecycle",
            "Approval",
            "Cost center",
            "Sub location",
            "Inventory count",
            "Physical count",
            "Last verification",
        ]
        data = []
        for asset in rows:
            loc = asset.location
            fin = asset.financial
            inv = asset.inventory
            data.append(
                [
                    asset.asset_code,
                    asset.asset_name,
                    asset.category.name if asset.category else "",
                    loc.plant.name if loc and loc.plant else "",
                    asset.rfid_code or "",
                    _status_label(asset.lifecycle_status),
                    _status_label(asset.approval_status),
                    fin.cost_center if fin and fin.cost_center else "",
                    loc.sub_location if loc and loc.sub_location else "",
                    str(inv.inventory_count) if inv and inv.inventory_count is not None else "",
                    str(inv.physical_count) if inv and inv.physical_count is not None else "",
                    _fmt_date(inv.last_verification_date if inv else None),
                ]
            )
        return ReportDocument(
            title="Asset register",
            subtitle=f"Generated {datetime.now().strftime('%Y-%m-%d %H:%M')} · {len(data)} assets",
            headers=headers,
            rows=data,
        )

    def _financial_year_verification(self, *, plant_id: int | None, fy_status: str | None) -> ReportDocument:
        period = financial_year_period_for()
        base = self._asset_base_query(plant_id=plant_id).where(
            AssetMaster.lifecycle_status == LIFECYCLE_ACTIVE,
            AssetMaster.rfid_code.isnot(None),
            AssetMaster.rfid_code != "",
        )
        rows = self._db.scalars(base).unique().all()
        normalized_fy = (fy_status or "all").strip().lower()

        headers = [
            "Asset code",
            "Asset name",
            "Plant",
            "RFID code",
            "Last verification",
            "FY status",
            "Financial year",
        ]
        data = []
        for asset in rows:
            loc = asset.location
            inv = asset.inventory
            last = inv.last_verification_date if inv else None
            verified = is_verified_in_financial_year(last)
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
        return ReportDocument(
            title=f"Financial year verification · {period.label}",
            subtitle=(
                f"Period {period.start.isoformat()} – {period.end.isoformat()} · "
                f"{len(data)} RFID assets"
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
            title="Physical orders summary",
            subtitle=f"Generated {datetime.now().strftime('%Y-%m-%d %H:%M')} · {len(data)} orders",
            headers=headers,
            rows=data,
        )

    def _physical_order_details(self, *, plant_id: int | None, status: str | None) -> ReportDocument:
        rows = self._db.scalars(
            self._orders_base_query(plant_id=plant_id, status=status).options(
                selectinload(PhysicalOrder.items).selectinload(PhysicalOrderItem.asset)
            )
        ).all()
        headers = [
            "Order number",
            "Plant",
            "Order status",
            "Asset code",
            "Asset name",
            "RFID code",
            "Verification status",
            "Scan time",
            "Rejection reason",
        ]
        data = []
        for order in rows:
            plant_name = order.plant.name if order.plant else ""
            order_status = _status_label(order.status)
            for item in order.items:
                asset = item.asset
                data.append(
                    [
                        order.order_number,
                        plant_name,
                        order_status,
                        asset.asset_code if asset else "",
                        asset.asset_name if asset else "",
                        asset.rfid_code if asset and asset.rfid_code else "",
                        _status_label(item.verification_status),
                        _fmt_dt(item.scan_time),
                        item.rejection_reason or "",
                    ]
                )
        return ReportDocument(
            title="Physical order details",
            subtitle=f"Generated {datetime.now().strftime('%Y-%m-%d %H:%M')} · {len(data)} line items",
            headers=headers,
            rows=data,
        )

    def _inventory_mismatch(self, *, plant_id: int | None) -> ReportDocument:
        base = (
            select(AssetMaster)
            .join(AssetInventoryInformation, AssetInventoryInformation.asset_id == AssetMaster.id)
            .where(
                AssetMaster.deleted_at.is_(None),
                AssetInventoryInformation.inventory_count.isnot(None),
                AssetInventoryInformation.physical_count.isnot(None),
                AssetInventoryInformation.inventory_count != AssetInventoryInformation.physical_count,
            )
            .options(
                selectinload(AssetMaster.location).selectinload(AssetLocationInformation.plant),
                selectinload(AssetMaster.inventory),
            )
            .order_by(AssetMaster.asset_code.asc())
        )
        if plant_id is not None:
            base = base.join(
                AssetLocationInformation,
                AssetLocationInformation.asset_id == AssetMaster.id,
            ).where(AssetLocationInformation.plant_id == plant_id)

        rows = self._db.scalars(base).unique().all()
        headers = [
            "Asset code",
            "Asset name",
            "Plant",
            "Inventory count",
            "Physical count",
            "Difference",
        ]
        data = []
        for asset in rows:
            inv = asset.inventory
            loc = asset.location
            if not inv or inv.inventory_count is None or inv.physical_count is None:
                continue
            diff = int(inv.physical_count) - int(inv.inventory_count)
            data.append(
                [
                    asset.asset_code,
                    asset.asset_name,
                    loc.plant.name if loc and loc.plant else "",
                    str(inv.inventory_count),
                    str(inv.physical_count),
                    str(diff),
                ]
            )
        return ReportDocument(
            title="Inventory mismatch",
            subtitle=f"Generated {datetime.now().strftime('%Y-%m-%d %H:%M')} · {len(data)} assets",
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
