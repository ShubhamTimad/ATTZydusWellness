"""Validate asset import rows (file upload or corrected grid resubmit)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from modules.assets.import_row_mapper import normalize_import_row
from modules.assets.model import AssetCategory, AssetMaster
from modules.platform.org_units.model import OrgUnit
from modules.assets.schema import ImportPreviewRow


def _cell_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def apply_import_validation(db: Session, rows: list[ImportPreviewRow]) -> list[ImportPreviewRow]:
    """Enrich rows with field_errors, duplicate flags, and valid status."""
    codes_in_file: dict[str, list[int]] = {}
    rfids_in_file: dict[str, list[int]] = {}

    for row in rows:
        code = _cell_str(row.data.get("asset_code")).upper()
        if code:
            codes_in_file.setdefault(code, []).append(row.row_number)
        rfid = _cell_str(row.data.get("rfid_code"))
        if rfid:
            rfids_in_file.setdefault(rfid, []).append(row.row_number)

    for row in rows:
        field_errors: dict[str, str] = {}
        errors: list[str] = []
        duplicate_asset_code = False
        duplicate_rfid_code = False

        name = _cell_str(row.data.get("asset_name"))
        if not name:
            field_errors["asset_name"] = "Asset name is required."

        code = _cell_str(row.data.get("asset_code")).upper()
        if not code:
            field_errors["asset_code"] = "Asset code is required."
        else:
            if len(codes_in_file.get(code, [])) > 1:
                field_errors["asset_code"] = "Duplicate asset code in this file."
                duplicate_asset_code = True
            elif db.scalar(
                select(AssetMaster.id).where(
                    AssetMaster.asset_code == code,
                    AssetMaster.deleted_at.is_(None),
                )
            ):
                field_errors["asset_code"] = "Asset code already exists in the system."
                duplicate_asset_code = True

        rfid = _cell_str(row.data.get("rfid_code"))
        if rfid:
            if len(rfids_in_file.get(rfid, [])) > 1:
                field_errors["rfid_code"] = "Duplicate RFID in this file."
                duplicate_rfid_code = True
            elif db.scalar(
                select(AssetMaster.id).where(
                    AssetMaster.rfid_code == rfid,
                    AssetMaster.deleted_at.is_(None),
                )
            ):
                field_errors["rfid_code"] = "RFID already exists in the system."
                duplicate_rfid_code = True

        cat_code = _cell_str(row.data.get("category_code"))
        if cat_code:
            cat = db.scalar(
                select(AssetCategory).where(
                    func.lower(AssetCategory.code) == cat_code.lower(),
                    AssetCategory.is_active.is_(True),
                )
            )
            if cat is None:
                field_errors["category_code"] = "Unknown asset category code."

        plant_code = _cell_str(row.data.get("plant_code"))
        if plant_code:
            plant = db.scalar(
                select(OrgUnit).where(
                    func.lower(OrgUnit.code) == plant_code.lower(),
                    OrgUnit.type == "PLANT",
                )
            )
            if plant is None:
                field_errors["plant_code"] = "Unknown plant code."

        if field_errors:
            errors = list(dict.fromkeys(field_errors.values()))

        row.field_errors = field_errors
        row.errors = errors
        row.duplicate_asset_code = duplicate_asset_code
        row.duplicate_rfid_code = duplicate_rfid_code
        row.valid = len(field_errors) == 0

        if row.valid and code:
            row.data["asset_code"] = code

    return rows


def rows_from_raw_dicts(
    raw_rows: list[dict[str, Any]],
    *,
    row_numbers: list[int] | None = None,
) -> list[ImportPreviewRow]:
    out: list[ImportPreviewRow] = []
    for idx, raw in enumerate(raw_rows):
        rn = (
            int(raw.get("row_number"))
            if raw.get("row_number") is not None
            else (row_numbers[idx] if row_numbers and idx < len(row_numbers) else idx + 2)
        )
        payload = raw.get("data") if isinstance(raw.get("data"), dict) else raw
        data = normalize_import_row(dict(payload))
        out.append(
            ImportPreviewRow(
                row_number=rn,
                valid=False,
                errors=[],
                field_errors={},
                data=data,
            )
        )
    return out


def build_preview_response(
    *,
    filename: str | None,
    rows: list[ImportPreviewRow],
) -> dict[str, Any]:
    valid = sum(1 for r in rows if r.valid)
    total = len(rows)
    return {
        "filename": filename,
        "total_rows": total,
        "valid_rows": valid,
        "error_rows": total - valid,
        "rows": rows,
    }
