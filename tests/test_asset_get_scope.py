"""Opening an asset must not disguise scope denial as 'not found'."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from modules.assets.service import AssetMasterService
from modules.errors import PermissionDeniedError
from modules.platform.users.scope import ViewerOrgScope


def test_out_of_scope_asset_is_forbidden(monkeypatch: pytest.MonkeyPatch) -> None:
    svc = AssetMasterService.__new__(AssetMasterService)
    svc._db = object()
    monkeypatch.setattr(
        "modules.assets.service.load_viewer_org_scope",
        lambda _db, _uid: ViewerOrgScope(frozenset({1}), frozenset({(1, "CC-1")}), frozenset({1})),
    )
    monkeypatch.setattr(svc, "_can_view_all_assets", lambda _uid: False)
    asset = SimpleNamespace(
        id=42,
        location=SimpleNamespace(plant_id=2),
        financial=SimpleNamespace(cost_center="CC-1"),
    )
    with pytest.raises(PermissionDeniedError, match="assigned plants"):
        svc._assert_asset_in_viewer_scope(asset, viewer_user_id=7)


def test_in_scope_asset_is_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    svc = AssetMasterService.__new__(AssetMasterService)
    svc._db = object()
    monkeypatch.setattr(
        "modules.assets.service.load_viewer_org_scope",
        lambda _db, _uid: ViewerOrgScope(frozenset({1}), frozenset({(1, "CC-1")}), frozenset({1})),
    )
    monkeypatch.setattr(svc, "_can_view_all_assets", lambda _uid: False)
    asset = SimpleNamespace(
        id=42,
        location=SimpleNamespace(plant_id=1),
        financial=SimpleNamespace(cost_center="CC-1"),
    )
    svc._assert_asset_in_viewer_scope(asset, viewer_user_id=7)


def test_get_asset_does_not_sync_transfer_lifecycles(monkeypatch: pytest.MonkeyPatch) -> None:
    svc = AssetMasterService.__new__(AssetMasterService)
    asset = object()
    monkeypatch.setattr(svc, "_load_asset", lambda _asset_id: asset)
    monkeypatch.setattr(svc, "_assert_asset_in_viewer_scope", lambda *_a, **_k: None)
    monkeypatch.setattr(svc, "_to_detail", lambda *_a, **_k: "ok")

    def boom(*_a, **_k):
        raise AssertionError("transfer lifecycle sync must not run on get_asset")

    monkeypatch.setattr("modules.transfers.service.sync_open_transfer_asset_lifecycles", boom)
    assert svc.get_asset(1, viewer_user_id=1) == "ok"
