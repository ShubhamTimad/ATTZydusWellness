"""Canonical asset master fields and Excel/CSV column aliases."""

from __future__ import annotations

from typing import Any

# Excel headers (case-insensitive) -> canonical import key
IMPORT_COLUMN_ALIASES: dict[str, list[str]] = {
    "asset_name": ["asset name", "asset_name"],
    "asset_class": ["asset class", "asset_class"],
    "asset_type": ["asset type", "asset_type"],
    "category_code": [
        "asset category",
        "asset category code",
        "category",
        "category code",
        "category_code",
    ],
    "asset_code": ["asset code", "asset_code", "code"],
    "combined_asset_number": [
        "combined asset no",
        "combined asset number",
        "combined_asset_number",
        "combined asset no.",
        "can",
    ],
    "remark": ["remark", "remarks", "notes"],
    "sub_no": ["sub-no", "sub no", "sub_no", "sub number", "sub-number"],
    "asset_description": [
        "asset description",
        "asset_description",
        "description",
    ],
    "rfid_code": ["rfid code", "rfid_code", "rfid", "uhf_rfid_code"],
    "tag_color_code": ["tag color", "tag color code", "tag_color", "tag_color_code"],
    "asset_custodian_code": [
        "asset custodian",
        "asset custodian code",
        "custodian",
        "custodian code",
        "asset_custodian",
        "asset_custodian_code",
    ],
    "asset_condition_code": [
        "asset condition",
        "asset condition code",
        "condition",
        "condition code",
        "asset_condition",
        "asset_condition_code",
    ],
    "sub_location": ["sub location", "sub_location", "sublocation"],
    "cost_center": ["cost center", "cost_center"],
    "party_details": ["party details", "party_details", "party"],
    "invoice_no": ["invoice no", "invoice no.", "invoice_no", "invoice number"],
    "invoice_date": ["invoice date", "invoice_date"],
    "inventory_count": ["inventory count", "inventory_count"],
    "voucher_no": ["voucher no", "voucher no.", "voucher_no"],
    "voucher_date": ["voucher date", "voucher_date"],
    "grn_date": ["grn date", "grn_date"],
    "grn_no": ["grn no", "grn no.", "grn_no"],
    "put_to_use_date": ["put to use", "put to use date", "put_to_use", "put_to_use_date"],
    "depreciation_rate": [
        "rate of depreciation",
        "rate of depreciation %",
        "depreciation rate",
        "depreciation_rate",
    ],
    "gross_block": ["gross block", "gross_block"],
    "life_span": ["life span", "life_span", "lifespan"],
    "plant_code": ["plant name", "plant", "plant code", "plant_code"],
    # Legacy / optional
    "functional_location": ["functional location", "functional_location"],
    "actual_location": ["actual location", "actual_location"],
    "profit_center": ["profit center", "profit_center"],
    "serial_no": ["serial", "serial no", "serial_no"],
}

ASSET_FIELD_LABELS: dict[str, str] = {
    "asset_name": "Asset name",
    "asset_class": "Asset class",
    "asset_type": "Asset type",
    "asset_category_id": "Asset category",
    "asset_code": "Asset Number",
    "combined_asset_number": "Combined Asset No",
    "remark": "Remark",
    "sub_no": "Sub-No",
    "rfid_code": "RFID Code",
    "tag_color_code": "Tag color",
    "asset_custodian_id": "Asset Custodian",
    "asset_custodian_code": "Asset Custodian",
    "asset_condition_id": "Asset Physical Condition",
    "asset_condition_code": "Asset Physical Condition",
    "sub_location": "Sub location",
    "plant_id": "Plant name",
    "cost_center": "Cost Center Code",
    "cost_center_name": "Cost Center Name",
    "party_details": "Party Details",
    "invoice_no": "Invoice no.",
    "invoice_date": "Invoice date",
    "inventory_count": "Inventory count",
    "voucher_no": "Voucher no.",
    "voucher_date": "Voucher date",
    "grn_date": "GRN date",
    "grn_no": "GRN no.",
    "put_to_use_date": "Put to use",
    "depreciation_rate": "Rate of depreciation",
    "gross_block": "APC-IGAAP",
    "life_span": "Life-Span (Years)",
    "functional_location": "Actual Location 1",
    "actual_location": "Actual location 2",
    "profit_center": "Profit center",
    "cap_date": "Capitalization Date",
    "asset_description": "Asset Description",
}

IMPORT_DATE_FIELDS = frozenset(
    {
        "invoice_date",
        "voucher_date",
        "grn_date",
        "put_to_use_date",
    }
)

IMPORT_DECIMAL_FIELDS = frozenset({"gross_block", "depreciation_rate"})

IMPORT_INT_FIELDS = frozenset({"inventory_count"})

# Required for manual create and import (physical order prerequisites; RFID optional at create).
ASSET_REQUIRED_IMPORT_FIELD_KEYS: frozenset[str] = frozenset(
    {
        "asset_name",
        "combined_asset_number",
        "category_code",
        "plant_code",
        "cost_center",
        "functional_location",
        "actual_location",
    }
)

ASSET_REQUIRED_MANUAL_FIELD_KEYS: frozenset[str] = frozenset(
    {
        "asset_name",
        "combined_asset_number",
        "asset_category_id",
        "plant_id",
        "cost_center",
        "functional_location",
        "actual_location",
    }
)


def _required_text(value: Any) -> bool:
    return bool(str(value or "").strip())


