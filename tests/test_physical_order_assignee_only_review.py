"""Named closure/creation assignees own approve/reject — not every approver in the role."""

from __future__ import annotations

from types import SimpleNamespace

from modules.orders.service import PhysicalOrderService


def test_task_for_actor_prefers_named_user_over_role() -> None:
    named = SimpleNamespace(assigned_user_id=9, assigned_role_id=3)
    role_only = SimpleNamespace(assigned_user_id=None, assigned_role_id=3)

    assert (
        PhysicalOrderService._task_for_actor([named], actor_user_id=9, role_ids={3}) is named
    )
    assert (
        PhysicalOrderService._task_for_actor([named], actor_user_id=8, role_ids={3}) is None
    )
    assert (
        PhysicalOrderService._task_for_actor([role_only], actor_user_id=8, role_ids={3})
        is role_only
    )
    assert (
        PhysicalOrderService._task_for_actor([role_only], actor_user_id=8, role_ids={99})
        is None
    )


def test_closure_approver_handoff_updates_assigned_to() -> None:
    order = SimpleNamespace(
        approval_request_id=None,
        assigned_to=7,
        assigned_by=None,
        assigned_at=None,
    )
    PhysicalOrderService._apply_closure_approver_handoff(
        None,  # type: ignore[arg-type]
        order,
        approver_user_id=9,
        approval_request_id=55,
        actor_user_id=7,
    )
    assert order.assigned_to == 9
    assert order.approval_request_id == 55
    assert order.assigned_by == 7
    assert order.assigned_at is not None


def test_restore_executor_uses_started_by() -> None:
    order = SimpleNamespace(started_by=7, assigned_to=9)
    PhysicalOrderService._restore_executor_assignee(None, order)  # type: ignore[arg-type]
    assert order.assigned_to == 7
