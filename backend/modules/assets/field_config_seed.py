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
    _row("asset_name", "Asset Name"),
    _row("asset_class", "Asset Class"),
    _row("asset_class_id", "Asset Class"),
    _row("asset_class_code", "Asset Class"),
    _row("asset_type", "Asset Type"),
    _row("asset_category_id", "Asset Category"),
    _row("category_code", "Asset Category"),
    _row("asset_code", "Asset Number"),
    _row("combined_asset_number", "Combined Asset No"),
    _row("remark", "Asset Remark"),
    _row("sub_no", "Sub-No"),
    _row("rfid_code", "RFID Code"),
    _row("tag_color_id", "Tag Color", is_visible=False),
    _row("tag_color_code", "Tag Color", is_visible=False),
    _row("asset_custodian_id", "Asset Custodian"),
    _row("asset_custodian_code", "Asset Custodian"),
    _row("asset_condition_id", "Asset Physical Condition"),
    _row("asset_condition_code", "Asset Physical Condition"),
    _row("serial_no", "Serial No."),
    _row("ownership_type", "Ownership Type"),
    _row("inventory_no", "Inventory No."),
    _row("asset_description", "Asset Description"),
    _row("engineering_description", "Engineering Description"),
    _row("qa_description", "QA Description"),
    _row("asset_allocation", "Asset Allocation"),
    _row("pm_equipment_id", "PM Equipment ID"),
    _row("plant_id", "Plant Name"),
    _row("plant_code", "Plant Code"),
    _row("plant_name", "Plant Name"),
    _row("sub_location", "Sub Location", is_visible=False),
    _row("functional_location", "Actual Location 1"),
    _row("actual_location", "Actual Location 2"),
    _row("building", "Building", is_visible=False),
    _row("floor", "Floor", is_visible=False),
    _row("room", "Room", is_visible=False),
    _row("zone", "Zone", is_visible=False),
    _row("cost_center", "Cost Center Code"),
    _row("cost_center_name", "Cost Center Name"),
    _row("capitalization_form_number", "CapEx Form Number"),
    _row("profit_center", "Profit Center", is_visible=False),
    _row("laboratory", "Laboratory", is_visible=False),
    _row("party_details", "Party Details"),
    _row("invoice_no", "Invoice No.", is_visible=False),
    _row("invoice_date", "Invoice Date", is_visible=False),
    _row("voucher_no", "Voucher No.", is_visible=False),
    _row("voucher_date", "Voucher Date", is_visible=False),
    _row("grn_no", "GRN No.", is_visible=False),
    _row("grn_date", "GRN Date", is_visible=False),
    _row("put_to_use_date", "Put to Use", is_visible=False),
    _row("cap_date", "Capitalization Date"),
    _row("depreciation_rate", "Rate of Depreciation", is_visible=False),
    _row("gross_block", "APC-IGAAP"),
    _row("life_span", "Life-Span (Years)"),
    _row("vendor_name", "Vendor Name", is_visible=False),
    _row("po_number", "PO Number", is_visible=False),
    _row("currency", "Currency", is_visible=False),
    _row("inventory_count", "Inventory Count"),
    _row("physical_count", "Physical Count"),
    _row("last_verification_date", "Last Verification Date"),
    _row("fy_verification_count", "Verifications This FY"),
    _row("physical_order_id", "Physical Order ID"),
    _row("physical_order_status", "Order Status"),
    _row("verification_status", "Verification Status"),
    _row("verification_remarks", "Verification Remarks"),
    _row("category_name", "Category Description"),
    _row("lifecycle_status", "Lifecycle Status"),
    _row("approval_status", "Approval Status"),
    _row("source_type", "Source"),
]
