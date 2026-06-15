"""Validate asset import rows (file upload or corrected grid resubmit)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from modules.assets.field_definitions import required_import_field_errors
from modules.assets.import_parser import is_blank_import_row
from modules.assets.import_master_resolve import ImportMasterLookups
from modules.assets.import_row_mapper import normalize_import_row
from modules.assets.model import AssetCategory, AssetMaster
from modules.assets.schema import ImportPreviewRow


def _validate_location_masters(
    lookups: ImportMasterLookups,
    field_errors: dict[str, str],
    *,
    plant_code: str,
    cost_center_code: str,
    profit_center_code: str,
    functional_location_code: str,
    actual_location_code: str,
) -> None:
    plant = lookups.resolve_plant(plant_code) if plant_code else None
    if plant_code and plant is None:
        field_errors["plant_code"] = "Unknown plant."
        return

    plant_id = int(plant.id) if plant is not None else None
    cc_row = None
    fl_row = None

    if cost_center_code:
        cc_row, err = lookups.resolve_cost_center(plant_id=plant_id, value=cost_center_code)
        if err:
            field_errors["cost_center"] = err
        elif cc_row is not None and plant_id is None:
            plant_id = int(cc_row.plant_id)

    if functional_location_code:
        fl_row, err = lookups.resolve_functional_location(
            plant_id=plant_id,
            value=functional_location_code,
        )
        if err:
            field_errors["functional_location"] = err
        elif fl_row is not None and plant_id is None:
            plant_id = int(fl_row.plant_id)

    if cc_row and fl_row and int(cc_row.plant_id) != int(fl_row.plant_id):
        field_errors["functional_location"] = (
            "Functional location does not belong to the same plant as the cost center."
        )

    if profit_center_code:
        if not cost_center_code:
            field_errors["profit_center"] = "Cost center is required when profit center is provided."
        elif "cost_center" not in field_errors:
            if cc_row is None:
                cc_row, err = lookups.resolve_cost_center(plant_id=plant_id, value=cost_center_code)
                if err:
                    field_errors["cost_center"] = err
            if cc_row is not None:
                _, err = lookups.resolve_profit_center(
                    cost_center_id=int(cc_row.id),
                    value=profit_center_code,
                )
                if err:
                    field_errors["profit_center"] = err

    if plant is not None:
        if cc_row is not None and int(cc_row.plant_id) != int(plant.id):
            field_errors["cost_center"] = "Cost center does not belong to this plant."
        if fl_row is not None and int(fl_row.plant_id) != int(plant.id):
            field_errors["functional_location"] = "Functional location does not belong to this plant."

    if actual_location_code:
        if not functional_location_code:
            field_errors["actual_location"] = "Functional location is required when actual location is provided."
        elif "functional_location" not in field_errors:
            if fl_row is None:
                fl_row, err = lookups.resolve_functional_location(
                    plant_id=plant_id,
                    value=functional_location_code,
                )
                if err:
                    field_errors["functional_location"] = err
            if fl_row is not None:
                _, err = lookups.resolve_actual_location(
                    functional_location_id=int(fl_row.id),
                    value=actual_location_code,
                )
                if err:
                    field_errors["actual_location"] = err


def _cell_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def apply_import_validation(db: Session, rows: list[ImportPreviewRow]) -> list[ImportPreviewRow]:
    """Enrich rows with field_errors, duplicate flags, and valid status."""
    lookups = ImportMasterLookups(db)
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

        field_errors.update(required_import_field_errors(row.data))

        code = _cell_str(row.data.get("asset_code")).upper()
        if code:
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
            if lookups.resolve_category(cat_code) is None:
                field_errors["category_code"] = "Unknown asset category."

        plant_code = _cell_str(row.data.get("plant_code"))
        cost_center_code = _cell_str(row.data.get("cost_center"))
        profit_center_code = _cell_str(row.data.get("profit_center"))
        functional_location_code = _cell_str(row.data.get("functional_location"))
        actual_location_code = _cell_str(row.data.get("actual_location"))
        _validate_location_masters(
            lookups,
            field_errors,
            plant_code=plant_code,
            cost_center_code=cost_center_code,
            profit_center_code=profit_center_code,
            functional_location_code=functional_location_code,
            actual_location_code=actual_location_code,
        )

        tag_color_code = _cell_str(row.data.get("tag_color_code"))
        if tag_color_code:
            if not rfid:
                field_errors["tag_color_code"] = "Tag color is only allowed when an RFID code is provided."
            elif lookups.resolve_tag_color(tag_color_code) is None:
                field_errors["tag_color_code"] = "Unknown tag color."

        asset_custodian_code = _cell_str(row.data.get("asset_custodian_code"))
        if asset_custodian_code and lookups.resolve_custodian(asset_custodian_code) is None:
            field_errors["asset_custodian_code"] = "Unknown asset custodian."

        asset_condition_code = _cell_str(row.data.get("asset_condition_code"))
        if asset_condition_code and lookups.resolve_condition(asset_condition_code) is None:
            field_errors["asset_condition_code"] = "Unknown asset condition."

        if field_errors:
            errors = list(dict.fromkeys(field_errors.values()))

        row.field_errors = field_errors
        row.errors = errors
        row.duplicate_asset_code = duplicate_asset_code
        row.duplicate_rfid_code = duplicate_rfid_code
        row.valid = len(field_errors) == 0

        if row.valid and code:
            row.data["asset_code"] = code
        if row.valid:
            row.data = lookups.normalize_row_codes(row.data)

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
        if is_blank_import_row(data):
            continue
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
