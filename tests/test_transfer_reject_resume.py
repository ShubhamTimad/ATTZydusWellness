"""Transfer reject → rejected → resume → draft (no in_rework product path)."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from modules.errors import ConflictError
from modules.transfers.constants import (
    STATUS_DRAFT,
    STATUS_IN_REWORK,
    STATUS_PENDING_APPROVAL,
    STATUS_RECEIVED_BY_CC2,
    STATUS_REJECTED,
)
from modules.transfers.service import (
    TransferOrderService,
    _list_action_label,
    reject_transfer_approval,
)


def _order(status: str, *, order_id: int = 1, created_by: int = 2):
    return SimpleNamespace(
        id=order_id,
        order_number="ATO-2026-0001",
        status=status,
        assigned_to=created_by,
        assigned_by=None,
        assigned_at=None,
        created_by=created_by,
        to_asset_custodian_id=8,
        rejection_reason=None,
        approval_request_id=None,
        closed_at=None,
        items=[],
    )


def test_pre_receive_reject_lands_on_rejected():
    order = _order(STATUS_PENDING_APPROVAL)
    db = MagicMock()
    db.scalar.return_value = order
    assert (
        reject_transfer_approval(
            db, order_id=1, approver_user_id=9, comment=" wrong dest "
        )
        == "creator"
    )
    assert order.status == STATUS_REJECTED
    assert order.rejection_reason == "wrong dest"
    assert order.assigned_to == order.created_by


def test_post_receive_reject_returns_to_assigned_receiver_not_custodian():
    order = _order(STATUS_RECEIVED_BY_CC2)
    db = MagicMock()
    # Order lookup, then the "approved" audit row naming the CC user picked to receive.
    db.scalar.side_effect = [order, {"assigned_to": 5}]
    with patch("modules.transfers.service._revert_transfer_assets_after_receive"):
        assert (
            reject_transfer_approval(
                db, order_id=1, approver_user_id=9, comment="send back"
            )
            == "receiver"
        )
    assert order.status == STATUS_REJECTED
    assert order.assigned_to == 5
    assert order.rejection_reason == "send back"


def test_list_action_bounce_is_receive_for_assigned_receiver_only():
    order = _order(STATUS_REJECTED)
    order.rejection_reason = "send back"
    order.assigned_to = 5
    order.approval_request_id = 55
    db = MagicMock()
    db.get.return_value = SimpleNamespace(status="pending")
    assert _list_action_label(db, order, int(order.created_by), {}) is None
    assert _list_action_label(db, order, int(order.to_asset_custodian_id), {}) is None
    assert _list_action_label(db, order, 5, {}) == "Receive"


def test_custodian_cannot_receive():
    order = _order("approved_by_cf")
    order.assigned_to = 5
    order.items = [SimpleNamespace(to_asset_custodian_id=8)]
    db = MagicMock()
    db.get.return_value = SimpleNamespace(is_superuser=False)
    svc = TransferOrderService(db)
    svc._assert_actor_may_receive(order, actor_user_id=5)
    try:
        svc._assert_actor_may_receive(order, actor_user_id=8)
    except ConflictError:
        pass
    else:
        raise AssertionError("custodian must not be able to receive")


def test_resume_rejected_moves_to_draft():
    order = _order(STATUS_REJECTED)
    order.approval_request_id = 99
    order.rejection_reason = "wrong dest"
    db = MagicMock()
    svc = TransferOrderService(db)
    with patch.object(svc, "_load_order", return_value=order):
        with patch.object(svc, "get_order", return_value="detail"):
            assert svc.resume_rejected_order(1, actor_user_id=int(order.created_by)) == "detail"
    assert order.status == STATUS_DRAFT
    assert order.approval_request_id is None
    assert order.rejection_reason is None
    assert order.assigned_to == order.created_by


def test_resume_legacy_in_rework_moves_to_draft():
    order = _order(STATUS_IN_REWORK)
    order.approval_request_id = 99
    order.rejection_reason = "fix and resubmit"
    db = MagicMock()
    svc = TransferOrderService(db)
    with patch.object(svc, "_load_order", return_value=order):
        with patch.object(svc, "get_order", return_value="detail"):
            assert svc.resume_rejected_order(1, actor_user_id=int(order.created_by)) == "detail"
    assert order.status == STATUS_DRAFT
    assert order.approval_request_id is None
    assert order.rejection_reason is None
