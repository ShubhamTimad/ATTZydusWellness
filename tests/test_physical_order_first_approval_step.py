"""Physical-order workflows: first of many steps is the executor, not an approver."""

from types import SimpleNamespace

from modules.platform.approvals.service import (
    assignment_step_for_workflow,
    first_approval_step,
    physical_same_role_close,
)


def test_three_approve_kinds_skips_first_as_assign() -> None:
    wf = SimpleNamespace(
        entity_type="physical_order_closure",
        steps=[
            SimpleNamespace(id=1, step_order=1, step_kind="approve", approver_role_id=10),
            SimpleNamespace(id=2, step_order=2, step_kind="approve", approver_role_id=20),
            SimpleNamespace(id=3, step_order=3, step_kind="approve", approver_role_id=20),
        ],
    )
    assert assignment_step_for_workflow(wf).id == 1
    assert first_approval_step(wf).id == 2


def test_explicit_assign_then_two_approve() -> None:
    wf = SimpleNamespace(
        entity_type="physical_order_closure",
        steps=[
            SimpleNamespace(id=1, step_order=1, step_kind="assign", approver_role_id=10),
            SimpleNamespace(id=2, step_order=2, step_kind="approve", approver_role_id=20),
            SimpleNamespace(id=3, step_order=3, step_kind="approve", approver_role_id=20),
        ],
    )
    assert assignment_step_for_workflow(wf).id == 1
    assert first_approval_step(wf).id == 2


def test_single_approve_step_is_the_approver() -> None:
    wf = SimpleNamespace(
        entity_type="physical_order_closure",
        steps=[
            SimpleNamespace(id=1, step_order=1, step_kind="approve", approver_role_id=20),
        ],
    )
    assert assignment_step_for_workflow(wf).id == 1
    assert first_approval_step(wf).id == 1


def test_same_role_close_is_not_a_new_handoff() -> None:
    approve = SimpleNamespace(id=2, step_order=2, step_kind="approve", approver_role_id=20)
    close = SimpleNamespace(id=3, step_order=3, step_kind="close", approver_role_id=20)
    other = SimpleNamespace(id=4, step_order=3, step_kind="close", approver_role_id=30)
    assert physical_same_role_close(approve, close) is True
    assert physical_same_role_close(approve, other) is False
    assert physical_same_role_close(approve, None) is False
