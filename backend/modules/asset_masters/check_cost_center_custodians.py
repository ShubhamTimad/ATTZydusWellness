"""ponytail: assert cost-center custodian mapping shape; upgrade when UI E2E covers it."""

from __future__ import annotations

from modules.asset_masters.schema import (
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


if __name__ == "__main__":
    test_replace_request_accepts_user_ids()
    test_public_shapes()
    print("ok")
