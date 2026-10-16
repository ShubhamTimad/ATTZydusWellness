"""Resolve import master-data values by display name or code."""

from __future__ import annotations

from typing import Any, TypeVar

from sqlalchemy import select
from sqlalchemy.orm import Session

from modules.asset_masters.model import (
    ActualLocationMaster,
    AssetClassMaster,
    AssetConditionMaster,
    CostCenterMaster,
    FunctionalLocationMaster,
    ProfitCenterMaster,
    TagColorMaster,
)
from modules.assets.model import AssetCategory
from modules.platform.org_units.model import OrgUnit
from modules.platform.users.model import User

T = TypeVar("T")


def norm_import_value(value: str) -> str:
    return (value or "").strip().lower()


def master_import_label(*, name: str | None, code: str) -> str:
    n = (name or "").strip()
    return n if n else str(code).strip()


def plant_import_label(plant: OrgUnit) -> str:
    return master_import_label(name=plant.name, code=str(plant.code))


def _value_variants(value: str) -> list[str]:
    raw = (value or "").strip()
    if not raw:
        return []
    variants = [raw]
    if " — " in raw:
        left, right = raw.split(" — ", 1)
        variants.extend([left.strip(), right.strip()])
    return [v for v in variants if v]


def _pick_unique_by_code_or_name(
    items: list[T],
    value: str,
    *,
    code_attr: str = "code",
    name_attr: str = "name",
    label: str,
) -> tuple[T | None, str | None]:
    keys = {norm_import_value(v) for v in _value_variants(value)}
    if not keys:
        return None, None

    by_code = [
        item
        for item in items
        if norm_import_value(str(getattr(item, code_attr, "") or "")) in keys
    ]
    if len(by_code) == 1:
        return by_code[0], None
    if len(by_code) > 1:
        return None, f"Ambiguous {label} code."

    by_name = [
        item
        for item in items
        if norm_import_value(str(getattr(item, name_attr, "") or "")) in keys
    ]
    if len(by_name) == 1:
        return by_name[0], None
    if len(by_name) > 1:
        return None, f"Ambiguous {label} name; use a code instead."
    return None, f"Unknown {label}."


