"""Validate asset import rows (file upload or corrected grid resubmit)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from modules.assets.field_definitions import (
    ASSET_NUMBER_SPECIAL_CHARS_MSG,
    asset_number_has_special_chars,
    required_import_field_errors,
)
from modules.assets.import_parser import is_blank_import_row
from modules.assets.import_master_resolve import ImportMasterLookups
from modules.assets.import_row_mapper import normalize_import_row
from modules.assets.model import AssetMaster
from modules.assets.schema import ImportPreviewRow
from modules.capex.constants import STATUS_APPROVED
from modules.capex.model import CapitalizationForm


def _cell_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _merge_cost_center_columns(
    data: dict[str, Any],
    lookups: ImportMasterLookups,
    field_errors: dict[str, str],
    *,
    plant_id: int | None,
) -> str:
    """Prefer Cost Center Code; accept Name alone; error if both resolve to different masters."""
    code_val = _cell_str(data.get("cost_center"))
    name_val = _cell_str(data.get("cost_center_name"))
    if not code_val and not name_val:
        return ""
    if code_val and name_val:
        row_code, err_code = lookups.resolve_cost_center(plant_id=plant_id, value=code_val)
        row_name, err_name = lookups.resolve_cost_center(plant_id=plant_id, value=name_val)
        if err_code:
            field_errors["cost_center"] = err_code
        if err_name:
            field_errors["cost_center_name"] = err_name
        if (
            row_code is not None
            and row_name is not None
            and int(row_code.id) != int(row_name.id)
        ):
            field_errors["cost_center_name"] = (
                "Cost Center Name does not match Cost Center Code."
            )
        if row_code is not None:
            data["cost_center"] = str(row_code.code)
            data["cost_center_name"] = str(row_code.name or row_code.code)
        else:
            data["cost_center"] = code_val
        return _cell_str(data.get("cost_center"))
    chosen = code_val or name_val
    row, err = lookups.resolve_cost_center(plant_id=plant_id, value=chosen)
    if err:
        field_errors["cost_center" if code_val else "cost_center_name"] = err
        data["cost_center"] = chosen
        return chosen
    if row is not None:
        data["cost_center"] = str(row.code)
        data["cost_center_name"] = str(row.name or row.code)
        return str(row.code)
    data["cost_center"] = chosen
    return chosen


def _merge_plant_columns(
    data: dict[str, Any],
    lookups: ImportMasterLookups,
    field_errors: dict[str, str],
) -> str:
    """Prefer Plant Code; accept Name alone; error if both resolve to different plants."""
    code_val = _cell_str(data.get("plant_code"))
    name_val = _cell_str(data.get("plant_name"))
    if not code_val and not name_val:
        return ""
    if code_val and name_val:
        plant_code = lookups.resolve_plant(code_val)
        plant_name = lookups.resolve_plant(name_val)
        if plant_code is None:
            field_errors["plant_code"] = "Unknown plant."
        if plant_name is None:
            field_errors["plant_name"] = "Unknown plant."
        if (
            plant_code is not None
            and plant_name is not None
            and int(plant_code.id) != int(plant_name.id)
        ):
            field_errors["plant_name"] = "Plant Name does not match Plant Code."
        if plant_code is not None:
            data["plant_code"] = str(plant_code.code)
            data["plant_name"] = str(plant_code.name or plant_code.code)
        else:
            data["plant_code"] = code_val
        return _cell_str(data.get("plant_code"))
    chosen = code_val or name_val
    plant = lookups.resolve_plant(chosen)
    if plant is None:
        field_errors["plant_code" if code_val else "plant_name"] = "Unknown plant."
        data["plant_code"] = chosen
        return chosen
    data["plant_code"] = str(plant.code)
    data["plant_name"] = str(plant.name or plant.code)
    return str(plant.code)


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
            field_errors.setdefault("cost_center", err)
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


def apply_import_validation(db: Session, rows: list[ImportPreviewRow]) -> list[ImportPreviewRow]:
    """Enrich rows with field_errors, duplicate flags, and valid status."""
    lookups = ImportMasterLookups(db)
    cans_in_file: dict[str, list[int]] = {}
    codes_in_file: dict[str, list[int]] = {}
    rfids_in_file: dict[str, list[int]] = {}
    capex_in_file: dict[str, list[int]] = {}

    for row in rows:
        can = _cell_str(row.data.get("combined_asset_number")).upper()
        if can:
            cans_in_file.setdefault(can, []).append(row.row_number)
        code = _cell_str(row.data.get("asset_code")).upper()
        if code:
            codes_in_file.setdefault(code, []).append(row.row_number)
        rfid = _cell_str(row.data.get("rfid_code"))
        if rfid:
            rfids_in_file.setdefault(rfid, []).append(row.row_number)
        capex_no = _cell_str(row.data.get("capitalization_form_number")).upper()
        if capex_no:
            capex_in_file.setdefault(capex_no, []).append(row.row_number)

    for row in rows:
        field_errors: dict[str, str] = {}
        errors: list[str] = []
        duplicate_asset_code = False
        duplicate_combined_asset_number = False
        duplicate_rfid_code = False

        # Accept companion name columns alone before required-field checks.
        if not _cell_str(row.data.get("plant_code")) and _cell_str(row.data.get("plant_name")):
            row.data["plant_code"] = row.data.get("plant_name")
        if not _cell_str(row.data.get("cost_center")) and _cell_str(row.data.get("cost_center_name")):
            row.data["cost_center"] = row.data.get("cost_center_name")

        field_errors.update(required_import_field_errors(row.data, db=db))

        can = _cell_str(row.data.get("combined_asset_number")).upper()
        if can and asset_number_has_special_chars(can):
            field_errors["combined_asset_number"] = ASSET_NUMBER_SPECIAL_CHARS_MSG
        elif can:
            if len(cans_in_file.get(can, [])) > 1:
                field_errors["combined_asset_number"] = "Duplicate Combined Asset No in this file."
                duplicate_combined_asset_number = True
            elif db.scalar(
                select(AssetMaster.id).where(
                    AssetMaster.combined_asset_number == can,
                    AssetMaster.deleted_at.is_(None),
                )
            ):
                field_errors["combined_asset_number"] = "Combined Asset No already exists in the system."
                duplicate_combined_asset_number = True

        code = _cell_str(row.data.get("asset_code")).upper()
        if not code:
            field_errors["asset_code"] = "Asset Number is required."
        elif asset_number_has_special_chars(code):
            field_errors["asset_code"] = ASSET_NUMBER_SPECIAL_CHARS_MSG

        rfid = _cell_str(row.data.get("rfid_code"))
        if rfid:
            if len(rfids_in_file.get(rfid, [])) > 1:
                field_errors["rfid_code"] = "Duplicate RFID in this file."
                duplicate_rfid_code = True
            elif db.scalar(select(AssetMaster.id).where(AssetMaster.rfid_code == rfid)):
                field_errors["rfid_code"] = "RFID already exists in the system."
                duplicate_rfid_code = True

        cat_code = _cell_str(row.data.get("category_code"))
        if cat_code:
            if lookups.resolve_category(cat_code) is None:
                field_errors["category_code"] = "Unknown asset category."

        plant_code = _merge_plant_columns(row.data, lookups, field_errors)
        plant = lookups.resolve_plant(plant_code) if plant_code else None
        plant_id = int(plant.id) if plant is not None else None
        cost_center_code = _merge_cost_center_columns(
            row.data,
            lookups,
            field_errors,
            plant_id=plant_id,
        )
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
        asset_class_code = _cell_str(row.data.get("asset_class_code"))
        if asset_class_code and lookups.resolve_asset_class(asset_class_code) is None:
            field_errors["asset_class_code"] = "Unknown asset class."

        capex_no = _cell_str(row.data.get("capitalization_form_number"))
        if capex_no:
            key = capex_no.upper()
            if len(capex_in_file.get(key, [])) > 1:
                field_errors["capitalization_form_number"] = (
                    "Duplicate CapEx form number in this file."
                )
            else:
                form = db.scalar(
                    select(CapitalizationForm).where(
                        func.upper(CapitalizationForm.form_number) == key
                    )
                )
                if form is None:
                    field_errors["capitalization_form_number"] = (
                        "Unknown capitalization form number."
                    )
                elif form.status != STATUS_APPROVED:
                    field_errors["capitalization_form_number"] = (
                        "Only an approved capitalization form can be linked."
                    )
                elif form.asset_id is not None:
                    field_errors["capitalization_form_number"] = (
                        "This capitalization form is already linked to an asset."
                    )
                else:
                    row.data["capitalization_form_id"] = int(form.id)
                    row.data["capitalization_form_number"] = form.form_number

        if field_errors:
            errors = list(dict.fromkeys(field_errors.values()))

        row.field_errors = field_errors
        row.errors = errors
        row.duplicate_asset_code = duplicate_asset_code
        row.duplicate_combined_asset_number = duplicate_combined_asset_number
        row.duplicate_rfid_code = duplicate_rfid_code
        row.valid = len(field_errors) == 0

        if row.valid and can:
            row.data["combined_asset_number"] = can
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
