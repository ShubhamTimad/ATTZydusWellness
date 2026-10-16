"""Unit checks for workflow-derived next-assignee rules (no role-name hardcoding)."""

from __future__ import annotations

from modules.transfers.constants import transfer_needs_next_assignee


def test_needs_next_when_next_role_id_present() -> None:
    assert transfer_needs_next_assignee(
        current_kind="approve",
        next_kind="receive",
        current_role_id=1,
        next_role_id=99,
    )


def test_no_picker_without_next_role_id() -> None:
    assert not transfer_needs_next_assignee(
        current_kind="approve",
        next_kind="receive",
        current_role_id=1,
        next_role_id=None,
    )


def test_confirm_to_close_same_role_skips_picker() -> None:
    assert not transfer_needs_next_assignee(
        current_kind="confirm",
        next_kind="close",
        current_role_id=5,
        next_role_id=5,
    )


def test_approve_to_close_same_role_skips_picker() -> None:
    assert not transfer_needs_next_assignee(
        current_kind="approve",
        next_kind="close",
        current_role_id=5,
        next_role_id=5,
    )


def test_confirm_to_close_different_role_needs_picker() -> None:
    assert transfer_needs_next_assignee(
        current_kind="confirm",
        next_kind="close",
        current_role_id=5,
        next_role_id=7,
    )


def test_enter_receive_does_not_also_log_step_approved() -> None:
    """One approve that opens receive must write one trail row, not step_approved + approved."""
    from pathlib import Path

    src = (
        Path(__file__).resolve().parents[1]
        / "backend/modules/platform/approvals/service.py"
    ).read_text(encoding="utf-8")
    transfer_fn = src.split("def _advance_transfer_after_step", 1)[1].split(
        "def _advance_disposal_after_step", 1
    )[0]
    disposal_fn = src.split("def _advance_disposal_after_step", 1)[1].split(
        "def _last_approve_user_id", 1
    )[0]
    for body, step_log in (
        (transfer_fn, "log_transfer_step_approved"),
        (disposal_fn, "log_disposal_step_approved"),
    ):
        receive_idx = body.rfind('if next_kind == "receive":')
        step_idx = body.rfind(step_log)
        assert receive_idx != -1 and step_idx != -1
        assert receive_idx < step_idx
