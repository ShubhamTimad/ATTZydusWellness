"""Physical verification list action labels; keep in sync with the needs_action tab."""

from __future__ import annotations

from types import SimpleNamespace

from modules.orders.service import PhysicalOrderService

VIEWER = 7


def _label(
    status: str,
    *,
    created_by=None,
    assigned_to=None,
    request_id=None,
    completed_at=None,
    started_at=None,
    assigned_at=None,
):
    order = SimpleNamespace(
        status=status,
        created_by=created_by,
        assigned_to=assigned_to,
        approval_request_id=request_id,
        completed_at=completed_at,
        started_at=started_at,
        assigned_at=assigned_at,
    )
    return PhysicalOrderService._row_action_label(None, order, VIEWER, {99})


def test_creator_submits_draft_and_resubmits_creation_reject() -> None:
    assert _label("draft", created_by=VIEWER) == "Submit"
    # Creation reject: never assigned/started — creator resubmits.
    assert _label("rejected", created_by=VIEWER) == "Resubmit"
    assert _label("draft", created_by=VIEWER + 1) is None


def test_assignee_starts_after_execution_reject() -> None:
    assert (
        _label(
            "rejected",
            assigned_to=VIEWER,
            assigned_at="now",
            started_at="now",
            completed_at="now",
        )
        == "Restart"
    )
    # Creator does not own needs-action when reject is after execution.
    assert (
        _label(
            "rejected",
            created_by=VIEWER,
            assigned_to=VIEWER + 1,
            assigned_at="now",
            started_at="now",
        )
        is None
    )


def test_pending_approver_sees_approve() -> None:
    assert _label("pending_approval", request_id=99) == "Approve"
    assert _label("pending_approval", request_id=98) is None
    assert _label("pending_closure_approval", assigned_to=VIEWER) == "Approve"


def test_assignee_walks_start_verify_close() -> None:
    assert _label("assigned", assigned_to=VIEWER) == "Start"
    assert _label("in_progress", assigned_to=VIEWER) == "Verify"
    assert _label("completed", assigned_to=VIEWER, completed_at="now") == "Close"
    # Completed with a closure approval request → Approve, not Close.
    assert (
        _label("completed", assigned_to=VIEWER, completed_at="now", request_id=99) == "Approve"
    )
    # `approved` means "creation approved" before execution and "closure approved" after it.
    assert _label("approved", assigned_to=VIEWER) == "Start"
    assert _label("approved", assigned_to=VIEWER, completed_at="now") == "Close"


def test_finished_orders_are_nobodys_turn() -> None:
    assert _label("closed", assigned_to=VIEWER, request_id=99) is None
    assert _label("cancelled", created_by=VIEWER) is None
