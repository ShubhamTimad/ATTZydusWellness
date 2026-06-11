"""Guardrails before deleting asset reference masters."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from modules.asset_masters.model import (
    ActualLocationMaster,
    CostCenterMaster,
    FunctionalLocationMaster,
    ProfitCenterMaster,
    TagColorMaster,
)
from modules.assets.model import (
    AssetCategory,
    AssetFinancialInformation,
    AssetLocationInformation,
    AssetMaster,
)
from modules.errors import ConflictError


class MasterInUseError(ConflictError):
    """Master row cannot be deleted while referenced by assets or child masters."""


def _active_asset_count(stmt) -> int:
    return int(stmt or 0)


def assert_category_deletable(db: Session, category_id: int) -> None:
    row = db.get(AssetCategory, category_id)
    if row is None:
        return
    count = db.scalar(
        select(func.count())
        .select_from(AssetMaster)
        .where(
            AssetMaster.deleted_at.is_(None),
            AssetMaster.asset_category_id == category_id,
        )
    )
    if _active_asset_count(count) > 0:
        raise MasterInUseError(
            "Cannot delete this category while assets are assigned to it. "
            "Reassign or remove those assets first."
        )


def assert_tag_color_deletable(db: Session, row_id: int) -> None:
    row = db.get(TagColorMaster, row_id)
    if row is None:
        return
    count = db.scalar(
        select(func.count())
        .select_from(AssetMaster)
        .where(
            AssetMaster.deleted_at.is_(None),
            AssetMaster.tag_color_id == row_id,
        )
    )
    if _active_asset_count(count) > 0:
        raise MasterInUseError(
            "Cannot delete this tag color while assets are assigned to it. "
            "Reassign or remove those assets first."
        )


def assert_cost_center_deletable(db: Session, row: CostCenterMaster) -> None:
    child_count = db.scalar(
        select(func.count())
        .select_from(ProfitCenterMaster)
        .where(ProfitCenterMaster.cost_center_id == row.id)
    )
    if _active_asset_count(child_count) > 0:
        raise MasterInUseError(
            "Cannot delete this cost center while profit centers exist under it. "
            "Remove child profit centers first."
        )
    asset_count = db.scalar(
        select(func.count())
        .select_from(AssetMaster)
        .join(AssetLocationInformation, AssetLocationInformation.asset_id == AssetMaster.id)
        .join(AssetFinancialInformation, AssetFinancialInformation.asset_id == AssetMaster.id)
        .where(
            AssetMaster.deleted_at.is_(None),
            AssetLocationInformation.plant_id == row.plant_id,
            AssetFinancialInformation.cost_center == row.code,
        )
    )
    if _active_asset_count(asset_count) > 0:
        raise MasterInUseError(
            "Cannot delete this cost center while assets use it. "
            "Reassign those assets first."
        )


def assert_profit_center_deletable(db: Session, row: ProfitCenterMaster) -> None:
    cc = db.get(CostCenterMaster, row.cost_center_id)
    if cc is None:
        return
    asset_count = db.scalar(
        select(func.count())
        .select_from(AssetMaster)
        .join(AssetLocationInformation, AssetLocationInformation.asset_id == AssetMaster.id)
        .join(AssetFinancialInformation, AssetFinancialInformation.asset_id == AssetMaster.id)
        .where(
            AssetMaster.deleted_at.is_(None),
            AssetLocationInformation.plant_id == cc.plant_id,
            AssetFinancialInformation.profit_center == row.code,
        )
    )
    if _active_asset_count(asset_count) > 0:
        raise MasterInUseError(
            "Cannot delete this profit center while assets use it. "
            "Reassign those assets first."
        )


def assert_functional_location_deletable(db: Session, row: FunctionalLocationMaster) -> None:
    child_count = db.scalar(
        select(func.count())
        .select_from(ActualLocationMaster)
        .where(ActualLocationMaster.functional_location_id == row.id)
    )
    if _active_asset_count(child_count) > 0:
        raise MasterInUseError(
            "Cannot delete this functional location while actual locations exist under it. "
            "Remove child actual locations first."
        )
    asset_count = db.scalar(
        select(func.count())
        .select_from(AssetMaster)
        .join(AssetLocationInformation, AssetLocationInformation.asset_id == AssetMaster.id)
        .where(
            AssetMaster.deleted_at.is_(None),
            AssetLocationInformation.plant_id == row.plant_id,
            AssetLocationInformation.functional_location == row.code,
        )
    )
    if _active_asset_count(asset_count) > 0:
        raise MasterInUseError(
            "Cannot delete this functional location while assets use it. "
            "Reassign those assets first."
        )


def assert_actual_location_deletable(db: Session, row: ActualLocationMaster) -> None:
    fl = db.get(FunctionalLocationMaster, row.functional_location_id)
    if fl is None:
        return
    asset_count = db.scalar(
        select(func.count())
        .select_from(AssetMaster)
        .join(AssetLocationInformation, AssetLocationInformation.asset_id == AssetMaster.id)
        .where(
            AssetMaster.deleted_at.is_(None),
            AssetLocationInformation.plant_id == fl.plant_id,
            AssetLocationInformation.functional_location == fl.code,
            AssetLocationInformation.actual_location == row.code,
        )
    )
    if _active_asset_count(asset_count) > 0:
        raise MasterInUseError(
            "Cannot delete this actual location while assets use it. "
            "Reassign those assets first."
        )
