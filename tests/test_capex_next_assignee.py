"""Unit checks for CapEx next-assignee rules (same role skips picker)."""

from __future__ import annotations

from modules.capex.constants import capex_needs_next_assignee


def test_needs_next_when_roles_differ() -> None:
    assert capex_needs_next_assignee(current_role_id=1, next_role_id=99)


def test_no_picker_without_next_role() -> None:
    assert not capex_needs_next_assignee(current_role_id=1, next_role_id=None)


def test_same_role_skips_picker() -> None:
    assert not capex_needs_next_assignee(current_role_id=5, next_role_id=5)


def test_same_role_string_ids_skips_picker() -> None:
    assert not capex_needs_next_assignee(current_role_id=5, next_role_id=5)
