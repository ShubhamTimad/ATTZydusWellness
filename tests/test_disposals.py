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
    STATUS_CANCELLED,
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
    _scrapyard_locations_after_receive,
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
        receiver_user_id=8,
        approval_request_id=None,
        to_cost_center_id=7,
        remarks="End of life",
        rejection_comment=None,
        closed_at=None,
        requires_engineering=False,
        items=[
            SimpleNamespace(
                id=i + 1,
                asset_id=a.id,
                asset=a,
                to_functional_location=None,
                to_actual_location=None,
                to_asset_custodian_id=None,
            )
            for i, a in enumerate(assets)
        ],
    )


def test_action_and_entity_mapping():
    assert action_and_entity_for_order(requires_engineering=False) == (ACTION_SUBMIT, ENTITY_TYPE)
    assert action_and_entity_for_order(requires_engineering=True) == (
        ACTION_SUBMIT_WITH_ENGINEERING,
        ENTITY_TYPE_WITH_ENGINEERING,
    )


def test_scrapyard_locations_from_received_items():
    order = _order(STATUS_PENDING_CF_CLOSE, assets=[_asset(1), _asset(2)])
    for item in order.items:
        item.to_functional_location = "FL-YARD"
        item.to_actual_location = "AL-YARD-01"
    db = MagicMock()
    assert _scrapyard_locations_after_receive(db, order) == ("FL-YARD", "AL-YARD-01")
    # Assets received into different spots have no single order-level destination.
    order.items[1].to_actual_location = "AL-YARD-02"
    assert _scrapyard_locations_after_receive(db, order) == (None, None)
    order.status = STATUS_DRAFT
    assert _scrapyard_locations_after_receive(db, order) == (None, None)


def test_scrapyard_locations_shown_after_cf_bounce():
    order = _order(STATUS_REJECTED, assets=[_asset()])
    order.rejection_comment = "fix locs"
    order.approval_request_id = 48
    order.items[0].to_functional_location = "FL-YARD"
    order.items[0].to_actual_location = "AL-YARD-01"
    db = MagicMock()
    db.get.return_value = SimpleNamespace(status="pending")
    assert _scrapyard_locations_after_receive(db, order) == ("FL-YARD", "AL-YARD-01")


def test_submit_requires_disposal_reason():
    order = _order(STATUS_DRAFT, assets=[_asset()])
    order.remarks = None
    svc = DisposalOrderService(MagicMock())
    with pytest.raises(ConflictError, match="Disposal reason is required"):
        svc._submit(order, actor_user_id=1, assignee_user_id=2)


def test_submit_requires_custodian():
    order = _order(STATUS_DRAFT, assets=[_asset()])
    order.receiver_user_id = None
    svc = DisposalOrderService(MagicMock())
    with pytest.raises(ConflictError, match="Select a custodian"):
        svc._submit(order, actor_user_id=1, assignee_user_id=2)


def _custodians_of_yard(*user_ids: int):
    """Stand in for the cost-center custodian link table."""

    def _assert(*, cost_center_id, user_id):
        del cost_center_id
        if int(user_id) not in user_ids:
            raise ConflictError("Selected custodian must be assigned to the scrapyard cost center.")
        return SimpleNamespace(id=int(user_id))

    return _assert


def test_each_asset_keeps_its_own_scrapyard_custodian():
    order = _order(STATUS_DRAFT, assets=[_asset(1), _asset(2)])
    svc = DisposalOrderService(MagicMock())
    with patch.object(svc, "_assert_cc_custodian", _custodians_of_yard(11, 12)):
        svc._resolve_item_custodians(
            order,
            item_custodians=[
                {"asset_id": 1, "to_asset_custodian_id": 11},
                {"asset_id": 2, "to_asset_custodian_id": 12},
            ],
            fallback_id=None,
            require_all=True,
        )
    assert [i.to_asset_custodian_id for i in order.items] == [11, 12]
    # The workflow still needs one order-level receiver; it mirrors the first asset.
    assert order.receiver_user_id == 11


def test_assets_left_unpicked_fall_back_to_the_order_custodian():
    order = _order(STATUS_DRAFT, assets=[_asset(1), _asset(2)])
    svc = DisposalOrderService(MagicMock())
    with patch.object(svc, "_assert_cc_custodian", _custodians_of_yard(11, 12)):
        svc._resolve_item_custodians(
            order,
            item_custodians=[{"asset_id": 2, "to_asset_custodian_id": 12}],
            fallback_id=11,
            require_all=True,
        )
    assert [i.to_asset_custodian_id for i in order.items] == [11, 12]


