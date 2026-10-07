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


def test_capex_picker_uses_form_step_not_other_workflows() -> None:
    from modules.capex.model import CapitalizationForm
    from modules.capex.service import CapexFormService
    from modules.platform.approvals.model import ApprovalRequest
    from modules.platform.approvals.step_roles import picker_role_ids

    central_finance = 5
    capex_step = SimpleNamespace(
        step_order=3, approver_role_id=central_finance, approver_roles=[SimpleNamespace(id=central_finance)]
    )
    hod_step = SimpleNamespace(step_order=1, approver_role_id=1, approver_roles=[])
    req = SimpleNamespace(workflow=SimpleNamespace(steps=[capex_step, hod_step]))
    form = SimpleNamespace(approval_request_id=42)

    class FakeDb:
        def get(self, model, pk):
            return {CapitalizationForm: form, ApprovalRequest: req}[model]

    step = CapexFormService(FakeDb())._form_step_for_role(34, central_finance)
    assert step is capex_step
    # With the step known, no cross-workflow expansion (db is never queried).
    assert picker_role_ids(None, central_finance, step) == [central_finance]
