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
from modules.assets.service import AssetMasterService  # noqa: E402


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


def test_set_asset_custodian_assigns_relationship() -> None:
    """FK-only updates leave a previously-loaded None relationship stale (expire_on_commit=False)."""
    user = SimpleNamespace(id=5, is_active=True, username="operator", full_name="Operator Demo")
    svc = AssetMasterService.__new__(AssetMasterService)
    svc._db = SimpleNamespace(get=lambda _model, _id: user)
    asset = SimpleNamespace(asset_custodian_id=None, asset_custodian=None)

    svc._set_asset_custodian(asset, 5)
    assert asset.asset_custodian_id == 5
    assert asset.asset_custodian is user

    svc._set_asset_custodian(asset, None)
    assert asset.asset_custodian_id is None
    assert asset.asset_custodian is None


if __name__ == "__main__":
    test_asset_custodian_fk_targets_users()
    test_import_resolves_custodian_username_or_full_name()
    test_set_asset_custodian_assigns_relationship()
    print("ok")
