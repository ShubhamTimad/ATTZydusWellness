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
