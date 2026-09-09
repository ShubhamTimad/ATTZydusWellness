"""Asset-list columns are validated and stored per user."""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import db.models  # noqa: E402,F401
from modules.assets.service import (  # noqa: E402
    ASSET_LIST_COLUMN_KEYS,
    DEFAULT_ASSET_LIST_COLUMNS,
    AssetMasterService,
)
from modules.platform.users.model import User  # noqa: E402


class _FakeDb:
    def __init__(self, user: SimpleNamespace) -> None:
        self.user = user
        self.committed = False

    def get(self, _model: object, _row_id: int) -> SimpleNamespace:
        return self.user

    def commit(self) -> None:
        self.committed = True


def test_user_model_has_asset_list_columns() -> None:
    column = User.__table__.c.asset_list_columns
    assert column.nullable
    assert column.type.__class__.__name__ == "JSON"


def test_default_columns_are_used_until_user_saves() -> None:
    svc = AssetMasterService(_FakeDb(SimpleNamespace(asset_list_columns=None)))  # type: ignore[arg-type]
    assert svc.get_asset_list_columns(1) == list(DEFAULT_ASSET_LIST_COLUMNS)


def test_columns_are_deduplicated_validated_and_saved() -> None:
    user = SimpleNamespace(asset_list_columns=None)
    db = _FakeDb(user)
    svc = AssetMasterService(db)  # type: ignore[arg-type]
    saved = svc.update_asset_list_columns(1, ["plant_code", "asset_name", "plant_name", "plant_code"])
    assert saved == ["plant_code", "asset_name", "plant_name"]
    assert user.asset_list_columns == saved
    assert db.committed
    assert set(saved) <= ASSET_LIST_COLUMN_KEYS
    assert "remark" not in ASSET_LIST_COLUMN_KEYS
    assert "asset_description" not in ASSET_LIST_COLUMN_KEYS
    assert {
        "sub_no",
        "asset_class",
        "asset_type",
        "asset_condition",
        "asset_custodian",
        "cap_date",
        "gross_block",
        "party_details",
        "life_span",
        "pm_equipment_id",
    } <= ASSET_LIST_COLUMN_KEYS

    try:
        svc.update_asset_list_columns(1, ["unknown"])
    except ValueError:
        pass
    else:
        raise AssertionError("unknown column must be rejected")


if __name__ == "__main__":
    test_user_model_has_asset_list_columns()
    test_default_columns_are_used_until_user_saves()
    test_columns_are_deduplicated_validated_and_saved()
    print("ok")
