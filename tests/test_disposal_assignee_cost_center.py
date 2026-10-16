"""Disposal approver pickers narrow role users to the order cost center."""

from __future__ import annotations

from types import SimpleNamespace

from modules.platform.approvals.org_scope import (
    ORG_SCOPE_DESTINATION,
    ORG_SCOPE_SOURCE,
    effective_step_org_scope,
    filter_users_by_cost_center,
)


def _user(name: str, *cost_center_ids: int):
    return SimpleNamespace(
        full_name=name,
        cost_centers=[SimpleNamespace(id=cc) for cc in cost_center_ids],
    )


def test_unscoped_approve_step_defaults_to_source() -> None:
    step = SimpleNamespace(org_scope=None, step_kind="approve")
    assert effective_step_org_scope(step, default=ORG_SCOPE_SOURCE) == ORG_SCOPE_SOURCE


def test_receive_step_defaults_to_destination() -> None:
    step = SimpleNamespace(org_scope=None, step_kind="receive")
    assert effective_step_org_scope(step, default=ORG_SCOPE_SOURCE) == ORG_SCOPE_DESTINATION


def test_explicit_org_scope_wins() -> None:
    step = SimpleNamespace(org_scope="destination", step_kind="approve")
    assert effective_step_org_scope(step, default=ORG_SCOPE_SOURCE) == ORG_SCOPE_DESTINATION


def test_source_pool_hides_other_cost_center_hods() -> None:
    hod_4100 = _user("Department HOD — CC-4100", 4100)
    hod_5100 = _user("Department HOD — CC-5100", 5100)
    plant_wide = _user("Approver Demo")
    pool = [hod_4100, hod_5100, plant_wide]
    assert filter_users_by_cost_center(pool, cost_center_id=4100) == [hod_4100, plant_wide]


if __name__ == "__main__":
    test_unscoped_approve_step_defaults_to_source()
    test_receive_step_defaults_to_destination()
    test_explicit_org_scope_wins()
    test_source_pool_hides_other_cost_center_hods()
    print("ok")
