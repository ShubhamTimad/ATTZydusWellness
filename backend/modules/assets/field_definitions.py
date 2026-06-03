"""Canonical asset master fields and Excel/CSV column aliases."""

from __future__ import annotations

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
    "rfid_code": ["rfid code", "rfid_code", "rfid", "uhf_rfid_code"],
    "tag_color_code": ["tag color", "tag color code", "tag_color", "tag_color_code"],
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
    "asset_code": "Asset code",
    "rfid_code": "RFID code",
    "tag_color_code": "Tag color",
    "sub_location": "Sub location",
    "plant_id": "Plant name",
    "cost_center": "Cost center",
    "party_details": "Party details",
    "invoice_no": "Invoice no.",
    "invoice_date": "Invoice date",
    "inventory_count": "Inventory count",
    "voucher_no": "Voucher no.",
    "voucher_date": "Voucher date",
    "grn_date": "GRN date",
    "grn_no": "GRN no.",
    "put_to_use_date": "Put to use",
    "depreciation_rate": "Rate of depreciation",
    "gross_block": "Gross block",
    "life_span": "Life span",
    "functional_location": "Functional location",
    "actual_location": "Actual location",
    "profit_center": "Profit center",
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
