"""Self-check: asset deactivate / reactivate eligibility."""

from __future__ import annotations

from types import SimpleNamespace

from modules.assets.lifecycle import (
    LIFECYCLE_ACTIVE,
    LIFECYCLE_DEACTIVATED,
    LIFECYCLE_INACTIVE,
    can_deactivate,
    can_reactivate,
    set_asset_deactivated,
    set_asset_reactivated,
)


def _asset(**kwargs):
    defaults = {
        "lifecycle_status": LIFECYCLE_ACTIVE,
        "approval_status": "approved",
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def test_can_deactivate_only_active_non_pending() -> None:
    assert can_deactivate(_asset()) is True
    assert can_deactivate(_asset(approval_status="not_required")) is True
    assert can_deactivate(_asset(approval_status="pending")) is False
    assert can_deactivate(_asset(lifecycle_status=LIFECYCLE_INACTIVE)) is False
    assert can_deactivate(_asset(lifecycle_status=LIFECYCLE_DEACTIVATED)) is False


def test_can_reactivate_only_deactivated() -> None:
    assert can_reactivate(_asset(lifecycle_status=LIFECYCLE_DEACTIVATED)) is True
    assert can_reactivate(_asset()) is False
    assert can_reactivate(_asset(lifecycle_status=LIFECYCLE_INACTIVE, approval_status="draft")) is False


def test_deactivate_reactivate_roundtrip() -> None:
    asset = _asset()
    change = set_asset_deactivated(asset)
    assert asset.lifecycle_status == LIFECYCLE_DEACTIVATED
    assert change["before"]["lifecycle_status"] == LIFECYCLE_ACTIVE
    assert can_reactivate(asset) is True
    assert can_deactivate(asset) is False

    back = set_asset_reactivated(asset)
    assert asset.lifecycle_status == LIFECYCLE_ACTIVE
    assert back["before"]["lifecycle_status"] == LIFECYCLE_DEACTIVATED
    assert can_deactivate(asset) is True
