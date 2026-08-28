"""Asset list search — ILIKE match only on columns shown in the asset list."""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import String, cast, or_, select

from modules.asset_masters.model import (
    ActualLocationMaster,
    CostCenterMaster,
    FunctionalLocationMaster,
)
from modules.assets.model import (
    AssetCategory,
    AssetFinancialInformation,
    AssetInventoryInformation,
    AssetLocationInformation,
    AssetMaster,
)
from modules.platform.org_units.model import OrgUnit

# Keep in sync with frontend ASSET_LIST_COLUMNS / backend ASSET_LIST_COLUMN_KEYS.
DEFAULT_SEARCH_COLUMNS = (
    "asset_code",
    "combined_asset_number",
    "asset_name",
    "rfid_code",
    "category_name",
    "cost_center",
    "functional_location",
    "inventory_count",
    "physical_count",
    "lifecycle_status",
)


def asset_global_search_clause(term: str, columns: Iterable[str] | None = None):
    """Match ``term`` against displayed list-column values only.

    ``columns`` should be the user's visible asset-list columns. When omitted,
    the default list columns are used.
    """
    needle = (term or "").strip()
    if not needle:
        return None
    q = f"%{needle}%"
    keys = {k for k in (columns or DEFAULT_SEARCH_COLUMNS) if k}

    clauses: list = []

    if "asset_code" in keys:
        clauses.append(AssetMaster.asset_code.ilike(q))
    if "combined_asset_number" in keys:
        clauses.append(AssetMaster.combined_asset_number.ilike(q))
    if "asset_name" in keys:
        clauses.append(AssetMaster.asset_name.ilike(q))
    if "rfid_code" in keys:
        clauses.append(AssetMaster.rfid_code.ilike(q))
    if "category_name" in keys:
        clauses.append(
            AssetMaster.asset_category_id.in_(
                select(AssetCategory.id)
                .where(or_(AssetCategory.name.ilike(q), AssetCategory.code.ilike(q)))
                .correlate(None)
            )
        )
    if "plant" in keys:
        clauses.append(
            select(1)
            .select_from(AssetLocationInformation)
            .where(
                AssetLocationInformation.asset_id == AssetMaster.id,
                AssetLocationInformation.plant_id.in_(
                    select(OrgUnit.id)
                    .where(
                        OrgUnit.type == "PLANT",
                        or_(OrgUnit.name.ilike(q), OrgUnit.code.ilike(q)),
                    )
                    .correlate(None)
                ),
            )
            .correlate(AssetMaster)
            .exists()
        )
    if "cost_center" in keys:
        clauses.append(
            select(1)
            .select_from(AssetFinancialInformation)
            .where(
                AssetFinancialInformation.asset_id == AssetMaster.id,
                AssetFinancialInformation.cost_center.ilike(q),
            )
            .correlate(AssetMaster)
            .exists()
        )
    if "cost_center_name" in keys:
        clauses.append(
            select(1)
            .select_from(AssetFinancialInformation)
            .where(
                AssetFinancialInformation.asset_id == AssetMaster.id,
                AssetFinancialInformation.cost_center.in_(
                    select(CostCenterMaster.code)
                    .where(CostCenterMaster.name.ilike(q))
                    .correlate(None)
                ),
            )
            .correlate(AssetMaster)
            .exists()
        )
    if "functional_location" in keys:
        clauses.append(
            select(1)
            .select_from(AssetLocationInformation)
            .where(
                AssetLocationInformation.asset_id == AssetMaster.id,
                or_(
                    AssetLocationInformation.functional_location.ilike(q),
                    AssetLocationInformation.functional_location.in_(
                        select(FunctionalLocationMaster.code)
                        .where(
                            or_(
                                FunctionalLocationMaster.name.ilike(q),
                                FunctionalLocationMaster.code.ilike(q),
                            )
                        )
                        .correlate(None)
                    ),
                ),
            )
            .correlate(AssetMaster)
            .exists()
        )
    if "actual_location" in keys:
        clauses.append(
            select(1)
            .select_from(AssetLocationInformation)
            .where(
                AssetLocationInformation.asset_id == AssetMaster.id,
                or_(
                    AssetLocationInformation.actual_location.ilike(q),
                    AssetLocationInformation.actual_location.in_(
                        select(ActualLocationMaster.code)
                        .where(
                            or_(
                                ActualLocationMaster.name.ilike(q),
                                ActualLocationMaster.code.ilike(q),
                            )
                        )
                        .correlate(None)
                    ),
                ),
            )
            .correlate(AssetMaster)
            .exists()
        )
    if "inventory_count" in keys or "physical_count" in keys or "last_verification_date" in keys:
        inv_parts = []
        if "inventory_count" in keys:
            inv_parts.append(cast(AssetInventoryInformation.inventory_count, String).ilike(q))
        if "physical_count" in keys:
            inv_parts.append(cast(AssetInventoryInformation.physical_count, String).ilike(q))
        if "last_verification_date" in keys:
            inv_parts.append(cast(AssetInventoryInformation.last_verification_date, String).ilike(q))
        clauses.append(
            select(1)
            .select_from(AssetInventoryInformation)
            .where(
                AssetInventoryInformation.asset_id == AssetMaster.id,
                or_(*inv_parts),
            )
            .correlate(AssetMaster)
            .exists()
        )
    if "lifecycle_status" in keys:
        # Status pill uses lifecycle + approval (Draft / Pending / Approved / …).
        clauses.append(AssetMaster.lifecycle_status.ilike(q))
        clauses.append(AssetMaster.approval_status.ilike(q))

    if not clauses:
        return None
    return or_(*clauses)
