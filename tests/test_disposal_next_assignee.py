"""Unit checks for disposal next-assignee rules (approve → close same role)."""

from __future__ import annotations

from modules.disposals.constants import disposal_needs_next_assignee


def test_approve_to_close_same_role_skips_picker() -> None:
    assert not disposal_needs_next_assignee(
        current_kind="approve",
        next_kind="close",
        current_role_id=8,
        next_role_id=8,
    )


def test_approve_to_close_different_role_needs_picker() -> None:
    assert disposal_needs_next_assignee(
        current_kind="approve",
        next_kind="close",
        current_role_id=8,
        next_role_id=9,
    )


def test_approve_to_receive_needs_picker() -> None:
    assert disposal_needs_next_assignee(
        current_kind="approve",
        next_kind="receive",
        current_role_id=1,
        next_role_id=2,
    )
