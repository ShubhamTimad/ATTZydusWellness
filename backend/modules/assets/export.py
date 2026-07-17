"""Excel export for asset register."""

from __future__ import annotations

import io
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

from modules.assets.field_definitions import ASSET_EXPORT_FIELD_LABELS
from modules.assets.model import AssetMaster


def _format_cell(value: Any) -> str | int | float | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return value


def asset_export_value(asset: AssetMaster, field: str) -> Any:
    loc = asset.location
    fin = asset.financial
    inv = asset.inventory
    plant = loc.plant if loc else None
    category = asset.category
    tag = asset.tag_color
    custodian = asset.asset_custodian
    condition = asset.asset_condition

    values: dict[str, Any] = {
        "asset_name": asset.asset_name,
        "asset_class": asset.asset_class,
        "asset_type": asset.asset_type,
        "asset_code": asset.asset_code,
        "combined_asset_number": asset.combined_asset_number,
        "remark": asset.remark,
        "sub_no": asset.sub_no,
        "rfid_code": asset.rfid_code,
        "serial_no": asset.serial_no,
        "asset_description": asset.information.asset_description if asset.information else None,
        "category_code": category.code if category else None,
        "category_name": category.name if category else None,
        "tag_color_code": tag.code if tag else None,
        "asset_custodian_code": custodian.username if custodian else None,
        "asset_condition_code": condition.code if condition else None,
        "sub_location": loc.sub_location if loc else None,
        "functional_location": loc.functional_location if loc else None,
        "actual_location": loc.actual_location if loc else None,
        "plant_code": plant.code if plant else None,
        "plant_name": plant.name if plant else None,
        "cost_center": fin.cost_center if fin else None,
        "party_details": fin.party_details if fin else None,
        "invoice_no": fin.invoice_no if fin else None,
        "invoice_date": fin.invoice_date if fin else None,
        "voucher_no": fin.voucher_no if fin else None,
        "voucher_date": fin.voucher_date if fin else None,
        "grn_date": fin.grn_date if fin else None,
        "grn_no": fin.grn_no if fin else None,
        "put_to_use_date": fin.put_to_use_date if fin else None,
        "depreciation_rate": fin.depreciation_rate if fin else None,
        "gross_block": fin.gross_block if fin else None,
        "life_span": fin.life_span if fin else None,
        "profit_center": fin.profit_center if fin else None,
        "inventory_count": inv.inventory_count if inv else 1,
        "physical_count": inv.physical_count if inv else None,
        "last_verification_date": inv.last_verification_date if inv else None,
        "lifecycle_status": asset.lifecycle_status,
        "approval_status": asset.approval_status,
        "source_type": asset.source_type,
    }
    return values.get(field)


def build_asset_export_xlsx(assets: list[AssetMaster], fields: list[str]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Assets"

    headers = [ASSET_EXPORT_FIELD_LABELS.get(key, key.replace("_", " ").title()) for key in fields]
    ws.append(headers)
    for col_idx, _ in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx)
        cell.font = Font(bold=True)

    for asset in assets:
        ws.append([_format_cell(asset_export_value(asset, key)) for key in fields])

    for col_idx, key in enumerate(fields, start=1):
        letter = get_column_letter(col_idx)
        max_len = len(headers[col_idx - 1])
        for row in ws.iter_rows(min_col=col_idx, max_col=col_idx, min_row=2):
            val = row[0].value
            if val is not None:
                max_len = max(max_len, min(len(str(val)), 48))
        ws.column_dimensions[letter].width = max(10, min(max_len + 2, 42))

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
