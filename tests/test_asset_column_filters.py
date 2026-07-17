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


if __name__ == "__main__":
    test_blank_filters_add_nothing()
    test_text_columns_use_ilike()
    test_related_columns_use_subqueries()
    print("ok")
