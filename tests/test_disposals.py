"""Disposal order status ladder, scrapyard handoff, and asset mutations on receive/close."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from modules.assets.lifecycle import LIFECYCLE_DISPOSED, LIFECYCLE_PENDING_DISPOSAL
from modules.disposals.constants import (
    ACTION_SUBMIT,
    ACTION_SUBMIT_WITH_ENGINEERING,
    ENTITY_TYPE,
    ENTITY_TYPE_WITH_ENGINEERING,
    STATUS_CLOSED,
    STATUS_DRAFT,
    STATUS_IN_REWORK,
    STATUS_PENDING_CF_CLOSE,
    STATUS_PENDING_RECEIPT,
    STATUS_REJECTED,
)
from modules.disposals.schema import (
    CloseDisposalRequest,
    CreateDisposalOrderRequest,
    ReceiveDisposalRequest,
    UpdateDisposalOrderRequest,
)
from modules.disposals.service import (
    DisposalOrderService,
    _can_disposal_operational_flag,
    action_and_entity_for_order,
    finalize_disposal_approval,
    reject_disposal_approval,
)
from modules.errors import ConflictError


def _asset(asset_id: int = 1):
    return SimpleNamespace(
        id=asset_id,
        asset_code=f"A-{asset_id}",
        asset_name="Pump",
        lifecycle_status="active",
        approval_status="approved",
        location=SimpleNamespace(
            asset_id=asset_id, plant_id=3, functional_location="OLD-FL", actual_location="OLD-AL"
        ),
        financial=SimpleNamespace(asset_id=asset_id, cost_center="CC-100"),
    )


def _order(status: str, *, assets, order_id: int = 1, assigned_to: int | None = 5):
    return SimpleNamespace(
        id=order_id,
        order_number="ADO-2026-0001",
        plant_id=3,
        status=status,
        assigned_to=assigned_to,
        assigned_by=None,
        assigned_at=None,
        created_by=2,
        remarks=None,
        rejection_comment=None,
        closed_at=None,
        requires_engineering=False,
        items=[SimpleNamespace(id=i + 1, asset_id=a.id, asset=a) for i, a in enumerate(assets)],
    )


def test_action_and_entity_mapping():
    assert action_and_entity_for_order(requires_engineering=False) == (ACTION_SUBMIT, ENTITY_TYPE)
    assert action_and_entity_for_order(requires_engineering=True) == (
        ACTION_SUBMIT_WITH_ENGINEERING,
        ENTITY_TYPE_WITH_ENGINEERING,
    )


def test_submit_requires_configured_workflow():
    order = _order(STATUS_DRAFT, assets=[_asset()])
    svc = DisposalOrderService(MagicMock())
    with patch("modules.disposals.service.get_workflow_for_action", return_value=None):
        with pytest.raises(ConflictError, match="No active disposal approval workflow"):
            svc._submit(order, actor_user_id=1, assignee_user_id=2)
    assert order.status == STATUS_DRAFT


def test_submit_rejects_non_operational_assets():
    asset = _asset()
    asset.lifecycle_status = "inactive"
    order = _order(STATUS_DRAFT, assets=[asset])
    svc = DisposalOrderService(MagicMock())
    with pytest.raises(ConflictError, match="active, approved"):
        svc._submit(order, actor_user_id=1, assignee_user_id=2)


def test_create_marks_assets_pending_disposal():
    asset = _asset()
    db = MagicMock()
    db.flush.side_effect = lambda: setattr(db.add.call_args.args[0], "id", 1)
    svc = DisposalOrderService(db)
    with patch.object(svc, "_load_assets", return_value=[asset]):
        with patch.object(svc, "_resolve_from_cost_center", return_value=None):
            with patch.object(svc, "get_order", return_value="detail"):
                result = svc.create_order(
                    CreateDisposalOrderRequest(
                        asset_ids=[1],
                        remarks=None,
                        requires_engineering=False,
                        assignee_user_id=None,
                        submit=False,
                    ),
                    actor_user_id=2,
                )
    assert result == "detail"
    assert asset.lifecycle_status == LIFECYCLE_PENDING_DISPOSAL


def test_archive_draft_reactivates_assets():
    asset = _asset()
    asset.lifecycle_status = LIFECYCLE_PENDING_DISPOSAL
    order = _order(STATUS_DRAFT, assets=[asset], assigned_to=None)
    db = MagicMock()
    svc = DisposalOrderService(db)
    with patch.object(svc, "_load_order", return_value=order):
        with patch.object(svc, "get_order", return_value="detail"):
            result = svc.archive_draft_order(1, actor_user_id=2)
    assert result == "detail"
    assert order.status == "cancelled"
    assert asset.lifecycle_status == "active"
    db.delete.assert_not_called()
    db.commit.assert_called_once()


def test_update_restores_removed_assets_and_marks_added_pending_disposal():
    asset1 = _asset(1)
    asset1.lifecycle_status = LIFECYCLE_PENDING_DISPOSAL
    asset2 = _asset(2)
    order = _order(STATUS_DRAFT, assets=[asset1], assigned_to=None)
    svc = DisposalOrderService(MagicMock())
    with patch.object(svc, "_load_order", return_value=order):
        with patch.object(svc, "_load_assets", return_value=[asset2]):
            with patch.object(svc, "_resolve_from_cost_center", return_value=None):
                with patch.object(svc, "get_order", return_value="detail"):
                    svc.update_order(
                        1,
                        UpdateDisposalOrderRequest(asset_ids=[2]),
                        actor_user_id=2,
                    )
    assert asset1.lifecycle_status == "active"
    assert asset2.lifecycle_status == LIFECYCLE_PENDING_DISPOSAL


def test_update_moves_order_plant_when_assets_change_plant():
    asset1 = _asset(1)
    asset1.lifecycle_status = LIFECYCLE_PENDING_DISPOSAL
    asset2 = _asset(2)
    asset2.location.plant_id = 9
    order = _order(STATUS_DRAFT, assets=[asset1], assigned_to=None)
    assert order.plant_id == 3
    svc = DisposalOrderService(MagicMock())
    with patch.object(svc, "_load_order", return_value=order):
        with patch.object(svc, "_load_assets", return_value=[asset2]):
            with patch.object(svc, "_resolve_from_cost_center", return_value=None):
                with patch.object(svc, "get_order", return_value="detail"):
                    svc.update_order(
                        1,
                        UpdateDisposalOrderRequest(asset_ids=[2]),
                        actor_user_id=2,
                    )
    assert order.plant_id == 9
    assert asset1.lifecycle_status == "active"
    assert asset2.lifecycle_status == LIFECYCLE_PENDING_DISPOSAL


def test_final_approval_hands_order_to_scrapyard_user():
    order = _order("pending_approval", assets=[_asset()], assigned_to=None)
    receiver = SimpleNamespace(id=42, is_active=True, full_name="Yard User")
    db = MagicMock()
    db.get.side_effect = lambda model, pk: order if pk == 1 else receiver

    finalize_disposal_approval(
        db, order_id=1, approver_user_id=9, step_role_name="MD", scrapyard_user_id=42
    )
    assert order.status == STATUS_PENDING_RECEIPT
    assert order.assigned_to == 42
    db.commit.assert_called_once()


def test_final_approval_without_scrapyard_user_is_blocked():
    order = _order("pending_approval", assets=[_asset()])
    db = MagicMock()
    db.get.return_value = order
    with pytest.raises(ConflictError, match="receiver"):
        finalize_disposal_approval(db, order_id=1, approver_user_id=9, scrapyard_user_id=None)


def test_reject_sends_order_to_rejected_for_creator():
    order = _order("pending_approval", assets=[_asset()])
    db = MagicMock()
    db.get.return_value = order
    reject_disposal_approval(db, order_id=1, approver_user_id=9, comment="  wrong assets  ")
    assert order.status == STATUS_REJECTED
    assert order.rejection_comment == "wrong assets"
    assert order.assigned_to == order.created_by


def test_resume_rejected_moves_to_draft():
    order = _order(STATUS_REJECTED, assets=[_asset()])
    order.approval_request_id = 99
    order.rejection_comment = "wrong assets"
    db = MagicMock()
    db.get.return_value = order
    svc = DisposalOrderService(db)
    with patch.object(svc, "_load_order", return_value=order):
        with patch.object(svc, "get_order", return_value="detail"):
            assert svc.resume_rejected_order(1, actor_user_id=int(order.created_by)) == "detail"
    assert order.status == STATUS_DRAFT
    assert order.approval_request_id is None
    assert order.rejection_comment is None
    assert order.assigned_to == order.created_by


def test_resume_in_rework_moves_to_draft():
    order = _order(STATUS_IN_REWORK, assets=[_asset()])
    order.approval_request_id = 99
    order.rejection_comment = "fix and resubmit"
    db = MagicMock()
    db.get.return_value = order
    svc = DisposalOrderService(db)
    with patch.object(svc, "_load_order", return_value=order):
        with patch.object(svc, "get_order", return_value="detail"):
            assert svc.resume_rejected_order(1, actor_user_id=int(order.created_by)) == "detail"
    assert order.status == STATUS_DRAFT
    assert order.approval_request_id is None
    assert order.rejection_comment is None
    assert order.assigned_to == order.created_by


def test_receive_relocates_assets_and_assigns_cf():
    asset = _asset()
    order = _order(STATUS_PENDING_RECEIPT, assets=[asset])
    cost_center = SimpleNamespace(id=7, code="CC-SCRAP", plant_id=3)
    cf_user = SimpleNamespace(id=11, is_active=True, is_superuser=False)
    db = MagicMock()
    db.get.side_effect = lambda model, pk: {7: cost_center, 11: cf_user}[pk]

    svc = DisposalOrderService(db)
    with patch.object(svc, "_load_order", return_value=order):
        with patch.object(svc, "get_order", return_value="detail"):
            svc.receive_order(
                1,
                ReceiveDisposalRequest(
                    assigned_to=11,
                    functional_location=" YARD-FL ",
                    actual_location=" YARD-AL ",
                    cost_center_id=7,
                ),
                actor_user_id=5,
            )
    assert order.status == STATUS_PENDING_CF_CLOSE
    assert order.assigned_to == 11
    assert asset.location.functional_location == "YARD-FL"
    assert asset.location.actual_location == "YARD-AL"
    assert asset.financial.cost_center == "CC-SCRAP"
    # Assets stay usable until CF approves/closes the order.
    assert asset.lifecycle_status == "active"


def test_receive_requires_cf_assignee():
    order = _order(STATUS_PENDING_RECEIPT, assets=[_asset()])
    cost_center = SimpleNamespace(id=7, code="CC-SCRAP", plant_id=3)
    db = MagicMock()
    db.get.return_value = cost_center
    svc = DisposalOrderService(db)
    with patch.object(svc, "_load_order", return_value=order):
        with pytest.raises(Exception):
            # assigned_to is required by the schema
            ReceiveDisposalRequest(
                functional_location="YARD-FL",
                actual_location="YARD-AL",
                cost_center_id=7,
            )


def test_receive_rejects_cost_center_from_another_plant():
    order = _order(STATUS_PENDING_RECEIPT, assets=[_asset()])
    cost_center = SimpleNamespace(id=7, code="CC-SCRAP", plant_id=99)
    db = MagicMock()
    db.get.return_value = cost_center
    svc = DisposalOrderService(db)
    with patch.object(svc, "_load_order", return_value=order):
        with pytest.raises(ConflictError, match="same plant"):
            svc.receive_order(
                1,
                ReceiveDisposalRequest(
                    assigned_to=11,
                    functional_location="YARD-FL",
                    actual_location="YARD-AL",
                    cost_center_id=7,
                ),
                actor_user_id=5,
            )


def test_close_marks_assets_disposed():
    asset = _asset()
    order = _order(STATUS_PENDING_CF_CLOSE, assets=[asset], assigned_to=11)
    svc = DisposalOrderService(MagicMock())
    with patch.object(svc, "_load_order", return_value=order):
        with patch.object(svc, "get_order", return_value="detail"):
            svc.close_order(1, CloseDisposalRequest(), actor_user_id=11)
    assert order.status == STATUS_CLOSED
    assert order.closed_at is not None
    assert asset.lifecycle_status == LIFECYCLE_DISPOSED
    assert asset.approval_status == "not_required"


def test_close_requires_pending_cf_close():
    order = _order(STATUS_PENDING_RECEIPT, assets=[_asset()])
    svc = DisposalOrderService(MagicMock())
    with patch.object(svc, "_load_order", return_value=order):
        with pytest.raises(ConflictError, match="have been received"):
            svc.close_order(1, CloseDisposalRequest(), actor_user_id=11)


def test_actor_may_act_denies_permission_holder_when_someone_else_assigned():
    order = _order(STATUS_PENDING_CF_CLOSE, assets=[_asset()], assigned_to=42)
    other = SimpleNamespace(id=7, is_superuser=False)
    db = MagicMock()
    db.get.return_value = other
    svc = DisposalOrderService(db)
    with patch(
        "modules.disposals.service.get_flat_permission_codes_for_user",
        return_value=["disposal.close"],
    ):
        assert not svc._actor_may_act(order, actor_user_id=7, permission="disposal.close")
    assert svc._actor_may_act(order, actor_user_id=42, permission="disposal.close")


def test_legacy_close_hidden_while_approval_request_pending_for_other_user():
    order = _order(STATUS_PENDING_CF_CLOSE, assets=[_asset()], assigned_to=42)
    order.approval_request_id = 99
    panel = SimpleNamespace(
        my_pending_task_id=None,
        current_step_kind="approve",
        request_status="pending",
    )
    assert not _can_disposal_operational_flag(
        order, panel=panel, legacy_ok=True, step_kind="close"
    )
