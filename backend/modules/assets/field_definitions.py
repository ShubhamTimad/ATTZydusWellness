"""Canonical asset master fields and Excel/CSV column aliases."""

from __future__ import annotations

import re
from typing import Any

# Letters, digits, hyphen only — no spaces or other punctuation.
_ASSET_NUMBER_RE = re.compile(r"^[A-Za-z0-9\-]+$")
ASSET_NUMBER_SPECIAL_CHARS_MSG = "Special characters are not allowed."


def asset_number_has_special_chars(value: str) -> bool:
    """True when a non-empty asset / combined asset number has disallowed characters."""
    s = value.strip()
    return bool(s) and _ASSET_NUMBER_RE.fullmatch(s) is None


def normalize_asset_number_field(value: str | None) -> str | None:
    """Strip, uppercase, and reject special characters. Empty → None."""
    if value is None:
        return None
    s = value.strip().upper()
    if not s:
        return None
    if asset_number_has_special_chars(s):
        raise ValueError(ASSET_NUMBER_SPECIAL_CHARS_MSG)
    return s

# Excel headers (case-insensitive) -> canonical import key
IMPORT_COLUMN_ALIASES: dict[str, list[str]] = {
    "asset_name": ["asset name", "asset_name"],
    "asset_class_code": [
        "Asset class",
        "asset class code",
        "asset_class",
        "asset_class_code",
        "class",
        "class code",
    ],
    "asset_type": ["asset type", "asset_type"],
    "category_code": [
        "asset category",
        "asset category / group",
        "asset category/group",
        "asset category code",
        "category",
        "category code",
        "category_code",
    ],
    "asset_code": [
        "asset number",
        "asset no",
        "asset no.",
        "asset code",
        "asset_code",
        "code",
    ],
    "combined_asset_number": [
        "combined asset no",
        "combined asset number",
        "combined_asset_number",
        "combined asset no.",
        "can",
    ],
    "remark": ["remark", "remarks", "notes", "asset remark", "asset remarks"],
    "sub_no": ["sub-no", "sub no", "sub_no", "sub number", "sub-number"],
    "asset_description": [
        "asset description",
        "asset_description",
        "description",
    ],
    "rfid_code": ["rfid code", "rfid_code", "rfid", "rfid tag", "uhf_rfid_code"],
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
        "physical condition of assets",
    ],
    "sub_location": ["sub location", "sub_location", "sublocation"],
    "cost_center": [
        "cost center",
        "cost center code",
        "cost_center",
        "cost_center_code",
    ],
    "cost_center_name": [
        "cost center name",
        "cost_center_name",
        "cost centre name",
    ],
    "capitalization_form_number": [
        "capex form number",
        "capitalization form number",
        "capitalization form no",
        "capex form no",
        "capitalization_form_number",
        "capex_form_number",
    ],
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
    "plant_code": ["plant code", "plant_code", "plant"],
    "plant_name": ["plant name", "plant_name", "plant description"],
    # Legacy / optional
    "functional_location": [
        "actual location 1",
        "functional location",
        "functional_location",
    ],
    "actual_location": [
        "actual location 2",
        "actual location",
        "actual_location",
    ],
    "profit_center": ["profit center", "profit_center"],
    "serial_no": ["serial", "serial no", "serial_no"],
}

ASSET_FIELD_LABELS: dict[str, str] = {
    "asset_name": "Asset name",
    "asset_class_code": "Asset class",
    "asset_class_id": "Asset class",
    "asset_type": "Asset type",
    "asset_category_id": "Asset category",
    "asset_code": "Asset Number",
    "combined_asset_number": "Combined Asset No",
    "remark": "Asset Remark",
    "sub_no": "Sub-No",
    "rfid_code": "RFID Code",
    "tag_color_code": "Tag color",
    "asset_custodian_id": "Asset Custodian",
    "asset_custodian_code": "Asset Custodian",
    "asset_condition_id": "Asset Physical Condition",
    "asset_condition_code": "Asset Physical Condition",
    "sub_location": "Sub location",
    "plant_id": "Plant Name",
    "plant_code": "Plant Code",
    "plant_name": "Plant Name",
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
    "capitalization_form_number": "CapEx form number",
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
    }
)

