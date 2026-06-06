from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ReportFilterDef:
    key: str
    label: str
    kind: str  # plant | order_status | fy_status
    required: bool = False


@dataclass(frozen=True)
class ReportDefinition:
    key: str
    title: str
    description: str
    filters: tuple[ReportFilterDef, ...]


REPORT_DEFINITIONS: tuple[ReportDefinition, ...] = (
    ReportDefinition(
        key="asset_register",
        title="Asset register",
        description="Full asset master export with location, financial, and inventory fields.",
        filters=(ReportFilterDef("plant_id", "Plant", "plant"),),
    ),
    ReportDefinition(
        key="financial_year_verification",
        title="Financial year verification",
        description="RFID-tagged assets with current financial year verification status.",
        filters=(
            ReportFilterDef("plant_id", "Plant", "plant"),
            ReportFilterDef("fy_status", "FY status", "fy_status"),
        ),
    ),
    ReportDefinition(
        key="physical_orders_summary",
        title="Physical orders summary",
        description="Physical verification orders with status, assignee, and asset counts.",
        filters=(
            ReportFilterDef("plant_id", "Plant", "plant"),
            ReportFilterDef("status", "Order status", "order_status"),
        ),
    ),
    ReportDefinition(
        key="physical_order_details",
        title="Physical order details",
        description="Order line items with scan results and verification status per asset.",
        filters=(
            ReportFilterDef("plant_id", "Plant", "plant"),
            ReportFilterDef("status", "Order status", "order_status"),
        ),
    ),
    ReportDefinition(
        key="inventory_mismatch",
        title="Inventory mismatch",
        description="Assets where inventory count does not match physical count.",
        filters=(ReportFilterDef("plant_id", "Plant", "plant"),),
    ),
)


def report_by_key(key: str) -> ReportDefinition | None:
    normalized = key.strip().lower()
    for report in REPORT_DEFINITIONS:
        if report.key == normalized:
            return report
    return None
