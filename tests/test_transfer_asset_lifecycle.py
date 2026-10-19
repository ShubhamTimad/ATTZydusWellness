"""Transfer orders lock assets as pending_transfer and restore them on archive/close."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from modules.assets.lifecycle import LIFECYCLE_PENDING_TRANSFER
from modules.errors import ConflictError
from modules.transfers.constants import STATUS_CANCELLED, STATUS_CLOSED, STATUS_CONFIRMED_BY_CF, STATUS_DRAFT
from modules.transfers.schema import (
    CreateTransferOrderRequest,
    SaveReceiveLocationsRequest,
    UpdateTransferOrderRequest,
)
from modules.transfers.service import (
    TransferOrderService,
    _apply_receive_assets,
    _changed_item_locations,
    _item_location_snapshot,
    apply_transfer_close,
    assert_assignee_is_not_creator,
    exclude_creator_from_assignees,
)


def _asset(asset_id: int = 1):
    return SimpleNamespace(
        id=asset_id,
        asset_code=f"A-{asset_id}",
        asset_name="Pump",
        lifecycle_status="active",
        approval_status="approved",
        asset_custodian_id=2,
        location=SimpleNamespace(
            asset_id=asset_id, plant_id=3, functional_location="OLD-FL", actual_location="OLD-AL"
        ),
        financial=SimpleNamespace(asset_id=asset_id, cost_center="CC-100"),
    )


def _order(status: str, *, assets, order_id: int = 1, assigned_to: int | None = 5):
    return SimpleNamespace(
        id=order_id,
        order_number="ATO-2026-0001",
        plant_id=3,
        status=status,
        assigned_to=assigned_to,
        assigned_by=None,
        assigned_at=None,
        created_by=2,
        approval_request_id=None,
        to_cost_center_id=7,
        to_asset_custodian_id=8,
        to_functional_location=None,
        to_actual_location=None,
        remarks=None,
        rejection_reason=None,
        closed_at=None,
        from_cost_center_id=10,
        items=[SimpleNamespace(id=i + 1, asset_id=a.id, asset=a) for i, a in enumerate(assets)],
    )


def test_validate_assets_reports_pending_transfer():
    asset = _asset()
    asset.lifecycle_status = LIFECYCLE_PENDING_TRANSFER
    svc = TransferOrderService(MagicMock())
    svc._load_assets = lambda ids: [asset]  # type: ignore[method-assign]
    res = svc.validate_assets([1])
    assert len(res.in_progress) == 1
    assert res.in_progress[0].asset_id == 1


def test_assert_blocks_pending_transfer_on_new_order():
    asset = _asset()
    asset.lifecycle_status = LIFECYCLE_PENDING_TRANSFER
    svc = TransferOrderService(MagicMock())
    with pytest.raises(ConflictError, match="already in progress for this asset"):
        svc._assert_assets_approved_for_transfer([asset])


def test_assert_allows_pending_transfer_already_on_order():
    asset = _asset()
    asset.lifecycle_status = LIFECYCLE_PENDING_TRANSFER
    svc = TransferOrderService(MagicMock())
    svc._assert_assets_approved_for_transfer([asset], reserved_asset_ids={1})


def test_create_marks_assets_pending_transfer():
    asset = _asset()
    from_cc = SimpleNamespace(id=10, plant_id=3)
    to_cc = SimpleNamespace(id=7, plant_id=3)
    to_custodian = SimpleNamespace(id=8)
    db = MagicMock()
    db.get.return_value = to_cc
    db.flush.side_effect = lambda: setattr(db.add.call_args.args[0], "id", 1)
    svc = TransferOrderService(db)
    with patch.object(svc, "_load_assets", return_value=[asset]):
        with patch.object(svc, "_assert_actor_is_custodian"):
            with patch.object(svc, "_assert_same_from_cost_center", return_value=from_cc):
                with patch.object(svc, "_assert_destination_differs"):
                    with patch.object(svc, "_resolve_to_asset_custodian", return_value=to_custodian):
                        with patch.object(svc, "_next_order_number", return_value="ATO-1"):
                            with patch.object(svc, "_replace_items"):
                                with patch.object(svc, "get_order", return_value="detail"):
                                    result = svc.create_order(
                                        CreateTransferOrderRequest(
                                            asset_ids=[1],
                                            to_cost_center_id=7,
                                            to_asset_custodian_id=8,
                                            submit=False,
                                        ),
                                        actor_user_id=2,
                                    )
    assert result == "detail"
    assert asset.lifecycle_status == LIFECYCLE_PENDING_TRANSFER


def test_delete_draft_is_rejected():
    svc = TransferOrderService(MagicMock())
    with pytest.raises(ConflictError, match="cannot be deleted"):
        svc.delete_draft_order(1, actor_user_id=2)


def test_archive_restores_assets_active():
    asset = _asset()
    asset.lifecycle_status = LIFECYCLE_PENDING_TRANSFER
    order = _order(STATUS_DRAFT, assets=[asset], assigned_to=None)
    db = MagicMock()
    svc = TransferOrderService(db)
    with patch.object(svc, "_load_order", return_value=order):
        with patch.object(svc, "get_order", return_value="detail"):
            with patch("modules.transfers.service._actor_may_discard_transfer", return_value=True):
                result = svc.archive_order(1, actor_user_id=2)
    assert result == "detail"
    assert order.status == STATUS_CANCELLED
    assert asset.lifecycle_status == "active"
    db.delete.assert_not_called()
    db.commit.assert_called_once()


def test_unarchive_marks_assets_pending_transfer():
    asset = _asset()
    asset.lifecycle_status = "active"
    order = _order(STATUS_CANCELLED, assets=[asset], assigned_to=None)
    audit = SimpleNamespace(old_value={"status": STATUS_DRAFT})
    db = MagicMock()
    db.scalar.return_value = audit
    svc = TransferOrderService(db)
    with patch.object(svc, "_load_order", return_value=order):
        with patch.object(svc, "get_order", return_value="detail"):
            with patch("modules.transfers.service._actor_may_discard_transfer", return_value=True):
                result = svc.unarchive_order(1, actor_user_id=2)
    assert result == "detail"
    assert order.status == STATUS_DRAFT
    assert asset.lifecycle_status == LIFECYCLE_PENDING_TRANSFER
    db.commit.assert_called_once()


def test_update_skips_audit_when_nothing_changed():
    asset = _asset()
    order = _order(STATUS_DRAFT, assets=[asset])
    order.items[0].to_asset_custodian_id = 8
    db = MagicMock()
    svc = TransferOrderService(db)
    with patch.object(svc, "_load_order", return_value=order):
        with patch.object(svc, "get_order", return_value="detail"):
            with patch("modules.transfers.service._log") as log:
                svc.update_order(1, UpdateTransferOrderRequest(), actor_user_id=2)
    log.assert_not_called()
    db.commit.assert_called_once()


def test_update_restores_removed_assets_and_marks_added_pending_transfer():
    asset1 = _asset(1)
    asset1.lifecycle_status = LIFECYCLE_PENDING_TRANSFER
    asset2 = _asset(2)
    order = _order(STATUS_DRAFT, assets=[asset1], assigned_to=None)
    from_cc = SimpleNamespace(id=10)
    svc = TransferOrderService(MagicMock())
    with patch.object(svc, "_load_order", return_value=order):
        with patch.object(svc, "_load_assets", return_value=[asset2]):
            with patch.object(svc, "_assert_actor_is_custodian"):
                with patch.object(svc, "_assert_same_from_cost_center", return_value=from_cc):
                    with patch.object(svc, "_replace_items"):
                        with patch.object(svc, "get_order", return_value="detail"):
                            svc.update_order(
                                1,
                                UpdateTransferOrderRequest(asset_ids=[2]),
                                actor_user_id=2,
                            )
    assert asset1.lifecycle_status == "active"
    assert asset2.lifecycle_status == LIFECYCLE_PENDING_TRANSFER


def test_cf_close_restores_assets_active():
    asset = _asset()
    asset.lifecycle_status = LIFECYCLE_PENDING_TRANSFER
    order = _order(STATUS_CONFIRMED_BY_CF, assets=[asset], assigned_to=5)
    db = MagicMock()
    svc = TransferOrderService(db)
    with patch.object(svc, "_load_order", return_value=order):
        with patch.object(svc, "get_order", return_value="detail"):
            result = svc.cf_close(1, actor_user_id=5)
    assert result == "detail"
    assert order.status == STATUS_CLOSED
    assert asset.lifecycle_status == "active"
    db.commit.assert_called_once()


def test_apply_transfer_close_restores_assets_active():
    asset = _asset()
    asset.lifecycle_status = LIFECYCLE_PENDING_TRANSFER
    order = _order(STATUS_CONFIRMED_BY_CF, assets=[asset], assigned_to=5)
    db = MagicMock()
    db.scalar.return_value = order
    apply_transfer_close(db, order_id=1, actor_user_id=5)
    assert order.status == STATUS_CLOSED
    assert asset.lifecycle_status == "active"


def test_backfill_migration_covers_all_open_transfer_statuses() -> None:
    from pathlib import Path

    from modules.transfers.constants import ACTIVE_STATUSES

    src = (
        Path(__file__).resolve().parents[1]
        / "backend/alembic/versions/091_pending_transfer_open_orders.py"
    ).read_text(encoding="utf-8")
    for status in ACTIVE_STATUSES:
        assert f'"{status}"' in src


def test_apply_receive_sets_per_item_locations_and_custodians() -> None:
    a1 = _asset(1)
    a1.lifecycle_status = LIFECYCLE_PENDING_TRANSFER
    a2 = _asset(2)
    a2.lifecycle_status = LIFECYCLE_PENDING_TRANSFER
    items = [
        SimpleNamespace(
            asset_id=1,
            asset=a1,
            to_asset_custodian_id=8,
            to_functional_location=None,
            to_actual_location=None,
        ),
        SimpleNamespace(
            asset_id=2,
            asset=a2,
            to_asset_custodian_id=9,
            to_functional_location=None,
            to_actual_location=None,
        ),
    ]
    order = SimpleNamespace(
        items=items,
        to_cost_center_id=7,
        to_asset_custodian_id=8,
        to_functional_location=None,
        to_actual_location=None,
    )
    db = MagicMock()
    db.get.return_value = SimpleNamespace(code="CC-200")
    _apply_receive_assets(
        db,
        order,
        functional_location="",
        actual_location="",
        item_locations=[
            {"asset_id": 1, "to_functional_location": "FL-A", "to_actual_location": "AL-A"},
            {"asset_id": 2, "to_functional_location": "FL-B", "to_actual_location": "AL-B"},
        ],
    )
    assert a1.location.functional_location == "FL-A"
    assert a1.location.actual_location == "AL-A"
    assert a1.asset_custodian_id == 8
    assert a1.financial.cost_center == "CC-200"
    assert a1.lifecycle_status == LIFECYCLE_PENDING_TRANSFER
    assert a2.location.functional_location == "FL-B"
    assert a2.location.actual_location == "AL-B"
    assert a2.asset_custodian_id == 9
    assert a2.lifecycle_status == LIFECYCLE_PENDING_TRANSFER
    assert items[0].to_functional_location == "FL-A"
    assert items[1].to_actual_location == "AL-B"


def test_cf_confirm_restores_assets_to_active_and_approved() -> None:
    a1 = _asset(1)
    a1.lifecycle_status = LIFECYCLE_PENDING_TRANSFER
    a1.approval_status = "pending"
    order = _order("received_by_cc2", assets=[a1])
    order.id = 10
    svc = TransferOrderService(MagicMock())
    with patch.object(svc, "_load_order", return_value=order):
        with patch.object(svc, "get_order", return_value=None):
            with patch("modules.transfers.service._log"):
                svc.cf_confirm(10, actor_user_id=1)
    assert order.status == "confirmed_by_cf"
    assert a1.lifecycle_status == "active"
    assert a1.approval_status == "approved"


def test_apply_transfer_confirm_restores_assets_to_active_and_approved() -> None:
    from modules.transfers.service import apply_transfer_confirm

    a1 = _asset(1)
    a1.lifecycle_status = LIFECYCLE_PENDING_TRANSFER
    a1.approval_status = "pending"
    order = _order("received_by_cc2", assets=[a1])
    order.id = 10
    db = MagicMock()
    db.scalar.return_value = order
    with patch("modules.transfers.service._log"):
        apply_transfer_confirm(db, order_id=10, actor_user_id=1, next_assignee_user_id=2)
    assert order.status == "confirmed_by_cf"
    assert a1.lifecycle_status == "active"
    assert a1.approval_status == "approved"


def test_revert_transfer_assets_after_receive_marks_pending_transfer() -> None:
    from modules.transfers.service import _revert_transfer_assets_after_receive

    asset = _asset(1)
    asset.lifecycle_status = "active"
    asset.approval_status = "approved"
    item = SimpleNamespace(
        asset_id=1,
        asset=asset,
        from_cost_center_code="CC-OLD",
        from_functional_location="FL-OLD",
        from_actual_location="AL-OLD",
        from_asset_custodian_id=2,
    )
    order = SimpleNamespace(items=[item])
    _revert_transfer_assets_after_receive(order)
    assert asset.lifecycle_status == LIFECYCLE_PENDING_TRANSFER
    assert asset.financial.cost_center == "CC-OLD"
    assert asset.location.functional_location == "FL-OLD"
    assert asset.location.actual_location == "AL-OLD"
    assert asset.asset_custodian_id == 2


def test_receive_audit_skips_locations_saved_earlier() -> None:
    a1, a2 = _asset(1), _asset(2)
    order = _order("approved_by_cf", assets=[a1, a2])
    for item in order.items:
        item.to_asset_custodian_id = 8
        item.to_functional_location = "FL-A"
        item.to_actual_location = "AL-A"
    before = _item_location_snapshot(order)
    # Only the second asset gets its locations during receive; the first was saved earlier.
    order.items[1].to_actual_location = "AL-B"
    rows = _changed_item_locations(order, before)
    assert [r["asset_code"] for r in rows] == ["A-2"]
    assert _changed_item_locations(order, _item_location_snapshot(order)) == []


def test_save_receive_locations_keeps_partial_rows_and_logs_pending() -> None:
    a1, a2 = _asset(1), _asset(2)
    order = _order("approved_by_cf", assets=[a1, a2])
    for item in order.items:
        item.to_functional_location = None
        item.to_actual_location = None
        item.to_asset_custodian_id = 8
    svc = TransferOrderService(MagicMock())
    with patch.object(svc, "_load_order", return_value=order):
        with patch.object(svc, "_assert_actor_may_receive"):
            with patch.object(svc, "get_order", return_value="detail"):
                with patch("modules.transfers.service._log") as log:
                    svc.save_receive_locations(
                        1,
                        SaveReceiveLocationsRequest(
                            item_locations=[
                                {"asset_id": 1, "to_functional_location": "FL-A", "to_actual_location": "AL-A"},
                                {"asset_id": 2, "to_functional_location": "FL-B"},
                            ]
                        ),
                        actor_user_id=8,
                    )
    # Asset 2 keeps its half-filled row instead of being rejected for the missing location.
    assert (order.items[0].to_functional_location, order.items[0].to_actual_location) == ("FL-A", "AL-A")
    assert (order.items[1].to_functional_location, order.items[1].to_actual_location) == ("FL-B", None)
    logged = log.call_args.kwargs
    assert logged["action"] == "receive_locations_saved"
    assert logged["new_value"]["item_locations"][1] == {
        "asset_code": "A-2",
        "asset_name": "Pump",
        "to_functional_location": "FL-B",
        "to_actual_location": None,
    }
    # Assets are only relocated on receive, not on a partial save.
    assert a1.location.functional_location == "OLD-FL"


def test_exclude_creator_from_assignees():
    creator = SimpleNamespace(id=2, full_name="Creator")
    other = SimpleNamespace(id=9, full_name="Other")
    users = [creator, other]
    assert [u.id for u in exclude_creator_from_assignees(users, created_by=2)] == [9]
    assert [u.id for u in exclude_creator_from_assignees(users, actor_user_id=2)] == [9]
    assert [u.id for u in exclude_creator_from_assignees(users, created_by=2, actor_user_id=9)] == [9]
    assert [u.id for u in exclude_creator_from_assignees(users)] == [2, 9]


def test_cannot_assign_transfer_to_creator():
    with pytest.raises(ConflictError, match="who created it"):
        assert_assignee_is_not_creator(created_by=2, assigned_to=2)
    assert_assignee_is_not_creator(created_by=2, assigned_to=9)
    assert_assignee_is_not_creator(created_by=None, assigned_to=2)


def test_submit_rejects_assigning_creator():
    asset = _asset()
    order = _order(STATUS_DRAFT, assets=[asset])
    svc = TransferOrderService(MagicMock())
    with patch.object(svc, "_assert_actor_may_submit_transfer"):
        with patch.object(svc, "_assert_assets_approved_for_transfer"):
            with patch.object(svc, "_assert_same_from_cost_center"):
                with pytest.raises(ConflictError, match="who created it"):
                    svc._submit(order, actor_user_id=2, assigned_to=2, remarks=None)