ASSET_REQUIRED_MANUAL_FIELD_KEYS: frozenset[str] = frozenset(
    {
        "asset_name",
        "combined_asset_number",
        "asset_category_id",
        "plant_id",
        "cost_center",
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
                label = "Plant Code"
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
    text_values = {
        "asset_name": asset_name,
        "combined_asset_number": combined_asset_number,
        "cost_center": cost_center,
    }
    for key in ASSET_REQUIRED_MANUAL_FIELD_KEYS:
        if key in ("asset_category_id", "plant_id"):
            continue
        if not _required_text(text_values.get(key)):
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
    "asset_class_code",
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
    "plant_name",
    "cost_center",
    "cost_center_name",
    "profit_center",
    "functional_location",
    "actual_location",
    "sub_location",
    "capitalization_form_number",
    "party_details",
    "invoice_no",
    "invoice_date",
    "voucher_no",
    "voucher_date",
    "grn_date",
    "grn_no",
    "put_to_use_date",
    "depreciation_rate",
    "gross_block",
    "life_span",
]

# Asset register PDF — fixed A4 columns.
ASSET_REGISTER_PDF_FIELDS: list[str] = [
    "asset_name",
    "asset_class_code",
    "category_code",
    "combined_asset_number",
    "cost_center",
    "asset_custodian_code",
    "asset_condition_code",
    "gross_block",
]

ASSET_REGISTER_PDF_LABELS: dict[str, str] = {
    "asset_name": "Asset Name",
    "asset_class_code": "Asset Class",
    "category_code": "Asset Category",
    "combined_asset_number": "Combined Asset No",
    "cost_center": "Cost Center",
    "asset_custodian_code": "Asset Custodian",
    "asset_condition_code": "Physical Condition",
    "gross_block": "APC-IGAAP",
}

# Asset register Excel pre-selection.
ASSET_REGISTER_DEFAULT_FIELDS: list[str] = [
    "asset_name",
    "asset_description",
    "asset_class_code",
    "category_code",
    "rfid_code",
    "combined_asset_number",
    "plant_name",
    "functional_location",
    "actual_location",
    "cost_center",
    "asset_custodian_code",
    "asset_condition_code",
    "party_details",
    "inventory_count",
    "cap_date",
    "life_span",
    "gross_block",
]

# Default export columns (matches import grid / Assets → Export dialog).
ASSET_EXPORT_DEFAULT_FIELDS: list[str] = [
    "asset_name",
    "asset_class_code",
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
    "asset_class_code",
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
    "cap_date",
    "pm_equipment_id",
    "cost_center_name",
    "capitalization_form_number",
    "fy_verification_count",
    "physical_order_id",
    "physical_order_status",
    "current_apc_igaap",
]

ASSET_EXPORT_FIELD_LABELS: dict[str, str] = {
    **ASSET_FIELD_LABELS,
    "category_code": "Asset Category",
    "plant_code": "Plant Code",
    "plant_name": "Plant Name",
    "category_name": "Category description",
    "physical_count": "Physical Count",
    "last_verification_date": "Last Verification Date",
    "lifecycle_status": "Lifecycle Status",
    "approval_status": "Approval Status",
    "source_type": "Source Type",
    "serial_no": "Serial No.",
    "pm_equipment_id": "PM Equipment ID",
    "fy_verification_count": "Verifications This FY",
    "physical_order_id": "Physical Order ID",
    "physical_order_status": "Order Status",
    "current_apc_igaap": "Current APC-IGAAP",
    "rfid_code": "RFID Code",
    "asset_condition_code": "Asset Physical Condition",
    "life_span": "Useful life",
    "gross_block": "APC-IGAAP",
}


def import_field_header_label(key: str, *, db: Any | None = None) -> str:
    """Import template headers: canonical labels + import-only required asterisks.

    Do not use create-form field_config.is_required for import asterisks.
    ``db`` is kept for call-site compatibility; labels come from export/import maps.
    """
    _ = db
    label = ASSET_EXPORT_FIELD_LABELS.get(key, key.replace("_", " ").title())
    if key in ASSET_REQUIRED_IMPORT_FIELD_KEYS:
        return f"{label} *"
    return label


def _register_template_header_aliases() -> None:
    """Keep parser aliases in sync with download-template / export titles."""
    for key, label in ASSET_EXPORT_FIELD_LABELS.items():
        aliases = IMPORT_COLUMN_ALIASES.get(key)
        if aliases is None:
            continue
        text = (label or "").strip()
        if not text:
            continue
        lower = {a.strip().lower() for a in aliases}
        if text.lower() not in lower:
            aliases.append(text)


_register_template_header_aliases()