def test_submit_names_the_asset_that_is_missing_a_custodian():
    order = _order(STATUS_DRAFT, assets=[_asset(1), _asset(2)])
    svc = DisposalOrderService(MagicMock())
    with patch.object(svc, "_assert_cc_custodian", _custodians_of_yard(11)):
        with pytest.raises(ConflictError, match="Select a custodian"):
            svc._resolve_item_custodians(
                order,
                item_custodians=[{"asset_id": 1, "to_asset_custodian_id": 11}],
                fallback_id=None,
                require_all=True,
            )


def test_moving_the_scrapyard_drops_custodians_who_do_not_work_there():
    order = _order(STATUS_DRAFT, assets=[_asset(1), _asset(2)])
    order.items[0].to_asset_custodian_id = 11
    order.items[1].to_asset_custodian_id = 99
    svc = DisposalOrderService(MagicMock())
    with patch.object(svc, "_assert_cc_custodian", _custodians_of_yard(11)):
        svc._resolve_item_custodians(
            order, item_custodians=None, fallback_id=None, require_all=False
        )
    assert [i.to_asset_custodian_id for i in order.items] == [11, None]
    # An explicit pick is the user's mistake to fix, so it must not be silently dropped.
    with patch.object(svc, "_assert_cc_custodian", _custodians_of_yard(11)):
        with pytest.raises(ConflictError, match="assigned to the scrapyard"):
            svc._resolve_item_custodians(
                order,
                item_custodians=[{"asset_id": 2, "to_asset_custodian_id": 99}],
                fallback_id=None,
                require_all=False,
            )


def test_any_asset_custodian_may_receive_the_order():
    order = _order(STATUS_PENDING_RECEIPT, assets=[_asset(1), _asset(2)])
    order.items[0].to_asset_custodian_id = 11
    order.items[1].to_asset_custodian_id = 12
    order.receiver_user_id = 11
    svc = DisposalOrderService(MagicMock())
    with patch.object(svc, "_actor_may_act", return_value=False):
        # Custodian of the second asset is not the assignee, but the yard is still theirs.
        svc._assert_actor_may_receive(order, actor_user_id=12)
        with pytest.raises(ConflictError, match="assigned receiver"):
            svc._assert_actor_may_receive(order, actor_user_id=13)


def test_list_cost_center_custodians_maps_users():
    db = MagicMock()
    db.get.return_value = SimpleNamespace(id=7, code="CC-4300")
    db.scalars.return_value.all.return_value = [
        SimpleNamespace(id=11, full_name="Yard Custodian", email="yard@x"),
    ]
    res = DisposalOrderService(db).list_cost_center_custodians(cost_center_id=7)
    assert res.role_name == "Cost center CC-4300 custodians"
    assert [(u.id, u.full_name) for u in res.items] == [(11, "Yard Custodian")]


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


def test_unarchive_order_marks_assets_pending_disposal():
    asset = _asset()
    asset.lifecycle_status = "active"
    order = _order(STATUS_CANCELLED, assets=[asset], assigned_to=None)
    audit = SimpleNamespace(old_value={"status": STATUS_DRAFT})
    db = MagicMock()
    db.scalar.return_value = audit
    svc = DisposalOrderService(db)
    with patch.object(svc, "_load_order", return_value=order):
        with patch.object(svc, "get_order", return_value="detail"):
            with patch("modules.disposals.service._actor_may_discard_disposal", return_value=True):
                result = svc.unarchive_order(1, actor_user_id=2)
    assert result == "detail"
    assert order.status == STATUS_DRAFT
    assert asset.lifecycle_status == LIFECYCLE_PENDING_DISPOSAL
    db.commit.assert_called_once()


def test_update_skips_audit_when_nothing_changed():
    asset = _asset()
    order = _order(STATUS_DRAFT, assets=[asset])
    order.items[0].to_asset_custodian_id = 8
    db = MagicMock()
    svc = DisposalOrderService(db)
    with patch.object(svc, "_load_order", return_value=order):
        with patch.object(svc, "get_order", return_value="detail"):
            with patch("modules.disposals.service.log_disposal_event") as log:
                svc.update_order(1, UpdateDisposalOrderRequest(), actor_user_id=2)
    log.assert_not_called()
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
    db.scalar.return_value = order
    assert (
        reject_disposal_approval(db, order_id=1, approver_user_id=9, comment="  wrong assets  ")
        == "creator"
    )
    assert order.status == STATUS_REJECTED
    assert order.rejection_comment == "wrong assets"
    assert order.assigned_to == order.created_by


