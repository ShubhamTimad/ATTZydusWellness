"""ponytail: assert cost-center custodian mapping shape; upgrade when UI E2E covers it."""

from __future__ import annotations

from modules.asset_masters.schema import (
    CostCenterCustodianAssignmentPublic,
    CostCenterCustodianUserPublic,
    CostCenterCustodiansPublic,
    CostCenterCustodiansReplaceRequest,
)


def test_replace_request_accepts_user_ids() -> None:
    body = CostCenterCustodiansReplaceRequest(user_ids=[1, 2, 2, 3])
    assert body.user_ids == [1, 2, 2, 3]


def test_public_shapes() -> None:
    user = CostCenterCustodianUserPublic(
        id=1, full_name="Ada", email="a@x.com", username="ada"
    )
    payload = CostCenterCustodiansPublic(
        cost_center_id=9,
        cost_center_code="CC1",
        cost_center_name="Quality",
        plant_id=1,
        items=[user],
    )
    assert payload.items[0].username == "ada"
    assert payload.cost_center_id == 9
    assignment = CostCenterCustodianAssignmentPublic(
        id=4,
        user_id=user.id,
        full_name=user.full_name,
        email=user.email,
        username=user.username,
        cost_center_id=9,
        cost_center_code="CC1",
        cost_center_name="Quality",
        plant_id=1,
        plant_code="P1",
        plant_name="Plant 1",
    )
    assert assignment.user_id == 1
    assert assignment.cost_center_code == "CC1"


if __name__ == "__main__":
    test_replace_request_accepts_user_ids()
    test_public_shapes()
    print("ok")
