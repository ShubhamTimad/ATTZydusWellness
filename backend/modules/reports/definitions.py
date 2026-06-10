from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ReportFilterDef:
    key: str
    label: str
    kind: str  # plant | category | cost_center | functional_location | actual_location | order_status | fy_status | financial_year
    required: bool = False


@dataclass(frozen=True)
class ReportDefinition:
    key: str
    title: str
    description: str
    filters: tuple[ReportFilterDef, ...]
    formats: tuple[str, ...] = ("xlsx", "pdf")


REPORT_DEFINITIONS: tuple[ReportDefinition, ...] = (
    ReportDefinition(
        key="asset_register",
        title="Asset register",
        description="Build a custom Excel report — filter assets and pick the columns you need.",
        filters=(),
        formats=(),
    ),
    ReportDefinition(
        key="financial_year_verification",
        title="Financial year physical verification",
        description="RFID-tagged assets with physical verification status for a selected financial year.",
        filters=(
            ReportFilterDef("fy_start_year", "Financial year", "financial_year"),
            ReportFilterDef("plant_id", "Plant", "plant"),
            ReportFilterDef("fy_status", "Physical verification", "fy_status"),
        ),
    ),
    ReportDefinition(
        key="physical_orders_summary",
        title="Physical orders",
        description="Physical verification orders with status, assignee, and asset counts.",
        filters=(
            ReportFilterDef("plant_id", "Plant", "plant"),
            ReportFilterDef("status", "Order status", "order_status"),
        ),
    ),
)


def report_by_key(key: str) -> ReportDefinition | None:
    normalized = key.strip().lower()
    for report in REPORT_DEFINITIONS:
        if report.key == normalized:
            return report
    return None
