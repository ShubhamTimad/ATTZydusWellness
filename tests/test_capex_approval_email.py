"""Final capitalization approval emails the submitter and that cost center's users."""

from __future__ import annotations

from types import SimpleNamespace

from modules.capex.constants import capex_sends_approval_success, status_codes_matching_search
from modules.capex.service import approval_success_recipients


def _user(uid: int, email: str | None, *, active: bool = True):
    return SimpleNamespace(id=uid, email=email, is_active=active, full_name=f"User {uid}")


def test_approval_success_includes_creator_and_cost_center_users_once() -> None:
    creator = _user(1, "cc@example.com")
    peer = _user(2, "peer@example.com")
    inactive = _user(3, "gone@example.com", active=False)
    no_email = _user(4, None)

    recipients = approval_success_recipients(
        creator=creator,
        cost_center_users=[creator, peer, inactive, no_email],
    )

    assert [u.id for u in recipients] == [1, 2]


def test_approval_success_includes_submitter_when_not_the_creator() -> None:
    creator = _user(1, "admin@example.com")
    submitter = _user(5, "user@example.com")
    peer = _user(2, "peer@example.com")

    recipients = approval_success_recipients(
        creator=creator,
        submitter=submitter,
        cost_center_users=[peer, submitter],
    )

    assert [u.id for u in recipients] == [5, 1, 2]


def test_success_mail_goes_out_on_last_approval_before_close() -> None:
    assert capex_sends_approval_success(step_kind="approve", later_step_kinds=["close"])
    assert capex_sends_approval_success(step_kind="approve", later_step_kinds=[])
    assert not capex_sends_approval_success(
        step_kind="approve", later_step_kinds=["approve", "close"]
    )
    assert not capex_sends_approval_success(step_kind="close", later_step_kinds=[])


def test_search_approved_matches_approved_status_not_pending() -> None:
    assert status_codes_matching_search("approved") == ["approved"]
    assert status_codes_matching_search("Pending Approval") == ["pending_approval"]
    assert set(status_codes_matching_search("rejected")) == {"rejected", "in_rework"}
    assert status_codes_matching_search("archived") == ["cancelled"]
