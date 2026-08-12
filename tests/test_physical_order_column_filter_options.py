"""Physical order list column filters expose distinct values from list-scoped orders."""

from __future__ import annotations

from modules.orders.schema import (
    PhysicalOrderListFilterCostCenter,
    PhysicalOrderListFilterOptionsResponse,
    PhysicalOrderListFilterPlant,
)


def test_order_list_filter_options_schema() -> None:
    res = PhysicalOrderListFilterOptionsResponse(
        plants=[PhysicalOrderListFilterPlant(id=1, code="P1", name="Plant One")],
        cost_centers=[
            PhysicalOrderListFilterCostCenter(
                id=2, code="CC-1", name="Finance", plant_id=1
            )
        ],
        statuses=["completed", "in_progress"],
    )
    assert res.plants[0].code == "P1"
    assert res.cost_centers[0].id == 2
    assert res.statuses == ["completed", "in_progress"]
