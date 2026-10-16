"""Physical order progress: rejection must not paint Approved/Closed as done."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

from modules.orders.constants import ORDER_STATUS_REJECTED
from modules.orders.progress import (
    _approval_progress_keys,
    _rejection_cutoff_key,
    _step_order,
    _step_phase,
)


def test_rejection_cutoff_after_completed_stops_before_approved() -> None:
    order = SimpleNamespace(
        closed_at=None,
        completed_at=datetime(2026, 8, 4, tzinfo=timezone.utc),
        started_at=datetime(2026, 8, 4, tzinfo=timezone.utc),
        assigned_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
    )
    assert (
        _rejection_cutoff_key(order, [], has_closure_workflow=True) == "completed"
    )


def test_rejected_phases_complete_only_through_cutoff() -> None:
    step_order = _step_order(show_creation_approval=False, has_closure_workflow=True)
    assert step_order == (
        "order_created",
        "assigned",
        "in_progress",
        "completed",
        "closure_approved",
        "closed",
    )
    assert (
        _step_phase(
            order_status=ORDER_STATUS_REJECTED,
            step_key="completed",
            step_order=step_order,
            active_key="rejected",
            rejection_cutoff="completed",
        )
        == "completed"
    )
    assert (
        _step_phase(
            order_status=ORDER_STATUS_REJECTED,
            step_key="closure_approved",
            step_order=step_order,
            active_key="rejected",
            rejection_cutoff="completed",
        )
        == "pending"
    )
    assert (
        _step_phase(
            order_status=ORDER_STATUS_REJECTED,
            step_key="closed",
            step_order=step_order,
            active_key="rejected",
            rejection_cutoff="completed",
        )
        == "pending"
    )
    assert (
        _step_phase(
            order_status=ORDER_STATUS_REJECTED,
            step_key="rejected",
            step_order=step_order,
            active_key="rejected",
            rejection_cutoff="completed",
        )
        == "rejected"
    )


def test_rejection_cutoff_creation_phase() -> None:
    order = SimpleNamespace(
        closed_at=None,
        completed_at=None,
        started_at=None,
        assigned_at=None,
    )
    audit = [
        SimpleNamespace(
            action="rejected",
            new_value={"phase": "creation"},
        )
    ]
    assert (
        _rejection_cutoff_key(order, audit, has_closure_workflow=True) == "approved"
    )


def test_progress_keys_assign_approve_close_is_one_approver() -> None:
    wf = SimpleNamespace(
        steps=[
            SimpleNamespace(step_order=1, step_kind="assign", role_name="Operator"),
            SimpleNamespace(step_order=2, step_kind="approve", role_name="Approver"),
            SimpleNamespace(step_order=3, step_kind="close", role_name="Approver"),
        ]
    )
    assert _approval_progress_keys(wf) == ("closure_approved",)
