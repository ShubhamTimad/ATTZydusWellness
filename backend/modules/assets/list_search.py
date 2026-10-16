"""Asset list search — ILIKE match only on columns shown in the asset list."""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import String, and_, cast, or_, select

from core.label_search import normalize_search_needle
from modules.asset_masters.model import (
    ActualLocationMaster,
    AssetClassMaster,
    AssetConditionMaster,
    CostCenterMaster,
    FunctionalLocationMaster,
)
from modules.assets.model import (
    AssetCategory,
    AssetFinancialInformation,
    AssetInformation,
    AssetInventoryInformation,
    AssetLocationInformation,
    AssetMaster,
)
from modules.orders.constants import ACTIVE_ORDER_STATUSES, status_codes_matching_search
from modules.orders.model import PhysicalOrder, PhysicalOrderItem
from modules.platform.org_units.model import OrgUnit
from modules.platform.users.model import User

# Display labels from frontend assetStatusLabel → match approval/lifecycle codes.
_ASSET_STATUS_LABEL_MATCHES: tuple[tuple[str, str | None, str | None], ...] = (
    # needle substring, approval_status (None=any), lifecycle_status (None=any)
    ("disposed", None, "disposed"),
    ("pending disposal", None, "pending_disposal"),
    ("pending transfer", None, "pending_transfer"),
    ("deactivated", None, "deactivated"),
    ("pending approval", "pending", None),
    ("rejected", "rejected", None),
    ("approved", "approved", None),
    ("draft", "draft", None),
)


def _asset_status_search_clauses(raw_term: str):
    """OR clauses matching UI status badges (not only raw DB codes)."""
    needle = normalize_search_needle(raw_term)
    if not needle:
        return []
    parts = []
    for label, approval, lifecycle in _ASSET_STATUS_LABEL_MATCHES:
        life_raw = (lifecycle or "").replace("_", " ")
        if needle not in label and needle not in (approval or "") and needle not in life_raw:
            continue
        conds = []
        if approval is not None:
            if approval == "approved":
                conds.append(AssetMaster.approval_status.in_(("approved", "not_required")))
            else:
                conds.append(AssetMaster.approval_status == approval)
        if lifecycle is not None:
            conds.append(AssetMaster.lifecycle_status == lifecycle)
        elif approval is not None:
            # Badge statuses for approval apply when not in a terminal lifecycle.
            conds.append(
                ~AssetMaster.lifecycle_status.in_(
                    ("disposed", "pending_disposal", "pending_transfer", "deactivated")
                )
            )
        if conds:
            parts.append(and_(*conds) if len(conds) > 1 else conds[0])
    # Also keep raw ILIKE on codes for partial code typing.
    underscore = needle.replace(" ", "_")
    parts.append(AssetMaster.lifecycle_status.ilike(f"%{underscore}%"))
    parts.append(AssetMaster.approval_status.ilike(f"%{underscore}%"))
    parts.append(AssetMaster.lifecycle_status.ilike(f"%{needle}%"))
    parts.append(AssetMaster.approval_status.ilike(f"%{needle}%"))
    return parts

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
        # Status pill uses lifecycle + approval (Draft / Pending Approval / …).
        clauses.extend(_asset_status_search_clauses(needle))
    if "sub_no" in keys:
        clauses.append(AssetMaster.sub_no.ilike(q))
    if "asset_type" in keys:
        clauses.append(AssetMaster.asset_type.ilike(q))
    if "asset_class" in keys:
        clauses.append(AssetMaster.asset_class.ilike(q))
        clauses.append(
            AssetMaster.asset_class_id.in_(
                select(AssetClassMaster.id)
                .where(or_(AssetClassMaster.name.ilike(q), AssetClassMaster.code.ilike(q)))
                .correlate(None)
            )
        )
    if "asset_condition" in keys:
        clauses.append(
            AssetMaster.asset_condition_id.in_(
                select(AssetConditionMaster.id)
                .where(
                    or_(AssetConditionMaster.name.ilike(q), AssetConditionMaster.code.ilike(q))
                )
                .correlate(None)
            )
        )
    if "asset_custodian" in keys:
        clauses.append(
            AssetMaster.asset_custodian_id.in_(
                select(User.id)
                .where(or_(User.full_name.ilike(q), User.username.ilike(q)))
                .correlate(None)
            )
        )
    fin_parts = []
    if "party_details" in keys:
        fin_parts.append(AssetFinancialInformation.party_details.ilike(q))
    if "life_span" in keys:
        fin_parts.append(AssetFinancialInformation.life_span.ilike(q))
    if "gross_block" in keys:
        fin_parts.append(cast(AssetFinancialInformation.gross_block, String).ilike(q))
    if "cap_date" in keys:
        fin_parts.append(cast(AssetFinancialInformation.cap_date, String).ilike(q))
    if fin_parts:
        clauses.append(
            select(1)
            .select_from(AssetFinancialInformation)
            .where(
                AssetFinancialInformation.asset_id == AssetMaster.id,
                or_(*fin_parts),
            )
            .correlate(AssetMaster)
            .exists()
        )
    if "pm_equipment_id" in keys:
        clauses.append(
            select(1)
            .select_from(AssetInformation)
            .where(
                AssetInformation.asset_id == AssetMaster.id,
                AssetInformation.pm_equipment_id.ilike(q),
            )
            .correlate(AssetMaster)
            .exists()
        )
    if "physical_order_id" in keys or "physical_order_status" in keys:
        order_parts = []
        if "physical_order_id" in keys:
            order_parts.append(PhysicalOrder.order_number.ilike(q))
        if "physical_order_status" in keys:
            order_parts.append(PhysicalOrder.status.ilike(q))
            status_codes = status_codes_matching_search(needle)
            if status_codes:
                order_parts.append(PhysicalOrder.status.in_(status_codes))
        clauses.append(
            select(1)
            .select_from(PhysicalOrderItem)
            .join(PhysicalOrder, PhysicalOrder.id == PhysicalOrderItem.order_id)
            .where(
                PhysicalOrderItem.asset_id == AssetMaster.id,
                PhysicalOrder.status.in_(tuple(ACTIVE_ORDER_STATUSES)),
                or_(*order_parts),
            )
            .correlate(AssetMaster)
            .exists()
        )

    if not clauses:
        return None
    return or_(*clauses)