class ImportMasterLookups:
    def __init__(self, db: Session) -> None:
        self.plants = list(db.scalars(select(OrgUnit).where(OrgUnit.type == "PLANT")).all())
        self.categories = list(
            db.scalars(select(AssetCategory).where(AssetCategory.is_active.is_(True))).all()
        )
        self.cost_centers = list(
            db.scalars(select(CostCenterMaster).where(CostCenterMaster.is_active.is_(True))).all()
        )
        self.functional_locations = list(
            db.scalars(
                select(FunctionalLocationMaster).where(FunctionalLocationMaster.is_active.is_(True))
            ).all()
        )
        self.actual_locations = list(
            db.scalars(
                select(ActualLocationMaster).where(ActualLocationMaster.is_active.is_(True))
            ).all()
        )
        self.profit_centers = list(
            db.scalars(select(ProfitCenterMaster).where(ProfitCenterMaster.is_active.is_(True))).all()
        )
        self.tag_colors = list(
            db.scalars(select(TagColorMaster).where(TagColorMaster.is_active.is_(True))).all()
        )
        self.custodians = list(
            db.scalars(select(User).where(User.is_active.is_(True))).all()
        )
        self.conditions = list(
            db.scalars(select(AssetConditionMaster).where(AssetConditionMaster.is_active.is_(True))).all()
        )
        self.asset_classes = list(
            db.scalars(select(AssetClassMaster).where(AssetClassMaster.is_active.is_(True))).all()
        )

    def resolve_plant(self, value: str) -> OrgUnit | None:
        row, _ = _pick_unique_by_code_or_name(self.plants, value, label="plant")
        return row

    def resolve_category(self, value: str) -> AssetCategory | None:
        row, _ = _pick_unique_by_code_or_name(self.categories, value, label="asset category")
        return row

    def resolve_tag_color(self, value: str) -> TagColorMaster | None:
        row, _ = _pick_unique_by_code_or_name(self.tag_colors, value, label="tag color")
        return row

    def resolve_custodian(self, value: str) -> User | None:
        row, _ = _pick_unique_by_code_or_name(
            self.custodians,
            value,
            code_attr="username",
            name_attr="full_name",
            label="asset custodian",
        )
        return row

    def resolve_condition(self, value: str) -> AssetConditionMaster | None:
        row, _ = _pick_unique_by_code_or_name(self.conditions, value, label="asset condition")
        return row

    def resolve_asset_class(self, value: str) -> AssetClassMaster | None:
        row, _ = _pick_unique_by_code_or_name(self.asset_classes, value, label="asset class")
        return row

    def resolve_cost_center(
        self, *, plant_id: int | None, value: str
    ) -> tuple[CostCenterMaster | None, str | None]:
        scoped = [
            cc for cc in self.cost_centers if plant_id is None or int(cc.plant_id) == plant_id
        ]
        row, err = _pick_unique_by_code_or_name(scoped, value, label="cost center")
        if err and "Ambiguous" in err:
            return None, err
        if row is not None:
            return row, None
        if plant_id is not None:
            return None, "Cost center not found for this plant."
        global_matches = [
            cc
            for cc in self.cost_centers
            if norm_import_value(value) in {
                norm_import_value(str(cc.code)),
                norm_import_value(str(cc.name)),
            }
        ]
        if len(global_matches) > 1:
            return None, "Cost center exists on multiple plants; specify plant."
        return None, "Unknown cost center."

    def resolve_functional_location(
        self, *, plant_id: int | None, value: str
    ) -> tuple[FunctionalLocationMaster | None, str | None]:
        scoped = [
            fl
            for fl in self.functional_locations
            if plant_id is None or int(fl.plant_id) == plant_id
        ]
        row, err = _pick_unique_by_code_or_name(scoped, value, label="functional location")
        if err and "Ambiguous" in err:
            return None, err
        if row is not None:
            return row, None
        if plant_id is not None:
            return None, "Functional location not found for this plant."
        global_matches = [
            fl
            for fl in self.functional_locations
            if norm_import_value(value) in {
                norm_import_value(str(fl.code)),
                norm_import_value(str(fl.name)),
            }
        ]
        if len(global_matches) > 1:
            return None, "Functional location exists on multiple plants; specify plant."
        return None, "Unknown functional location."

    def resolve_actual_location(
        self, *, functional_location_id: int, value: str
    ) -> tuple[ActualLocationMaster | None, str | None]:
        scoped = [
            al
            for al in self.actual_locations
            if int(al.functional_location_id) == functional_location_id
        ]
        row, err = _pick_unique_by_code_or_name(scoped, value, label="actual location")
        if err and "Ambiguous" in err:
            return None, err
        if row is not None:
            return row, None
        return None, "Actual location not found under this functional location."

    def resolve_profit_center(
        self, *, cost_center_id: int | None, value: str
    ) -> tuple[ProfitCenterMaster | None, str | None]:
        scoped = [
            pc
            for pc in self.profit_centers
            if cost_center_id is None or int(pc.cost_center_id) == cost_center_id
        ]
        row, err = _pick_unique_by_code_or_name(scoped, value, label="profit center")
        if err and "Ambiguous" in err:
            return None, err
        if row is not None:
            return row, None
        if cost_center_id is not None:
            return None, "Profit center not found for this cost center."
        global_matches = [
            pc
            for pc in self.profit_centers
            if norm_import_value(value) in {
                norm_import_value(str(pc.code)),
                norm_import_value(str(pc.name)),
            }
        ]
        if len(global_matches) > 1:
            return None, "Profit center exists under multiple cost centers; specify cost center."
        return None, "Unknown profit center."

    def normalize_row_codes(self, data: dict[str, Any]) -> dict[str, Any]:
        """Rewrite name-based import values to canonical stored codes."""
        out = dict(data)

        plant_value = str(data.get("plant_code") or data.get("plant_name") or "").strip()
        plant = self.resolve_plant(plant_value) if plant_value else None
        if plant is not None:
            out["plant_code"] = str(plant.code)
            out["plant_name"] = str(plant.name or plant.code)

        category_value = str(data.get("category_code") or "").strip()
        if category_value:
            category = self.resolve_category(category_value)
            if category is not None:
                out["category_code"] = str(category.code)

        plant_id = int(plant.id) if plant is not None else None

        cost_center_value = str(
            data.get("cost_center") or data.get("cost_center_name") or ""
        ).strip()
        cc_row = None
        if cost_center_value:
            cc_row, _ = self.resolve_cost_center(plant_id=plant_id, value=cost_center_value)
            if cc_row is not None:
                out["cost_center"] = str(cc_row.code)
                out["cost_center_name"] = str(cc_row.name or cc_row.code)
                if plant_id is None:
                    plant_id = int(cc_row.plant_id)
                    parent_plant = next(
                        (p for p in self.plants if int(p.id) == plant_id),
                        None,
                    )
                    if parent_plant is not None:
                        out["plant_code"] = str(parent_plant.code)
                        out["plant_name"] = str(parent_plant.name or parent_plant.code)

        profit_center_value = str(data.get("profit_center") or "").strip()
        if profit_center_value and cc_row is not None:
            pc_row, _ = self.resolve_profit_center(
                cost_center_id=int(cc_row.id),
                value=profit_center_value,
            )
            if pc_row is not None:
                out["profit_center"] = str(pc_row.code)

        functional_location_value = str(data.get("functional_location") or "").strip()
        fl_row = None
        if functional_location_value:
            fl_row, _ = self.resolve_functional_location(
                plant_id=plant_id,
                value=functional_location_value,
            )
            if fl_row is not None:
                out["functional_location"] = str(fl_row.code)

        actual_location_value = str(data.get("actual_location") or "").strip()
        if actual_location_value and fl_row is not None:
            al_row, _ = self.resolve_actual_location(
                functional_location_id=int(fl_row.id),
                value=actual_location_value,
            )
            if al_row is not None:
                out["actual_location"] = str(al_row.code)

        tag_color_value = str(data.get("tag_color_code") or "").strip()
        if tag_color_value:
            tag_color = self.resolve_tag_color(tag_color_value)
            if tag_color is not None:
                out["tag_color_code"] = str(tag_color.code)

        custodian_value = str(data.get("asset_custodian_code") or "").strip()
        if custodian_value:
            custodian = self.resolve_custodian(custodian_value)
            if custodian is not None:
                out["asset_custodian_code"] = str(custodian.username)

        condition_value = str(data.get("asset_condition_code") or "").strip()
        if condition_value:
            condition = self.resolve_condition(condition_value)
            if condition is not None:
                out["asset_condition_code"] = str(condition.code)

        class_value = str(data.get("asset_class_code") or "").strip()
        if class_value:
            asset_class = self.resolve_asset_class(class_value)
            if asset_class is not None:
                out["asset_class_code"] = str(asset_class.code)

        return out
