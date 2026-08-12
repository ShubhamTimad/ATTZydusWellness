"""Physical order audit detail should surface next assignees."""

from __future__ import annotations

from types import SimpleNamespace

from modules.orders.progress import _AUDIT_LABELS, _audit_detail, _workflow_next_assignee_line


def test_closure_items_approved_detail() -> None:
    detail = _audit_detail(
        "closure_items_approved",
        None,
        {"asset_codes": ["10036", "10031"]},
    )
    assert detail == "10036, 10031"
    assert _AUDIT_LABELS["closure_items_approved"] == "Assets approved"


def test_closure_submit_and_reject_labels() -> None:
    assert _AUDIT_LABELS["closure_submitted"] == "Submitted for closure approval"
    assert _AUDIT_LABELS["closure_items_rejected"] == "Assets rejected"
    assert _AUDIT_LABELS["completed"] == "Order completed"


def test_closure_items_rejected_detail_prefixes_reason() -> None:
    detail = _audit_detail(
        "closure_items_rejected",
        None,
        {"asset_codes": ["10036"], "reason": "For a reason"},
    )
    assert detail == "10036 — Reason: For a reason"


def test_assignment_changed_detail_shows_assigned_to() -> None:
    detail = _audit_detail(
        "assignment_changed",
        None,
        {"assigned_to": 7, "assigned_to_name": "Operator Demo", "auto_assigned": True},
    )
    assert detail == "Assigned to: Operator Demo"


def test_rejected_detail_includes_assigned_to() -> None:
    detail = _audit_detail(
        "rejected",
        None,
        {"reason": "Bad scan", "assigned_to": 7, "assigned_to_name": "Operator Demo"},
    )
    assert detail == "Bad scan — Assigned to: Operator Demo"


def test_closure_submitted_detail_shows_assigned_approver() -> None:
    detail = _audit_detail(
        "closure_submitted",
        None,
        {
            "approval_request_id": 12,
            "assignee_user_id": 9,
            "assignee_user_name": "Approver Demo",
        },
    )
    assert detail == "Assigned to: Approver Demo"


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
    assert line == "Assigned to: Approver Demo"
