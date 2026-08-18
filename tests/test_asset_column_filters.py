"""Per-column list filters translate to the expected SQL predicates."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import db.models  # noqa: E402,F401
from sqlalchemy import select  # noqa: E402

from modules.assets.model import AssetMaster  # noqa: E402
from modules.assets.service import AssetMasterService  # noqa: E402


def _sql(column_filters: dict[str, str]) -> str:
    svc = AssetMasterService.__new__(AssetMasterService)
    base = select(AssetMaster)
    return str(svc._apply_column_filters(base, column_filters))


def test_blank_filters_add_nothing() -> None:
    plain = str(select(AssetMaster))
    assert _sql({}) == plain
    assert _sql({"asset_code": "  ", "category": ""}) == plain


def test_text_columns_use_ilike() -> None:
    sql = _sql({"asset_code": "AST", "asset_name": "pump", "rfid_code": "E2"})
    assert "lower(asset_master.asset_code) LIKE" in sql
    assert "lower(asset_master.asset_name) LIKE" in sql
    assert "lower(asset_master.rfid_code) LIKE" in sql


def test_related_columns_use_subqueries() -> None:
    sql = _sql({"category": "IT", "cost_center": "prod", "functional_location": "line"})
    assert "asset_categories" in sql
    assert "asset_financial_information" in sql and "cost_center_masters" in sql
    assert "asset_location_information" in sql and "functional_location_masters" in sql


def test_count_and_location_columns() -> None:
    sql = _sql({"actual_location": "mezz", "inventory_count": "1", "physical_count": "0"})
    assert "actual_location_masters" in sql
    assert "asset_inventory_information" in sql
    assert "inventory_count" in sql
    assert "physical_count" in sql


def test_approved_list_hides_disposal_lifecycles() -> None:
    from modules.assets.lifecycle import (
        APPROVED_LIST_HIDDEN_LIFECYCLES,
        LIFECYCLE_ACTIVE,
        LIFECYCLE_DISPOSED,
        LIFECYCLE_PENDING_DISPOSAL,
        LIFECYCLE_PENDING_TRANSFER,
    )

    assert LIFECYCLE_PENDING_DISPOSAL in APPROVED_LIST_HIDDEN_LIFECYCLES
    assert LIFECYCLE_PENDING_TRANSFER in APPROVED_LIST_HIDDEN_LIFECYCLES
    assert LIFECYCLE_DISPOSED in APPROVED_LIST_HIDDEN_LIFECYCLES
    assert LIFECYCLE_ACTIVE not in APPROVED_LIST_HIDDEN_LIFECYCLES


if __name__ == "__main__":
    test_blank_filters_add_nothing()
    test_text_columns_use_ilike()
    test_related_columns_use_subqueries()
    test_count_and_location_columns()
    test_approved_list_hides_disposal_lifecycles()
    print("ok")
