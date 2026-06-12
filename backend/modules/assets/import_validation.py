"""Validate asset import rows (file upload or corrected grid resubmit)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from modules.assets.field_definitions import required_import_field_errors
from modules.assets.import_row_mapper import normalize_import_row
from modules.assets.model import AssetCategory, AssetMaster
from modules.asset_masters.model import (
    ActualLocationMaster,
    CostCenterMaster,
    FunctionalLocationMaster,
    ProfitCenterMaster,
)
from modules.asset_masters.model import TagColorMaster
from modules.platform.org_units.model import OrgUnit
from modules.assets.schema import ImportPreviewRow


class _LocationMasterLookups:
    def __init__(self, db: Session) -> None:
        self.plant_by_code: dict[str, OrgUnit] = {
            str(p.code).lower(): p
            for p in db.scalars(select(OrgUnit).where(OrgUnit.type == "PLANT")).all()
        }
        self.cost_center_by_plant_code: dict[tuple[int, str], CostCenterMaster] = {
            (int(cc.plant_id), str(cc.code).lower()): cc
            for cc in db.scalars(
                select(CostCenterMaster).where(CostCenterMaster.is_active.is_(True))
            ).all()
        }
        self.functional_by_plant_code: dict[tuple[int, str], FunctionalLocationMaster] = {
            (int(fl.plant_id), str(fl.code).lower()): fl
            for fl in db.scalars(
                select(FunctionalLocationMaster).where(FunctionalLocationMaster.is_active.is_(True))
            ).all()
        }
        self.actual_by_fl_code: dict[tuple[int, str], ActualLocationMaster] = {
            (int(al.functional_location_id), str(al.code).lower()): al
            for al in db.scalars(
                select(ActualLocationMaster).where(ActualLocationMaster.is_active.is_(True))
            ).all()
        }
        self.profit_center_by_cc_code: dict[tuple[int, str], ProfitCenterMaster] = {
            (int(pc.cost_center_id), str(pc.code).lower()): pc
            for pc in db.scalars(
                select(ProfitCenterMaster).where(ProfitCenterMaster.is_active.is_(True))
            ).all()
        }

    def resolve_plant(self, plant_code: str) -> OrgUnit | None:
        if not plant_code:
            return None
        return self.plant_by_code.get(plant_code.lower())

    def resolve_cost_center(
        self, *, plant_id: int | None, code: str
    ) -> tuple[CostCenterMaster | None, str | None]:
        key = code.lower()
        if plant_id is not None:
            row = self.cost_center_by_plant_code.get((plant_id, key))
            if row is None:
                return None, "Cost center not found for this plant."
            return row, None
        matches = [cc for (pid, c), cc in self.cost_center_by_plant_code.items() if c == key]
        if not matches:
            return None, "Unknown cost center code."
        if len(matches) > 1:
            return None, "Cost center exists on multiple plants; specify plant."
        return matches[0], None

    def resolve_functional_location(
        self, *, plant_id: int | None, code: str
    ) -> tuple[FunctionalLocationMaster | None, str | None]:
        key = code.lower()
        if plant_id is not None:
            row = self.functional_by_plant_code.get((plant_id, key))
            if row is None:
                return None, "Functional location not found for this plant."
            return row, None
        matches = [fl for (pid, c), fl in self.functional_by_plant_code.items() if c == key]
        if not matches:
            return None, "Unknown functional location code."
        if len(matches) > 1:
            return None, "Functional location exists on multiple plants; specify plant."
        return matches[0], None

    def resolve_actual_location(
        self, *, functional_location_id: int, code: str
    ) -> tuple[ActualLocationMaster | None, str | None]:
        row = self.actual_by_fl_code.get((functional_location_id, code.lower()))
        if row is None:
            return None, "Actual location not found under this functional location."
        return row, None

    def resolve_profit_center(
        self, *, cost_center_id: int | None, code: str
    ) -> tuple[ProfitCenterMaster | None, str | None]:
        key = code.lower()
        if cost_center_id is not None:
            row = self.profit_center_by_cc_code.get((cost_center_id, key))
            if row is None:
                return None, "Profit center not found for this cost center."
            return row, None
        matches = [pc for (cc_id, c), pc in self.profit_center_by_cc_code.items() if c == key]
        if not matches:
            return None, "Unknown profit center code."
        if len(matches) > 1:
            return None, "Profit center exists under multiple cost centers; specify cost center."
        return matches[0], None


def _validate_location_masters(
    lookups: _LocationMasterLookups,
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
        field_errors["plant_code"] = "Unknown plant code."
        return

    plant_id = int(plant.id) if plant is not None else None
    cc_row: CostCenterMaster | None = None
    fl_row: FunctionalLocationMaster | None = None

    if cost_center_code:
        cc_row, err = lookups.resolve_cost_center(plant_id=plant_id, code=cost_center_code)
        if err:
            field_errors["cost_center"] = err
        elif cc_row is not None and plant_id is None:
            plant_id = int(cc_row.plant_id)

    if functional_location_code:
        fl_row, err = lookups.resolve_functional_location(plant_id=plant_id, code=functional_location_code)
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
                cc_row, err = lookups.resolve_cost_center(plant_id=plant_id, code=cost_center_code)
                if err:
                    field_errors["cost_center"] = err
            if cc_row is not None:
                _, err = lookups.resolve_profit_center(
                    cost_center_id=int(cc_row.id),
                    code=profit_center_code,
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
                    plant_id=plant_id, code=functional_location_code
                )
                if err:
                    field_errors["functional_location"] = err
            if fl_row is not None:
                _, err = lookups.resolve_actual_location(
                    functional_location_id=int(fl_row.id),
                    code=actual_location_code,
                )
                if err:
                    field_errors["actual_location"] = err


def _cell_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def apply_import_validation(db: Session, rows: list[ImportPreviewRow]) -> list[ImportPreviewRow]:
    """Enrich rows with field_errors, duplicate flags, and valid status."""
    lookups = _LocationMasterLookups(db)
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
            cat = db.scalar(
                select(AssetCategory).where(
                    func.lower(AssetCategory.code) == cat_code.lower(),
                    AssetCategory.is_active.is_(True),
                )
            )
            if cat is None:
                field_errors["category_code"] = "Unknown asset category code."

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
            else:
                tc = db.scalar(
                    select(TagColorMaster).where(
                        func.lower(TagColorMaster.code) == tag_color_code.lower(),
                        TagColorMaster.is_active.is_(True),
                    )
                )
                if tc is None:
                    field_errors["tag_color_code"] = "Unknown tag color code."

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
