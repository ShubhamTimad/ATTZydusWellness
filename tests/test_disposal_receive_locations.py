"""Disposal receive writes a scrapyard location per asset, and lets the receiver park progress."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from modules.disposals.constants import STATUS_PENDING_RECEIPT
from modules.disposals.schema import SaveDisposalLocationsRequest
from modules.disposals.service import (
    DisposalOrderService,
    _apply_receive_assets,
    _changed_item_locations,
    _item_location_snapshot,
    _revert_disposal_assets_after_receive,
)
from modules.errors import ConflictError


def _asset(asset_id: int = 1):
    return SimpleNamespace(
        id=asset_id,
        asset_code=f"A-{asset_id}",
        asset_name="Pump",
        lifecycle_status="pending_disposal",
        approval_status="approved",
        location=SimpleNamespace(
            asset_id=asset_id, plant_id=3, functional_location="OLD-FL", actual_location="OLD-AL"
        ),
        financial=SimpleNamespace(asset_id=asset_id, cost_center="CC-100"),
    )


def _order(*assets, status: str = STATUS_PENDING_RECEIPT):
    return SimpleNamespace(
        id=1,
        order_number="ADO-2026-0001",
        plant_id=3,
        status=status,
        to_cost_center_id=7,
        receiver_user_id=8,
        assigned_to=8,
        items=[
            SimpleNamespace(
                id=i + 1,
                asset_id=a.id,
                asset=a,
                to_functional_location=None,
                to_actual_location=None,
            )
            for i, a in enumerate(assets)
        ],
    )


def _echo_locations(_db, *, plant_id, functional_location, actual_location):
    """Stand in for the scrapyard master lookup, which is exercised by its own DB tests."""
    del plant_id
    return functional_location, actual_location


def test_receive_sends_each_asset_to_its_own_scrapyard_location() -> None:
    a1, a2 = _asset(1), _asset(2)
    order = _order(a1, a2)
    with patch("modules.disposals.service.require_scrapyard_locations", _echo_locations):
        shared = _apply_receive_assets(
            MagicMock(),
            order,
            cost_center_code="SCRAP-01",
            functional_location=None,
            actual_location=None,
            item_locations=[
                {"asset_id": 1, "to_functional_location": "FL-A", "to_actual_location": "AL-A"},
                {"asset_id": 2, "to_functional_location": "FL-B", "to_actual_location": "AL-B"},
            ],
        )
    assert (a1.location.functional_location, a1.location.actual_location) == ("FL-A", "AL-A")
    assert (a2.location.functional_location, a2.location.actual_location) == ("FL-B", "AL-B")
    assert a1.financial.cost_center == a2.financial.cost_center == "SCRAP-01"
    assert (order.items[0].to_functional_location, order.items[0].to_actual_location) == (
        "FL-A",
        "AL-A",
    )
    # Mixed destinations have no single order-level pair to show on the detail page.
    assert shared == (None, None)
    # Receive is the last stage before CF close — assets are disposed now, not at close.
    assert a1.lifecycle_status == a2.lifecycle_status == "disposed"


def test_cf_reject_after_receive_undoes_disposed() -> None:
    a1 = _asset(1)
    a1.lifecycle_status = "disposed"
    order = _order(a1)
    order.items[0].from_cost_center_code = "CC-100"
    order.items[0].from_functional_location = "OLD-FL"
    order.items[0].from_actual_location = "OLD-AL"
    _revert_disposal_assets_after_receive(order)
    assert a1.lifecycle_status == "pending_disposal"
    assert a1.financial.cost_center == "CC-100"


def test_receive_falls_back_to_locations_parked_earlier() -> None:
    a1, a2 = _asset(1), _asset(2)
    order = _order(a1, a2)
    order.items[0].to_functional_location = "FL-A"
    order.items[0].to_actual_location = "AL-A"
    with patch("modules.disposals.service.require_scrapyard_locations", _echo_locations):
        shared = _apply_receive_assets(
            MagicMock(),
            order,
            cost_center_code="SCRAP-01",
            functional_location="FL-A",
            actual_location="AL-A",
            item_locations=None,
        )
    # Asset 1 keeps the saved pair; asset 2 takes the order-level fallback — both agree.
    assert a1.location.functional_location == a2.location.functional_location == "FL-A"
    assert shared == ("FL-A", "AL-A")


def test_receive_names_the_asset_that_is_still_missing_a_location() -> None:
    a1, a2 = _asset(1), _asset(2)
    order = _order(a1, a2)
    order.items[0].to_functional_location = "FL-A"
    order.items[0].to_actual_location = "AL-A"
    with patch("modules.disposals.service.require_scrapyard_locations", _echo_locations):
        with pytest.raises(ConflictError, match="A-2"):
            _apply_receive_assets(
                MagicMock(),
                order,
                cost_center_code="SCRAP-01",
                functional_location=None,
                actual_location=None,
                item_locations=None,
            )


def test_receive_audit_skips_locations_saved_earlier() -> None:
    order = _order(_asset(1), _asset(2))
    for item in order.items:
        item.to_functional_location = "FL-A"
        item.to_actual_location = "AL-A"
    before = _item_location_snapshot(order)
    order.items[1].to_actual_location = "AL-B"
    rows = _changed_item_locations(order, before)
    assert [r["asset_code"] for r in rows] == ["A-2"]
    assert _changed_item_locations(order, _item_location_snapshot(order)) == []


def test_save_receive_locations_keeps_half_filled_rows() -> None:
    a1, a2 = _asset(1), _asset(2)
    order = _order(a1, a2)
    svc = DisposalOrderService(MagicMock())
    with (
        patch.object(svc, "_load_order", return_value=order),
        patch.object(svc, "_assert_actor_may_receive"),
        patch.object(svc, "_require_scrapyard_locations", side_effect=lambda **kw: (
            kw["functional_location"],
            kw["actual_location"],
        )),
        patch.object(svc, "get_order", return_value="detail"),
        patch("modules.disposals.service.log_disposal_event") as log,
    ):
        svc.save_receive_locations(
            1,
            SaveDisposalLocationsRequest(
                item_locations=[
                    {
                        "asset_id": 1,
                        "to_functional_location": "FL-A",
                        "to_actual_location": "AL-A",
                    },
                    {"asset_id": 2, "to_functional_location": "FL-B"},
                ]
            ),
            actor_user_id=8,
        )
    assert (order.items[1].to_functional_location, order.items[1].to_actual_location) == (
        "FL-B",
        None,
    )
    logged = log.call_args.kwargs
    assert logged["action"] == "receive_locations_saved"
    assert logged["new_value"]["item_locations"][1] == {
        "asset_code": "A-2",
        "asset_name": "Pump",
        "to_functional_location": "FL-B",
        "to_actual_location": None,
    }
    # Assets only move on receive, so a partial save must leave them where they are.
    assert a1.location.functional_location == "OLD-FL"
    assert a1.lifecycle_status == "pending_disposal"
