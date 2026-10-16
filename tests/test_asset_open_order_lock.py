"""Block delete/deactivate while an asset is on an open physical order."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from modules.errors import ConflictError
from modules.assets.service import AssetMasterService
from modules.assets.schema import AssetActivePhysicalOrderPublic


def test_assert_blocks_open_physical_order(monkeypatch: pytest.MonkeyPatch) -> None:
    svc = AssetMasterService(SimpleNamespace())  # type: ignore[arg-type]
    asset = SimpleNamespace(id=1, asset_code="A-1", lifecycle_status="active")

    monkeypatch.setattr(
        svc,
        "_orders_for_assets_by_status",
        lambda *_a, **_k: {
            1: AssetActivePhysicalOrderPublic(
                order_id=9,
                order_number="PO-9",
                order_status="in_progress",
                closed_at=None,
                has_closure_workflow=False,
            )
        },
    )

    with pytest.raises(ConflictError, match="open physical order PO-9"):
        svc._assert_asset_not_on_open_order(asset)  # type: ignore[arg-type]


def test_assert_allows_when_no_open_order(monkeypatch: pytest.MonkeyPatch) -> None:
    svc = AssetMasterService(SimpleNamespace())  # type: ignore[arg-type]
    asset = SimpleNamespace(id=1, asset_code="A-1", lifecycle_status="active")

    monkeypatch.setattr(svc, "_orders_for_assets_by_status", lambda *_a, **_k: {})
    svc._assert_asset_not_on_open_order(asset)  # type: ignore[arg-type]


def test_assert_blocks_pending_transfer() -> None:
    svc = AssetMasterService(SimpleNamespace())  # type: ignore[arg-type]
    asset = SimpleNamespace(id=1, asset_code="A-1", lifecycle_status="pending_transfer")
    with pytest.raises(ConflictError, match="open transfer"):
        svc._assert_asset_not_on_open_order(asset)  # type: ignore[arg-type]
