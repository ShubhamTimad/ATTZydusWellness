"""Physical order audit detail should surface next assignees."""

from __future__ import annotations

from types import SimpleNamespace

from modules.orders.progress import _audit_detail, _workflow_next_assignee_line


def test_assignment_changed_detail_shows_next_user() -> None:
    detail = _audit_detail(
        "assignment_changed",
        None,
        {"assigned_to": 7, "assigned_to_name": "Operator Demo", "auto_assigned": True},
    )
    assert detail == "Next: Operator Demo (after creation approval)"


def test_rejected_detail_includes_next_assignee() -> None:
    detail = _audit_detail(
        "rejected",
        None,
        {"reason": "Bad scan", "assigned_to": 7, "assigned_to_name": "Operator Demo"},
    )
    assert detail == "Bad scan — Next: Operator Demo"


def test_workflow_next_assignee_from_next_step_task() -> None:
    act = SimpleNamespace(
        action="approve",
        created_at="t1",
        task_id=1,
        task=SimpleNamespace(step=SimpleNamespace(step_order=1)),
    )
    next_task = SimpleNamespace(
        id=2,
        assigned_user_id=9,
        assigned_role_id=None,
        created_at="t2",
        step=SimpleNamespace(step_order=2, approver_role_id=3),
    )
    req = SimpleNamespace(tasks=[next_task])
    line = _workflow_next_assignee_line(
        SimpleNamespace(get=lambda *_a, **_k: None),
        req,
        act,
        user_name_fn=lambda uid: "Approver Demo" if uid == 9 else None,
    )
    assert line == "Next: Approver Demo"
