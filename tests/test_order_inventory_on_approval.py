"""Inventory & verification posts only after approval, not on scan."""

from __future__ import annotations

from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

from modules.orders.constants import ITEM_STATUS_APPROVED, ITEM_STATUS_REJECTED
from modules.orders.service import PhysicalOrderService


def test_scan_does_not_call_inventory_helpers_directly() -> None:
    """Guard: posting helper requires scan_time + non-rejected status."""
    svc = PhysicalOrderService.__new__(PhysicalOrderService)
    svc._db = MagicMock()
    svc._inventory_already_posted_for_order = MagicMock(return_value=False)  # type: ignore[method-assign]

    no_scan = SimpleNamespace(
        scan_time=None,
        verification_status=ITEM_STATUS_APPROVED,
        asset_id=1,
        asset=None,
    )
    assert (
        svc._post_inventory_verification_for_item(  # type: ignore[arg-type]
            no_scan, SimpleNamespace(id=9), actor_user_id=1
        )
        is False
    )

    rejected = SimpleNamespace(
        scan_time=datetime(2026, 8, 4, tzinfo=timezone.utc),
        verification_status=ITEM_STATUS_REJECTED,
        asset_id=1,
        asset=None,
    )
    assert (
        svc._post_inventory_verification_for_item(  # type: ignore[arg-type]
            rejected, SimpleNamespace(id=9), actor_user_id=1
        )
        is False
    )


def test_post_inventory_updates_physical_count_and_date() -> None:
    svc = PhysicalOrderService.__new__(PhysicalOrderService)
    svc._db = MagicMock()
    svc._inventory_already_posted_for_order = MagicMock(return_value=False)  # type: ignore[method-assign]

    inv = SimpleNamespace(physical_count=0, last_verification_date=None)
    asset = SimpleNamespace(id=7, inventory=inv)
    item = SimpleNamespace(
        scan_time=datetime(2026, 8, 4, 12, 0, tzinfo=timezone.utc),
        verification_status=ITEM_STATUS_APPROVED,
        asset_id=7,
        asset=asset,
    )
    order = SimpleNamespace(id=3, order_number="PVO-1")

    posted: list[dict] = []

    def fake_log(db, **kwargs):
        posted.append(kwargs)

    import modules.orders.service as order_service_mod

    original = order_service_mod.log_asset_physically_verified
    order_service_mod.log_asset_physically_verified = fake_log  # type: ignore[assignment]
    try:
        assert (
            svc._post_inventory_verification_for_item(  # type: ignore[arg-type]
                item, order, actor_user_id=2
            )
            is True
        )
    finally:
        order_service_mod.log_asset_physically_verified = original

    assert inv.physical_count == 1
    assert inv.last_verification_date == date(2026, 8, 4)
    assert len(posted) == 1
