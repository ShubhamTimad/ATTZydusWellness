"""Default asset field display config — seeded on migration."""

from __future__ import annotations

from typing import TypedDict


class FieldConfigSeed(TypedDict):
    field_key: str
    display_label: str
    is_visible: bool
    is_required: bool


_REQUIRED = {
    "asset_name",
    "combined_asset_number",
    "asset_category_id",
    "category_code",
    "plant_id",
    "plant_code",
    "cost_center",
    "functional_location",
    "actual_location",
}


def _row(
    field_key: str,
    display_label: str,
    *,
    is_required: bool = False,
    is_visible: bool = True,
) -> FieldConfigSeed:
    required = (is_required or field_key in _REQUIRED) and is_visible
    return {
        "field_key": field_key,
        "display_label": display_label,
        "is_visible": is_visible,
        "is_required": required,
    }


# ponytail: static seed list; add rows + migration when new DB columns ship.
ASSET_FIELD_CONFIG_SEED: list[FieldConfigSeed] = [
    _row("asset_name", "Asset name"),
    _row("asset_class", "Asset class"),
    _row("asset_type", "Asset type"),
    _row("asset_category_id", "Asset category"),
    _row("category_code", "Asset category"),
    _row("asset_code", "Asset Number"),
    _row("combined_asset_number", "Combined Asset No"),
    _row("remark", "Remark"),
    _row("sub_no", "Sub-No"),
    _row("rfid_code", "RFID Code"),
    _row("tag_color_id", "Tag color", is_visible=False),
    _row("tag_color_code", "Tag color", is_visible=False),
    _row("asset_custodian_id", "Asset Custodian"),
    _row("asset_custodian_code", "Asset Custodian"),
    _row("asset_condition_id", "Asset Physical Condition"),
    _row("asset_condition_code", "Asset Physical Condition"),
    _row("serial_no", "Serial no."),
    _row("ownership_type", "Ownership type"),
    _row("inventory_no", "Inventory no."),
    _row("asset_description", "Asset Description"),
    _row("engineering_description", "Engineering description"),
    _row("qa_description", "QA description"),
    _row("asset_allocation", "Asset allocation"),
    _row("pm_equipment_id", "PM equipment ID"),
    _row("plant_id", "Plant Name"),
    _row("plant_code", "Plant Code"),
    _row("plant_name", "Plant Name"),
    _row("sub_location", "Sub location", is_visible=False),
    _row("functional_location", "Actual Location 1"),
    _row("actual_location", "Actual location 2"),
    _row("building", "Building", is_visible=False),
    _row("floor", "Floor", is_visible=False),
    _row("room", "Room"),
    _row("zone", "Zone"),
    _row("cost_center", "Cost Center Code"),
    _row("cost_center_name", "Cost Center Name"),
    _row("capitalization_form_number", "CapEx form number"),
    _row("profit_center", "Profit center", is_visible=False),
    _row("laboratory", "Laboratory", is_visible=False),
    _row("party_details", "Party Details"),
    _row("invoice_no", "Invoice no.", is_visible=False),
    _row("invoice_date", "Invoice date", is_visible=False),
    _row("voucher_no", "Voucher no.", is_visible=False),
    _row("voucher_date", "Voucher date", is_visible=False),
    _row("grn_no", "GRN no.", is_visible=False),
    _row("grn_date", "GRN date", is_visible=False),
    _row("put_to_use_date", "Put to use", is_visible=False),
    _row("cap_date", "Capitalization Date"),
    _row("depreciation_rate", "Rate of depreciation", is_visible=False),
    _row("gross_block", "APC-IGAAP"),
    _row("life_span", "Life-Span (Years)"),
    _row("vendor_name", "Vendor name", is_visible=False),
    _row("po_number", "PO number", is_visible=False),
    _row("currency", "Currency", is_visible=False),
    _row("inventory_count", "Inventory count"),
    _row("physical_count", "Physical count"),
    _row("last_verification_date", "Last verification date"),
    _row("fy_verification_count", "Verifications this FY"),
    _row("physical_order_id", "Physical order ID"),
    _row("physical_order_status", "Order status"),
    _row("verification_status", "Verification status"),
    _row("verification_remarks", "Verification remarks"),
    _row("category_name", "Category description"),
    _row("lifecycle_status", "Lifecycle status"),
    _row("approval_status", "Approval status"),
    _row("source_type", "Source"),
]