def test_cf_reject_returns_to_receiver_for_location_edits():
    asset = _asset()
    asset.location.functional_location = "NEW-FL"
    asset.location.actual_location = "NEW-AL"
    asset.financial.cost_center = "CC-SCRAP"
    order = _order(STATUS_PENDING_CF_CLOSE, assets=[asset], assigned_to=11)
    order.items[0].from_cost_center_code = "CC-100"
    order.items[0].from_functional_location = "OLD-FL"
    order.items[0].from_actual_location = "OLD-AL"
    db = MagicMock()
    db.scalar.return_value = order
    assert (
        reject_disposal_approval(db, order_id=1, approver_user_id=9, comment="fix locs")
        == "receiver"
    )
    assert order.status == STATUS_REJECTED
    assert order.assigned_to == order.receiver_user_id
    assert order.rejection_comment == "fix locs"
    assert asset.location.functional_location == "OLD-FL"
    assert asset.location.actual_location == "OLD-AL"
    assert asset.financial.cost_center == "CC-100"


def test_cf_reject_recovers_receiver_from_receive_audit():
    asset = _asset()
    order = _order(STATUS_PENDING_CF_CLOSE, assets=[asset], assigned_to=11)
    order.receiver_user_id = None
    order.items[0].from_cost_center_code = "CC-100"
    order.items[0].from_functional_location = "OLD-FL"
    order.items[0].from_actual_location = "OLD-AL"
    audit = SimpleNamespace(
        action="received",
        actor_user_id=8,
        new_value={"status": STATUS_PENDING_CF_CLOSE},
    )
    db = MagicMock()
    db.scalar.side_effect = [order]
    db.scalars.return_value.all.return_value = [audit]
    assert reject_disposal_approval(db, order_id=1, approver_user_id=9, comment="bounce") == "receiver"
    assert order.status == STATUS_REJECTED
    assert order.receiver_user_id == 8
    assert order.assigned_to == 8


def test_receiver_reject_sends_order_to_rejected_for_creator():
    order = _order(STATUS_PENDING_RECEIPT, assets=[_asset()], assigned_to=8)
    db = MagicMock()
    db.scalar.return_value = order
    assert (
        reject_disposal_approval(db, order_id=1, approver_user_id=8, comment="cannot receive")
        == "creator"
    )
    assert order.status == STATUS_REJECTED
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


def test_can_receive_false_once_pending_cf_close():
    """Stale engine receive task must not keep the Receive button after assets moved."""
    order = SimpleNamespace(status=STATUS_PENDING_CF_CLOSE, approval_request_id=48)
    panel = SimpleNamespace(
        my_pending_task_id=146,
        current_step_kind="receive",
        request_status="pending",
    )
    assert (
        _can_disposal_operational_flag(
            order, panel=panel, legacy_ok=True, step_kind="receive"
        )
        is False
    )


def test_can_receive_true_on_rejected_bounce_to_receiver():
    order = SimpleNamespace(status=STATUS_REJECTED, approval_request_id=48)
    panel = SimpleNamespace(
        my_pending_task_id=146,
        current_step_kind="receive",
        request_status="pending",
    )
    assert (
        _can_disposal_operational_flag(
            order,
            panel=panel,
            legacy_ok=False,
            step_kind="receive",
            allow_rejected_receive=True,
        )
        is True
    )


def test_receive_relocates_assets_and_assigns_cf():
    asset = _asset()
    order = _order(STATUS_PENDING_RECEIPT, assets=[asset])
    cost_center = SimpleNamespace(
        id=7, code="CC-SCRAP", plant_id=3, is_scrapyard=True, is_active=True
    )
    cf_user = SimpleNamespace(id=11, is_active=True, is_superuser=False)
    db = MagicMock()
    db.get.side_effect = lambda model, pk: {7: cost_center, 11: cf_user}.get(pk)

    svc = DisposalOrderService(db)
    with patch.object(svc, "_load_order", return_value=order):
        with patch.object(svc, "_pending_step_task", return_value=None):
            with patch(
                "modules.disposals.service.require_scrapyard_locations",
                return_value=("YARD-FL", "YARD-AL"),
            ):
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
    order.to_cost_center_id = 7
    cost_center = SimpleNamespace(
        id=7, code="CC-SCRAP", plant_id=99, is_scrapyard=True, is_active=True
    )
    db = MagicMock()
    db.get.return_value = cost_center
    svc = DisposalOrderService(db)
    with patch.object(svc, "_load_order", return_value=order):
        with patch.object(svc, "_pending_step_task", return_value=None):
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
