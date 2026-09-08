from types import SimpleNamespace

from modules.platform.approvals.schema import ApprovalStepCreate
from modules.platform.approvals.step_roles import step_role_ids


def test_step_create_accepts_multiple_roles() -> None:
    step = ApprovalStepCreate(step_order=1, approver_role_ids=[3, 7])
    assert step.approver_role_id == 3
    assert step.approver_role_ids == [3, 7]


def test_step_role_ids_include_primary_and_extras() -> None:
    step = SimpleNamespace(
        approver_role_id=3,
        approver_roles=[SimpleNamespace(id=3), SimpleNamespace(id=9)],
    )
    assert step_role_ids(step) == [3, 9]
