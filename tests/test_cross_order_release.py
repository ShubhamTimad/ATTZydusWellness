"""An asset is free for another order once the step before Close is done."""

from __future__ import annotations

from modules.orders.conflicts import (
    asset_free_for_new_order,
    disposal_hold_statuses,
    transfer_hold_statuses,
)


def test_hold_statuses_release_before_close() -> None:
    assert "confirmed_by_cf" not in transfer_hold_statuses()
    assert "received_by_cc2" in transfer_hold_statuses()
    assert "pending_cf_close" not in disposal_hold_statuses()
    assert "pending_receipt" in disposal_hold_statuses()


def test_pending_transfer_free_only_once_confirmed() -> None:
    assert asset_free_for_new_order("active", 1, set())
    assert asset_free_for_new_order("pending_transfer", 1, {1})
    assert not asset_free_for_new_order("pending_transfer", 1, set())
    assert not asset_free_for_new_order("pending_disposal", 1, {1})
    assert not asset_free_for_new_order("disposed", 1, {1})
