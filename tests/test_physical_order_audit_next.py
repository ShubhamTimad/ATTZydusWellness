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
    assert _AUDIT_LABELS["closure_items_approved"] == "Assets Approved"


def test_closure_submit_and_reject_labels() -> None:
    assert _AUDIT_LABELS["closure_submitted"] == "Submitted for Approval"
    assert _AUDIT_LABELS["closure_items_rejected"] == "Assets Rejected"
    assert _AUDIT_LABELS["completed"] == "Completed"


def test_closure_items_rejected_detail_prefixes_reason() -> None:
    detail = _audit_detail(
        "closure_items_rejected",
        None,
        {"asset_codes": ["10036"], "reason": "For a reason"},
    )
    assert detail == "10036 — Rejected Reason: For a reason"


def test_assignment_changed_detail_shows_assigned_to() -> None:
    detail = _audit_detail(
        "assignment_changed",
        None,
        {"assigned_to": 7, "assigned_to_name": "Operator Demo", "auto_assigned": True},
    )
    assert detail == "Assigned to: Operator Demo"


def test_order_created_has_no_executor_detail() -> None:
    assert (
        _audit_detail(
            "order_created",
            None,
            {"assigned_to": 7, "assigned_to_name": "Operator Demo"},
        )
        is None
    )


def test_rejected_detail_includes_assigned_to() -> None:
    detail = _audit_detail(
        "rejected",
        None,
        {"reason": "Bad scan", "assigned_to": 7, "assigned_to_name": "Operator Demo"},
    )
    assert detail == "Rejected Reason: Bad scan"


def test_rejected_detail_hides_boilerplate_reason() -> None:
    detail = _audit_detail(
        "rejected",
        None,
        {
            "reason": "Approved remaining assets; rejected assets returned to executor.",
            "assigned_to_name": "Operator Demo",
        },
    )
    assert detail is None


def test_enrich_hides_line_rejects_when_order_rejected() -> None:
    from datetime import datetime, timezone

    from modules.orders.progress import enrich_audit_rows

    rows = [
        SimpleNamespace(
            id=1,
            action="closure_items_rejected",
            actor_user_id=9,
            old_value=None,
            new_value={"asset_codes": ["DEMO-AST-020"], "reason": "J"},
            created_at=datetime(2026, 8, 20, 12, 51, tzinfo=timezone.utc),
        ),
        SimpleNamespace(
            id=2,
            action="rejected",
            actor_user_id=9,
            old_value=None,
            new_value={
                "reason": "Approved remaining assets; rejected assets returned to executor.",
                "assigned_to_name": "Operator Demo",
            },
            created_at=datetime(2026, 8, 20, 12, 51, tzinfo=timezone.utc),
        ),
    ]
    audit = enrich_audit_rows(
        rows,
        user_name_fn=lambda uid: "Approver Demo" if uid == 9 else "Operator Demo",
    )
    labels = [e.label for e in audit]
    assert labels == ["Order Rejected"]
    assert audit[0].detail == "Rejected Reason: J"


def test_enrich_keeps_each_reject_reason_separate() -> None:
    from datetime import datetime, timezone

    from modules.orders.progress import enrich_audit_rows

    rows = [
        SimpleNamespace(
            id=1,
            action="closure_items_rejected",
            actor_user_id=9,
            old_value=None,
            new_value={"asset_codes": ["A1"], "reason": "First reason"},
            created_at=datetime(2026, 8, 20, 12, 0, tzinfo=timezone.utc),
        ),
        SimpleNamespace(
            id=2,
            action="rejected",
            actor_user_id=9,
            old_value=None,
            new_value={
                "reason": "Approved remaining assets; rejected assets returned to executor.",
            },
            created_at=datetime(2026, 8, 20, 12, 0, tzinfo=timezone.utc),
        ),
        SimpleNamespace(
            id=3,
            action="closure_items_rejected",
            actor_user_id=9,
            old_value=None,
            new_value={"asset_codes": ["A1"], "reason": "Second reason"},
            created_at=datetime(2026, 8, 20, 13, 0, tzinfo=timezone.utc),
        ),
        SimpleNamespace(
            id=4,
            action="rejected",
            actor_user_id=9,
            old_value=None,
            new_value={
                "reason": "Approved remaining assets; rejected assets returned to executor.",
            },
            created_at=datetime(2026, 8, 20, 13, 0, tzinfo=timezone.utc),
        ),
    ]
    audit = enrich_audit_rows(rows, user_name_fn=lambda _uid: "Approver Demo")
    rejected = [e for e in audit if e.label == "Order Rejected"]
    by_id = {int(e.id): e.detail for e in rejected}
    assert by_id[2] == "Rejected Reason: First reason"
    assert by_id[4] == "Rejected Reason: Second reason"


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


def test_enrich_audit_synthesizes_completed_before_closure_submit() -> None:
    from datetime import datetime, timezone

    from modules.orders.progress import enrich_audit_rows

    completed_at = datetime(2026, 8, 20, 6, 17, tzinfo=timezone.utc)
    submitted_at = datetime(2026, 8, 20, 6, 47, tzinfo=timezone.utc)
    rows = [
        SimpleNamespace(
            id=1,
            action="started",
            actor_user_id=7,
            old_value=None,
            new_value=None,
            created_at=datetime(2026, 8, 19, 18, 47, tzinfo=timezone.utc),
        ),
        SimpleNamespace(
            id=2,
            action="closure_submitted",
            actor_user_id=7,
            old_value=None,
            new_value={"assignee_user_name": "Approver Demo"},
            created_at=submitted_at,
        ),
    ]
    audit = enrich_audit_rows(
        rows,
        user_name_fn=lambda uid: "Operator Demo" if uid == 7 else "Approver Demo",
        work_completed_at=completed_at,
        work_completed_by=7,
    )
    labels = [e.label for e in audit]
    assert "Completed" in labels
    assert "Submitted for Approval" in labels
    completed_idx = labels.index("Completed")
    submitted_idx = labels.index("Submitted for Approval")
    assert completed_idx < submitted_idx
