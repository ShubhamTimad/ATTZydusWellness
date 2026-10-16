"""CapEx action-code selection, double-link guard, and submit handoff rules."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from modules.capex.constants import (
    ACTION_SUBMIT,
    ACTION_SUBMIT_WITH_ENGINEERING,
    ENTITY_TYPE,
    ENTITY_TYPE_WITH_ENGINEERING,
    STATUS_APPROVED,
    STATUS_DRAFT,
)
from modules.capex.service import CapexFormService, action_and_entity_for_form
from modules.errors import ConflictError


def test_action_and_entity_without_engineering():
    action, entity = action_and_entity_for_form(requires_engineering=False)
    assert action == ACTION_SUBMIT
    assert entity == ENTITY_TYPE


def test_action_and_entity_with_engineering():
    action, entity = action_and_entity_for_form(requires_engineering=True)
    assert action == ACTION_SUBMIT_WITH_ENGINEERING
    assert entity == ENTITY_TYPE_WITH_ENGINEERING


def test_link_to_asset_rejects_second_link():
    form = SimpleNamespace(id=1, status=STATUS_APPROVED, asset_id=None)
    db = MagicMock()
    db.get.return_value = form
    # First call: no other form linked to this asset
    db.scalar.return_value = None

    svc = CapexFormService(db)
    linked = svc.link_to_asset(1, asset_id=99)
    assert linked.asset_id == 99

    # Already linked
    form.asset_id = 99
    with pytest.raises(ConflictError, match="already linked"):
        svc.link_to_asset(1, asset_id=100)


def test_link_to_asset_rejects_unapproved():
    form = SimpleNamespace(id=1, status="draft", asset_id=None)
    db = MagicMock()
    db.get.return_value = form
    svc = CapexFormService(db)
    with pytest.raises(ConflictError, match="approved"):
        svc.link_to_asset(1, asset_id=99)


def test_list_audit_hides_asset_link_events():
    db = MagicMock()
    db.scalars.return_value.all.return_value = []
    svc = CapexFormService(db)
    with patch.object(svc, "_load"):
        assert svc.list_audit(1) == []
    stmt = db.scalars.call_args[0][0]
    sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    assert "NOT IN" in sql
    assert "'linked_to_asset'" in sql and "'unlinked_from_asset'" in sql


def test_submit_requires_workflow_no_auto_approve():
    form = SimpleNamespace(
        id=1,
        status=STATUS_DRAFT,
        asset_name="Pump",
        requires_engineering=False,
        approval_request_id=None,
        form_number="CAP-2026-00001",
        department=None,
        auc_code=None,
        rejection_comment=None,
    )
    db = MagicMock()
    svc = CapexFormService(db)
    with patch("modules.capex.service.get_workflow_for_action", return_value=None):
        with pytest.raises(ConflictError, match="No active CapEx approval workflow"):
            svc._submit(form, actor_user_id=1, assignee_user_id=2)
    assert form.status == STATUS_DRAFT


def test_reassign_requires_pending_approval():
    form = SimpleNamespace(id=1, status=STATUS_DRAFT, approval_request_id=None)
    db = MagicMock()
    db.scalar.return_value = form
    # CapexFormService._load uses selectinload options; stub returns form
    svc = CapexFormService(db)

    # Bypass _load complexity: patch it
    with patch.object(svc, "_load", return_value=form):
        with pytest.raises(ConflictError, match="pending approval"):
            svc.reassign_approver(1, actor_user_id=1, assignee_user_id=2)


def test_reassign_blocked_after_first_approval_level():
    from modules.capex.constants import STATUS_PENDING_APPROVAL

    form = SimpleNamespace(id=1, status=STATUS_PENDING_APPROVAL, approval_request_id=9)
    pending = SimpleNamespace(
        task_type="approval",
        status="pending",
        step=SimpleNamespace(step_order=2, approver_role_id=1),
        assigned_user_id=1,
    )
    req = SimpleNamespace(
        id=9,
        status="pending",
        tasks=[pending],
        workflow=SimpleNamespace(
            steps=[
                SimpleNamespace(step_order=1),
                SimpleNamespace(step_order=2),
            ]
        ),
    )
    db = MagicMock()
    db.scalar.return_value = req
    svc = CapexFormService(db)
    with patch.object(svc, "_load", return_value=form):
        with pytest.raises(ConflictError, match="first approval level"):
            svc.reassign_approver(1, actor_user_id=1, assignee_user_id=2)


def test_split_approval_task_runs_keeps_prior_attempt():
    from modules.platform.tasks.service import _split_approval_task_runs

    t1 = SimpleNamespace(id=1, task_type="approval", status="approved")
    t2 = SimpleNamespace(id=2, task_type="approval", status="rejected")
    t3 = SimpleNamespace(id=3, task_type="approval", status="pending")
    runs = _split_approval_task_runs([t1, t2, t3])
    assert len(runs) == 2
    assert [t.id for t in runs[0]] == [1, 2]
    assert [t.id for t in runs[1]] == [3]


def test_submit_switches_workflow_when_engineering_toggled():
    from modules.capex.constants import STATUS_IN_REWORK

    form = SimpleNamespace(
        id=7,
        status=STATUS_IN_REWORK,
        asset_name="Chiller",
        requires_engineering=False,
        approval_request_id=9,
        form_number="CAP-2026-00003",
        department=None,
        auc_code=None,
        rejection_comment="no",
        cost_center_id=None,
    )
    existing = SimpleNamespace(
        id=9,
        entity_type=ENTITY_TYPE_WITH_ENGINEERING,
        workflow_id=99,
    )
    wf = SimpleNamespace(id=88, steps=[SimpleNamespace(step_order=1, approver_role_id=3)])
    db = MagicMock()
    db.scalar.return_value = existing
    svc = CapexFormService(db)

    with patch("modules.capex.service.get_workflow_for_action", return_value=wf):
        with patch(
            "modules.capex.service._first_step_role",
            return_value=SimpleNamespace(id=3, name="HOD"),
        ):
            with patch(
                "modules.capex.service._users_in_role",
                return_value=[SimpleNamespace(id=2)],
            ):
                with patch.object(svc, "_resubmit_with_workflow_switch") as switch:
                    svc._submit(form, actor_user_id=1, assignee_user_id=2)
                    switch.assert_called_once()
                    assert switch.call_args.kwargs["entity_type"] == ENTITY_TYPE
                    assert switch.call_args.kwargs["workflow"] is wf


def test_submit_form_applies_engineering_flag_before_workflow():
    from modules.capex.constants import STATUS_IN_REWORK

    form = SimpleNamespace(
        id=9,
        status=STATUS_IN_REWORK,
        requires_engineering=True,
        asset_name="Belt",
        approval_request_id=1,
    )
    db = MagicMock()
    svc = CapexFormService(db)
    with patch.object(svc, "_load", side_effect=[form, form]):
        with patch.object(svc, "_submit") as submit:
            with patch.object(svc, "_to_detail", return_value=MagicMock()):
                svc.submit_form(
                    9,
                    actor_user_id=1,
                    assignee_user_id=2,
                    requires_engineering=False,
                )
                assert form.requires_engineering is False
                submit.assert_called_once()
                db.flush.assert_called()