def required_import_field_errors(data: dict[str, Any], *, db: Any | None = None) -> dict[str, str]:
    if db is not None:
        from modules.assets.field_config import IMPORT_SCOPE, AssetFieldConfigService, validate_required_fields

        return validate_required_fields(
            AssetFieldConfigService(db),
            data,
            scope_keys=IMPORT_SCOPE,
        )
    errors: dict[str, str] = {}
    for key in ASSET_REQUIRED_IMPORT_FIELD_KEYS:
        if not _required_text(data.get(key)):
            label = ASSET_FIELD_LABELS.get(key, key.replace("_", " ").title())
            if key == "category_code":
                label = "Asset category"
            elif key == "plant_code":
                label = "Plant name"
            errors[key] = f"{label} is required."
    return errors


def required_manual_create_field_errors(
    *,
    asset_name: str,
    asset_code: str = "",
    combined_asset_number: str = "",
    asset_category_id: int | None,
    plant_id: int | None,
    cost_center: str | None,
    profit_center: str | None,
    functional_location: str | None,
    actual_location: str | None,
    db: Any | None = None,
) -> dict[str, str]:
    if db is not None:
        from modules.assets.field_config import MANUAL_CREATE_SCOPE, AssetFieldConfigService, validate_required_fields

        return validate_required_fields(
            AssetFieldConfigService(db),
            {
                "asset_name": asset_name,
                "asset_code": asset_code,
                "combined_asset_number": combined_asset_number,
                "asset_category_id": asset_category_id,
                "plant_id": plant_id,
                "cost_center": cost_center,
                "profit_center": profit_center,
                "functional_location": functional_location,
                "actual_location": actual_location,
            },
            scope_keys=MANUAL_CREATE_SCOPE,
        )
    errors: dict[str, str] = {}
    text_checks = (
        ("asset_name", asset_name),
        ("combined_asset_number", combined_asset_number),
        ("cost_center", cost_center),
        ("profit_center", profit_center),
        ("functional_location", functional_location),
        ("actual_location", actual_location),
    )
    for key, value in text_checks:
        if not _required_text(value):
            label = ASSET_FIELD_LABELS.get(key, key.replace("_", " ").title())
            errors[key] = f"{label} is required."
    if asset_category_id is None:
        errors["asset_category_id"] = "Asset category is required."
    if plant_id is None:
        errors["plant_id"] = "Plant name is required."
    return errors


# Import template column order (plant and parents before dependent dropdowns).
ASSET_IMPORT_TEMPLATE_FIELDS: list[str] = [
    "asset_name",
    "asset_class",
    "asset_type",
    "category_code",
    "combined_asset_number",
    "asset_code",
    "remark",
    "sub_no",
    "asset_description",
    "rfid_code",
    "tag_color_code",
    "asset_custodian_code",
    "asset_condition_code",
    "plant_code",
    "cost_center",
    "profit_center",
    "functional_location",
    "actual_location",
    "sub_location",
    "party_details",
    "invoice_no",
    "invoice_date",
    "inventory_count",
    "voucher_no",
    "voucher_date",
    "grn_date",
    "grn_no",
    "put_to_use_date",
    "depreciation_rate",
    "gross_block",
    "life_span",
    "serial_no",
]

# Default export columns (matches import grid / Assets → Export dialog).
ASSET_EXPORT_DEFAULT_FIELDS: list[str] = [
    "asset_name",
    "asset_class",
    "asset_type",
    "category_code",
    "combined_asset_number",
    "asset_code",
    "remark",
    "sub_no",
    "asset_description",
    "rfid_code",
    "tag_color_code",
    "asset_custodian_code",
    "asset_condition_code",
    "sub_location",
    "functional_location",
    "actual_location",
    "cost_center",
    "party_details",
    "invoice_no",
    "invoice_date",
    "inventory_count",
    "voucher_no",
    "voucher_date",
    "grn_date",
    "grn_no",
    "put_to_use_date",
    "depreciation_rate",
    "gross_block",
    "life_span",
    "plant_code",
]

# Canonical keys for asset Excel export (import-compatible first, then metadata).
ASSET_EXPORT_FIELDS: list[str] = [
    "asset_name",
    "asset_class",
    "asset_type",
    "category_code",
    "combined_asset_number",
    "asset_code",
    "remark",
    "sub_no",
    "asset_description",
    "rfid_code",
    "tag_color_code",
    "asset_custodian_code",
    "asset_condition_code",
    "sub_location",
    "cost_center",
    "party_details",
    "invoice_no",
    "invoice_date",
    "inventory_count",
    "voucher_no",
    "voucher_date",
    "grn_date",
    "grn_no",
    "put_to_use_date",
    "depreciation_rate",
    "gross_block",
    "life_span",
    "plant_code",
    "functional_location",
    "actual_location",
    "profit_center",
    "serial_no",
    "physical_count",
    "last_verification_date",
    "lifecycle_status",
    "approval_status",
    "source_type",
    "plant_name",
    "category_name",
]

ASSET_EXPORT_FIELD_LABELS: dict[str, str] = {
    **ASSET_FIELD_LABELS,
    "category_code": "Asset category",
    "plant_code": "Plant name",
    "plant_name": "Plant description",
    "category_name": "Category description",
    "physical_count": "Physical count",
    "last_verification_date": "Last verification date",
    "lifecycle_status": "Lifecycle status",
    "approval_status": "Approval status",
    "source_type": "Source",
    "serial_no": "Serial no.",
}


def import_field_header_label(key: str, *, db: Any | None = None) -> str:
    if db is not None:
        from modules.assets.field_config import AssetFieldConfigService

        svc = AssetFieldConfigService(db)
        label = svc.label(key)
        if svc.is_required(key):
            return f"{label} *"
        return label
    label = ASSET_EXPORT_FIELD_LABELS.get(key, key.replace("_", " ").title())
    if key in ASSET_REQUIRED_IMPORT_FIELD_KEYS:
        return f"{label} *"
    return label
