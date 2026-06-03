"""Map import row dicts to asset section payloads."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from modules.assets.field_definitions import IMPORT_DATE_FIELDS, IMPORT_DECIMAL_FIELDS, IMPORT_INT_FIELDS
from modules.assets.schema import (
    AssetFinancialPayload,
    AssetInformationPayload,
    AssetLocationPayload,
)


def _strip(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None


def parse_date_cell(value: Any) -> date | None:
    s = _strip(value)
    if not s:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s[:10], fmt).date()
        except ValueError:
            continue
    return None


def parse_decimal_cell(value: Any) -> Decimal | None:
    s = _strip(value)
    if not s:
        return None
    try:
        return Decimal(str(s).replace(",", ""))
    except (InvalidOperation, ValueError):
        return None


def parse_int_cell(value: Any) -> int | None:
    s = _strip(value)
    if not s:
        return None
    try:
        return int(str(s).replace(",", "").split(".")[0])
    except ValueError:
        return None


def normalize_import_row(raw: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in raw.items():
        if value is None or (isinstance(value, str) and not value.strip()):
            continue
        if key in IMPORT_DATE_FIELDS:
            out[key] = parse_date_cell(value)
        elif key in IMPORT_DECIMAL_FIELDS:
            out[key] = parse_decimal_cell(value)
        elif key in IMPORT_INT_FIELDS:
            out[key] = parse_int_cell(value)
        else:
            out[key] = _strip(value) if isinstance(value, str) else value
    return out


def build_section_payloads(raw: dict[str, Any]) -> dict[str, Any]:
    """Return kwargs for AssetMaster + nested payloads from normalized import row."""
    n = normalize_import_row(raw)
    return {
        "asset_name": n.get("asset_name"),
        "asset_code": str(n.get("asset_code", "")).upper() if n.get("asset_code") else None,
        "rfid_code": n.get("rfid_code"),
        "serial_no": n.get("serial_no"),
        "asset_class": n.get("asset_class"),
        "asset_type": n.get("asset_type"),
        "category_code": n.get("category_code"),
        "tag_color_code": n.get("tag_color_code"),
        "information": AssetInformationPayload(
            inventory_no=n.get("inventory_no"),
            asset_description=n.get("asset_description"),
        ),
        "plant_code": n.get("plant_code"),
        "location": AssetLocationPayload(
            sub_location=n.get("sub_location"),
            functional_location=n.get("functional_location"),
            actual_location=n.get("actual_location"),
        ),
        "financial": AssetFinancialPayload(
            cost_center=n.get("cost_center"),
            profit_center=n.get("profit_center"),
            party_details=n.get("party_details"),
            invoice_no=n.get("invoice_no"),
            invoice_date=n.get("invoice_date"),
            voucher_no=n.get("voucher_no"),
            voucher_date=n.get("voucher_date"),
            grn_no=n.get("grn_no"),
            grn_date=n.get("grn_date"),
            put_to_use_date=n.get("put_to_use_date"),
            depreciation_rate=n.get("depreciation_rate"),
            gross_block=n.get("gross_block"),
            life_span=n.get("life_span"),
            vendor_name=n.get("vendor_name"),
            po_number=n.get("po_number"),
            currency=n.get("currency"),
        ),
    }
