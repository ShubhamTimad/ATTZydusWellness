"""Transfer orders lock assets as pending_transfer and restore them on archive/delete/close."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from modules.assets.lifecycle import LIFECYCLE_PENDING_TRANSFER
from modules.errors import ConflictError
from modules.transfers.constants import STATUS_CANCELLED, STATUS_CLOSED, STATUS_CONFIRMED_BY_CF, STATUS_DRAFT
from modules.transfers.schema import CreateTransferOrderRequest, UpdateTransferOrderRequest
from modules.transfers.service import TransferOrderService, apply_transfer_close


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


def test_assert_blocks_pending_transfer_on_new_order():
    asset = _asset()
    asset.lifecycle_status = LIFECYCLE_PENDING_TRANSFER
    svc = TransferOrderService(MagicMock())
    with pytest.raises(ConflictError, match="approved assets"):
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


def test_delete_draft_restores_assets_active():
    asset = _asset()
    asset.lifecycle_status = LIFECYCLE_PENDING_TRANSFER
    order = _order(STATUS_DRAFT, assets=[asset], assigned_to=None)
    db = MagicMock()
    svc = TransferOrderService(db)
    with patch.object(svc, "_load_order", return_value=order):
        with patch("modules.transfers.service._is_plain_transfer_draft", return_value=True):
            with patch("modules.transfers.service._actor_may_discard_transfer", return_value=True):
                svc.delete_draft_order(1, actor_user_id=2)
    assert asset.lifecycle_status == "active"
    db.delete.assert_called_once()
    db.commit.assert_called_once()


def test_archive_restores_assets_active():
    asset = _asset()
    asset.lifecycle_status = LIFECYCLE_PENDING_TRANSFER
    order = _order(STATUS_DRAFT, assets=[asset], assigned_to=None)
    db = MagicMock()
    svc = TransferOrderService(db)
    with patch.object(svc, "_load_order", return_value=order):
        with patch.object(svc, "get_order", return_value="detail"):
            with patch("modules.transfers.service._is_plain_transfer_draft", return_value=False):
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
