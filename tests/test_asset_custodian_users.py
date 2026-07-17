"""Asset custodians are active platform users, not asset-master rows."""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import db.models  # noqa: E402,F401
from modules.assets.import_master_resolve import _pick_unique_by_code_or_name  # noqa: E402
from modules.assets.model import AssetMaster  # noqa: E402


def test_asset_custodian_fk_targets_users() -> None:
    targets = {
        fk.target_fullname
        for fk in AssetMaster.__table__.c.asset_custodian_id.foreign_keys
    }
    assert targets == {"users.id"}


def test_import_resolves_custodian_username_or_full_name() -> None:
    users = [
        SimpleNamespace(id=1, username="operator", full_name="Plant Operator"),
        SimpleNamespace(id=2, username="manager", full_name="Plant Manager"),
    ]
    by_username, error = _pick_unique_by_code_or_name(
        users,
        "operator",
        code_attr="username",
        name_attr="full_name",
        label="asset custodian",
    )
    assert error is None and by_username.id == 1

    by_name, error = _pick_unique_by_code_or_name(
        users,
        "Plant Manager",
        code_attr="username",
        name_attr="full_name",
        label="asset custodian",
    )
    assert error is None and by_name.id == 2


if __name__ == "__main__":
    test_asset_custodian_fk_targets_users()
    test_import_resolves_custodian_username_or_full_name()
    print("ok")
